// =============================================================================
// controller/connection.js — the phone's WebSocket link to the server.
//
// Keeps itself alive: if the connection drops (Wi-Fi hiccup, server
// restarted) it tries again every second.
// =============================================================================

const RECONNECT_MS = 1000;

export class Connection {
  constructor() {
    /** Is the WebSocket to the server open? */
    this.open = false;
    /** Is a game page connected to the server too? */
    this.gameReady = false;
    /** Callbacks you can set. */
    this.onStatusChange = null; // fn()
    this.onMessage = null; // fn(message) for messages from the game

    this.#connect();
  }

  #connect() {
    // The server serves this page, so it is at the same host and port.
    this.socket = new WebSocket(`wss://${location.host}/ws?role=controller`);

    this.socket.addEventListener('open', () => {
      this.open = true;
      this.onStatusChange?.();
    });

    this.socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === 'status') {
        // From the relay: how many game pages are listening?
        this.gameReady = message.games > 0;
        this.onStatusChange?.();
      } else {
        this.onMessage?.(message);
      }
    });

    this.socket.addEventListener('close', () => {
      this.open = false;
      this.gameReady = false;
      this.onStatusChange?.();
      setTimeout(() => this.#connect(), RECONNECT_MS);
    });
  }

  /** Send an object as JSON (silently skipped while disconnected). */
  send(message) {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}
