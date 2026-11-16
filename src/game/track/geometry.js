// =============================================================================
// track/geometry.js — generates all track geometry as plain number arrays.
//
// "Plain arrays" (positions, triangle indices, …) on purpose: the very same
// arrays are handed to Three.js to draw (track/meshes.js) and to Rapier to
// collide with (track/colliders.js). What you see is exactly what you hit.
//
// Cross-section of the track, looking along the direction of travel
// (lateral position 0 is the centre line, negative is left):
//
//    wall   verge (grass)      road (asphalt)      verge (grass)   wall
//     ##  ...............|=====================|...............  ##
//     -W               -half         0        +half              +W
//
// Outside the walls lies the terrain, a big grid of hills that is lowered
// slightly wherever the track runs so it never pokes through the road.
// =============================================================================

import * as THREE from 'three';

const WALL_THICKNESS = 0.5; // visual thickness of the barrier
const WALL_COLLIDER_THICKNESS = 1.0; // physics walls are thicker = safer
const TERRAIN_CELL = 3; // metres between terrain grid points
const TERRAIN_MARGIN = 220; // how far the terrain extends past the track
const TERRAIN_SINK = 0.5; // how far the terrain is lowered under the track

/**
 * @param {TrackPath} path
 * @param {object} cfg  CONFIG.track
 */
export function buildTrackGeometry(path, cfg) {
  const half = cfg.roadWidth / 2;
  const wall = half + cfg.vergeWidth; // lateral position of the walls

  // A helper that returns "the point `lateral` metres right of the centre
  // line and `height` above the road" for a given sample.
  const edge = (lateral, height = 0) => (sample) => path.pointAt(sample, lateral, height);

  // --- Road and verges ---------------------------------------------------------
  const road = strip(path, edge(-half), edge(half), { uvScale: 8 });
  const verges = merge([
    strip(path, edge(-wall), edge(-half), { uvScale: 6 }),
    strip(path, edge(half), edge(wall), { uvScale: 6 }),
  ]);

  // --- Curbs: red/white blocks along both road edges in corners -----------------
  // A sample gets curbs if the track is curvy there or a few samples away
  // (so curbs begin slightly before the corner and end slightly after it).
  const hasCurb = (i) => {
    for (let k = -5; k <= 5; k++) {
      if (Math.abs(path.sample(i + k).curvature) > cfg.curbMinCurvature) return true;
    }
    return false;
  };
  const RED = [0.78, 0.1, 0.08];
  const WHITE = [0.92, 0.92, 0.9];
  const curbOptions = {
    only: hasCurb,
    color: (i) => (Math.floor(i / 2) % 2 ? RED : WHITE), // change colour every 2 samples
  };
  const curbs = merge([
    strip(path, edge(-half, 0.02), edge(-half + cfg.curbWidth, 0.02), curbOptions),
    strip(path, edge(half - cfg.curbWidth, 0.02), edge(half, 0.02), curbOptions),
  ]);

  // --- Start/finish line: one short strip across the road -------------------------
  const startLine = strip(path, edge(-half, 0.025), edge(half, 0.025), { from: 0, to: 1, unitV: true });

  // --- Walls (visual) --------------------------------------------------------------
  // Each wall is three strips: inner face, top, outer face. The outer face
  // reaches below the road to hide the seam with the terrain.
  const H = cfg.wallHeight;
  const T = WALL_THICKNESS;
  const LIGHT = [0.88, 0.88, 0.86];
  const DARK = [0.25, 0.42, 0.62];
  const wallOptions = { color: (i) => (Math.floor(i / 4) % 2 ? DARK : LIGHT) };
  const walls = merge([
    // right wall: inner face, top, outer face
    strip(path, edge(wall, -0.3), edge(wall, H), wallOptions),
    strip(path, edge(wall, H), edge(wall + T, H), wallOptions),
    strip(path, edge(wall + T, H), edge(wall + T, -1.2), wallOptions),
    // left wall: outer face, top, inner face
    strip(path, edge(-wall - T, -1.2), edge(-wall - T, H), wallOptions),
    strip(path, edge(-wall - T, H), edge(-wall, H), wallOptions),
    strip(path, edge(-wall, H), edge(-wall, -0.3), wallOptions),
  ]);

  // --- Walls (physics): a chain of boxes -------------------------------------------
  const wallBoxes = [];
  const STEP = 2; // one box per 2 samples (~3 m)
  for (const side of [-1, 1]) {
    for (let i = 0; i < path.count; i += STEP) {
      const lateral = side * (wall + WALL_COLLIDER_THICKNESS / 2);
      const a = path.pointAt(path.sample(i), lateral, (H - 1) / 2);
      const b = path.pointAt(path.sample(i + STEP), lateral, (H - 1) / 2);
      // Build the box orientation: Z along the wall, Y up, X across.
      const z = b.clone().sub(a);
      const length = z.length();
      z.normalize();
      const x = new THREE.Vector3().crossVectors(path.sample(i + 1).up, z).normalize();
      const y = new THREE.Vector3().crossVectors(z, x);
      wallBoxes.push({
        halfExtents: { x: WALL_COLLIDER_THICKNESS / 2, y: (H + 1) / 2, z: length / 2 + 0.05 },
        position: a.add(b).multiplyScalar(0.5),
        quaternion: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)),
      });
    }
  }

  // --- Terrain ------------------------------------------------------------------------
  const heightAt = makeTerrainHeightFunction(path, wall + WALL_THICKNESS + 1.5);
  const terrain = buildTerrainGrid(path, heightAt);

  return { road, verges, curbs, startLine, walls, wallBoxes, terrain, heightAt, wallDistance: wall };
}

