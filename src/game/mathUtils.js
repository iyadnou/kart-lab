// =============================================================================
// mathUtils.js — small maths helpers shared by several modules.
// =============================================================================

/**
 * Move `current` towards `target` like a critically damped spring: quickly at
 * first, easing in at the end, never overshooting. This is the classic
 * "smooth damp" used by chase cameras.
 *
 * The spring needs to remember its velocity between calls, so pass an object
 * `state` with a numeric `velocity` property; it is updated in place.
 *
 * @param {number} smoothTime  roughly the time (s) to cover most of the gap
 */
export function smoothDamp(current, target, state, smoothTime, dt) {
  const omega = 2 / Math.max(smoothTime, 1e-4);
  const x = omega * dt;
  // A cheap, stable approximation of e^(-x).
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (state.velocity + omega * change) * dt;
  state.velocity = (state.velocity - omega * temp) * decay;
  return target + (change + temp) * decay;
}

/** Same as smoothDamp, but for angles in radians: always takes the short way round. */
export function smoothDampAngle(current, target, state, smoothTime, dt) {
  return smoothDamp(current, current + shortestAngle(current, target), state, smoothTime, dt);
}

/** The signed smallest rotation that takes angle `from` to angle `to`. */
export function shortestAngle(from, to) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * A small seeded random number generator ("mulberry32"). Unlike Math.random()
 * it gives the same sequence every time for the same seed, so the scenery
 * looks identical on every page load.
 */
export function createRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Format seconds as m:ss.mmm for lap times. */
export function formatTime(seconds) {
  if (seconds === null || seconds === undefined) return '–:––.–––';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(3).padStart(6, '0')}`;
}
