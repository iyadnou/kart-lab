// =============================================================================
// physics.js — a thin wrapper around the Rapier physics world.
//
// Responsibilities:
//   * load Rapier (it is WebAssembly, so loading is asynchronous)
//   * create the world and step it
//   * helpers to add static colliders (trimesh, box, cylinder)
//   * remember a small "userData" object for every collider, so other code
//     can ask "what did this wheel / this ray touch?" (asphalt, grass, wall…)
//   * report collision-start events (used for the wall-hit vibration)
//
// Nothing here knows about Three.js or karts.
// =============================================================================

import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

// --- Collision groups ---------------------------------------------------------
// Each collider belongs to some groups and has a filter of groups it reacts to.
// We use them mainly for ray casts: wheel rays must only see the ground,
// the camera ray should see ground + walls + obstacles, and so on.
export const GROUP = {
  GROUND: 0b0001,
  WALL: 0b0010,
  KART: 0b0100,
  OBSTACLE: 0b1000,
  ALL: 0xffff,
};

/** Pack "I am in `membership`, I interact with `filter`" into Rapier's format. */
export function collisionGroups(membership, filter) {
  return ((membership << 16) | filter) >>> 0;
}

export class Physics {
  /** Use `await Physics.create(config)` instead of `new Physics()`. */
  static async create(config) {
    await RAPIER.init();
    return new Physics(config);
  }

  constructor(config) {
    this.world = new RAPIER.World({ x: 0, y: -config.physics.gravity, z: 0 });
    this.world.timestep = config.physics.timestep;

    // Collision events are collected here during world.step().
    this.eventQueue = new RAPIER.EventQueue(true);

    // collider.handle (a number) -> userData object, e.g. { surface: 'grass' }.
    this.colliderData = new Map();

    // Functions to call when two colliders start touching.
    this.collisionListeners = [];

    // All static scenery shares one fixed (never moving) rigid body.
    this.staticBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  /** Change gravity at runtime (used by the tuning panel). */
  setGravity(g) {
    this.world.gravity = { x: 0, y: -g, z: 0 };
  }

  // --- userData ---------------------------------------------------------------

  setUserData(collider, data) {
    this.colliderData.set(collider.handle, data);
  }

  /** Returns the userData object of a collider, or an empty object. */
  getUserData(collider) {
    return (collider && this.colliderData.get(collider.handle)) || EMPTY;
  }

  // --- Static colliders ---------------------------------------------------------

  /**
   * Add a static triangle-mesh collider.
   * @param {Float32Array} positions  x,y,z for every vertex
   * @param {Uint32Array} indices     three vertex indices per triangle
   * @param {object} userData         e.g. { surface: 'asphalt' }
   */
  addTrimesh(positions, indices, userData, { group = GROUP.GROUND, friction = 0.8 } = {}) {
    const desc = RAPIER.ColliderDesc.trimesh(positions, indices)
      .setFriction(friction)
      .setCollisionGroups(collisionGroups(group, GROUP.ALL));
    const collider = this.world.createCollider(desc, this.staticBody);
    this.setUserData(collider, userData);
    return collider;
  }

  /**
   * Add a static box. `position` is its centre, `quaternion` its orientation,
   * both plain {x,y,z(,w)} objects (a THREE.Vector3/Quaternion works too).
   */
  addBox(halfExtents, position, quaternion, userData, options = {}) {
    const desc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
    return this.#addShape(desc, position, quaternion, userData, options);
  }

  /** Add a static upright cylinder (tire stacks, posts). */
  addCylinder(halfHeight, radius, position, userData, options = {}) {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius);
    return this.#addShape(desc, position, IDENTITY_ROTATION, userData, options);
  }

  #addShape(desc, position, quaternion, userData, options) {
    const { group = GROUP.OBSTACLE, friction = 0.5, restitution = 0 } = options;
    desc
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w })
      .setFriction(friction)
      .setRestitution(restitution)
      .setCollisionGroups(collisionGroups(group, GROUP.ALL));
    if (friction === 0) {
      // "Min" = when two things touch, use the smaller friction of the two.
      // Without this Rapier averages them and a zero-friction wall would
      // still feel sticky.
      desc.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
    }
    const collider = this.world.createCollider(desc, this.staticBody);
    this.setUserData(collider, userData);
    return collider;
  }

  // --- Queries ----------------------------------------------------------------

  /**
   * Cast a ray and return the distance to the first hit, or null.
   * `filterMask` is a combination of GROUP.* values the ray may hit.
   */
  castRay(origin, direction, maxDistance, filterMask, excludeBody) {
    const ray = new RAPIER.Ray(origin, direction);
    const hit = this.world.castRay(
      ray,
      maxDistance,
      true,
      undefined,
      collisionGroups(GROUP.ALL, filterMask),
      undefined,
      excludeBody,
    );
    return hit ? hit.timeOfImpact : null;
  }

  // --- Events -------------------------------------------------------------------

  /** `listener(colliderA, colliderB)` is called when two colliders start touching. */
  onCollisionStart(listener) {
    this.collisionListeners.push(listener);
  }

  // --- Stepping -----------------------------------------------------------------

  /** Advance the simulation by one fixed timestep. */
  step() {
    this.world.step(this.eventQueue);

    this.eventQueue.drainCollisionEvents((handleA, handleB, started) => {
      if (!started) return;
      const a = this.world.getCollider(handleA);
      const b = this.world.getCollider(handleB);
      for (const listener of this.collisionListeners) listener(a, b);
    });
  }
}

const EMPTY = Object.freeze({});
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
