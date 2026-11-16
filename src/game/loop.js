// =============================================================================
// loop.js — the game loop: fixed-timestep physics + interpolated rendering.
//
// The problem: the browser calls us once per screen refresh (60, 120, 144 Hz…
// or irregularly when the computer is busy). Physics, however, must advance in
// equal steps, otherwise the kart would handle differently on every machine.
//
// The solution ("fix your timestep"):
//   * Collect real elapsed time in an `accumulator`.
//   * While at least one physics step's worth of time has collected, run a
//     physics step and take that time out again.
//   * Whatever is left over (less than one step) tells us how far we are
//     BETWEEN the last two physics states: alpha = leftover / timestep (0..1).
//     The renderer draws the kart blended between those two states, which
//     keeps motion perfectly smooth on any display.
// =============================================================================

/**
 * @param {object} options
 * @param {number} options.timestep            physics step in seconds
 * @param {(dt: number) => void} options.step  advance the simulation one step
 * @param {(alpha: number, frameDt: number) => void} options.render
 *        draw a frame; alpha = blend between previous and current physics state
 */
export function startLoop({ timestep, step, render }) {
  let accumulator = 0;
  let lastTime = performance.now();

  function frame(now) {
    // Real time since the previous frame. Capped: after a pause (tab in the
    // background, breakpoint) we do not want to simulate seconds at once.
    const frameDt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    accumulator += frameDt;
    while (accumulator >= timestep) {
      step(timestep);
      accumulator -= timestep;
    }

    render(accumulator / timestep, frameDt);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
