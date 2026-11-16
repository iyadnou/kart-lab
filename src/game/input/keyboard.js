// =============================================================================
// input/keyboard.js — keyboard driving, for testing without a phone.
//
//   Arrow keys / WASD   steer, accelerate, brake/reverse
//   Space               handbrake
//   R                   reset kart
// Other keys (G, C, …) are "shortcuts": call onShortcut(key, fn) to react.
// =============================================================================

const DRIVE_KEYS = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'handbrake',
};

export class Keyboard {
  constructor() {
    this.held = { up: false, down: false, left: false, right: false, handbrake: false };
    this.resetPressed = false; // true until someone reads it (see consumeReset)
    this.shortcuts = new Map();

    window.addEventListener('keydown', (event) => {
      // Do not steal keys while typing in the tuning panel's number fields.
      if (event.target instanceof HTMLInputElement) return;
      const action = DRIVE_KEYS[event.code];
      if (action) {
        this.held[action] = true;
        event.preventDefault(); // stop arrows/space from scrolling the page
        return;
      }
      if (event.repeat) return; // holding a key down fires many keydowns
      if (event.code === 'KeyR') this.resetPressed = true;
      this.shortcuts.get(event.code)?.();
    });

    window.addEventListener('keyup', (event) => {
      const action = DRIVE_KEYS[event.code];
      if (action) this.held[action] = false;
    });

    // If the window loses focus we never get the keyup: release everything.
    window.addEventListener('blur', () => {
      for (const key of Object.keys(this.held)) this.held[key] = false;
    });
  }

  /** Run `callback` when a key is pressed, e.g. onShortcut('KeyG', …). */
  onShortcut(code, callback) {
    this.shortcuts.set(code, callback);
  }

  /** Current driving input from the keyboard. */
  read() {
    const h = this.held;
    return {
      steer: (h.right ? 1 : 0) - (h.left ? 1 : 0),
      throttle: h.up ? 1 : 0,
      brake: h.down ? 1 : 0,
      handbrake: h.handbrake,
    };
  }

  /** Returns true once per press of R. */
  consumeReset() {
    const pressed = this.resetPressed;
    this.resetPressed = false;
    return pressed;
  }
}
