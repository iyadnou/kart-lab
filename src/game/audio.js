// =============================================================================
// audio.js — all the kart's sound effects, generated live with the Web Audio
// API. There are no sound files: every sound is built from two raw
// ingredients, OSCILLATORS (pure tones) and NOISE (hiss), shaped by filters.
//
// Web Audio works like a box of effect pedals: you create "nodes" and plug
// them into each other. Ours are wired like this:
//
//   engine:  3 oscillators ─► low-pass filter ─► gain ─┐
//   intake:  noise ─► band-pass filter ─► gain ────────┤
//   skid:    noise ─► band-pass filter ─► gain ────────┼─► master gain ─► limiter ─► speakers
//   grass:   noise ─► low-pass ─► wobble ─► gain ──────┤
//   one-shots (wall hit, lap chime) ───────────────────┘
//
// The four looping layers play ALL the time; we only turn their volume and
// pitch knobs up and down every frame. That is the trick for smooth sound:
// nothing ever starts or stops abruptly, so there are no clicks, and a
// continuous tone or noise has no loop point you could hear.
//
// Every knob change goes through setTargetAtTime(), which glides to the new
// value over a few hundredths of a second instead of jumping.
// =============================================================================

const SETTINGS_KEY = 'kart-lab.audio';
const GLIDE = 0.06; // seconds; how quickly knobs follow their targets

export class AudioManager {
  /** @param {object} config  the CONFIG object (reads CONFIG.audio live) */
  constructor(config) {
    this.config = config;
    this.context = null; // created on the first user gesture, see unlock()
    this.lastIntake = 0;
    this.#loadSettings();

    // Browsers refuse to make sound until the user has interacted with the
    // page. Any key press or click on the game page is enough.
    // (Several event types, because browsers differ in which ones they accept.)
    const gesture = () => this.unlock();
    for (const type of ['keydown', 'pointerdown', 'mousedown', 'click', 'touchend']) {
      window.addEventListener(type, gesture);
    }

    // Do not keep droning while the tab is in the background.
    document.addEventListener('visibilitychange', () => {
      if (!this.context) return;
      if (document.hidden) this.context.suspend();
      else this.context.resume();
    });
  }

  /** True once the browser has allowed us to play. */
  get running() {
    return this.context?.state === 'running';
  }

  /**
   * True while the browser is holding the sound back because nobody has
   * clicked or pressed a key on this page yet. This happens when you drive
   * with the phone only: the phone's taps do not count for the Mac's page.
   */
  get blocked() {
    return !this.running && !document.hidden;
  }

  // ===========================================================================
  // Setting up
  // ===========================================================================

