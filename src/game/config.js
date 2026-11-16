// =============================================================================
// config.js — every tuning value of the game lives in this one file.
//
// The tuning panel (press G in the game) edits this object live, so you can
// change a number while driving and feel the difference immediately. When you
// find values you like, copy them back into this file to make them permanent.
//
// Units: metres, seconds, kilograms, newtons, radians (unless a name says
// otherwise, e.g. `topSpeedKmh`, `fovDeg`).
//
// Coordinate convention used everywhere in the project:
//   +Y is up. In the kart's own (local) space +Z is forward and +X is LEFT.
// =============================================================================

export const CONFIG = {
  // --- World ---------------------------------------------------------------
  physics: {
    // The simulation always advances in steps of exactly this size, no matter
    // how fast the screen refreshes (see loop.js).
    timestep: 1 / 60,
    // Stronger than real gravity (9.81). A classic arcade trick: the kart
    // falls faster and presses harder on its tyres, so it feels planted.
    gravity: 14,
  },

  // --- Kart body -----------------------------------------------------------
  chassis: {
    mass: 180,
    // Half-sizes of the collision box (x = half width, y = half height,
    // z = half length).
    halfWidth: 0.62,
    halfHeight: 0.15,
    halfLength: 0.95,
    // The centre of mass sits below the middle of the box. Lower = less body
    // roll and harder to flip.
    centerOfMassY: -0.12,
    // Scales how hard the body is to rotate. >1 feels heavier and lazier.
    inertiaScale: 1.0,
    // How much the body leans in corners. 0 = stays flat (the physics
    // engine's default), 0.9 = what real physics predicts. See
    // #applyBodyRoll in vehicle.js.
    bodyRoll: 0.9,
    // Friction/bounciness of the body when it touches walls or the ground.
    friction: 0.2,
    restitution: 0.15,
    // Resistance against spinning. Calms the kart down in the air and makes
    // slides easier to catch.
    angularDamping: 1.5,
  },

  // --- Wheel placement -----------------------------------------------------
  wheels: {
    radius: 0.19,
    // Where the suspension is attached, relative to the body centre.
    frontZ: 0.65,
    rearZ: -0.6,
    halfTrack: 0.52, // left/right distance from the centre line
    mountY: 0.0, // height of the suspension's top mount
  },

  // --- Suspension (one spring + damper per wheel) --------------------------
  suspension: {
    restLength: 0.2, // spring length with no load
    travel: 0.1, // how far it may compress/extend from rest
    // Spring strength. Rapier scales this by the chassis mass, so the unit is
    // "acceleration per metre of compression".
    stiffness: 70,
    // Dampers remove bounce. Compression = while squashing, relaxation =
    // while extending.
    dampingCompression: 5.0,
    dampingRelaxation: 7.0,
    maxForce: 20000,
  },

  // --- Tyres ---------------------------------------------------------------
  tires: {
    // Grip multiplier: the largest friction force a tyre can make is
    // (load on that wheel) x frictionSlip. The rear has a bit more than the
    // front, so at the limit the front lets go first (safe understeer).
    frictionSlipFront: 1.4,
    frictionSlipRear: 1.5,
    // 0..1 — how completely a tyre cancels sideways sliding each step.
    sideFrictionStiffness: 1.0,
    // Sideways speed (m/s) of a tyre above which we call it "sliding"
    // (used for smoke, skid marks).
    slideThreshold: 2.5,
  },

  // --- Engine and brakes ---------------------------------------------------
  engine: {
    topSpeedKmh: 90,
    force: 1700, // peak forward push, shared by the two rear wheels
    reverseTopSpeedKmh: 25,
    reverseForce: 900,
    brakeForce: 3200, // total, shared by all four wheels
    brakeFrontBias: 0.6, // share of braking done by the front wheels
    engineBrakeForce: 280, // gentle slowing when you lift off the throttle
    airDrag: 0.12, // force = airDrag x speed^2
  },

  // --- Steering ------------------------------------------------------------
  steering: {
    maxAngleLowSpeed: 0.52, // rad (~30 deg) when crawling
    maxAngleHighSpeed: 0.075, // rad (~4 deg) at top speed
    // Shape of the blend between the two angles as speed rises (1 = straight
    // line, smaller = the angle shrinks sooner).
    speedCurve: 0.6,
    // How fast the front wheels turn towards / back from the target (rad/s).
    turnRate: 2.6,
    returnRate: 4.0,
  },

  // --- Handbrake / drifting ------------------------------------------------
  handbrake: {
    rearGripFactor: 0.75, // rear tyre grip is multiplied by this
    rearBrakeForce: 500, // light rear braking while held
    // Multiplies the steering angle limit while the handbrake is held.
    // Above 1 gives extra lock for counter-steering, but also easier spins.
    steerBoost: 1.0,
  },

  // --- Driver aids ---------------------------------------------------------
  stability: {
    antiRoll: 3000, // N per metre of left/right suspension difference
    downforce: 0.8, // force = downforce x speed^2, pushes the kart down
    upsideDownSeconds: 2.0, // auto-recover after being flipped this long
    // Below this height the kart has fallen off the world and is reset.
    fallResetY: -30,
  },

  // --- Surfaces ------------------------------------------------------------
  // `grip` multiplies tyre friction; `drag` is a slowing force per wheel
  // (N per m/s). Colliders are tagged with one of these names.
  surfaces: {
    asphalt: { grip: 1.0, drag: 0 },
    grass: { grip: 0.55, drag: 38 },
  },

  // Walls are slippery so you slide along them instead of stopping dead.
  // (Read once when the track is built: changing these needs a page reload.)
  walls: { friction: 0.0, restitution: 0.2 },

  // --- Track dimensions (changing these needs a page reload) ---------------
  track: {
    roadWidth: 12,
    vergeWidth: 5, // grass strip between the road edge and the wall
    wallHeight: 1.1,
    sampleSpacing: 1.5, // distance between cross-sections of the road mesh
    curbWidth: 1.0,
    curbMinCurvature: 1 / 75, // corners tighter than 75 m radius get curbs
    checkpointCount: 16,
    spawnDistanceBeforeLine: 8,
  },

  // --- Chase camera --------------------------------------------------------
  camera: {
    distance: 4.6, // metres behind the kart
    height: 1.8, // metres above the kart
    lookAhead: 2.6, // aim this far in front of the kart
    lookHeight: 0.9,
    // Seconds the camera needs to (mostly) catch up. Bigger = lazier.
    positionLag: 0.11,
    rotationLag: 0.18,
    fovDeg: 62,
    fovMaxDeg: 80, // at top speed
    collisionMargin: 0.35,
  },

  // --- Effects -------------------------------------------------------------
  effects: {
    smokeRate: 60, // particles per second per sliding wheel
    dustRate: 35,
    skidMarkWidth: 0.16,
    skidMarkMaxSegments: 3000,
  },

  // --- Graphics ------------------------------------------------------------
  graphics: {
    quality: 'high', // 'high' or 'low'
    shadowMapSize: 2048,
    shadowRange: 38, // half-size of the area around the kart that has shadows
    fogNear: 140,
    fogFar: 520,
  },
};
