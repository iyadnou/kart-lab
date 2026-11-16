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
   */
  update({ speedKmh, laps, phoneConnected, started }) {
    const e = this.elements;
    this.#text(e.speed, String(Math.round(speedKmh)));
    this.#text(e.lapNumber, laps.lap > 0 ? String(laps.lap) : '–');
    this.#text(e.lapTime, formatTime(laps.lapTime));
    this.#text(e.lapLast, formatTime(laps.lastLapTime));
    this.#text(e.lapBest, formatTime(laps.bestLapTime));

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
