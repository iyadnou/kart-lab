// =============================================================================
// input/index.js — one place the game asks "what does the driver want?".
//
// It merges the two input sources into a single object:
//   { steer: -1..1, throttle: 0..1, brake: 0..1, handbrake: bool }
// so the rest of the game does not care whether a phone or a keyboard (or,
// one day, a gamepad or an AI) is driving.
// =============================================================================

import { Keyboard } from './keyboard.js';
import { RemoteController } from './remote.js';

export class Input {
  constructor() {
    this.keyboard = new Keyboard();
    this.remote = new RemoteController();
    this.current = { steer: 0, throttle: 0, brake: 0, handbrake: false };
  }

  /** Read both sources and combine them. Call once per physics step. */
  read() {
    const k = this.keyboard.read();
    const r = this.remote.read();
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    // Adding/maxing means either device works at any time, even together.
    this.current.steer = clamp(k.steer + r.steer, -1, 1);
    this.current.throttle = Math.max(k.throttle, r.throttle);
    this.current.brake = Math.max(k.brake, r.brake);
    this.current.handbrake = k.handbrake || r.handbrake;
    return this.current;
  }

  /** True once after R or the phone's RESET button was pressed. */
  consumeReset() {
    // Note: both are called on purpose (no short-circuit `||` between calls),
    // so neither source keeps a stale press.
    const fromKeyboard = this.keyboard.consumeReset();
    const fromRemote = this.remote.consumeReset();
    return fromKeyboard || fromRemote;
  }
}
