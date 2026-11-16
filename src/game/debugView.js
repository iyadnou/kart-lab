// =============================================================================
// debugView.js — draws what the PHYSICS engine sees (press C).
//
// Rapier can describe all its colliders as a list of coloured line segments.
// We put those lines into one THREE.LineSegments object. Very useful to check
// that the collision shapes really match the visible meshes.
// =============================================================================

import * as THREE from 'three';

export class DebugView {
  constructor(scene, physics) {
    this.physics = physics;
    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, depthTest: true, fog: false }),
    );
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);
  }

  toggle() {
    this.lines.visible = !this.lines.visible;
  }

  /** Call once per frame; does nothing while hidden. */
  update() {
    if (!this.lines.visible) return;
    // vertices: x,y,z per point (two points per line); colors: r,g,b,a per point.
    const { vertices, colors } = this.physics.world.debugRender();
    const geometry = this.lines.geometry;
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  }
}