  /** Create (or wake up) the audio system. Safe to call repeatedly. */
  unlock() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContextClass) return; // very old browser: stay silent
      this.context = new AudioContextClass();
      this.#buildGraph();
    }
    if (this.context.state === 'suspended' && !document.hidden) this.context.resume();
  }

  #buildGraph() {
    const ctx = this.context;

    // --- Output: master volume, then a limiter so layers never distort ---------
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    this.master.connect(limiter).connect(ctx.destination);
    this.#applyMasterVolume();

    // --- Noise: two seconds of random numbers, looped forever ---------------------
    // White noise has no pattern, so the loop point is inaudible.
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    noise.start();

    /** A silent gain node feeding the master; we turn it up when needed. */
    const layer = () => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.master);
      return gain;
    };
    const filter = (type, frequency, q = 1) => {
      const node = ctx.createBiquadFilter();
      node.type = type;
      node.frequency.value = frequency;
      node.Q.value = q;
      return node;
    };

    // --- Engine: three oscillators through a low-pass filter ----------------------
    // A sawtooth wave is harsh and buzzy, like a small two-stroke engine. A
    // second, slightly detuned one makes it sound less synthetic, and a
    // square wave one octave lower adds body.
    this.engineGain = layer();
    this.engineFilter = filter('lowpass', 400, 2);
    this.engineFilter.connect(this.engineGain);
    this.engineOscillators = [
      { type: 'sawtooth', ratio: 1.0, level: 0.5 },
      { type: 'sawtooth', ratio: 1.007, level: 0.35 },
      { type: 'square', ratio: 0.5, level: 0.4 },
    ].map(({ type, ratio, level }) => {
      const oscillator = ctx.createOscillator();
      oscillator.type = type;
      const gain = ctx.createGain();
      gain.gain.value = level;
      oscillator.connect(gain).connect(this.engineFilter);
      oscillator.start();
      return { oscillator, ratio };
    });

    // --- Intake roar: the "whoosh" you hear when you step on the gas ---------------
    this.intakeGain = layer();
    this.intakeFilter = filter('bandpass', 500, 1.2);
    noise.connect(this.intakeFilter).connect(this.intakeGain);

    // --- Tyre skid / brake squeal: noise squeezed into a narrow, high band ---------
    this.skidGain = layer();
    this.skidFilter = filter('bandpass', 1900, 7);
    noise.connect(this.skidFilter).connect(this.skidGain);

    // --- Grass rumble: very low noise, with a fast wobble for the bumps -------------
    this.grassGain = layer();
    const wobble = ctx.createGain(); // volume wobbles between 0.4 and 1.0
    wobble.gain.value = 0.7;
    const wobbleSpeed = ctx.createOscillator();
    wobbleSpeed.frequency.value = 13;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 0.3;
    wobbleSpeed.connect(wobbleDepth).connect(wobble.gain);
    wobbleSpeed.start();
    noise.connect(filter('lowpass', 170, 0.7)).connect(wobble).connect(this.grassGain);

    this.noise = noise;
  }

  // ===========================================================================
  // Every frame: follow what the kart is doing
  // ===========================================================================

  /** @param {Vehicle} vehicle */
  update(vehicle) {
    if (!this.running) return;
    const a = this.config.audio;
    const now = this.context.currentTime;
    const glide = (param, value, time = GLIDE) => param.setTargetAtTime(value, now, time);

    const topSpeed = this.config.engine.topSpeedKmh / 3.6;
    const speed = Math.abs(vehicle.forwardSpeed);
    const speed01 = Math.min(speed / topSpeed, 1.15);
    const throttle = vehicle.throttle;

    // --- Engine -----------------------------------------------------------------
    // The kart has one gear, so engine speed simply follows road speed. Pressing
    // the gas raises the pitch a little at once (the engine "pulls") and
    // opens the filter, which makes the tone brighter and more aggressive.
    const pitch = a.engineIdleHz + (a.engineTopHz - a.engineIdleHz) * speed01 + throttle * 9;
    for (const { oscillator, ratio } of this.engineOscillators) glide(oscillator.frequency, pitch * ratio);
    glide(this.engineFilter.frequency, 520 + 900 * speed01 + 1100 * throttle, 0.1);
    glide(this.engineGain.gain, a.engineVolume * (0.24 + 0.14 * speed01 + 0.26 * throttle), 0.1);

    // --- Intake roar: only while accelerating -----------------------------------------
    // Rises quickly when you press the gas and fades slowly when you lift.
    const intake = throttle * (0.35 + 0.65 * Math.min(speed01, 1));
    glide(this.intakeFilter.frequency, 350 + 900 * speed01);
    glide(this.intakeGain.gain, a.engineVolume * 0.55 * intake, intake > this.lastIntake ? 0.04 : 0.25);
    this.lastIntake = intake;

    // --- Skid / brake squeal -----------------------------------------------------------
    // Two reasons for tyre noise: tyres sliding sideways, and hard braking.
    // Both get louder with speed, and need rubber on asphalt.
    let slidingOnAsphalt = 0;
    let onGrass = 0;
    for (const wheel of vehicle.wheels) {
      if (!wheel.inContact) continue;
      if (wheel.surface === 'grass') onGrass += 0.25;
      else if (wheel.sliding) slidingOnAsphalt += 0.25;
    }
    const asphaltShare = vehicle.groundedWheels > 0 ? 1 - onGrass : 0;
    const braking = vehicle.forwardSpeed > 2 ? vehicle.brake * asphaltShare : 0;
    const skid = Math.min(1, Math.max(slidingOnAsphalt * 1.4, braking * 0.8)) * Math.min(speed / 12, 1.3);
    glide(this.skidFilter.frequency, 1500 + 900 * Math.min(speed01, 1)); // pitch rises with speed
    glide(this.skidGain.gain, a.skidVolume * 0.9 * skid, 0.05);

    // --- Grass rumble --------------------------------------------------------------------
    glide(this.grassGain.gain, a.skidVolume * 2.4 * onGrass * Math.min(speed / 10, 1), 0.08);
  }

  // ===========================================================================
  // One-shot sounds
  // ===========================================================================

  /**
   * Play a short sound once.
   * @param {'bump'|'lap'|'best'|'reset'} name
   * @param {number} intensity  0..1, used by 'bump' (how hard the hit was)
   */
  play(name, intensity = 1) {
    if (!this.running) return;
    const level = this.config.audio.effectsVolume;
    if (name === 'bump') this.#bump(Math.min(Math.max(intensity, 0.15), 1) * level);
    else if (name === 'lap') this.#chime([880, 1320], 0.1 * level);
    else if (name === 'best') this.#chime([880, 1109, 1320, 1760], 0.1 * level);
    else if (name === 'reset') this.#chime([520, 390], 0.07 * level);
  }

  /** A wall hit: a thud (falling sine tone) plus a crunch (burst of noise). */
  #bump(volume) {
    const ctx = this.context;
    const now = ctx.currentTime;

    const thud = ctx.createOscillator();
    thud.frequency.setValueAtTime(110, now);
    thud.frequency.exponentialRampToValueAtTime(38, now + 0.18);
    const thudGain = this.#envelope(volume * 0.9, 0.005, 0.22);
    thud.connect(thudGain).connect(this.master);
    thud.start(now);
    thud.stop(now + 0.3);

    const crunch = ctx.createBufferSource();
    crunch.buffer = this.noise.buffer;
    // Start somewhere random in the noise so no two hits sound identical.
    const crunchFilter = ctx.createBiquadFilter();
    crunchFilter.type = 'lowpass';
    crunchFilter.frequency.value = 1100;
    crunch.connect(crunchFilter).connect(this.#envelope(volume * 0.6, 0.002, 0.14)).connect(this.master);
    crunch.start(now, Math.random() * 1.5);
    crunch.stop(now + 0.25);
  }

  /** A few short beeps in a row (lap finished, kart reset). */
  #chime(frequencies, volume) {
    const ctx = this.context;
    frequencies.forEach((frequency, i) => {
      const start = ctx.currentTime + i * 0.09;
      const beep = ctx.createOscillator();
      beep.type = 'triangle';
      beep.frequency.value = frequency;
      beep.connect(this.#envelope(volume, 0.01, 0.16, start)).connect(this.master);
      beep.start(start);
      beep.stop(start + 0.25);
    });
  }

  /**
   * A gain node whose volume rises quickly and then dies away — the
   * "envelope" of a short sound. Starting and ending at silence is what
   * prevents clicks.
   */
  #envelope(peak, attack, decay, start = this.context.currentTime) {
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
    return gain;
  }

  // ===========================================================================
  // Mute and master volume (remembered between visits)
  // ===========================================================================

  get muted() {
    return this.config.audio.muted;
  }

  get volume() {
    return this.config.audio.masterVolume;
  }

  setMuted(muted) {
    this.config.audio.muted = !!muted;
    this.#applyMasterVolume();
    this.#saveSettings();
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** @param {number} volume  0..1 */
  setVolume(volume) {
    this.config.audio.masterVolume = Math.min(Math.max(volume, 0), 1);
    this.#applyMasterVolume();
    this.#saveSettings();
  }

  /** Call after changing CONFIG.audio from outside (the tuning panel). */
  refresh() {
    this.#applyMasterVolume();
    this.#saveSettings();
  }

  #applyMasterVolume() {
    if (!this.master) return;
    const a = this.config.audio;
    // Glide even here, so muting does not click.
    this.master.gain.setTargetAtTime(a.muted ? 0 : a.masterVolume, this.context.currentTime, 0.03);
  }

  #loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {};
      if (typeof saved.muted === 'boolean') this.config.audio.muted = saved.muted;
      if (typeof saved.masterVolume === 'number') this.config.audio.masterVolume = saved.masterVolume;
    } catch {
      // No saved settings (or storage unavailable): keep the defaults.
    }
  }

  #saveSettings() {
    try {
      const { muted, masterVolume } = this.config.audio;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ muted, masterVolume }));
    } catch {
      // Private browsing may forbid storage; not important.
    }
  }
}
