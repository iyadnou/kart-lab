// =============================================================================
// track/layout.js — the shape of the circuit, as a list of control points.
//
// A smooth closed curve (a Catmull-Rom spline) is drawn through these points
// in order, and everything else — road, curbs, walls, terrain, checkpoints —
// is generated from that one curve. To change the circuit, edit this file.
//
// Each point is [x, y, z, bankDegrees]:
//   x, z  position on the map in metres (+x = east, +z = south)
//   y     height in metres
//   bank  sideways tilt of the road. Positive raises the RIGHT edge, which is
//         what you want in a LEFT turn. Optional, defaults to 0.
//
// The lap runs counter-clockwise when seen from above. Point 0 is the
// start/finish line.
//
// Rules of thumb when editing (`npm run sim` checks them for you):
//   * keep corner radii above ~14 m, otherwise the inner wall folds over
//   * keep different parts of the track at least ~30 m apart
// =============================================================================

/**
 * Points on a circular arc — the easy way to describe a clean corner.
 *
 * Angles are in degrees on the map: 0° = east of the centre, 90° = south,
 * 180° = west, 270° (or -90°) = north. The arc runs from `fromDeg` to `toDeg`.
 * Height changes evenly from `y0` to `y1`. `bank` is strongest in the middle
 * of the corner and fades to zero at both ends.
 */
function arc({ center, radius, fromDeg, toDeg, stepDeg = 30, y0, y1, bank = 0 }) {
  const points = [];
  const steps = Math.round(Math.abs(toDeg - fromDeg) / stepDeg);
  for (let i = 0; i <= steps; i++) {
    const f = i / steps; // 0 at the start of the corner, 1 at the end
    const angle = ((fromDeg + (toDeg - fromDeg) * f) * Math.PI) / 180;
    points.push([
      center[0] + radius * Math.cos(angle),
      y0 + (y1 - y0) * f,
      center[1] + radius * Math.sin(angle),
      bank * Math.sin(f * Math.PI),
    ]);
  }
  return points;
}

export const TRACK_POINTS = [
  // --- Main straight, heading east ------------------------------------------
  [-30, 0, 70], // start / finish line
  [10, 0, 70],
  [50, 0, 70],

  // --- Turn 1: wide, banked 180° left ----------------------------------------
  ...arc({ center: [85, 34], radius: 36, fromDeg: 90, toDeg: -90, y0: 0, y1: 2, bank: 13 }),

  // --- Short straight west, then the hairpin: tight 180° right ----------------
  [60, 2.5, -2],
  ...arc({ center: [33, -20], radius: 18, fromDeg: 90, toDeg: 270, y0: 3, y1: 3 }),

  // --- Fast sweeper: 180° left with a generous radius --------------------------
  [56, 3.5, -38],
  ...arc({ center: [78, -70], radius: 32, fromDeg: 90, toDeg: -90, y0: 4, y1: 5, bank: 4 }),

  // --- S-bend along the north side, heading west ------------------------------
  [45, 5, -103],
  [10, 5.5, -92],
  [-25, 6, -105],
  [-58, 7.5, -94],

  // --- The hill: climb to the crest, then descend down the west side ----------
  [-92, 11, -97], // crest
  [-125, 9.5, -82],
  [-142, 6.5, -50],
  [-145, 3, -5],
  [-140, 1, 35],

  // --- Last corner back onto the main straight --------------------------------
  [-122, 0, 60],
  [-90, 0, 70],
];
