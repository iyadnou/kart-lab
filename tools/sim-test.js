// =============================================================================
// tools/sim-test.js — run the game's physics WITHOUT graphics, in Node.
//
//   npm run sim
//
// It does two things:
//   1. Checks the track shape (length, tightest corner, parts too close).
//   2. Lets a very simple "robot driver" do two laps and prints what happened.
//
// This is handy after changing the track layout or the vehicle tuning: if the
// robot can no longer finish a lap, something is probably off. It is also a
// small demo of how AI karts could reuse Vehicle + TrackPath later.
// =============================================================================

import { CONFIG } from '../src/game/config.js';
import { Physics } from '../src/game/physics.js';
import { Vehicle } from '../src/game/vehicle.js';
import { LapTracker } from '../src/game/laps.js';
import { createTrack } from '../src/game/track/index.js';
import { addTrackColliders } from '../src/game/track/colliders.js';

const track = createTrack(CONFIG);
const { path } = track;

// --- 1. Track shape report -----------------------------------------------------
const corridor = CONFIG.track.roadWidth / 2 + CONFIG.track.vergeWidth;
let tightest = Infinity;
let tightestAt = 0;
for (const s of path.samples) {
  const radius = 1 / Math.max(Math.abs(s.curvature), 1e-6);
  if (radius < tightest) {
    tightest = radius;
    tightestAt = s.distance;
  }
}
// Closest approach between two parts of the track that are NOT neighbours
// along the lap (at least 60 m apart by road).
let closest = Infinity;
const skip = Math.round(60 / path.spacing);
for (let i = 0; i < path.count; i++) {
  for (let j = i + skip; j < path.count; j++) {
    if (path.count - j + i < skip) continue;
    closest = Math.min(closest, path.samples[i].position.distanceTo(path.samples[j].position));
  }
}
const heights = path.samples.map((s) => s.position.y);
console.log('TRACK');
console.log(`  length            ${path.length.toFixed(0)} m  (${path.count} samples)`);
console.log(`  tightest corner   ${tightest.toFixed(1)} m radius at ${tightestAt.toFixed(0)} m` +
  (tightest < corridor + 2 ? '   <-- TOO TIGHT, inner wall will fold' : ''));
console.log(`  closest approach  ${closest.toFixed(1)} m` +
  (closest < corridor * 2 + 4 ? '   <-- TOO CLOSE, corridors overlap' : ''));
console.log(`  height range      ${Math.min(...heights).toFixed(1)} .. ${Math.max(...heights).toFixed(1)} m`);

// --- 2. Robot laps ---------------------------------------------------------------
const physics = await Physics.create(CONFIG);
addTrackColliders(physics, track.geometry, CONFIG);
const vehicle = new Vehicle(physics, CONFIG, track.startPose);
const laps = new LapTracker(path, CONFIG.track.checkpointCount);
laps.locate(vehicle.position);

let wallHits = 0;
vehicle.onWallHit = () => wallHits++;
laps.onLapComplete = (time) => console.log(`  lap done in ${time.toFixed(2)} s`);

/** Steer towards a point further along the centre line; slow down for corners. */
function robotDriver() {
  const speed = Math.max(vehicle.forwardSpeed, 0);
  const here = laps.sampleIndex ?? 0;

  // Aim at a point ahead; look further ahead the faster we go.
  const lookAhead = 5 + speed * 0.45;
  const target = path.sample(here + Math.round(lookAhead / path.spacing)).position;
  const toTarget = target.clone().sub(vehicle.position);
  const angle = Math.atan2(toTarget.dot(vehicle.left), toTarget.dot(vehicle.forward));
  const steer = Math.max(-1, Math.min(1, -angle * 2.5)); // + angle = target is to the left

  // Find the sharpest curve in the next stretch and the speed it allows.
  let maxCurvature = 0;
  const brakingDistance = (speed * speed) / (2 * 12) + 8;
  for (let d = 0; d < brakingDistance; d += path.spacing) {
    maxCurvature = Math.max(maxCurvature, Math.abs(path.sample(here + Math.round(d / path.spacing)).curvature));
  }
  const safeSpeed = Math.sqrt(15 / Math.max(maxCurvature, 1e-4)); // v = sqrt(a / curvature)

  return {
    steer,
    throttle: speed < safeSpeed ? 1 : 0,
    brake: speed > safeSpeed + 1.5 ? 1 : 0,
    handbrake: false,
  };
}

console.log('ROBOT DRIVE');
const dt = CONFIG.physics.timestep;
let topSpeed = 0;
let maxRollDeg = 0;
let offRoadSteps = 0;
let airSteps = 0;
let steps = 0;
const maxSteps = 240 / dt;
while (laps.lap < 3 && steps < maxSteps) {
  vehicle.preStep(robotDriver(), dt);
  physics.step();
  vehicle.postStep(dt);
  laps.update(vehicle.position, dt);

  topSpeed = Math.max(topSpeed, vehicle.speedKmh);
  maxRollDeg = Math.max(maxRollDeg, Math.abs(Math.asin(vehicle.left.y)) * (180 / Math.PI));
  if (vehicle.wheels.some((w) => w.inContact && w.surface === 'grass')) offRoadSteps++;
  if (vehicle.groundedWheels === 0) airSteps++;
  steps++;
}

console.log(`  laps completed    ${Math.max(laps.lap - 1, 0)} of 2`);
console.log(`  best lap          ${laps.bestLapTime?.toFixed(2) ?? '—'} s`);
console.log(`  top speed         ${topSpeed.toFixed(1)} km/h`);
console.log(`  max body lean     ${maxRollDeg.toFixed(1)}° (includes road banking)`);
console.log(`  time on grass     ${(offRoadSteps * dt).toFixed(1)} s`);
console.log(`  time airborne     ${(airSteps * dt).toFixed(1)} s`);
console.log(`  wall hits         ${wallHits}`);
console.log(`  simulated         ${(steps * dt).toFixed(1)} s`);
process.exit(laps.lap >= 3 ? 0 : 1);
