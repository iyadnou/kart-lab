// =============================================================================
// track/index.js — builds the track's data: the path (centre line samples)
// and the geometry arrays. No rendering and no physics here, so this also
// runs in Node (see tools/sim-test.js).
//
//   meshes.js    turns the geometry into Three.js meshes   (browser only)
//   colliders.js turns the geometry into Rapier colliders
//   scenery.js   trees, rocks, tire stacks, fences, gantry (browser only)
// =============================================================================

import * as THREE from 'three';
import { TRACK_POINTS } from './layout.js';
import { TrackPath } from './path.js';
import { buildTrackGeometry } from './geometry.js';

// How high above the road a kart is dropped when (re)spawned.
const SPAWN_HEIGHT = 0.5;

export function createTrack(config) {
  const cfg = config.track;
  const path = new TrackPath(TRACK_POINTS, cfg.sampleSpacing);
  const geometry = buildTrackGeometry(path, cfg);

  /** Position + orientation for a kart sitting on the road at `sample`. */
  function poseAt(sample) {
    return {
      position: path.pointAt(sample, 0, SPAWN_HEIGHT),
      quaternion: path.orientationAt(sample),
    };
  }

  // The starting grid is a few metres before the start/finish line.
  const startSample = path.sample(-Math.round(cfg.spawnDistanceBeforeLine / path.spacing));

  return {
    path,
    geometry,
    poseAt,
    startPose: poseAt(startSample),
    /** Pose on the centre line nearest to a position (for auto-recovery). */
    nearestPose(position) {
      return poseAt(path.sample(path.nearestIndex(new THREE.Vector3().copy(position))));
    },
  };
}
