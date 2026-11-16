// =============================================================================
// hud.js — the heads-up display: speed, lap times, connection status, the QR
// code and the start screen. It is plain HTML (see index.html) on top of the
// 3D canvas; this module only fills in text and shows/hides elements.
// =============================================================================

import QRCode from 'qrcode';
import { formatTime } from './mathUtils.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.elements = {
      lapNumber: $('lap-number'),
      lapTime: $('lap-time'),
      lapLast: $('lap-last'),
      lapBest: $('lap-best'),
      speed: $('speed-value'),
      connection: $('connection'),
      connectionText: $('connection-text'),
      qrCard: $('qr-card'),
      qrSmall: $('qr-small'),
      qrLarge: $('qr-large'),
      controllerUrl: $('controller-url'),
      startScreen: $('start-screen'),
      startWaiting: $('start-waiting'),
      startReady: $('start-ready'),
      toast: $('toast'),
      qualityButton: $('quality-button'),
      ghostButton: $('ghost-button'),
      soundButton: $('sound-button'),
      volumeSlider: $('volume-slider'),
      soundHint: $('sound-hint'),
      aiRow: $('ai-row'),
      lapAi: $('lap-ai'),
      loading: $('loading'),
    };
    // Remember what each element currently shows, so we only touch the page
    // when something actually changed (DOM updates are comparatively slow).
    this.shown = new Map();
    this.toastTimer = null;
  }

  /** Set an element's text, but only if it differs from what is shown. */
  #text(element, value) {
    if (this.shown.get(element) === value) return;
    this.shown.set(element, value);
    element.textContent = value;
  }

  hideLoading() {
    this.elements.loading.classList.add('hidden');
  }

  /** Draw the QR codes for the phone's address. */
  setControllerUrl(url) {
    this.elements.controllerUrl.textContent = url;
    const options = { margin: 1, color: { dark: '#0d1117', light: '#ffffff' } };
    QRCode.toCanvas(this.elements.qrLarge, url, { ...options, width: 210 });
    QRCode.toCanvas(this.elements.qrSmall, url, { ...options, width: 84 });
  }

  /**
   * Refresh everything. Called once per frame.
   * @param {object} s
   * @param {number} s.speedKmh
   * @param {LapTracker} s.laps
   * @param {boolean} s.phoneConnected
   * @param {boolean} s.started   has the player left the start screen?
   * @param {number|null} s.aiLapTime  the AI ghost's lap time, if there is one
   */
  update({ speedKmh, laps, phoneConnected, started, aiLapTime }) {
    const e = this.elements;
    this.#text(e.speed, String(Math.round(speedKmh)));
    this.#text(e.lapNumber, laps.lap > 0 ? String(laps.lap) : '–');
    this.#text(e.lapTime, formatTime(laps.lapTime));
    this.#text(e.lapLast, formatTime(laps.lastLapTime));
    this.#text(e.lapBest, formatTime(laps.bestLapTime));

    // Best | Last | AI — the AI row only exists if an AI ghost was loaded, and
    // is highlighted once your best lap is faster than the AI's.
    e.aiRow.hidden = aiLapTime === null;
    if (aiLapTime !== null) {
      this.#text(e.lapAi, formatTime(aiLapTime));
      e.aiRow.classList.toggle('beaten', laps.bestLapTime !== null && laps.bestLapTime < aiLapTime);
    }

    this.#text(e.connectionText, phoneConnected ? 'Phone connected' : 'No phone');
    e.connection.classList.toggle('connected', phoneConnected);

    // Start screen: QR code until a phone connects, then "Press GAS".
    e.startScreen.classList.toggle('hidden', started);
    e.startWaiting.hidden = phoneConnected;
    e.startReady.hidden = !phoneConnected;
    // While driving, a small QR code stays in the corner if no phone is connected.
    e.qrCard.hidden = !started || phoneConnected;
  }

  /** Show a short message in the middle of the screen. `ms = 0` keeps it until cleared. */
  toast(message, { ms = 2500, warning = false } = {}) {
    const el = this.elements.toast;
    el.textContent = message;
    el.classList.toggle('warning', warning);
    el.classList.add('visible');
    clearTimeout(this.toastTimer);
    if (ms > 0) this.toastTimer = setTimeout(() => this.clearToast(), ms);
  }

  clearToast() {
    clearTimeout(this.toastTimer);
    this.elements.toast.classList.remove('visible');
  }

  /**
   * Wire the Sound button and the volume slider to the audio manager.
   * Returns a function that refreshes their labels (call it after the mute
   * state changed some other way, e.g. the M key).
   */
  bindSoundControls(audio) {
    const { soundButton, volumeSlider } = this.elements;
    const refresh = () => {
      // "Blocked" = the browser is waiting for a click on this page before
      // it lets us make sound (see AudioManager.blocked).
      const blocked = audio.blocked && !audio.muted;
      soundButton.textContent = blocked ? 'Sound: click to enable' : `Sound: ${audio.muted ? 'Off' : 'On'}`;
      soundButton.classList.toggle('attention', blocked);
      this.elements.soundHint.hidden = !blocked;
      volumeSlider.value = Math.round(audio.volume * 100);
    };
    soundButton.addEventListener('click', () => {
      // If sound was blocked, this click is what unblocks it: do not also mute.
      if (!soundButton.classList.contains('attention')) audio.toggleMute();
      refresh();
      soundButton.blur();
    });
    volumeSlider.addEventListener('input', () => audio.setVolume(volumeSlider.value / 100));
    // Give the keyboard back to the game after using the slider.
    volumeSlider.addEventListener('change', () => volumeSlider.blur());
    refresh();
    // The blocked state changes by itself (first click, tab hidden…): poll it.
    setInterval(() => {
      if (document.activeElement !== volumeSlider) refresh();
    }, 400);
    return refresh;
  }

  /** Wire the Ghosts button. Returns a function that refreshes its label. */
  bindGhostButton(ghosts) {
    const button = this.elements.ghostButton;
    const refresh = () => (button.textContent = `Ghosts: ${ghosts.enabled ? 'On' : 'Off'}`);
    button.addEventListener('click', () => {
      ghosts.setEnabled(!ghosts.enabled);
      refresh();
      button.blur();
    });
    refresh();
    return refresh;
  }

  /** Wire the Quality button. `onToggle()` must return the new quality name. */
  bindQualityButton(initial, onToggle) {
    const label = (quality) => `Quality: ${quality === 'low' ? 'Low' : 'High'}`;
    this.elements.qualityButton.textContent = label(initial);
    this.elements.qualityButton.addEventListener('click', (event) => {
      event.currentTarget.textContent = label(onToggle());
      event.currentTarget.blur(); // so Space does not "click" it again
    });
  }
}
