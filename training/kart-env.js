// =============================================================================
// training/kart-env.js — the game as a reinforcement-learning environment.
//
// It runs the REAL game physics (the same Vehicle, track and colliders the
// browser uses), just without graphics. So whatever the AI learns here is
// valid in the game, and a lap it drives here replays in the game exactly.
//
// An RL environment is a loop of three things:
//   observation  what the driver can "see" (a list of numbers)
//   action       what the driver does: [steer, gas, brake]
//   reward       one number saying how good the last moment was
// The learning algorithm (PPO, in train.py) tries actions, collects rewards
// and gradually prefers what earned more.
//
// One env step = 3 physics steps (the AI decides 20 times per second).
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../src/game/config.js';
import { Physics, GROUP } from '../src/game/physics.js';
import { Vehicle } from '../src/game/vehicle.js';
import { LapTracker } from '../src/game/laps.js';
import { createTrack } from '../src/game/track/index.js';
import { addTrackColliders } from '../src/game/track/colliders.js';
import { GhostRecorder } from '../src/game/ghost/recording.js';
import { createRandom, shortestAngle } from '../src/game/mathUtils.js';

// --- Settings ---------------------------------------------------------------------
const PHYSICS_STEPS_PER_ACTION = 3;
const MAX_TRAIN_STEPS = 1200; // 60 s per training episode
const MAX_EVAL_STEPS = 5000;

// What the driver sees.
const RAY_ANGLES_DEG = [-90, -45, -20, -8, 0, 8, 20, 45, 90]; // wall distance sensors
const RAY_RANGE = 40; // metres
const LOOKAHEAD_METRES = [8, 16, 28, 42, 60]; // points on the centre line ahead
export const OBSERVATION_SIZE = 8 + RAY_ANGLES_DEG.length + LOOKAHEAD_METRES.length * 3;

// Reward shaping.
const REWARD = {
  progressPerMetre: 0.1, // the main signal: get round the track
  timePerStep: -0.02, // every moment costs a little -> faster is better
  grassPerStep: -0.05, // multiplied by the share of wheels on grass
  wallHit: -1.0,
  lapBase: 10, // finishing a lap…
  lapParSeconds: 60, // …plus 1 per second under this time
  failure: -10, // stuck, flipped or driving the wrong way
};

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();

export class KartEnv {
  static async create() {
    const physics = await Physics.create(CONFIG);
    return new KartEnv(physics);
  }

  constructor(physics) {
    this.physics = physics;
    this.track = createTrack(CONFIG);
    this.path = this.track.path;
    addTrackColliders(physics, this.track, CONFIG);
    this.vehicle = new Vehicle(physics, CONFIG, this.track.startPose);
    this.wallHits = 0;
    this.vehicle.onWallHit = () => this.wallHits++;
    this.dt = CONFIG.physics.timestep;
    this.random = createRandom(1);
    this.bestGhost = null; // fastest lap recorded in eval mode
    // Ray casts only work once the world has been stepped at least once.
    physics.step();
    this.reset({ mode: 'eval' });
  }

  /**
   * Start a new episode.
   *  mode 'train': a random spot on the track, random speed — so the AI
   *                practises every corner, not just the first one.
   *  mode 'eval':  the game's real starting grid, at rest. Laps are timed
   *                and recorded as ghosts.
   */
  reset({ mode = 'train', seed = null, laps = 3 } = {}) {
    if (seed !== null) this.random = createRandom(seed);
    this.mode = mode;
    this.targetLaps = laps;
    this.steps = 0;
    this.wallHits = 0;
    this.lapStartStep = 0;

    if (mode === 'eval') {
      const pose = this.track.startPose;
      this.vehicle.teleport(pose.position, pose.quaternion);
      this.bestGhost = null;
    } else {
      const r = this.random;
      const sample = this.path.sample(Math.floor(r() * this.path.count));
      const pose = this.track.poseAt(sample);
      pose.position.addScaledVector(sample.right, (r() * 2 - 1) * 3); // up to 3 m off-centre
      const yawNoise = new THREE.Quaternion().setFromAxisAngle(sample.up, (r() * 2 - 1) * 0.15);
      pose.quaternion.premultiply(yawNoise);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(pose.quaternion);
      this.vehicle.teleport(pose.position, pose.quaternion, forward.multiplyScalar(r() * 18));
    }

    this.laps = new LapTracker(this.path, CONFIG.track.checkpointCount);
    this.laps.locate(this.vehicle.position);
    this.recorder = new GhostRecorder(this.dt, this.path.length);
    this.progress = this.#trackDistance();
    this.distanceThisLap = 0; // metres since the last full lap (train mode)
    this.windowProgress = 0; // for the "stuck" check
    this.windowSteps = 0;
    return this.#observe();
  }

