import { metricDistance } from '../geo/planar';
import { toLks94, toWgs84 } from '../geo/projection';
import { normalizeDegrees, type LonLat } from '../geo/sphere';

export interface WalkSample {
  position: LonLat;
  headingDegrees: number;
  distanceM: number;
  totalM: number;
}

/** Deterministic metric playback, shared by editor simulation and future sensor adapters. */
export function sampleWalk(waypoints: readonly LonLat[], distanceM: number): WalkSample {
  if (!waypoints.length || !Number.isFinite(distanceM))
    throw new RangeError('Invalid simulated route.');
  const points = waypoints.map(toLks94);
  const lengths = points.slice(1).map((p, i) => metricDistance(points[i]!, p));
  const totalM = lengths.reduce((sum, n) => sum + n, 0);
  const clamped = Math.max(0, Math.min(totalM, distanceM));
  let remaining = clamped;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (!length) continue;
    if (remaining <= length || i === lengths.length - 1) {
      const a = points[i]!,
        b = points[i + 1]!,
        t = remaining / length;
      return {
        position: toWgs84([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]),
        headingDegrees: normalizeDegrees((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI),
        distanceM: clamped,
        totalM,
      };
    }
    remaining -= length;
  }
  return {
    position: waypoints[waypoints.length - 1]!,
    headingDegrees: 0,
    distanceM: clamped,
    totalM,
  };
}

/** Manual simulation intentionally permits leaving the route; it is never real guidance. */
export function moveWalker(position: LonLat, headingDegrees: number, distanceM: number): LonLat {
  if (!Number.isFinite(headingDegrees) || !Number.isFinite(distanceM))
    throw new RangeError('Invalid simulated movement.');
  const p = toLks94(position),
    a = (headingDegrees * Math.PI) / 180;
  return toWgs84([p[0] + Math.sin(a) * distanceM, p[1] + Math.cos(a) * distanceM]);
}
