// =============================================================================
// track/obstacles.js — the SOLID scenery: tire stacks and the gantry posts.
//
// This file only decides where they stand and gives them colliders. Drawing
// them is scenery.js's job. Keeping the two apart means the headless tools
// (npm run sim, the AI training in training/) collide with exactly the same
// obstacles as the game, without needing any graphics code.
// =============================================================================

export const TIRE = { radius: 0.34, tube: 0.15, perStack: 3 };
export const GANTRY = { height: 6, postRadius: 0.3, sideClearance: 1.4 };

/**
 * Work out where the obstacles are.
 * @param {TrackPath} path
 * @param {number} wallDistance  lateral distance of the walls from the centre line
 * @param {object} config        the CONFIG object
 */
export function placeObstacles(path, wallDistance, config) {
  // Tire stacks: in front of the wall on the outside of tight corners (the
  // hairpin), on every 2nd sample.
  const tireStacks = [];
  for (let i = 0; i < path.count; i += 2) {
    const sample = path.samples[i];
    if (Math.abs(sample.curvature) < 1 / 24) continue;
    // Left turn (positive curvature) -> the outside is on the right.
    const side = sample.curvature > 0 ? 1 : -1;
    tireStacks.push({ sample, lateral: side * (wallDistance - 0.55) });
  }

  // Gantry: two posts beside the road at the start/finish line.
  const halfSpan = config.track.roadWidth / 2 + GANTRY.sideClearance;
  const gantry = { sample: path.sample(0), halfSpan, postLaterals: [-halfSpan, halfSpan] };

  return { tireStacks, gantry };
}

/** Give every obstacle a collider. */
export function addObstacleColliders(physics, path, obstacles) {
  // One cylinder per tire stack. Slightly bouncy, like real tire walls.
  const stackHeight = TIRE.perStack * TIRE.tube * 2;
  for (const { sample, lateral } of obstacles.tireStacks) {
    physics.addCylinder(
      stackHeight / 2 + 0.3,
      TIRE.radius + TIRE.tube,
      path.pointAt(sample, lateral, stackHeight / 2),
      { type: 'obstacle' },
      { friction: 0.3, restitution: 0.5 },
    );
  }

  const { sample, postLaterals } = obstacles.gantry;
  for (const lateral of postLaterals) {
    physics.addCylinder(GANTRY.height / 2, GANTRY.postRadius, path.pointAt(sample, lateral, GANTRY.height / 2), {
      type: 'obstacle',
    });
  }
}
