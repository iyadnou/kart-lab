// =============================================================================
// controller/main.js — the phone controller page.
//
// What it does, ~60 times per second:
//   read the tilt (or the slider) and the buttons
//   -> send one small JSON message to the server
//   -> the server relays it to the game on the Mac
//
// The message (the whole "protocol" between phone and game):
//   { type: 'input', steer: -1..1, throttle: 0..1, brake: 0..1,
//     handbrake: true/false, reset: true/false }
// =============================================================================

import './style.css';
import { TiltSteering } from './tilt.js';
import { createHoldButton, createSlider } from './buttons.js';
import { Connection } from './connection.js';
import { enterControllerMode, blockBrowserGestures } from './screen.js';

const SEND_INTERVAL_MS = 1000 / 60;
const SETTINGS_KEY = 'kart-lab.controller';
// Sensitivity slider 0..100 maps to "degrees of tilt for full lock" 60..15.
const LEAST_SENSITIVE_DEG = 60;
const MOST_SENSITIVE_DEG = 15;

const $ = (id) => document.getElementById(id);

// --- Parts ------------------------------------------------------------------------
const tilt = new TiltSteering();
const connection = new Connection();
const gas = createHoldButton($('gas'));
const brake = createHoldButton($('brake'));
const handbrake = createHoldButton($('handbrake'));
const reset = createHoldButton($('reset'));
const slider = createSlider($('slider'), $('slider-knob'));

blockBrowserGestures();

// --- Settings (remembered on this phone) ---------------------------------------------
const settings = { sensitivity: 55, mode: 'tilt', ...loadSettings() };

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {};
  } catch {
    return {};
  }
}

function applySettings() {
  const t = settings.sensitivity / 100;
  tilt.fullLockDegrees = LEAST_SENSITIVE_DEG + (MOST_SENSITIVE_DEG - LEAST_SENSITIVE_DEG) * t;
  $('sensitivity').value = settings.sensitivity;
  $('mode').value = settings.mode;
  $('slider').hidden = settings.mode !== 'slider';
  $('wheel').hidden = settings.mode === 'slider';
  $('calibrate').hidden = settings.mode === 'slider';
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing may forbid storage; settings then last until reload.
  }
}

$('sensitivity').addEventListener('input', (event) => {
  settings.sensitivity = Number(event.target.value);
  applySettings();
});
$('mode').addEventListener('change', (event) => {
  settings.mode = event.target.value;
  applySettings();
});
$('settings-toggle').addEventListener('click', () => ($('settings').hidden = !$('settings').hidden));
$('settings-close').addEventListener('click', () => ($('settings').hidden = true));
$('calibrate').addEventListener('click', () => tilt.calibrate());
applySettings();

// --- Start: needs a tap, because iOS only grants sensor access from a tap ---------------
$('start').addEventListener('click', async () => {
  const granted = await tilt.start();
  enterControllerMode(); // fullscreen, landscape lock, keep the screen on

  if (!granted) {
    useSliderFallback('Tilt permission was denied — using the slider.');
  } else {
    // Permission is fine, but is there really a sensor? Give it a moment.
    setTimeout(() => {
      if (!tilt.available && settings.mode === 'tilt') {
        useSliderFallback('No tilt sensor found — using the slider.');
      }
    }, 1200);
  }
  $('start-overlay').hidden = true;
});

function useSliderFallback(reason) {
  settings.mode = 'slider';
  applySettings();
  showStatusNote(reason);
}

// --- Connection status pill ---------------------------------------------------------------
let statusNote = null;
function showStatusNote(text) {
  statusNote = text;
  updateStatus();
  setTimeout(() => {
    statusNote = null;
    updateStatus();
  }, 4000);
}

function updateStatus() {
  const element = $('status');
  let text = 'Connecting…';
  let state = '';
  if (connection.open && connection.gameReady) {
    text = 'Connected';
    state = 'ready';
  } else if (connection.open) {
    text = 'Waiting for the game…';
    state = 'waiting';
  }
  element.className = `status ${state}`;
  $('status-text').textContent = statusNote ?? text;
}
connection.onStatusChange = updateStatus;
updateStatus();

// --- Messages from the game ------------------------------------------------------------------
connection.onMessage = (message) => {
  if (message.type === 'rumble') {
    // Vibration exists on Android; iPhones have no navigator.vibrate.
    navigator.vibrate?.(Number(message.ms) || 50);
  }
};

// --- The send loop ------------------------------------------------------------------------------
let lastSendTime = 0;

function frame(now) {
  requestAnimationFrame(frame);

  const steer = settings.mode === 'slider' ? slider.value : tilt.value;

  // Visual feedback: the dot on the bar and the little steering wheel.
  $('steer-dot').style.left = `${50 + steer * 46}%`;
  $('wheel').style.transform = `rotate(${steer * 90}deg)`;

  // requestAnimationFrame can run at 120 Hz on some phones; 60 is plenty.
  if (now - lastSendTime < SEND_INTERVAL_MS - 1) return;
  lastSendTime = now;

  connection.send({
    type: 'input',
    steer: Math.round(steer * 1000) / 1000, // 3 decimals keep the message short
    throttle: gas.pressed ? 1 : 0,
    brake: brake.pressed ? 1 : 0,
    handbrake: handbrake.pressed,
    reset: reset.pressed,
  });
}
requestAnimationFrame(frame);
