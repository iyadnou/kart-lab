// =============================================================================
// vehicle.js — the kart's physics. No rendering happens here, so the same
// class could later drive AI karts (tools/sim-test.js already drives one
// without any graphics at all).
//
// How it works in one paragraph:
//   The kart is ONE rigid body (a box). It has no physical wheels. Instead,
//   Rapier's DynamicRayCastVehicleController shoots a ray downward from each
//   of the four wheel mounts. Where a ray hits the ground, the controller
//   applies (1) a spring + damper force — the suspension — and (2) friction
//   forces — the tyre. Our job each step is to tell the controller the
//   steering angle, engine force and brake of every wheel, and to add a few
//   forces of our own (drag, downforce, anti-roll).
//
// Each physics step is split in two halves, called from loop.js:
//   preStep(input, dt)  -> turn driver input into wheel commands and forces
//   (physics world steps)
//   postStep(dt)        -> read back what happened (speed, sliding wheels…)
// =============================================================================

import * as THREE from 'three';
import { RAPIER, GROUP, collisionGroups } from './physics.js';

/** Wheel order used everywhere: front-left, front-right, rear-left, rear-right. */
export const WHEEL = { FL: 0, FR: 1, RL: 2, RR: 3 };
const WHEEL_COUNT = 4;
const isFront = (i) => i < 2;
const isLeft = (i) => i % 2 === 0;

// Wheel rays may only hit the ground (not walls, not obstacles).
const WHEEL_RAY_GROUPS = collisionGroups(GROUP.ALL, GROUP.GROUND);

// The inertia formula needs a body height; a real kart with its driver is
// taller than our thin collision box, so we use a fixed sensible value.
const NOMINAL_BODY_HEIGHT = 0.5;

// Scratch objects, reused every step so we do not create garbage.
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

export class Vehicle {
  /**
   * @param {Physics} physics
   * @param {object} config   the CONFIG object (read live, every step)
   * @param {{position: THREE.Vector3, quaternion: THREE.Quaternion}} spawn
   */
  constructor(physics, config, spawn) {
    this.physics = physics;
    this.config = config;

    // --- The rigid body -----------------------------------------------------
    const c = config.chassis;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.position.x, spawn.position.y, spawn.position.z)
      .setRotation(spawn.quaternion)
      .setCanSleep(false) // a sleeping body would ignore the vehicle controller
      .setCcdEnabled(true); // continuous collision: never tunnel through a wall
    this.body = physics.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(c.halfWidth, c.halfHeight, c.halfLength)
      .setCollisionGroups(collisionGroups(GROUP.KART, GROUP.GROUND | GROUP.WALL | GROUP.OBSTACLE))
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.collider = physics.world.createCollider(colliderDesc, this.body);
    physics.setUserData(this.collider, { type: 'kart' });

    // --- The ray-cast vehicle controller --------------------------------------
    this.controller = physics.world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1; // Y is up
    this.controller.setIndexForwardAxis = 2; // Z is forward

