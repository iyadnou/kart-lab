// =============================================================================
// track/path.js — turns the control points into a list of evenly spaced
// "samples" along the centre line of the road.
//
// Each sample is a little coordinate frame standing on the road:
//
//        up
//        |   forward (along the track)
//        |  /
//        | /
//        +------ right (across the road, tilted if the road is banked)
//
// Every other track module works from these samples: the road mesh places two
// vertices per sample (left and right edge), walls stand on them, checkpoints
// sit on them, and the lap counter asks "which sample is the kart nearest to?"
// =============================================================================

import * as THREE from 'three';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class TrackPath {
  /**
   * @param {number[][]} points  control points, see layout.js
   * @param {number} spacing     desired distance between samples (m)
   */
  constructor(points, spacing) {
    const positions = points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const banks = points.map((p) => THREE.MathUtils.degToRad(p[3] ?? 0));

    // closed = true: the curve joins the last point back to the first.
    // 'centripetal' avoids overshoots and loops between unevenly spaced points.
    this.curve = new THREE.CatmullRomCurve3(positions, true, 'centripetal');
    // Three.js measures the curve by cutting it into straight pieces; more
    // pieces = more accurate "distance along the track".
    this.curve.arcLengthDivisions = 4000;

    /** Total lap length in metres. */
    this.length = this.curve.getLength();
    /** Number of samples; sample `count` would be sample 0 again. */
    this.count = Math.round(this.length / spacing);
    /** Actual distance between two neighbouring samples. */
    this.spacing = this.length / this.count;

    /** @type {TrackSample[]} */
    this.samples = [];
    for (let i = 0; i < this.count; i++) {
      // u = fraction of the lap by DISTANCE (0..1).
      const u = i / this.count;
      // t = the curve's own parameter. It advances by the same amount between
      // every pair of control points, however far apart they are, so we can
      // use it to find out which control points we are between.
      const t = this.curve.getUtoTmapping(u);

      const position = this.curve.getPoint(t);
      const forward = this.curve.getTangent(t).normalize();

      // Blend the bank angle of the two surrounding control points.
      const segment = t * points.length;
      const index = Math.floor(segment) % points.length;
      const blend = THREE.MathUtils.smoothstep(segment - Math.floor(segment), 0, 1);
      const bank = THREE.MathUtils.lerp(banks[index], banks[(index + 1) % points.length], blend);

      // Flat "right" = perpendicular to forward and to world up. Then tilt it
      // by the bank angle: positive bank lifts the right-hand side.
      const flatRight = new THREE.Vector3().crossVectors(forward, WORLD_UP).normalize();
      const right = flatRight
        .clone()
        .multiplyScalar(Math.cos(bank))
        .addScaledVector(WORLD_UP, Math.sin(bank));
      // The road's surface normal is perpendicular to both.
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();

      this.samples.push({
        index: i,
        position,
        forward,
        right,
        up,
        flatRight,
        bank,
        distance: i * this.spacing,
        curvature: 0, // filled in below
      });
    }

    // Curvature = how quickly the heading changes per metre (1 / corner
    // radius). Positive = left turn. We compare each sample's neighbours.
    for (let i = 0; i < this.count; i++) {
      const a = this.sample(i - 2).forward;
      const b = this.sample(i + 2).forward;
      const turn = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z); // signed angle a->b
      this.samples[i].curvature = -turn / (4 * this.spacing);
    }
  }

  /** Sample by index; any integer works because the track is a loop. */
  sample(i) {
    return this.samples[((i % this.count) + this.count) % this.count];
  }

  /** Index of the sample nearest to a distance along the track. */
  indexAtDistance(distance) {
    return ((Math.round(distance / this.spacing) % this.count) + this.count) % this.count;
  }

  /**
   * Find the sample closest to a world position.
   *
   * With `hint` (a previous result) only nearby samples are searched. That is
   * faster, and it also means the answer cannot jump to a different part of
   * the track that merely happens to be close by — which is what keeps the
   * lap counter honest.
   */
  nearestIndex(position, hint = null, window = 25) {
    let best = -1;
    let bestDistance = Infinity;
    const from = hint === null ? 0 : hint - window;
    const to = hint === null ? this.count - 1 : hint + window;
    for (let i = from; i <= to; i++) {
      const d = this.sample(i).position.distanceToSquared(position);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    return ((best % this.count) + this.count) % this.count;
  }

  /**
   * A point on the road surface: `lateral` metres to the right of the centre
   * line (negative = left) and `height` metres above the surface.
   */
  pointAt(sample, lateral, height = 0, target = new THREE.Vector3()) {
    return target
      .copy(sample.position)
      .addScaledVector(sample.right, lateral)
      .addScaledVector(sample.up, height);
  }

  /** Orientation of something standing on the road, facing along the track. */
  orientationAt(sample, target = new THREE.Quaternion()) {
    // Our convention: local +X = left, +Y = up, +Z = forward.
    const left = sample.right.clone().negate();
    const basis = new THREE.Matrix4().makeBasis(left, sample.up, sample.forward);
    return target.setFromRotationMatrix(basis);
  }
}

/**
 * @typedef {object} TrackSample
 * @property {number} index
 * @property {THREE.Vector3} position   centre of the road
 * @property {THREE.Vector3} forward    direction of travel
 * @property {THREE.Vector3} right      across the road, includes banking
 * @property {THREE.Vector3} up         road surface normal
 * @property {THREE.Vector3} flatRight  across the road, ignoring banking
 * @property {number} bank              bank angle (rad)
 * @property {number} distance          metres from the start line
 * @property {number} curvature         1/radius, positive = left turn
 */
