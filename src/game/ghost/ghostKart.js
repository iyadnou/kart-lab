// =============================================================================
// ghost/ghostKart.js — one see-through kart that replays a recording.
//
// It reuses the normal kart model, repainted with a single transparent
// material. A ghost is purely visual: it has no physics body at all, so it
// cannot touch your kart or anything else.
// =============================================================================

import * as THREE from 'three';
import { KartModel } from '../kartModel.js';
import { sampleGhost } from './recording.js';

const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();

export class GhostKart {
  /**
   * @param {object} config  the CONFIG object
   * @param {number} color   tint of the ghost, e.g. 0x66ccff
   */
  constructor(config, color) {
    this.config = config;
    this.recording = null;

    this.model = new KartModel(config);
    this.material = new THREE.MeshStandardMaterial({
      color,
      emissive: color, // glows a little, so it reads as "not a real kart"
      emissiveIntensity: 0.35,
      roughness: 0.6,
      transparent: true,
      opacity: config.ghost.opacity,
    });
    this.model.group.traverse((object) => {
      if (!object.isMesh) return;
      object.material = this.material;
      object.castShadow = false; // ghosts cast no shadow
      object.receiveShadow = false;
    });
    this.model.group.visible = false;
  }

  /** The Three.js object to add to the scene. */
  get object() {
    return this.model.group;
  }

  /** Give the ghost a recording to replay (or null to remove it). */
  setRecording(recording) {
    this.recording = recording;
    this.model.group.visible = false;
  }

  /**
   * Place the ghost where its recording was `time` seconds into the lap.
   * @param {number} time       seconds since the player crossed the start line
   * @param {boolean} enabled   the on/off switch from the menu
   * @param {THREE.Vector3} playerPosition  to fade the ghost when it is in your face
   * @param {number} frameDt    real frame time, to spin the wheels
   */
  update(time, enabled, playerPosition, frameDt) {
    const group = this.model.group;
    // Hidden when switched off, when there is no recording, and after the
    // ghost has finished its lap (it reappears when you start your next one).
    if (!enabled || !this.recording || time > this.recording.lapTime) {
      group.visible = false;
      return;
    }
    group.visible = true;

    const speed = sampleGhost(this.recording, Math.max(time, 0), _position, _quaternion);
    this.model.setPose(_position, _quaternion, speed, frameDt);

    // Fade out when very close to the player so it never blocks the view
    // (your own ghost starts every lap exactly where you are).
    const distance = _position.distanceTo(playerPosition);
    const nearFade = THREE.MathUtils.smoothstep(distance, 1.5, 7);
    this.material.opacity = this.config.ghost.opacity * (0.12 + 0.88 * nearFade);
  }
}