  /**
   * @param {number[]} action  three numbers in -1..1 from the neural network:
   *   [0] steering  -1 = full left, +1 = full right
   *   [1] gas       -1 = none, +1 = full   (mapped to 0..1)
   *   [2] brake     below 0 = none, +1 = full
   */
  step(action) {
    const clamp = THREE.MathUtils.clamp;
    const input = {
      steer: clamp(action[0], -1, 1),
      throttle: clamp((action[1] + 1) / 2, 0, 1),
      brake: clamp(action[2], 0, 1),
      handbrake: false,
    };

    const hitsBefore = this.wallHits;
    const info = {};
    let advanced = 0;
    let grass = 0;

    for (let i = 0; i < PHYSICS_STEPS_PER_ACTION; i++) {
      this.vehicle.preStep(input, this.dt);
      this.physics.step();
      this.vehicle.postStep(this.dt);
      this.laps.update(this.vehicle.position, this.dt);

      // Eval mode: time real laps and keep the fastest as a ghost.
      if (this.mode === 'eval') {
        const ghost = this.recorder.update(this.vehicle, this.laps, { source: 'ai', name: 'AI driver (PPO)' });
        if (ghost) {
          info.lap_time = ghost.lapTime;
          if (!this.bestGhost || ghost.lapTime < this.bestGhost.lapTime) this.bestGhost = ghost;
        }
      }

      // How far did we move along the track? (Negative when going backwards.)
      const distance = this.#trackDistance();
      let delta = distance - this.progress;
      if (delta > this.path.length / 2) delta -= this.path.length; // crossed the line backwards
      if (delta < -this.path.length / 2) delta += this.path.length; // crossed the line forwards
      this.progress = distance;
      advanced += delta;
      grass += this.vehicle.wheels.filter((w) => w.inContact && w.surface === 'grass').length / 4;
    }
    grass /= PHYSICS_STEPS_PER_ACTION;
    this.steps++;

    // --- Reward ------------------------------------------------------------------
    let reward = advanced * REWARD.progressPerMetre + REWARD.timePerStep + grass * REWARD.grassPerStep;
    if (this.wallHits > hitsBefore) reward += REWARD.wallHit;

    // A full lap's distance covered: bonus, bigger for a faster lap.
    this.distanceThisLap += advanced;
    if (this.distanceThisLap >= this.path.length) {
      const seconds = (this.steps - this.lapStartStep) * PHYSICS_STEPS_PER_ACTION * this.dt;
      reward += REWARD.lapBase + Math.max(0, REWARD.lapParSeconds - seconds);
      this.distanceThisLap -= this.path.length;
      this.lapStartStep = this.steps;
    }

    // --- Is the episode over? --------------------------------------------------------
    // "terminated" = it ended because of what the driver did.
    // "truncated"  = we simply ran out of time.
    let terminated = false;
    // Stuck or going the wrong way: less than 3 m of progress in 4 seconds.
    this.windowProgress += advanced;
    if (++this.windowSteps >= 80) {
      if (this.windowProgress < 3) terminated = true;
      this.windowProgress = 0;
      this.windowSteps = 0;
    }
    if (this.vehicle.upsideDownTime > 1 || this.vehicle.position.y < CONFIG.stability.fallResetY) terminated = true;
    if (terminated) reward += REWARD.failure;

    let truncated = false;
    if (this.mode === 'eval') {
      // The first crossing of the line starts lap 1, so `laps.lap - 1` laps are complete.
      if (this.laps.lap - 1 >= this.targetLaps) truncated = true;
      if (this.steps >= MAX_EVAL_STEPS) truncated = true;
    } else if (this.steps >= MAX_TRAIN_STEPS) {
      truncated = true;
    }

    return { obs: this.#observe(), reward, terminated, truncated, info };
  }

  /** Distance along the centre line (0 .. track length), measured smoothly. */
  #trackDistance() {
    const sample = this.path.sample(this.laps.sampleIndex);
    const along = _v.copy(this.vehicle.position).sub(sample.position).dot(sample.forward);
    return sample.distance + along;
  }

  /**
   * Build the observation: everything the driver knows, scaled so that the
   * numbers are roughly between -1 and 1 (neural networks learn best that way).
   */
  #observe() {
    const v = this.vehicle;
    const path = this.path;
    const sample = path.sample(this.laps.sampleIndex);
    const obs = [];

    // --- The kart's own motion (8 numbers) -------------------------------------
    obs.push(v.forwardSpeed / 25); // 25 m/s = top speed
    obs.push(v.velocity.dot(v.left) / 10); // sideways sliding
    obs.push(_v.copy(v.body.angvel()).dot(v.up) / 3); // how fast it is turning
    // Heading relative to the track direction, as sine and cosine so there
    // is no jump between +180° and -180°.
    const kartYaw = Math.atan2(v.forward.x, v.forward.z);
    const trackYaw = Math.atan2(sample.forward.x, sample.forward.z);
    const headingError = shortestAngle(trackYaw, kartYaw);
    obs.push(Math.sin(headingError), Math.cos(headingError));
    // Sideways position on the track: -1 = at the left wall, +1 = at the right wall.
    const lateral = _v.copy(v.position).sub(sample.position).dot(sample.right);
    obs.push(lateral / this.track.geometry.wallDistance);
    obs.push(v.steerAngle / CONFIG.steering.maxAngleLowSpeed);
    obs.push(v.wheels.filter((w) => w.inContact && w.surface === 'grass').length / 4);

    // --- Distance to the walls: rays fanned out in front (9 numbers) -------------
    _origin.copy(v.position).addScaledVector(v.up, 0.3);
    for (const degrees of RAY_ANGLES_DEG) {
      _dir.copy(v.forward).applyAxisAngle(v.up, THREE.MathUtils.degToRad(-degrees)); // + = to the right
      const hit = this.physics.castRay(_origin, _dir, RAY_RANGE, GROUP.WALL, v.body);
      obs.push((hit ?? RAY_RANGE) / RAY_RANGE);
    }

    // --- The road ahead: upcoming centre-line points (15 numbers) ------------------
    // Each point is given as "how far to my left" and "how far in front of me",
    // plus how sharply the track bends there.
    for (const metres of LOOKAHEAD_METRES) {
      const ahead = path.sample(this.laps.sampleIndex + Math.round(metres / path.spacing));
      _v.copy(ahead.position).sub(v.position);
      obs.push(_v.dot(v.left) / 60, _v.dot(v.forward) / 60, ahead.curvature * 20);
    }
    return obs;
  }
}
