// =============================================================================
// track/colliders.js — gives the generated track geometry to the physics
// engine. Each collider is tagged with userData so the kart can tell what
// its wheels are rolling on and what it crashed into.
// =============================================================================

import { GROUP } from '../physics.js';

/**
 * @param {Physics} physics
 * @param {object} geometry  result of buildTrackGeometry()
 * @param {object} config    the CONFIG object
 */
export function addTrackColliders(physics, geometry, config) {
  const { road, verges, terrain, wallBoxes } = geometry;

  // Triangle meshes: the wheels' rays hit exactly the triangles you see.
  physics.addTrimesh(road.positions, road.indices, { type: 'ground', surface: 'asphalt' });
  physics.addTrimesh(verges.positions, verges.indices, { type: 'ground', surface: 'grass' });
  // The kart cannot normally get past the walls, but if it ever does, there
  // is solid grass out there to land on.
  physics.addTrimesh(terrain.positions, terrain.indices, { type: 'ground', surface: 'grass' });

  // Walls: a chain of slippery boxes.
  for (const box of wallBoxes) {
    physics.addBox(box.halfExtents, box.position, box.quaternion, { type: 'wall' }, {
      group: GROUP.WALL,
      friction: config.walls.friction,
      restitution: config.walls.restitution,
    });
  }
}
