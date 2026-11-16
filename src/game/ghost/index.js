// =============================================================================
// ghost/index.js — the ghost system: records your laps, keeps your fastest
// one as "your ghost", and replays it together with the AI's ghost.
//
//   recording.js  the file format, recording, reading back with interpolation
//   storage.js    loading/saving ghosts/<name>.json through the server
//   ghostKart.js  the see-through kart
//
// Timeline of a ghost: every time you cross the start line, both ghosts
// restart their laps from the line too. So you always race them from the
// same moment, lap after lap.
// =============================================================================

import { GhostRecorder } from './recording.js';
import { GhostKart } from './ghostKart.js';
import { loadGhost, saveGhost, downloadGhost } from './storage.js';

const PLAYER_COLOR = 0x7fd4ff; // light blue: your own best lap
const AI_COLOR = 0xff6ad5; // pink: the AI driver
const SETTINGS_KEY = 'kart-lab.ghost';

export class GhostSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} config        the CONFIG object (reads CONFIG.ghost live)
   * @param {number} trackLength   lap length in metres
   */
  constructor(scene, config, trackLength) {
    this.config = config;
    this.trackLength = trackLength;
    this.recorder = new GhostRecorder(config.physics.timestep, trackLength);
    this.player = new GhostKart(config, PLAYER_COLOR);
    this.ai = new GhostKart(config, AI_COLOR);
    scene.add(this.player.object, this.ai.object);
    this.#loadSettings();
  }

  /** Load both ghost files from the server. Call once at start-up. */
  async load() {
    const [player, ai] = await Promise.all([loadGhost('player'), loadGhost('ai')]);
    this.player.setRecording(this.#fitsThisTrack(player, 'player'));
    this.ai.setRecording(this.#fitsThisTrack(ai, 'ai'));
  }

  /** A ghost recorded on a different circuit would drive through the scenery. */
  #fitsThisTrack(ghost, name) {
    if (!ghost) return null;
    if (Math.abs(ghost.trackLength - this.trackLength) > 1) {
      console.warn(`Ignoring ghost "${name}": it was recorded on a different track layout.`);
      return null;
    }
    return ghost;
  }

  /** The AI ghost's lap time in seconds, or null if there is no AI ghost. */
  get aiLapTime() {
    return this.ai.recording?.lapTime ?? null;
  }

  /** Your ghost's lap time in seconds, or null. */
  get playerLapTime() {
    return this.player.recording?.lapTime ?? null;
  }

  /**
   * Call once per physics step, after the lap tracker. Records the current
   * lap; when a lap is completed and it is faster than your ghost, it
   * becomes your new ghost and is saved to ghosts/player.json.
   */
  step(vehicle, laps) {
    const finished = this.recorder.update(vehicle, laps, { source: 'player', name: 'My best lap' });
    if (!finished) return;
    const current = this.playerLapTime;
    if (current === null || finished.lapTime < current) {
      this.player.setRecording(finished);
      saveGhost('player', finished); // in the background; the game does not wait
    }
  }

  /**
   * Call once per rendered frame.
   * @param {number} lapTime  seconds since the start line was crossed
   * @param {boolean} racing  false before the first crossing (ghosts wait on the line)
   */
  render(lapTime, racing, playerPosition, frameDt) {
    const g = this.config.ghost;
    const time = racing ? lapTime : 0;
    this.player.update(time, g.showPlayer, playerPosition, frameDt);
    this.ai.update(time, g.showAI, playerPosition, frameDt);
  }

  /** Are any ghosts switched on? */
  get enabled() {
    return this.config.ghost.showPlayer || this.config.ghost.showAI;
  }

  /** Switch both ghosts on or off together (the HUD button). */
  setEnabled(enabled) {
    this.config.ghost.showPlayer = this.config.ghost.showAI = enabled;
    this.saveSettings();
  }

  /** Download your ghost as a file. */
  downloadPlayerGhost() {
    if (this.player.recording) downloadGhost(this.player.recording, 'kart-lab-ghost.json');
  }

  /** Remember the on/off switches for the next visit. */
  saveSettings() {
    try {
      const { showPlayer, showAI } = this.config.ghost;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ showPlayer, showAI }));
    } catch {
      // Storage unavailable: the switches just reset on reload.
    }
  }

  #loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {};
      if (typeof saved.showPlayer === 'boolean') this.config.ghost.showPlayer = saved.showPlayer;
      if (typeof saved.showAI === 'boolean') this.config.ghost.showAI = saved.showAI;
    } catch {
      // Keep the defaults.
    }
  }
}
