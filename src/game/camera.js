// =============================================================================
// camera.js — the third-person chase camera.
//
// Each frame:
//   1. Work out the IDEAL spot: behind and above the kart.
//   2. Do not jump there — follow with springs, so the camera lags a little.
//      The direction it sits in lags more than its position, which is what
//      makes the kart visibly swing in turns.
//   3. Cast a ray from the kart to the camera; if a wall or hill is in the
//      way, pull the camera in front of it so it never ends up inside things.
//   4. Look at a point slightly ahead of the kart, and widen the field of
//      view with speed (a cheap, effective sense of speed).
// =============================================================================

import * as THREE from 'three';
import { GROUP } from './physics.js';
import { smoothDamp, smoothDampAngle } from './mathUtils.js';

const UP = new THREE.Vector3(0, 1, 0);
const _forward = new THREE.Vector3();
const _ideal = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _ray = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();

export class ChaseCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {Physics} physics  for the anti-clipping ray casts
   * @param {object} config    the CONFIG object
   */
  constructor(camera, physics, config) {
    this.camera = camera;
    this.physics = physics;
    this.config = config;

    this.yaw = 0; // smoothed compass direction the camera looks along
    this.position = new THREE.Vector3(); // smoothed camera position
    this.lookAt = new THREE.Vector3();
    this.fov = config.camera.fovDeg;

    // Spring velocities (see smoothDamp in mathUtils.js).
    this.springs = {
      yaw: { velocity: 0 },
      x: { velocity: 0 },
      y: { velocity: 0 },
      z: { velocity: 0 },
      fov: { velocity: 0 },
    };
    this.needsSnap = true;
  }

  /** Jump straight to the ideal spot on the next update (after a respawn). */
  snap() {
    this.needsSnap = true;
  }

  /**
   * @param {THREE.Object3D} kart   the kart model (already interpolated)
   * @param {Vehicle} vehicle       for speed and for excluding it from rays
   * @param {number} dt             real frame time in seconds
   */
  update(kart, vehicle, dt) {
    const c = this.config.camera;

    // The kart's heading as a compass angle, ignoring pitch and roll.
    _forward.set(0, 0, 1).applyQuaternion(kart.quaternion);
    const kartYaw = Math.atan2(_forward.x, _forward.z);

    if (this.needsSnap) {
      this.yaw = kartYaw;
      for (const spring of Object.values(this.springs)) spring.velocity = 0;
    } else {
      this.yaw = smoothDampAngle(this.yaw, kartYaw, this.springs.yaw, c.rotationLag, dt);
    }

    // 1. Ideal position: `distance` behind (along the smoothed yaw), `height` above.
    _ideal.set(
      kart.position.x - Math.sin(this.yaw) * c.distance,
      kart.position.y + c.height,
      kart.position.z - Math.cos(this.yaw) * c.distance,
    );

    // 2. Follow with a spring on each axis.
    if (this.needsSnap) {
      this.position.copy(_ideal);
    } else {
      const s = this.springs;
      this.position.x = smoothDamp(this.position.x, _ideal.x, s.x, c.positionLag, dt);
      this.position.y = smoothDamp(this.position.y, _ideal.y, s.y, c.positionLag * 1.6, dt);
      this.position.z = smoothDamp(this.position.z, _ideal.z, s.z, c.positionLag, dt);
    }

    // 3. Anti-clipping. Ray from just above the kart towards the camera.
    _focus.copy(kart.position).addScaledVector(UP, c.lookHeight);
    _ray.copy(this.position).sub(_focus);
    const wanted = _ray.length();
    _ray.divideScalar(wanted);
    const mask = GROUP.GROUND | GROUP.WALL | GROUP.OBSTACLE;
    const hit = this.physics.castRay(_focus, _ray, wanted + c.collisionMargin, mask, vehicle.body);
    const finalPosition = this.camera.position.copy(this.position);
    if (hit !== null) {
      // Something is in the way: stop a little in front of it.
      finalPosition.copy(_focus).addScaledVector(_ray, Math.max(hit - c.collisionMargin, 0.5));
    }
    // Also never sink into the ground directly below the camera.
    const probeHeight = 3;
    _ray.copy(finalPosition).addScaledVector(UP, probeHeight);
    const ground = this.physics.castRay(_ray, { x: 0, y: -1, z: 0 }, probeHeight + c.collisionMargin, GROUP.GROUND);
    if (ground !== null) finalPosition.y += probeHeight + c.collisionMargin - ground;

    // 4. Aim slightly ahead of the kart; the look target is smoothed a bit too.
    _lookTarget.copy(kart.position).addScaledVector(_forward, c.lookAhead).addScaledVector(UP, c.lookHeight);
    if (this.needsSnap) this.lookAt.copy(_lookTarget);
    else this.lookAt.lerp(_lookTarget, 1 - Math.exp(-dt * 12));
    this.camera.lookAt(this.lookAt);

    // Speed-based field of view.
    const topSpeed = this.config.engine.topSpeedKmh;
    const speed01 = THREE.MathUtils.clamp(vehicle.speedKmh / topSpeed, 0, 1);
    const targetFov = THREE.MathUtils.lerp(c.fovDeg, c.fovMaxDeg, speed01 * speed01);
    this.fov = this.needsSnap ? targetFov : smoothDamp(this.fov, targetFov, this.springs.fov, 0.4, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    this.needsSnap = false;
  }
}
