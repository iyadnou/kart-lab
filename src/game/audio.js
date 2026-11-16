// =============================================================================
// audio.js — a STUB. Sound is out of scope for version 1, but the game
// already calls these methods at the right moments, so adding sound later
// means filling in this one file.
//
// Ideas for a real implementation (Web Audio API):
//   * engine: an OscillatorNode (or a looped sample) whose pitch follows
//     vehicle.speedKmh — update it in update()
//   * skid: a looped noise sample whose volume follows vehicle.isSliding
//   * one-shots in play(): 'bump' (wall hit), 'lap' (lap completed)
// Browsers only allow audio after a user gesture, so create the AudioContext
// in unlock(), which main.js calls when the player starts driving.
// =============================================================================

export class AudioManager {
  /** Called once when the player first presses GAS (a user gesture). */
  unlock() {}

  /** Called every frame with the vehicle, for continuous sounds. */
  update(_vehicle) {}

  /** Play a one-shot sound by name: 'bump', 'lap', 'reset'. */
  play(_name) {}
}