// =============================================================================
// Strips
// =============================================================================

/**
 * Build a ribbon of triangles that follows the track between two edges.
 *
 * `edgeA(sample)` and `edgeB(sample)` return the two edge points for a
 * sample. With A on the left and B on the right, the surface faces up.
 *
 * Options:
 *   from, to   only cover samples from..to (default: the whole loop)
 *   only(i)    skip segments where this returns false
 *   color(i)   -> [r,g,b] for segment i (gives each segment its own flat colour)
 *   uvScale    texture repeats every `uvScale` metres along the track
 *   unitV      instead, stretch the texture exactly once over the strip
 */
function strip(path, edgeA, edgeB, options = {}) {
  const { from = 0, to = path.count, only = null, color = null, uvScale = 1, unitV = false } = options;
  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];

  for (let i = from; i < to; i++) {
    if (only && !only(i)) continue;
    // One segment = a quad between sample i and sample i+1. Its four corners
    // are not shared with neighbouring quads; this costs a few vertices but
    // lets every quad have its own colour and keeps the code simple.
    const s0 = path.sample(i);
    const s1 = path.sample(i + 1);
    const a0 = edgeA(s0);
    const b0 = edgeB(s0);
    const a1 = edgeA(s1);
    const b1 = edgeB(s1);
    const base = positions.length / 3;
    positions.push(a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, a1.x, a1.y, a1.z, b1.x, b1.y, b1.z);

    const v0 = unitV ? (i - from) / (to - from) : (i * path.spacing) / uvScale;
    const v1 = unitV ? (i + 1 - from) / (to - from) : ((i + 1) * path.spacing) / uvScale;
    uvs.push(0, v0, 1, v0, 0, v1, 1, v1);

    if (color) {
      const c = color(i);
      for (let k = 0; k < 4; k++) colors.push(c[0], c[1], c[2]);
    }
    // Two triangles, counter-clockwise when seen from the front side.
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  return toTypedArrays({ positions, uvs, colors, indices });
}

/** Join several geometries into one (so they can be one mesh / one collider). */
function merge(parts) {
  const out = { positions: [], uvs: [], colors: [], indices: [] };
  for (const part of parts) {
    const offset = out.positions.length / 3;
    for (const v of part.positions) out.positions.push(v);
    for (const v of part.uvs) out.uvs.push(v);
    for (const v of part.colors) out.colors.push(v);
    for (const v of part.indices) out.indices.push(v + offset);
  }
  return toTypedArrays(out);
}

function toTypedArrays({ positions, uvs, colors, indices }) {
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
}

// =============================================================================
// Terrain
// =============================================================================

/**
 * Returns a function heightAt(x, z) describing the landscape.
 *
 *  - Inside the track corridor: just below the (possibly banked) road.
 *  - Outside: starts at the height of the nearby track edge and gradually
 *    turns into rolling hills that rise towards the horizon.
 */