    const w = config.wheels;
    const s = config.suspension;
    const down = { x: 0, y: -1, z: 0 }; // suspension direction (local)
    const axle = { x: -1, y: 0, z: 0 }; // wheel spin axis (local)
    for (let i = 0; i < WHEEL_COUNT; i++) {
      this.controller.addWheel(this.#wheelMount(i), down, axle, s.restLength, w.radius);
    }

    // --- State other modules read -----------------------------------------------
    /** Pose after the latest physics step and the one before (for interpolation). */
    this.position = new THREE.Vector3().copy(spawn.position);
    this.quaternion = new THREE.Quaternion().copy(spawn.quaternion);
    this.prevPosition = this.position.clone();
    this.prevQuaternion = this.quaternion.clone();

    /** Unit vectors of the kart in world space. */
    this.forward = new THREE.Vector3(0, 0, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.left = new THREE.Vector3(1, 0, 0);
    this.velocity = new THREE.Vector3();

    this.forwardSpeed = 0; // m/s, negative when reversing
    this.steerAngle = 0; // current front wheel angle (rad, + = left)
    this.handbrake = false;
    this.groundedWheels = 0;
    this.upsideDownTime = 0;

    /** Per-wheel info, refreshed in postStep(). */
    this.wheels = [];
    for (let i = 0; i < WHEEL_COUNT; i++) {
      this.wheels.push({
        inContact: false,
        surface: 'asphalt', // name of the surface under the wheel
        suspensionLength: s.restLength,
        rotation: 0, // spin angle (rad)
        steering: 0, // steer angle (rad)
        sideSlip: 0, // sideways speed of the tyre over the ground (m/s)
        sliding: false,
        contactPoint: new THREE.Vector3(),
      });
    }

    /** Set this to a function to be told about wall hits: fn(impactSpeed). */
    this.onWallHit = null;
    physics.onCollisionStart((a, b) => this.#handleCollision(a, b));

    this.applyTuning();
    this.#readBody();
  }

  /** Local position of a wheel's suspension mount. */
  #wheelMount(i) {
    const w = this.config.wheels;
    return {
      x: isLeft(i) ? w.halfTrack : -w.halfTrack,
      y: w.mountY,
      z: isFront(i) ? w.frontZ : w.rearZ,
    };
  }

  /**
   * Push every "static" tuning value from the config into Rapier. Called once
   * at start and again whenever the tuning panel changes something. (Values
   * like engine force are read from the config every step and need no push.)
   */
  applyTuning() {
    const { chassis: c, wheels: w, suspension: s, tires: t } = this.config;

    // Mass, centre of mass and rotational inertia of a solid box.
    const width = c.halfWidth * 2;
    const length = c.halfLength * 2;
    const height = NOMINAL_BODY_HEIGHT;
    const k = (c.mass / 12) * c.inertiaScale;
    this.collider.setMassProperties(
      c.mass,
      { x: 0, y: c.centerOfMassY, z: 0 },
      {
        x: k * (height * height + length * length), // pitch
        y: k * (width * width + length * length), // yaw
        z: k * (width * width + height * height), // roll
      },
      { x: 0, y: 0, z: 0, w: 1 },
    );
    this.collider.setFriction(c.friction);
    this.collider.setRestitution(c.restitution);
    this.body.setAngularDamping(c.angularDamping);

    for (let i = 0; i < WHEEL_COUNT; i++) {
      const ctl = this.controller;
      ctl.setWheelChassisConnectionPointCs(i, this.#wheelMount(i));
      ctl.setWheelRadius(i, w.radius);
      ctl.setWheelSuspensionRestLength(i, s.restLength);
      ctl.setWheelMaxSuspensionTravel(i, s.travel);
      ctl.setWheelSuspensionStiffness(i, s.stiffness);
      ctl.setWheelSuspensionCompression(i, s.dampingCompression);
      ctl.setWheelSuspensionRelaxation(i, s.dampingRelaxation);
      ctl.setWheelMaxSuspensionForce(i, s.maxForce);
      ctl.setWheelSideFrictionStiffness(i, t.sideFrictionStiffness);
    }
  }

  // ===========================================================================
  // Step, first half: input -> forces
  // ===========================================================================

  /**
   * @param {{steer:number, throttle:number, brake:number, handbrake:boolean}} input
   *        steer: -1 (left) .. +1 (right); throttle/brake: 0..1
   * @param {number} dt  fixed timestep in seconds
   */
  preStep(input, dt) {
    // Remember the pose before this step so rendering can blend between the
    // previous and the new pose (see loop.js, "interpolation").
    this.prevPosition.copy(this.position);
    this.prevQuaternion.copy(this.quaternion);

    this.handbrake = !!input.handbrake;

    this.#updateSteering(input, dt);
    this.#updateEngineAndBrakes(input, dt);
    this.#updateTyreGrip();
    this.#applyExtraForces(dt);

    // Let the controller cast its rays and apply suspension + tyre forces.
    this.controller.updateVehicle(dt, undefined, WHEEL_RAY_GROUPS);

    this.#applyBodyRoll();
  }

  /**
   * Body roll and sideways weight transfer.
   *
   * A tyre pushes on the kart at ground level, below the centre of mass. In
   * a corner that off-centre push makes a real car lean outwards and loads
   * up its outside wheels. Rapier's controller deliberately applies only a
   * small part of that leaning effect (about 10%; it is the "roll influence"
   * of the classic ray-cast vehicle model, which makes tall vehicles
   * un-flippable). We add the rest back, scaled by `chassis.bodyRoll`:
   *
   *   torque = sideways tyre force x height of the centre of mass above the
   *            contact point, around the kart's forward axis
   *
   * Once the body leans, the outside springs compress and push harder on
   * their tyres — and since grip depends on load, weight transfer follows.
   */
  #applyBodyRoll() {
    const amount = this.config.chassis.bodyRoll;
    if (amount <= 0) return;
    const ctl = this.controller;
    const com = _v1.copy(this.body.worldCom());
    let torque = 0;
    for (let i = 0; i < WHEEL_COUNT; i++) {
      if (!ctl.wheelIsInContact(i)) continue;
      const sideImpulse = ctl.wheelSideImpulse(i) ?? 0; // along the axle, + = towards the right
      const height = _v2.copy(com).sub(ctl.wheelContactPoint(i)).dot(this.up);
      torque -= sideImpulse * height;
    }
    this.body.applyTorqueImpulse(_v2.copy(this.forward).multiplyScalar(torque * amount), true);
  }

  #updateSteering(input, dt) {
    const st = this.config.steering;
    const topSpeed = this.config.engine.topSpeedKmh / 3.6;

    // Speed-sensitive steering: the faster we go, the less the wheels turn.
    // `speedCurve` below 1 makes the angle drop quickly at first, then level out.
    const speed01 = THREE.MathUtils.clamp(Math.abs(this.forwardSpeed) / topSpeed, 0, 1) ** st.speedCurve;
    let maxAngle = THREE.MathUtils.lerp(st.maxAngleLowSpeed, st.maxAngleHighSpeed, speed01);
    if (this.handbrake) {
      // More lock while drifting so you can counter-steer.
      maxAngle = Math.min(st.maxAngleLowSpeed, maxAngle * this.config.handbrake.steerBoost);
    }

    // Input +1 means "right", but a positive wheel angle turns left.
    const target = -THREE.MathUtils.clamp(input.steer, -1, 1) * maxAngle;

    // Wheels cannot snap instantly; move towards the target at a limited rate.
    const returning = Math.abs(target) < Math.abs(this.steerAngle);
    const rate = (returning ? st.returnRate : st.turnRate) * dt;
    this.steerAngle += THREE.MathUtils.clamp(target - this.steerAngle, -rate, rate);

    this.controller.setWheelSteering(WHEEL.FL, this.steerAngle);
    this.controller.setWheelSteering(WHEEL.FR, this.steerAngle);
  }

