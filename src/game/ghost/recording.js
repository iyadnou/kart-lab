// =============================================================================
// ghost/recording.js — the ghost file format, recording a lap, and reading a
// recorded lap back at any moment in time.
//
// A ghost is a recording of WHERE the kart was, not of what the driver did:
//   position + rotation + speed, 30 times per second, for one lap.
// Replaying it is just "put the ghost kart where the recording says". That
// is why a ghost can never drift away from its original run, and why a lap
// driven by the AI in training (training/) replays in the game unchanged.
//
// No rendering and no browser APIs here: this file is also used by Node
// (training/kart-env.js records the AI's lap with the very same class).
//
// The file format (JSON):
//   {
//     "format": "kart-lab-ghost", "version": 1,
//     "source": "player" | "ai",       who drove it
//     "name": "My best lap",
//     "lapTime": 41.283,               seconds
//     "sampleRate": 30,                samples per second
//     "trackLength": 944.2,            to notice ghosts from another circuit
//     "created": "2026-11-16T10:00:00.000Z",
//     "samples": [ [x, y, z, qx, qy, qz, qw, speed], ... ]
//   }
// Sample number k was taken k / sampleRate seconds after crossing the line.
// (x, y, z) is the position, (qx, qy, qz, qw) the rotation as a quaternion,
// speed is in m/s (used to spin the ghost's wheels).
// =============================================================================

import * as THREE from 'three';

export const GHOST_FORMAT = 'kart-lab-ghost';
export const GHOST_VERSION = 1;
export const GHOST_SAMPLE_RATE = 30;

const round = (value, decimals) => Number(value.toFixed(decimals));

export class GhostRecorder {
  /**
   * @param {number} physicsTimestep  seconds per physics step (1/60)
   * @param {number} trackLength      lap length in metres, stored in the file
   */
  constructor(physicsTimestep, trackLength) {
    // Physics runs at 60 Hz, we keep every 2nd step -> 30 samples per second.
    this.every = Math.max(1, Math.round(1 / (physicsTimestep * GHOST_SAMPLE_RATE)));
    this.sampleRate = 1 / (physicsTimestep * this.every);
    this.trackLength = trackLength;
    this.lap = 0; // the lap currently being recorded (0 = not started)
    this.tick = 0; // physics steps since that lap began
    this.samples = [];
  }

  /**
   * Call once per physics step, AFTER the lap tracker was updated.
   * Returns a finished recording at the moment a lap is completed, else null.
   *
   * @param {Vehicle} vehicle
   * @param {LapTracker} laps
   * @param {{source?: string, name?: string}} meta  stored in the recording
   */
  update(vehicle, laps, meta = {}) {
    if (laps.lap === this.lap) {
      // Same lap as before: keep sampling.
      if (this.lap > 0 && ++this.tick % this.every === 0) this.#sample(vehicle);
      return null;
    }

    // The lap number changed: the kart just crossed the start/finish line.
    let finished = null;
    if (this.lap > 0 && laps.lap === this.lap + 1 && this.samples.length > 1) {
      finished = {
        format: GHOST_FORMAT,
        version: GHOST_VERSION,
        source: meta.source ?? 'player',
        name: meta.name ?? 'Recorded lap',
        lapTime: round(laps.lastLapTime, 3),
        sampleRate: this.sampleRate,
        trackLength: round(this.trackLength, 1),
        created: new Date().toISOString(),
        samples: this.samples,
      };
    }
    // Start recording the new lap with a sample at time 0.
    this.lap = laps.lap;
    this.tick = 0;
    this.samples = [];
    if (this.lap > 0) this.#sample(vehicle);
    return finished;
  }

  #sample(vehicle) {
    const p = vehicle.position;
    const q = vehicle.quaternion;
    // Rounding keeps the file small: millimetres are plenty.
    this.samples.push([
      round(p.x, 3), round(p.y, 3), round(p.z, 3),
      round(q.x, 4), round(q.y, 4), round(q.z, 4), round(q.w, 4),
      round(vehicle.forwardSpeed, 2),
    ]);
  }
}

/**
 * Check that something loaded from a file really is a usable ghost.
 * Returns an error message, or null if it is fine.
 */
export function validateGhost(ghost) {
  if (!ghost || typeof ghost !== 'object') return 'not an object';
  if (ghost.format !== GHOST_FORMAT) return 'not a Kart Lab ghost file';
  if (ghost.version !== GHOST_VERSION) return `unsupported version ${ghost.version}`;
  if (!(ghost.lapTime > 0) || !(ghost.sampleRate > 0)) return 'missing lapTime or sampleRate';
  if (!Array.isArray(ghost.samples) || ghost.samples.length < 2) return 'no samples';
  const ok = (s) => Array.isArray(s) && s.length === 8 && s.every(Number.isFinite);
  if (!ghost.samples.every(ok)) return 'malformed samples';
  return null;
}

const _nextPosition = new THREE.Vector3();
const _nextQuaternion = new THREE.Quaternion();

/**
 * Where was the ghost `time` seconds into its lap?
 *
 * The recording only has a sample every 1/30 s, but the screen may refresh
 * faster, so we INTERPOLATE: find the two samples around `time` and blend
 * them (straight-line blend for the position, "slerp" for the rotation).
 *
 * Writes into `position` and `quaternion`, returns the speed in m/s.
 */
export function sampleGhost(ghost, time, position, quaternion) {
  const samples = ghost.samples;
  const exact = THREE.MathUtils.clamp(time * ghost.sampleRate, 0, samples.length - 1);
  const index = Math.min(Math.floor(exact), samples.length - 2);
  const blend = exact - index; // 0 = at sample `index`, 1 = at the next one

  const a = samples[index];
  const b = samples[index + 1];
  position.set(a[0], a[1], a[2]).lerp(_nextPosition.set(b[0], b[1], b[2]), blend);
  quaternion.set(a[3], a[4], a[5], a[6]).slerp(_nextQuaternion.set(b[3], b[4], b[5], b[6]), blend).normalize();
  return a[7] + (b[7] - a[7]) * blend;
}