function makeTerrainHeightFunction(path, corridor) {
  // Copy what we need into flat arrays; this function runs ~50,000 times.
  const n = path.count;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const sz = new Float32Array(n);
  const rx = new Float32Array(n);
  const rz = new Float32Array(n);
  const slope = new Float32Array(n); // sideways slope of the road from banking
  for (let i = 0; i < n; i++) {
    const s = path.samples[i];
    sx[i] = s.position.x;
    sy[i] = s.position.y;
    sz[i] = s.position.z;
    rx[i] = s.flatRight.x;
    rz[i] = s.flatRight.z;
    slope[i] = Math.tan(s.bank);
  }

  // Points along both outer edges of the corridor (every 2nd sample).
  const edges = [];
  for (let i = 0; i < n; i += 2) {
    for (const side of [-1, 1]) {
      const p = path.pointAt(path.samples[i], side * corridor);
      edges.push(p.x, p.y, p.z);
    }
  }

  return function heightAt(x, z) {
    // Nearest centre-line sample (brute force is fine at this scale).
    let nearest = 0;
    let nearestD2 = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = x - sx[i];
      const dz = z - sz[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < nearestD2) {
        nearestD2 = d2;
        nearest = i;
      }
    }
    const distance = Math.sqrt(nearestD2);

    if (distance < corridor) {
      // Under the track: follow the road's (tilted) plane, a bit lower.
      const lateral = (x - sx[nearest]) * rx[nearest] + (z - sz[nearest]) * rz[nearest];
      return sy[nearest] + lateral * slope[nearest] - TERRAIN_SINK;
    }

    // Outside: "inverse distance weighting" — a weighted average of the
    // heights of all track-edge points, where close points count far more
    // than distant ones. Next to the track this equals the track's height;
    // between two parts of the track it blends smoothly from one to the other.
    let weightSum = 0;
    let heightSum = 0;
    for (let i = 0; i < edges.length; i += 3) {
      const dx = x - edges[i];
      const dz = z - edges[i + 2];
      const d2 = dx * dx + dz * dz + 0.01;
      const weight = 1 / (d2 * d2);
      weightSum += weight;
      heightSum += weight * edges[i + 1];
    }
    const trackHeight = heightSum / weightSum;

    const away = distance - corridor; // metres from the corridor
    const smooth = THREE.MathUtils.smoothstep;
    const sink = TERRAIN_SINK * (1 - smooth(away, 0, 10));
    const hills =
      2.5 * Math.sin(x * 0.031 + 1.3) * Math.cos(z * 0.027 - 0.4) +
      1.5 * Math.sin((x + z) * 0.052) +
      1.0 * Math.cos(x * 0.09 - z * 0.07);
    const rim = 16 * smooth(away, 50, 200); // high ground near the horizon
    return trackHeight - sink + hills * smooth(away, 3, 60) + rim;
  };
}

/** A regular grid of vertices covering the track area, lifted to heightAt(). */
function buildTerrainGrid(path, heightAt) {
  const box = new THREE.Box3();
  for (const s of path.samples) box.expandByPoint(s.position);
  const x0 = box.min.x - TERRAIN_MARGIN;
  const z0 = box.min.z - TERRAIN_MARGIN;
  const nx = Math.ceil((box.max.x + TERRAIN_MARGIN - x0) / TERRAIN_CELL) + 1;
  const nz = Math.ceil((box.max.z + TERRAIN_MARGIN - z0) / TERRAIN_CELL) + 1;

  const positions = new Float32Array(nx * nz * 3);
  const colors = new Float32Array(nx * nz * 3);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = x0 + ix * TERRAIN_CELL;
      const z = z0 + iz * TERRAIN_CELL;
      const k = (iz * nx + ix) * 3;
      positions[k] = x;
      positions[k + 1] = heightAt(x, z);
      positions[k + 2] = z;
      // Patchy greens so the grass is not one flat colour.
      const patch = 0.5 + 0.5 * Math.sin(x * 0.07 + Math.sin(z * 0.05) * 2) * Math.cos(z * 0.06);
      colors[k] = 0.2 + 0.1 * patch;
      colors[k + 1] = 0.42 + 0.12 * patch;
      colors[k + 2] = 0.14 + 0.04 * patch;
    }
  }

  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let n = 0;
  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iz * nx + ix; //      a --- c      (x ->)
      const b = a + nx; //            |  /  |
      const c = a + 1; //             b --- d      (z v)
      const d = b + 1;
      indices[n++] = a;
      indices[n++] = b;
      indices[n++] = c;
      indices[n++] = b;
      indices[n++] = d;
      indices[n++] = c;
    }
  }
  return { positions, colors, indices, uvs: new Float32Array(0) };
}
