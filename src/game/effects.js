// =============================================================================
// effects.js — tire smoke, grass dust and skid marks.
//
// Two small building blocks:
//   ParticleSystem  a fixed pool of soft round sprites drawn as ONE object
//   SkidMarks       a ribbon of dark quads laid on the road, also one object
// and the Effects class, which watches the kart's wheels and feeds them.
// =============================================================================

import * as THREE from 'three';

const MAX_PARTICLES = 700;

// -----------------------------------------------------------------------------
// Particles
// -----------------------------------------------------------------------------

/**
 * All particles live in one THREE.Points object. Each has a position, colour,
 * opacity and size stored in big typed arrays; the GPU draws every particle
 * as a camera-facing square, and the fragment shader below turns each square
 * into a soft blob. Dead particles simply have size 0.
 *
 * "Pool" means we never create or delete particles while playing: when a new
 * one is needed we reuse the oldest slot. No garbage, no stutter.
 */
class ParticleSystem {
  constructor() {
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 4); // r, g, b, opacity
    this.sizes = new Float32Array(MAX_PARTICLES);
    // Simulation data the GPU does not need:
    this.velocities = new Float32Array(MAX_PARTICLES * 3);
    this.ages = new Float32Array(MAX_PARTICLES);
    this.lifetimes = new Float32Array(MAX_PARTICLES); // 0 = dead
    this.startSizes = new Float32Array(MAX_PARTICLES);
    this.startOpacities = new Float32Array(MAX_PARTICLES);
    this.next = 0; // slot to (re)use for the next particle

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 4));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false, // see-through things should not block what is behind
      uniforms: { uPixelsPerUnit: { value: 500 } },
      vertexShader: /* glsl */ `
        attribute vec4 aColor;
        attribute float aSize;
        uniform float uPixelsPerUnit;
        varying vec4 vColor;
        void main() {
          vColor = aColor;
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewPosition;
          // Size on screen shrinks with distance (-viewPosition.z).
          gl_PointSize = aSize * uPixelsPerUnit / max(-viewPosition.z, 0.1);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        void main() {
          // gl_PointCoord runs 0..1 across the square; fade out towards the edge.
          float distanceFromCentre = length(gl_PointCoord - 0.5);
          float softness = smoothstep(0.5, 0.1, distanceFromCentre);
          gl_FragColor = vec4(vColor.rgb, vColor.a * softness);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false; // particles move; skip the bounds check
    this.points.renderOrder = 2;
  }

  /**
   * Spawn one particle.
   * @param {THREE.Vector3} position
   * @param {THREE.Vector3} velocity
   * @param {THREE.Color} color
   */
  emit(position, velocity, color, opacity, size, lifetime) {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PARTICLES;
    position.toArray(this.positions, i * 3);
    velocity.toArray(this.velocities, i * 3);
    color.toArray(this.colors, i * 4);
    this.ages[i] = 0;
    this.lifetimes[i] = lifetime;
    this.startSizes[i] = size;
    this.startOpacities[i] = opacity;
  }

  update(dt, camera, viewportHeight) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.lifetimes[i] === 0) continue;
      this.ages[i] += dt;
      const life = this.ages[i] / this.lifetimes[i]; // 0 = newborn, 1 = dead
      if (life >= 1) {
        this.lifetimes[i] = 0;
        this.sizes[i] = 0;
        continue;
      }
      const p = i * 3;
      this.positions[p] += this.velocities[p] * dt;
      this.positions[p + 1] += this.velocities[p + 1] * dt;
      this.positions[p + 2] += this.velocities[p + 2] * dt;
      // Air resistance: puffs slow down quickly.
      const drag = Math.exp(-dt * 2.5);
      this.velocities[p] *= drag;
      this.velocities[p + 1] *= drag;
      this.velocities[p + 2] *= drag;

      this.sizes[i] = this.startSizes[i] * (1 + life * 2.5); // grow…
      this.colors[i * 4 + 3] = this.startOpacities[i] * (1 - life) * Math.min(life * 12, 1); // …and fade
    }
    const attributes = this.points.geometry.attributes;
    attributes.position.needsUpdate = true;
    attributes.aColor.needsUpdate = true;
    attributes.aSize.needsUpdate = true;

    // How many screen pixels one metre covers at distance 1, for this camera.
    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    this.points.material.uniforms.uPixelsPerUnit.value = viewportHeight / (2 * Math.tan(halfFov));
  }
}

// -----------------------------------------------------------------------------
// Skid marks
// -----------------------------------------------------------------------------

/**
 * A fixed number of quads. Every time a sliding wheel has moved a little, one
 * quad is written between its previous and current position. When all quads
 * are used, the oldest are overwritten (a "ring buffer").
 */
class SkidMarks {
  constructor(maxSegments, width) {
    this.maxSegments = maxSegments;
    this.width = width;
    this.next = 0;

    this.positions = new Float32Array(maxSegments * 4 * 3);
    const indices = new Uint32Array(maxSegments * 6);
    for (let i = 0; i < maxSegments; i++) {
      const v = i * 4;
      indices.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    const material = new THREE.MeshBasicMaterial({
      color: 0x0c0c0d,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Pull the marks slightly towards the camera in depth so they do not
      // flicker against the road they lie on.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Write one quad between two pairs of edge points. */
  addSegment(left0, right0, left1, right1) {
    const offset = this.next * 12;
    left0.toArray(this.positions, offset);
    right0.toArray(this.positions, offset + 3);
    left1.toArray(this.positions, offset + 6);
    right1.toArray(this.positions, offset + 9);
    this.next = (this.next + 1) % this.maxSegments;
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

// -----------------------------------------------------------------------------
// Effects: decides when to emit what
// -----------------------------------------------------------------------------

const SMOKE_COLOR = new THREE.Color(0.85, 0.85, 0.87);
const DUST_COLOR = new THREE.Color(0.5, 0.42, 0.26);
const _velocity = new THREE.Vector3();
const _position = new THREE.Vector3();
const _axle = new THREE.Vector3();
const _left = new THREE.Vector3();
const _right = new THREE.Vector3();

export class Effects {
  constructor(scene, config) {
    this.config = config;
    this.particles = new ParticleSystem();
    this.skidMarks = new SkidMarks(config.effects.skidMarkMaxSegments, config.effects.skidMarkWidth);
    scene.add(this.particles.points, this.skidMarks.mesh);

    // Per wheel: the previous skid mark edge points (null = not marking) and
    // a fractional counter so emission rates work at any step size.
    this.trail = [0, 1, 2, 3].map(() => ({ active: false, left: new THREE.Vector3(), right: new THREE.Vector3() }));
    this.emitCounter = [0, 0, 0, 0];
  }

  /** Call once per physics step, after vehicle.postStep(). */
  step(vehicle, dt) {
    const e = this.config.effects;
    const speed = vehicle.velocity.length();

    for (let i = 0; i < 4; i++) {
      const wheel = vehicle.wheels[i];
      const trail = this.trail[i];
      const onAsphalt = wheel.inContact && wheel.surface === 'asphalt';
      const onGrass = wheel.inContact && wheel.surface === 'grass';

      // --- Smoke and dust -----------------------------------------------------
      let rate = 0;
      let color = SMOKE_COLOR;
      let opacity = 0.35;
      if (onAsphalt && wheel.sliding) {
        rate = e.smokeRate;
      } else if (onGrass && speed > 3) {
        rate = e.dustRate * Math.min(speed / 12, 1);
        color = DUST_COLOR;
        opacity = 0.3;
      }
      this.emitCounter[i] += rate * dt;
      while (this.emitCounter[i] >= 1) {
        this.emitCounter[i] -= 1;
        _position.copy(wheel.contactPoint);
        _position.y += 0.1;
        // Drift along with the kart a little, rise, and spread randomly.
        _velocity.copy(vehicle.velocity).multiplyScalar(0.25);
        _velocity.x += (Math.random() - 0.5) * 1.5;
        _velocity.y += 0.6 + Math.random() * 0.8;
        _velocity.z += (Math.random() - 0.5) * 1.5;
        this.particles.emit(_position, _velocity, color, opacity, 0.35 + Math.random() * 0.25, 0.6 + Math.random() * 0.5);
      }

      // --- Skid marks -----------------------------------------------------------
      if (!(onAsphalt && wheel.sliding)) {
        trail.active = false;
        continue;
      }
      // The mark is as wide as the tyre, across the wheel's axle direction.
      _axle.copy(vehicle.left).applyAxisAngle(vehicle.up, wheel.steering).multiplyScalar(this.skidMarks.width / 2);
      _left.copy(wheel.contactPoint).add(_axle).addScaledVector(vehicle.up, 0.02);
      _right.copy(wheel.contactPoint).sub(_axle).addScaledVector(vehicle.up, 0.02);
      if (!trail.active) {
        trail.active = true; // start a new mark here
      } else if (_left.distanceToSquared(trail.left) < 0.2 * 0.2) {
        continue; // moved less than 20 cm: wait
      } else {
        this.skidMarks.addSegment(trail.left, trail.right, _left, _right);
      }
      trail.left.copy(_left);
      trail.right.copy(_right);
    }
  }

  /** Call once per rendered frame. */
  update(frameDt, camera, viewportHeight) {
    this.particles.update(frameDt, camera, viewportHeight);
  }
}
