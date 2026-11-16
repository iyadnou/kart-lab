// =============================================================================
// track/meshes.js — turns the generated geometry arrays into visible
// Three.js meshes, with materials and small procedural textures.
//
// All textures are painted in code on a <canvas> — no image files needed.
// =============================================================================

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRandom } from '../mathUtils.js';

/**
 * @param {object} geometry  result of buildTrackGeometry()
 * @param {number} maxAnisotropy  renderer capability; keeps the road texture
 *                                sharp when seen at a flat angle
 */
export function createTrackMeshes(geometry, maxAnisotropy = 1) {
  const group = new THREE.Group();
  group.name = 'track';

  const road = new THREE.Mesh(
    toBufferGeometry(geometry.road),
    new THREE.MeshStandardMaterial({ map: roadTexture(maxAnisotropy), roughness: 0.88, metalness: 0 }),
  );

  const verges = new THREE.Mesh(
    toBufferGeometry(geometry.verges),
    new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1, metalness: 0 }),
  );

  const curbs = new THREE.Mesh(
    toBufferGeometry(geometry.curbs),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 }),
  );

  const startLine = new THREE.Mesh(
    toBufferGeometry(geometry.startLine),
    new THREE.MeshStandardMaterial({ map: checkerTexture(16, 2), roughness: 0.6 }),
  );

  const walls = new THREE.Mesh(
    toBufferGeometry(geometry.walls),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 }),
  );

  const terrain = new THREE.Mesh(
    toBufferGeometry(geometry.terrain),
    // flatShading gives every triangle one flat colour: the low-poly look.
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true }),
  );

  // Paint that lies on top of the road must win the depth test against it.
  for (const decal of [curbs, startLine]) {
    decal.material.polygonOffset = true;
    decal.material.polygonOffsetFactor = -2;
    decal.material.polygonOffsetUnits = -2;
  }

  for (const mesh of [road, verges, curbs, startLine, terrain]) mesh.receiveShadow = true;
  walls.receiveShadow = true;
  walls.castShadow = true;

  group.add(terrain, verges, road, curbs, startLine, walls);
  return group;
}

/** Wrap plain arrays in a THREE.BufferGeometry. */
function toBufferGeometry({ positions, indices, uvs, colors }) {
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (uvs && uvs.length) geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (colors && colors.length) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  // Our strips give every quad its own four corners. Welding identical
  // corners together lets Three.js average the normals across neighbouring
  // quads, so curved surfaces are lit smoothly instead of looking faceted.
  // (Corners with different colours stay separate, so curb blocks stay crisp.)
  geometry = mergeVertices(geometry);
  geometry.computeVertexNormals(); // needed for lighting
  return geometry;
}

// =============================================================================
// Procedural textures
// =============================================================================

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d') };
}

function toTexture(canvas, { repeat = true, anisotropy = 1 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; // canvas colours are sRGB
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  return texture;
}

/** Speckle a canvas with random light/dark dots (cheap "noise"). */
function speckle(ctx, width, height, count, random, alpha) {
  for (let i = 0; i < count; i++) {
    const shade = random() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${random() * alpha})`;
    const size = 1 + random() * 2.5;
    ctx.fillRect(random() * width, random() * height, size, size);
  }
}

/**
 * Asphalt with white edge lines and a dashed centre line. The texture spans
 * the road's full width (u: 0..1) and repeats every few metres along it (v).
 */
function roadTexture(anisotropy) {
  const size = 512;
  const { canvas, ctx } = makeCanvas(size, size);
  const random = createRandom(7);
  ctx.fillStyle = '#3e4046';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, size, 9000, random, 0.09);

  ctx.fillStyle = '#e9e9e4';
  ctx.fillRect(size * 0.015, 0, size * 0.016, size); // left edge line
  ctx.fillRect(size * (1 - 0.031), 0, size * 0.016, size); // right edge line
  ctx.fillStyle = 'rgba(233,233,228,0.85)';
  ctx.fillRect(size * 0.5 - 4, 0, 8, size * 0.5); // centre dash: half painted, half gap
  return toTexture(canvas, { anisotropy });
}

function grassTexture() {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size, size);
  const random = createRandom(11);
  ctx.fillStyle = '#6aa644';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, size, 5000, random, 0.12);
  const texture = toTexture(canvas);
  texture.repeat.set(2, 1);
  return texture;
}

/** Black/white squares for the start line. */
export function checkerTexture(columns, rows) {
  const cell = 16;
  const { canvas, ctx } = makeCanvas(columns * cell, rows * cell);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#111111' : '#f2f2f2';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const texture = toTexture(canvas, { repeat: false });
  texture.magFilter = THREE.NearestFilter; // crisp squares
  return texture;
}
