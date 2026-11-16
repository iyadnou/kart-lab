// =============================================================================
// main.js — the entry point of the game page. It creates every module and
// connects them; the actual work happens inside the modules.
//
// Reading order if you are new here:
//   config.js   all the numbers
//   loop.js     how time advances (fixed physics steps, smooth rendering)
//   vehicle.js  the kart's physics
//   track/      how the circuit is generated
//   then whatever interests you: camera.js, effects.js, hud.js, input/
// =============================================================================

import './hud.css';
import { CONFIG } from './config.js';
import { Physics } from './physics.js';
import { createScene } from './scene.js';
import { createTrack } from './track/index.js';
import { createTrackMeshes } from './track/meshes.js';
import { addTrackColliders } from './track/colliders.js';
import { createScenery } from './track/scenery.js';
import { Vehicle } from './vehicle.js';
import { KartModel } from './kartModel.js';
import { ChaseCamera } from './camera.js';
import { Effects } from './effects.js';
import { LapTracker } from './laps.js';
import { Input } from './input/index.js';
import { Hud } from './hud.js';
import { AudioManager } from './audio.js';
import { GhostSystem } from './ghost/index.js';
import { DebugView } from './debugView.js';
import { createTuningPanel } from './tuningPanel.js';
import { startLoop } from './loop.js';
import { formatTime } from './mathUtils.js';

const NO_INPUT = { steer: 0, throttle: 0, brake: 0, handbrake: false };
const RUMBLE_INTERVAL_MS = 250; // do not buzz the phone more often than this