  #updateEngineAndBrakes(input, dt) {
    const e = this.config.engine;
    const v = this.forwardSpeed;
    const throttle = THREE.MathUtils.clamp(input.throttle, 0, 1);
    const brakePedal = THREE.MathUtils.clamp(input.brake, 0, 1);

    let engineForce = 0; // total push from the engine (N); negative = reverse
    let brakeForce = 0; // total braking (N)

    // The engine is strongest from a standstill and fades to zero at top
    // speed — that fade is what limits the top speed.
    const forwardPower = (speed) => Math.max(0, 1 - (speed / (e.topSpeedKmh / 3.6)) ** 2);
    const reversePower = (speed) => Math.max(0, 1 - (speed / (e.reverseTopSpeedKmh / 3.6)) ** 2);

    if (v > 0.5) {
      // Rolling forward: GAS accelerates, BRAKE brakes.
      engineForce = throttle * e.force * forwardPower(v);
      brakeForce = brakePedal * e.brakeForce;
    } else if (v < -0.5) {
      // Rolling backward: BRAKE keeps reversing, GAS brakes first.
      engineForce = -brakePedal * e.reverseForce * reversePower(-v);
      brakeForce = throttle * e.brakeForce;
    } else if (throttle > 0) {
      engineForce = throttle * e.force; // setting off forward
    } else if (brakePedal > 0) {
      engineForce = -brakePedal * e.reverseForce; // setting off in reverse
    }

