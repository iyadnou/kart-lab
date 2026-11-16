// =============================================================================
// track/scenery.js — everything decorative around the track: trees, rocks,
// tire stacks, fences and the start gantry.
//
// Performance note: there are hundreds of trees. Drawing each as its own mesh
// would be slow, so identical objects use THREE.InstancedMesh — one geometry
// drawn many times in a single draw call, each copy with its own position,
// size and colour.
// =============================================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRandom } from '../mathUtils.js';
import { checkerTexture } from './meshes.js';

const TREE_COUNT = 320;
const ROCK_COUNT = 110;

/**
 * @param {object} track     result of createTrack()
 * @param {Physics} physics  solid scenery gets colliders
 * @param {object} config    the CONFIG object
 */
export function createScenery(track, physics, config) {
  const group = new THREE.Group();
  group.name = 'scenery';
  const random = createRandom(2024);

  group.add(createTrees(track, random));
  group.add(createRocks(track, random));
  group.add(createTireStacks(track, physics));
  group.add(createFences(track));
  group.add(createGantry(track, physics, config));
  return group;
}

/** A helper to fill an InstancedMesh from a list of {position, quaternion, scale, color}. */
function fillInstances(mesh, items) {
  const matrix = new THREE.Matrix4();
  items.forEach((item, i) => {
    matrix.compose(item.position, item.quaternion, item.scale);
    mesh.setMatrixAt(i, matrix);
    if (item.color) mesh.setColorAt(i, item.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/**
 * Pick random spots on the terrain that are outside the track corridor.
 * `minGap`/`maxDistance` are measured from the track's centre line.
 */
function scatter(track, random, count, minGap, maxDistance) {
  const { path, geometry } = track;
  const box = new THREE.Box3();
  for (const s of path.samples) box.expandByPoint(s.position);
  box.expandByScalar(maxDistance);

  const spots = [];
  const probe = new THREE.Vector3();
  let attempts = 0;
  while (spots.length < count && attempts++ < count * 40) {
    const x = THREE.MathUtils.lerp(box.min.x, box.max.x, random());
    const z = THREE.MathUtils.lerp(box.min.z, box.max.z, random());
    // Distance to the track, ignoring height.
    let nearest = Infinity;
    for (const s of path.samples) {
      nearest = Math.min(nearest, (s.position.x - x) ** 2 + (s.position.z - z) ** 2);
    }
    nearest = Math.sqrt(nearest);
    if (nearest < geometry.wallDistance + minGap || nearest > maxDistance) continue;
    spots.push(probe.set(x, geometry.heightAt(x, z), z).clone());
  }
  return spots;
}

// --- Trees --------------------------------------------------------------------------

function createTrees(track, random) {
  // A stylised pine: a short trunk and two stacked cones, merged into one
  // geometry. Vertex colours tell trunk and leaves apart.
  const paint = (geometry, color) => {
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  };
  const trunk = paint(new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6).translate(0, 0.8, 0), new THREE.Color(0x6b4a2b));
  const lower = paint(new THREE.ConeGeometry(1.7, 3.2, 7).translate(0, 2.9, 0), new THREE.Color(0xffffff));
  const upper = paint(new THREE.ConeGeometry(1.2, 2.6, 7).translate(0, 4.7, 0), new THREE.Color(0xffffff));
  const geometry = mergeGeometries([trunk, lower, upper]);

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const mesh = new THREE.InstancedMesh(geometry, material, TREE_COUNT);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const up = new THREE.Vector3(0, 1, 0);
  const items = scatter(track, random, TREE_COUNT, 3.5, 150).map((position) => {
    const size = 0.8 + random() * 0.9;
    position.y -= 0.2; // sink the trunk a little so it never floats on slopes
    return {
      position,
      quaternion: new THREE.Quaternion().setFromAxisAngle(up, random() * Math.PI * 2),
      scale: new THREE.Vector3(size, size * (0.85 + random() * 0.4), size),
      // The instance colour multiplies the vertex colour: white leaves become
      // a random green; the brown trunk just gets slightly tinted.
      color: new THREE.Color().setHSL(0.27 + random() * 0.09, 0.62, 0.16 + random() * 0.1),
    };
  });
  mesh.count = items.length;
  fillInstances(mesh, items);
  return mesh;
}

// --- Rocks --------------------------------------------------------------------------

function createRocks(track, random) {
  const geometry = new THREE.IcosahedronGeometry(1, 0); // 20 flat faces
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  const mesh = new THREE.InstancedMesh(geometry, material, ROCK_COUNT);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const items = scatter(track, random, ROCK_COUNT, 2.5, 90).map((position) => {
    const size = 0.4 + random() * random() * 2.2;
    position.y += size * 0.15;
    return {
      position,
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 3, random() * 3, random() * 3)),
      scale: new THREE.Vector3(size * (0.8 + random() * 0.6), size * (0.5 + random() * 0.4), size),
      color: new THREE.Color().setHSL(0.08, 0.05, 0.4 + random() * 0.2),
    };
  });
  mesh.count = items.length;
  fillInstances(mesh, items);
  return mesh;
}

// --- Tire stacks ----------------------------------------------------------------------

/** Stacks of tires in front of the wall on the outside of tight corners. */
function createTireStacks(track, physics) {
  const { path, geometry: trackGeometry } = track;
  const TIRE_RADIUS = 0.34;
  const TIRE_TUBE = 0.15;
  const TIRES_PER_STACK = 3;

  // Choose the spots: every 2nd sample where the corner is tight (the hairpin).
  const stacks = [];
  for (let i = 0; i < path.count; i += 2) {
    const s = path.samples[i];
    if (Math.abs(s.curvature) < 1 / 24) continue;
    // Left turn (positive curvature) -> the outside is on the right.
    const side = s.curvature > 0 ? 1 : -1;
    stacks.push({ sample: s, lateral: side * (trackGeometry.wallDistance - 0.55) });
  }

  const tire = new THREE.TorusGeometry(TIRE_RADIUS, TIRE_TUBE, 6, 12).rotateX(Math.PI / 2); // lie flat
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const mesh = new THREE.InstancedMesh(tire, material, stacks.length * TIRES_PER_STACK);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const palette = [new THREE.Color(0x1c1c1f), new THREE.Color(0xb3221a), new THREE.Color(0xe8e8e8)];
  const items = [];
  stacks.forEach(({ sample, lateral }, n) => {
    const quaternion = path.orientationAt(sample);
    for (let k = 0; k < TIRES_PER_STACK; k++) {
      items.push({
        position: path.pointAt(sample, lateral, TIRE_TUBE + k * TIRE_TUBE * 2),
        quaternion,
        scale: new THREE.Vector3(1, 1, 1),
        color: palette[(n + k) % 2 === 0 ? 0 : 1 + (n % 2)],
      });
    }
    // One cylinder collider per stack. Slightly bouncy, like real tire walls.
    const height = TIRES_PER_STACK * TIRE_TUBE * 2;
    physics.addCylinder(height / 2 + 0.3, TIRE_RADIUS + TIRE_TUBE, path.pointAt(sample, lateral, height / 2), {
      type: 'obstacle',
    }, { friction: 0.3, restitution: 0.5 });
  });
  fillInstances(mesh, items);
  return mesh;
}

// --- Fences --------------------------------------------------------------------------

/** Wooden fences behind the walls along the main straight. */
function createFences(track) {
  const { path, geometry: trackGeometry } = track;
  const parts = [];
  const POST_HEIGHT = 1.5;
  const lateralDistance = trackGeometry.wallDistance + 3;
  const first = -Math.round(45 / path.spacing); // from 45 m before the line…
  const last = Math.round(75 / path.spacing); //   …to 75 m after it
  const dummy = new THREE.Object3D();

  for (const side of [-1, 1]) {
    for (let i = first; i < last; i += 2) {
      const a = path.sample(i);
      const b = path.sample(i + 2);
      const pa = path.pointAt(a, side * lateralDistance);
      const pb = path.pointAt(b, side * lateralDistance);
      pa.y = trackGeometry.heightAt(pa.x, pa.z);
      pb.y = trackGeometry.heightAt(pb.x, pb.z);

      // A post at `pa`…
      parts.push(new THREE.BoxGeometry(0.14, POST_HEIGHT, 0.14).translate(pa.x, pa.y + POST_HEIGHT / 2, pa.z));
      // …and two rails from `pa` to `pb`.
      for (const railHeight of [0.65, 1.25]) {
        dummy.position.copy(pa).lerp(pb, 0.5);
        dummy.position.y += railHeight;
        dummy.lookAt(pb.x, pb.y + railHeight, pb.z);
        dummy.updateMatrix();
        parts.push(new THREE.BoxGeometry(0.06, 0.14, pa.distanceTo(pb)).applyMatrix4(dummy.matrix));
      }
    }
  }
  const mesh = new THREE.Mesh(
    mergeGeometries(parts),
    new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.85 }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// --- Start gantry ----------------------------------------------------------------------

/** Two posts and a beam with a banner across the start/finish line. */
function createGantry(track, physics, config) {
  const { path } = track;
  const sample = path.sample(0);
  const halfSpan = config.track.roadWidth / 2 + 1.4;
  const HEIGHT = 6;
  const group = new THREE.Group();

  // Build it around the origin, then move the whole group onto the track.
  const metal = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.45, metalness: 0.6 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, HEIGHT, 10), metal);
    post.position.set(side * halfSpan, HEIGHT / 2, 0);
    group.add(post);
    // Posts are solid. (+X is "left" in track space, so lateral = -x.)
    physics.addCylinder(HEIGHT / 2, 0.3, path.pointAt(sample, -side * halfSpan, HEIGHT / 2), { type: 'obstacle' });
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 2 + 0.6, 0.35, 0.5), metal);
  beam.position.y = HEIGHT;
  group.add(beam);

  // The banner: text painted on a canvas, shown on both faces.
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#12151b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ff8a2a';
  ctx.fillRect(0, 0, canvas.width, 10);
  ctx.fillRect(0, canvas.height - 10, canvas.width, 10);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 76px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('KART LAB  ·  START / FINISH', canvas.width / 2, canvas.height / 2 + 4);
  const bannerTexture = new THREE.CanvasTexture(canvas);
  bannerTexture.colorSpace = THREE.SRGBColorSpace;
  bannerTexture.anisotropy = 4;

  const bannerGeometry = new THREE.PlaneGeometry(halfSpan * 2 - 0.6, 1.5);
  const bannerMaterial = new THREE.MeshStandardMaterial({ map: bannerTexture, roughness: 0.7 });
  for (const facing of [0, Math.PI]) {
    const banner = new THREE.Mesh(bannerGeometry, bannerMaterial);
    banner.position.set(0, HEIGHT - 1.0, facing === 0 ? 0.26 : -0.26);
    banner.rotation.y = facing;
    group.add(banner);
  }

  // A checkered strip under the banner.
  const checker = checkerTexture(40, 2);
  for (const facing of [0, Math.PI]) {
    const stripMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(halfSpan * 2 - 0.6, 0.5),
      new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7 }),
    );
    stripMesh.position.set(0, HEIGHT - 2.05, facing === 0 ? 0.26 : -0.26);
    stripMesh.rotation.y = facing;
    group.add(stripMesh);
  }

  group.traverse((object) => {
    if (object.isMesh) object.castShadow = true;
  });
  group.position.copy(sample.position);
  group.quaternion.copy(path.orientationAt(sample));
  return group;
}