async function main() {
  const hud = new Hud();

  // --- World ---------------------------------------------------------------------
  const physics = await Physics.create(CONFIG); // loads the Rapier WebAssembly
  const view = createScene(CONFIG, document.getElementById('view'));

  const track = createTrack(CONFIG);
  addTrackColliders(physics, track, CONFIG);
  view.scene.add(createTrackMeshes(track.geometry, view.renderer.capabilities.getMaxAnisotropy()));
  view.scene.add(createScenery(track));

  // --- Kart ----------------------------------------------------------------------
  const vehicle = new Vehicle(physics, CONFIG, track.startPose);
  const kartModel = new KartModel(CONFIG);
  view.scene.add(kartModel.group);

  const chaseCamera = new ChaseCamera(view.camera, physics, CONFIG);
  const effects = new Effects(view.scene, CONFIG);
  const audio = new AudioManager(CONFIG);
  const debugView = new DebugView(view.scene, physics);

  // --- Rules ---------------------------------------------------------------------
  const laps = new LapTracker(track.path, CONFIG.track.checkpointCount, window.localStorage);
  laps.locate(vehicle.position);

  // --- Ghosts: recorded laps replayed as see-through karts ----------------------------
  const ghosts = new GhostSystem(view.scene, CONFIG, track.path.length);
  await ghosts.load(); // ghosts/player.json and ghosts/ai.json, if they exist

  laps.onLapComplete = (time, isBest) => {
    const ai = ghosts.aiLapTime;
    if (ai !== null && time < ai) hud.toast(`Faster than the AI!  ${formatTime(time)}`);
    else hud.toast(isBest ? `Best lap!  ${formatTime(time)}` : `Lap  ${formatTime(time)}`);
    audio.play(isBest ? 'best' : 'lap');
  };

  // --- Input ---------------------------------------------------------------------
  const input = new Input();
  input.remote.onControllerUrl = (url) => hud.setControllerUrl(url);

  // Tell the phone to vibrate when we hit something (Android only; iPhones
  // ignore it because Safari has no vibration API).
  let lastRumble = 0;
  vehicle.onWallHit = (speed) => {
    const now = performance.now();
    if (speed < 3 || now - lastRumble < RUMBLE_INTERVAL_MS) return;
    lastRumble = now;
    input.remote.send({ type: 'rumble', ms: Math.round(Math.min(30 + speed * 4, 120)) });
    audio.play('bump', speed / 20); // louder for harder hits
  };

  // --- Game state ------------------------------------------------------------------
  let started = false; // false while the start screen is showing
  let phoneWasConnected = false;

  /** Put the kart back on the track at the last checkpoint. */
  function resetKart() {
    const sample = laps.respawnSample;
    const pose = sample ? track.poseAt(sample) : track.startPose;
    vehicle.teleport(pose.position, pose.quaternion);
    laps.locate(vehicle.position);
    chaseCamera.snap();
    audio.play('reset');
  }

  // --- Tuning panel and shortcuts -----------------------------------------------------
  const panel = createTuningPanel(CONFIG, {
    onChange: () => {
      vehicle.applyTuning();
      audio.refresh();
      ghosts.saveSettings();
      refreshSoundControls();
      refreshGhostButton();
    },
    resetKart,
    downloadGhost: () => ghosts.downloadPlayerGhost(),
    setQuality: (quality) => view.setQuality(quality),
    setGravity: (gravity) => physics.setGravity(gravity),
  });
  input.keyboard.onShortcut('KeyG', () => panel.toggle());
  input.keyboard.onShortcut('KeyC', () => debugView.toggle());

  // Sound and ghost switches: HUD buttons, keys, and the tuning panel all
  // change the same CONFIG values; the refresh functions keep labels in sync.
  const refreshSoundControls = hud.bindSoundControls(audio);
  const refreshGhostButton = hud.bindGhostButton(ghosts);
  const refreshPanel = () => panel.gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
  input.keyboard.onShortcut('KeyM', () => {
    audio.toggleMute();
    refreshSoundControls();
    refreshPanel();
  });
  input.keyboard.onShortcut('KeyH', () => {
    ghosts.setEnabled(!ghosts.enabled);
    refreshGhostButton();
    refreshPanel();
  });
  hud.bindQualityButton(CONFIG.graphics.quality, () => {
    CONFIG.graphics.quality = CONFIG.graphics.quality === 'low' ? 'high' : 'low';
    view.setQuality(CONFIG.graphics.quality);
    panel.gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
    return CONFIG.graphics.quality;
  });

  // ===========================================================================
  // One physics step (runs exactly 60 times per simulated second)
  // ===========================================================================
  function step(dt) {
    let driverInput = input.read();

    if (!started) {
      // Start screen: wait for GAS (phone) or the up key.
      if (driverInput.throttle > 0.1) {
        started = true;
        audio.unlock();
        // Started from the phone without ever touching this page? Then the
        // browser is still blocking sound; say how to fix it.
        setTimeout(() => {
          if (audio.blocked && !audio.muted) hud.toast('🔇 Click the game window once for sound', { ms: 6000 });
        }, 700);
      } else {
        driverInput = NO_INPUT;
      }
    }

    if (input.consumeReset() && started) resetKart();

    vehicle.preStep(driverInput, dt);
    physics.step();
    vehicle.postStep(dt);

    laps.update(vehicle.position, dt);
    ghosts.step(vehicle, laps); // record this lap; keep it if it is my fastest
    effects.step(vehicle, dt);

    // Automatic rescue: upside down for too long, or fallen off the world.
    if (vehicle.upsideDownTime > CONFIG.stability.upsideDownSeconds) {
      const pose = track.nearestPose(vehicle.position);
      vehicle.teleport(pose.position, pose.quaternion);
      chaseCamera.snap();
    } else if (vehicle.position.y < CONFIG.stability.fallResetY) {
      resetKart();
    }
  }

  // ===========================================================================
  // One rendered frame (runs as often as the screen refreshes)
  // ===========================================================================
  function render(alpha, frameDt) {
    // `alpha` blends between the previous and the current physics state.
    kartModel.update(vehicle, alpha);
    chaseCamera.update(kartModel.group, vehicle, frameDt);
    view.followWithShadow(kartModel.group.position);
    effects.update(frameDt, view.camera, view.renderer.domElement.height);
    // The lap clock, blended like the kart, so ghosts move smoothly too.
    const ghostTime = laps.lapTime - (1 - alpha) * CONFIG.physics.timestep;
    ghosts.render(ghostTime, laps.lap > 0, kartModel.group.position, frameDt);
    audio.update(vehicle);
    debugView.update();

    const phoneConnected = input.remote.connected;
    if (phoneWasConnected && !phoneConnected) {
      // (On the start screen the QR code already says it all.)
      if (started) hud.toast('Controller disconnected', { ms: 0, warning: true });
    } else if (!phoneWasConnected && phoneConnected) {
      hud.clearToast();
    }
    phoneWasConnected = phoneConnected;

    hud.update({ speedKmh: vehicle.speedKmh, laps, phoneConnected, started, aiLapTime: ghosts.aiLapTime });
    view.renderer.render(view.scene, view.camera);
  }

  hud.hideLoading();
  startLoop({ timestep: CONFIG.physics.timestep, step, render });

  // Handy for experiments in the browser console, e.g. `game.vehicle.speedKmh`.
  window.game = { CONFIG, physics, view, track, vehicle, kartModel, chaseCamera, laps, input, hud, audio, ghosts, resetKart };
}

main().catch((error) => {
  console.error(error);
  document.getElementById('loading').textContent = `Could not start: ${error.message}`;
});