    const coasting = throttle === 0 && brakePedal === 0;
    let rearBrake = brakeForce * (1 - e.brakeFrontBias);
    let frontBrake = brakeForce * e.brakeFrontBias;

    if (coasting) {
      if (Math.abs(v) < 0.5) {
        // Standing still with no input: hold the kart like a parking brake,
        // otherwise it would creep down slopes.
        frontBrake = rearBrake = e.brakeForce * 0.5;
      } else {
        rearBrake = e.engineBrakeForce; // lifting off slows you gently
      }
    }
    if (this.handbrake) rearBrake += this.config.handbrake.rearBrakeForce;

    // Rapier wants the engine force per wheel in newtons, and the brake as
    // the largest impulse (force x time) it may use in this step. Note: a
    // wheel with a non-zero engine force ignores its brake, which is why
    // holding GAS + HANDBRAKE gives a powered slide.
    const ctl = this.controller;
    ctl.setWheelEngineForce(WHEEL.RL, engineForce / 2);
    ctl.setWheelEngineForce(WHEEL.RR, engineForce / 2);
    ctl.setWheelBrake(WHEEL.FL, (frontBrake / 2) * dt);
    ctl.setWheelBrake(WHEEL.FR, (frontBrake / 2) * dt);
    ctl.setWheelBrake(WHEEL.RL, (rearBrake / 2) * dt);
    ctl.setWheelBrake(WHEEL.RR, (rearBrake / 2) * dt);
  }

  /** Tyre grip depends on the surface under each wheel and on the handbrake. */
  #updateTyreGrip() {
    const t = this.config.tires;
    const surfaces = this.config.surfaces;
    for (let i = 0; i < WHEEL_COUNT; i++) {
      const surface = surfaces[this.wheels[i].surface] ?? surfaces.asphalt;
      let grip = (isFront(i) ? t.frictionSlipFront : t.frictionSlipRear) * surface.grip;
      if (this.handbrake && !isFront(i)) grip *= this.config.handbrake.rearGripFactor;
      this.controller.setWheelFrictionSlip(i, grip);
    }
  }

  /** Forces the ray-cast controller does not know about. */
  #applyExtraForces(dt) {
    const { engine: e, stability: stab, surfaces, suspension: s } = this.config;
    const speed = this.velocity.length();

    // We apply forces as impulses (force x dt) at the centre of mass.
    const impulse = _v1.set(0, 0, 0);

    // 1. Air drag grows with the square of the speed.
    impulse.addScaledVector(this.velocity, -e.airDrag * speed * dt);

    // 2. Surface drag: every wheel on grass/dirt slows the kart down.
    let surfaceDrag = 0;
    for (const wheel of this.wheels) {
      if (wheel.inContact) surfaceDrag += (surfaces[wheel.surface] ?? surfaces.asphalt).drag;
    }
    impulse.addScaledVector(this.velocity, -surfaceDrag * dt);

    // 3. Downforce presses the kart onto the road at speed (more grip, fewer
    //    flips). Only while touching the ground, so jumps stay natural.
    if (this.groundedWheels > 0) {
      impulse.addScaledVector(this.up, -stab.downforce * speed * speed * dt);
    }
    this.body.applyImpulse(impulse, true);

    // 4. Anti-roll bars: when one side's suspension is squashed more than the
    //    other (the body is leaning), push the squashed side up and the other
    //    side down. This resists body roll without stiffening the springs.
    for (const [l, r] of [
      [WHEEL.FL, WHEEL.FR],
      [WHEEL.RL, WHEEL.RR],
    ]) {
      const wl = this.wheels[l];
      const wr = this.wheels[r];
      if (!wl.inContact && !wr.inContact) continue;
      const compressionL = s.restLength - wl.suspensionLength;
      const compressionR = s.restLength - wr.suspensionLength;
      const force = (compressionL - compressionR) * stab.antiRoll;
      const push = _v2.copy(this.up).multiplyScalar(force * dt);
      this.body.applyImpulseAtPoint(push, this.#mountWorld(l, _v3), true);
      this.body.applyImpulseAtPoint(push.negate(), this.#mountWorld(r, _v3), true);
    }
  }

  /** World position of a wheel's suspension mount. */
  #mountWorld(i, target) {
    const m = this.#wheelMount(i);
    return target.set(m.x, m.y, m.z).applyQuaternion(this.quaternion).add(this.position);
  }

  // ===========================================================================
  // Step, second half: read results
  // ===========================================================================

  postStep(dt) {
    this.#readBody();

    const ctl = this.controller;
    const threshold = this.config.tires.slideThreshold;
    const angularVelocity = _v1.copy(this.body.angvel());
    this.groundedWheels = 0;

    for (let i = 0; i < WHEEL_COUNT; i++) {
      const wheel = this.wheels[i];
      wheel.inContact = ctl.wheelIsInContact(i);
      wheel.suspensionLength = ctl.wheelSuspensionLength(i) ?? wheel.suspensionLength;
      wheel.rotation = ctl.wheelRotation(i) ?? 0;
      wheel.steering = isFront(i) ? this.steerAngle : 0;
      wheel.sliding = false;
      wheel.sideSlip = 0;
      if (!wheel.inContact) continue;

      this.groundedWheels++;
      wheel.contactPoint.copy(ctl.wheelContactPoint(i));

      // Which surface is under this wheel? The ray hit a collider, and we
      // stored a userData object for every collider (see physics.js).
      wheel.surface = this.physics.getUserData(ctl.wheelGroundObject(i)).surface ?? 'asphalt';

      // Sideways slip = how fast the tyre's contact patch moves along the
      // wheel's axle direction. A rolling tyre has ~0; a sliding one has lots.
      // Velocity of a point on a rigid body = v + angularVelocity x offset.
      const offset = _v2.copy(wheel.contactPoint).sub(this.position);
      const pointVelocity = _v3.crossVectors(angularVelocity, offset).add(this.velocity);
      const axle = _v2.copy(this.left).applyAxisAngle(this.up, wheel.steering);
      wheel.sideSlip = pointVelocity.dot(axle);
      wheel.sliding =
        Math.abs(wheel.sideSlip) > threshold ||
        (this.handbrake && !isFront(i) && Math.abs(this.forwardSpeed) > 4);
    }

    // Count how long the kart has been lying on its side or roof.
    this.upsideDownTime = this.up.y < 0.3 ? this.upsideDownTime + dt : 0;
  }

  /** Copy the body's pose and velocity out of Rapier into Three.js objects. */
  #readBody() {
    this.position.copy(this.body.translation());
    this.quaternion.copy(this.body.rotation());
    this.velocity.copy(this.body.linvel());
    this.forward.set(0, 0, 1).applyQuaternion(this.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.left.set(1, 0, 0).applyQuaternion(this.quaternion);
    this.forwardSpeed = this.velocity.dot(this.forward);
  }

  get speedKmh() {
    return Math.abs(this.forwardSpeed) * 3.6;
  }

  /** True if any wheel is currently sliding sideways. */
  get isSliding() {
    return this.wheels.some((w) => w.sliding);
  }

  // ===========================================================================
  // Other
  // ===========================================================================

  /** Instantly move the kart somewhere, at rest (reset / respawn). */
  teleport(position, quaternion) {
    this.body.setTranslation(position, true);
    this.body.setRotation(quaternion, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    this.upsideDownTime = 0;
    this.#readBody();
    // Make "previous" equal "current" so the kart does not streak across the
    // screen for one frame.
    this.prevPosition.copy(this.position);
    this.prevQuaternion.copy(this.quaternion);
  }

  #handleCollision(a, b) {
    if (a !== this.collider && b !== this.collider) return;
    const other = a === this.collider ? b : a;
    const type = this.physics.getUserData(other).type;
    if ((type === 'wall' || type === 'obstacle') && this.onWallHit) {
      this.onWallHit(this.velocity.length());
    }
  }
}
