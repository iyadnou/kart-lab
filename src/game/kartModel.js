// =============================================================================
// kartModel.js — what the kart LOOKS like. Built entirely from simple shapes
// (boxes, cylinders, spheres) in code, so there are no model files.
//
// The model has no influence on the driving; it just copies the physics
// state every frame:
//   * the whole group follows the chassis (blended between two physics
//     states — see loop.js)
//   * each wheel moves up/down with its suspension, turns with the steering
//     and spins with the distance travelled
//
// Local axes, as everywhere: +X = left, +Y = up, +Z = forward.
// =============================================================================

import * as THREE from 'three';

const COLORS = {
  body: 0x12a89a, // teal
  accent: 0xff7a1a, // orange
  dark: 0x23262c,
  metal: 0x9aa0a8,
  tire: 0x17181b,
  suit: 0xf2f2f0,
  visor: 0x16181d,
};

export class KartModel {
  constructor(config) {
    this.config = config;
    /** Add this to the scene. */
    this.group = new THREE.Group();
    this.group.name = 'kart';

    this.#buildBody();
    this.#buildDriver();
    this.#buildWheels();

    this.group.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
  }

  /** Small helper: make a mesh, place it, add it to a parent. */
  #part(geometry, material, position, parent = this.group) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    parent.add(mesh);
    return mesh;
  }

  #buildBody() {
    const paint = new THREE.MeshStandardMaterial({ color: COLORS.body, roughness: 0.35, metalness: 0.1 });
    const accent = new THREE.MeshStandardMaterial({ color: COLORS.accent, roughness: 0.4, metalness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: COLORS.dark, roughness: 0.7 });
    const metal = new THREE.MeshStandardMaterial({ color: COLORS.metal, roughness: 0.3, metalness: 0.8 });
    const box = (w, h, l) => new THREE.BoxGeometry(w, h, l);

    // Heights are relative to the physics body's centre, which rides about
    // 0.33 m above the road; so y = -0.2 is just above the ground.
    this.#part(box(0.74, 0.06, 1.75), dark, [0, -0.2, 0.02]); // floor pan

    // Nose: a wedge made from a box that is lower at the front.
    const nose = this.#part(box(0.46, 0.16, 0.62), paint, [0, -0.1, 0.68]);
    nose.rotation.x = 0.16;
    this.#part(box(0.3, 0.05, 0.3), accent, [0, 0.0, 0.62]).rotation.x = 0.16; // nose stripe
    this.#part(box(1.02, 0.07, 0.2), accent, [0, -0.17, 0.98]); // front bumper

    // Side pods between the wheels.
    for (const side of [-1, 1]) {
      this.#part(box(0.2, 0.17, 0.72), paint, [side * 0.42, -0.1, 0.02]);
      this.#part(box(0.21, 0.04, 0.5), accent, [side * 0.42, 0.0, 0.02]);
    }

    // Seat: a base and a tilted back rest.
    this.#part(box(0.42, 0.07, 0.4), dark, [0, -0.14, -0.2]);
    const seatBack = this.#part(box(0.44, 0.52, 0.07), dark, [0, 0.08, -0.42]);
    seatBack.rotation.x = -0.25;

    // Engine behind the seat, with an exhaust pipe.
    this.#part(box(0.46, 0.26, 0.3), metal, [0, -0.04, -0.68]);
    this.#part(box(0.3, 0.1, 0.22), dark, [0, 0.13, -0.68]);
    const exhaust = this.#part(new THREE.CylinderGeometry(0.045, 0.055, 0.5, 8), metal, [-0.3, 0.0, -0.78]);
    exhaust.rotation.x = Math.PI / 2 - 0.3;
    this.#part(box(0.98, 0.07, 0.09), dark, [0, -0.12, -0.96]); // rear bumper

    // Steering column and wheel. The wheel turns with the front wheels.
    const column = this.#part(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), metal, [0, 0.02, 0.4]);
    column.rotation.x = -0.95;
    this.steeringWheel = new THREE.Group();
    this.steeringWheel.position.set(0, 0.17, 0.2);
    this.steeringWheel.rotation.x = -0.95 + Math.PI / 2; // tilt towards the driver
    this.group.add(this.steeringWheel);
    this.#part(new THREE.TorusGeometry(0.13, 0.022, 6, 14), dark, [0, 0, 0], this.steeringWheel);
    this.#part(box(0.24, 0.03, 0.02), dark, [0, 0, 0], this.steeringWheel);
  }

  #buildDriver() {
    const suit = new THREE.MeshStandardMaterial({ color: COLORS.suit, roughness: 0.8 });
    const helmet = new THREE.MeshStandardMaterial({ color: COLORS.accent, roughness: 0.25, metalness: 0.1 });
    const visor = new THREE.MeshStandardMaterial({ color: COLORS.visor, roughness: 0.1, metalness: 0.6 });
    const glove = new THREE.MeshStandardMaterial({ color: COLORS.dark, roughness: 0.8 });

    // The driver leans with the kart a little; grouping makes that easy.
    this.driver = new THREE.Group();
    this.group.add(this.driver);
    const d = this.driver;

    const torso = this.#part(new THREE.CapsuleGeometry(0.17, 0.26, 4, 10), suit, [0, 0.16, -0.26], d);
    torso.rotation.x = -0.18;
    this.#part(new THREE.SphereGeometry(0.17, 14, 10), helmet, [0, 0.55, -0.27], d); // helmet
    this.#part(new THREE.BoxGeometry(0.25, 0.09, 0.12), visor, [0, 0.56, -0.14], d); // visor
    this.#part(new THREE.BoxGeometry(0.06, 0.03, 0.3), new THREE.MeshStandardMaterial({ color: 0xffffff }), [0, 0.715, -0.27], d); // helmet stripe

    for (const side of [-1, 1]) {
      // Arm from the shoulder to the steering wheel.
      const shoulder = new THREE.Vector3(side * 0.2, 0.3, -0.2);
      const hand = new THREE.Vector3(side * 0.12, 0.18, 0.18);
      const arm = this.#part(new THREE.CapsuleGeometry(0.05, shoulder.distanceTo(hand) - 0.1, 3, 6), suit, [0, 0, 0], d);
      arm.position.copy(shoulder).lerp(hand, 0.5);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hand.clone().sub(shoulder).normalize());
      this.#part(new THREE.SphereGeometry(0.055, 8, 6), glove, hand.toArray(), d);

      // Leg stretched forward beside the steering column.
      const leg = this.#part(new THREE.CapsuleGeometry(0.065, 0.5, 3, 6), suit, [side * 0.12, -0.06, 0.12], d);
      leg.rotation.x = Math.PI / 2 - 0.12;
    }
  }

  #buildWheels() {
    const w = this.config.wheels;
    const tireMaterial = new THREE.MeshStandardMaterial({ color: COLORS.tire, roughness: 0.9 });
    const rimMaterial = new THREE.MeshStandardMaterial({ color: COLORS.accent, roughness: 0.4, metalness: 0.3 });
    const spokeMaterial = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.5 });

    /**
     * Each wheel is two nested groups:
     *   pivot — positioned by the suspension, rotated around Y by the steering
     *   spin  — rotated around the axle (X) as the wheel rolls
     */
    this.wheels = [];
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const left = i % 2 === 0;
      const width = front ? 0.15 : 0.2; // rear tyres are wider
      const pivot = new THREE.Group();
      const spin = new THREE.Group();
      pivot.add(spin);
      this.group.add(pivot);

      // Cylinders stand upright by default; rotate so the axis is the axle (X).
      const tire = new THREE.CylinderGeometry(w.radius, w.radius, width, 18).rotateZ(Math.PI / 2);
      this.#part(tire, tireMaterial, [0, 0, 0], spin);
      const rim = new THREE.CylinderGeometry(w.radius * 0.55, w.radius * 0.55, width + 0.012, 12).rotateZ(Math.PI / 2);
      this.#part(rim, rimMaterial, [0, 0, 0], spin);
      // Two crossed white bars on the outside face make the spinning visible.
      const outside = (left ? 1 : -1) * (width / 2 + 0.008);
      this.#part(new THREE.BoxGeometry(0.012, w.radius * 1.0, 0.035), spokeMaterial, [outside, 0, 0], spin);
      this.#part(new THREE.BoxGeometry(0.012, 0.035, w.radius * 1.0), spokeMaterial, [outside, 0, 0], spin);

      this.wheels.push({
        pivot,
        spin,
        x: left ? w.halfTrack : -w.halfTrack,
        z: front ? w.frontZ : w.rearZ,
        front,
        angle: 0, // accumulated spin angle
        lastRotation: 0,
      });
    }
  }

  /**
   * Place the model directly, without a Vehicle. Ghost karts use this: they
   * only know a position, a rotation and a speed from their recording.
   */
  setPose(position, quaternion, speed, frameDt) {
    this.group.position.copy(position);
    this.group.quaternion.copy(quaternion);
    // Wheels sit where the suspension rests under the kart's own weight,
    // and spin as fast as the kart moves: angle = distance / radius.
    const { wheels: w, suspension: s } = this.config;
    const hang = s.restLength - 0.05;
    for (const visual of this.wheels) {
      visual.pivot.position.set(visual.x, w.mountY - hang, visual.z);
      visual.angle += (speed * frameDt) / w.radius;
      visual.spin.rotation.x = visual.angle;
    }
  }

  /**
   * Copy the physics state onto the model.
   * @param {Vehicle} vehicle
   * @param {number} alpha  0..1, how far we are between the previous and the
   *                        current physics state (render interpolation)
   */
  update(vehicle, alpha) {
    // Blend position linearly and rotation spherically ("slerp").
    this.group.position.lerpVectors(vehicle.prevPosition, vehicle.position, alpha);
    this.group.quaternion.slerpQuaternions(vehicle.prevQuaternion, vehicle.quaternion, alpha);

    const mountY = this.config.wheels.mountY;
    for (let i = 0; i < 4; i++) {
      const visual = this.wheels[i];
      const state = vehicle.wheels[i];
      // The wheel hangs `suspensionLength` below its mount point.
      visual.pivot.position.set(visual.x, mountY - state.suspensionLength, visual.z);
      visual.pivot.rotation.y = state.steering;

      // Spin by however much the physics wheel rotated since last frame —
      // except rear wheels under handbrake, which we show as locked.
      const delta = state.rotation - visual.lastRotation;
      visual.lastRotation = state.rotation;
      const locked = vehicle.handbrake && !visual.front;
      if (!locked) visual.angle += delta;
      visual.spin.rotation.x = visual.angle;
    }

    // The steering wheel exaggerates the front wheel angle so it reads well.
    // (Wheel angle + = left; seen from behind, left = counter-clockwise.)
    this.steeringWheel.rotation.z = -vehicle.steerAngle * 3;
    // The driver leans into the corner a little.
    this.driver.rotation.z = THREE.MathUtils.lerp(this.driver.rotation.z, vehicle.steerAngle * 0.35, 0.15);
  }
}
