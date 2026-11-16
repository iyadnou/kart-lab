// =============================================================================
// laps.js — checkpoints, lap counting and lap timing. Pure logic: no
// rendering, no physics engine.
//
// The checkpoints are invisible gates spread evenly around the track. Gate 0
// is the start/finish line. A lap only counts if you pass every gate in order,
// so turning around after the line and crossing it again does nothing.
//
// How a gate is detected: every step we ask the track "which centre-line
// sample is the kart nearest to?". That index grows as you drive forward.
// When it moves from below a gate's index to at/above it, you passed the gate.
// =============================================================================

const BEST_LAP_KEY = 'kart-lab.bestLap';

export class LapTracker {
  /**
   * @param {TrackPath} path
   * @param {number} checkpointCount
   * @param {Storage|null} storage  localStorage in the browser, null in tests
   */
  constructor(path, checkpointCount, storage = null) {
    this.path = path;
    this.storage = storage;

    /** Sample index of every gate; gate 0 is the start line (sample 0). */
    this.gates = [];
    for (let i = 0; i < checkpointCount; i++) {
      this.gates.push(Math.round((i * path.count) / checkpointCount));
    }

    this.lap = 0; // 0 = have not crossed the start line yet
    this.nextGate = 0; // the gate we must pass next
    this.lastGate = 0; // the gate we passed most recently (for respawning)
    this.lapTime = 0; // seconds in the current lap
    this.lastLapTime = null;
    this.bestLapTime = this.#loadBest();

    this.sampleIndex = null; // nearest sample to the kart, updated each step

    /** Optional callback: fn(lapTime, isNewBest) when a lap is completed. */
    this.onLapComplete = null;
  }

  /** Call when the kart is placed on the track (start, reset). */
  locate(position) {
    this.sampleIndex = this.path.nearestIndex(position);
  }

  /** Call once per physics step. */
  update(position, dt) {
    if (this.sampleIndex === null) this.locate(position);
    if (this.lap > 0) this.lapTime += dt;

    const count = this.path.count;
    const previous = this.sampleIndex;
    const current = this.path.nearestIndex(position, previous);
    this.sampleIndex = current;

    // How many samples did we advance? The track is a loop, so the raw
    // difference can be off by a whole lap; fold it into -count/2..count/2.
    let advance = current - previous;
    if (advance > count / 2) advance -= count;
    if (advance < -count / 2) advance += count;
    if (advance <= 0) return; // standing still or going backwards

    // Did the samples we just moved over include the next gate?
    const gate = this.gates[this.nextGate];
    const stepsToGate = (((gate - previous) % count) + count) % count; // 0 = on it
    if (stepsToGate > 0 && stepsToGate <= advance) this.#passGate();
  }

  #passGate() {
    if (this.nextGate === 0) {
      // Crossed the start/finish line with all other gates done.
      if (this.lap > 0) this.#completeLap();
      this.lap++;
      this.lapTime = 0;
    }
    this.lastGate = this.nextGate;
    this.nextGate = (this.nextGate + 1) % this.gates.length;
  }

  #completeLap() {
    this.lastLapTime = this.lapTime;
    const isBest = this.bestLapTime === null || this.lapTime < this.bestLapTime;
    if (isBest) {
      this.bestLapTime = this.lapTime;
      this.storage?.setItem(BEST_LAP_KEY, String(this.lapTime));
    }
    this.onLapComplete?.(this.lastLapTime, isBest);
  }

  #loadBest() {
    const saved = Number(this.storage?.getItem(BEST_LAP_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  }

  /** The track sample of the last gate passed — where "reset kart" puts you. */
  get respawnSample() {
    // Before the first crossing, respawn at the starting grid instead.
    return this.lap === 0 ? null : this.path.sample(this.gates[this.lastGate]);
  }
}
