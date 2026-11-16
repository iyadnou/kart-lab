// =============================================================================
// input/remote.js — receives the phone's input over WebSocket.
//
// The phone sends ~60 messages per second (see src/controller/main.js):
//   { type: 'input', steer: -1..1, throttle: 0..1, brake: 0..1,
//     handbrake: bool, reset: bool }
// They arrive here via the relay in server/relay.js.
//
// Safety rule: if no input message arrives for 500 ms (phone asleep, Wi-Fi
// hiccup, browser closed) we treat the controller as disconnected and all its
// inputs as zero, so the kart never keeps accelerating on stale data.
// =============================================================================

const TIMEOUT_MS = 500;
const RECONNECT_MS = 1000;

export class RemoteController {
  constructor() {
    this.state = { steer: 0, throttle: 0, brake: 0, handbrake: false };
    this.lastMessageTime = -Infinity;
    this.resetHeld = false; // for turning the held button into a single event
    this.resetPressed = false;
    /** The address the phone should open; arrives from the server. */
    this.controllerUrl = null;
    /** Optional callback: fn(url) when the controller URL becomes known. */
    this.onControllerUrl = null;

    this.#connect();
  }

  #connect() {
    // Same host and port as the page itself; wss:// because the page is https://.
    this.socket = new WebSocket(`wss://${location.host}/ws?role=game`);

    this.socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return; // ignore anything that is not JSON
      }
      if (message.type === 'input') this.#onInput(message);
      else if (message.type === 'status') this.#onStatus(message);
    });

    // The server restarted or the network dropped: keep trying.
    this.socket.addEventListener('close', () => setTimeout(() => this.#connect(), RECONNECT_MS));
  }

  #onInput(message) {
    // Never trust numbers from the network: force them into range.
    const number = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);
    this.state.steer = number(message.steer, -1, 1);
    this.state.throttle = number(message.throttle, 0, 1);
    this.state.brake = number(message.brake, 0, 1);
    this.state.handbrake = !!message.handbrake;

    // `reset` is true for as long as the button is held; we want one event.
    if (message.reset && !this.resetHeld) this.resetPressed = true;
    this.resetHeld = !!message.reset;

    this.lastMessageTime = performance.now();
  }

  #onStatus(message) {
    if (message.controllerUrl && message.controllerUrl !== this.controllerUrl) {
      this.controllerUrl = message.controllerUrl;
      this.onControllerUrl?.(this.controllerUrl);
    }
  }

  /** True while fresh input is arriving from a phone. */
  get connected() {
    return performance.now() - this.lastMessageTime < TIMEOUT_MS;
  }

  /** The phone's input, or all zeros if it has gone quiet. */
  read() {
    if (!this.connected) {
      this.state.steer = this.state.throttle = this.state.brake = 0;
      this.state.handbrake = false;
    }
    return this.state;
  }

  consumeReset() {
    const pressed = this.resetPressed;
    this.resetPressed = false;
    return pressed;
  }

  /** Send a message to the phone(s), e.g. { type: 'rumble', ms: 60 }. */
  send(message) {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}
