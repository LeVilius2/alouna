import { closestOnSegment, metricDistance, polylineLength, projectOnPolyline } from '../geo/planar';
import { toLks94, toWgs84, type MetricPoint } from '../geo/projection';
import { normalizeDegrees, signedAngleDiff, type LonLat } from '../geo/sphere';

export interface CarrotSample {
  /** Projected point on the route polyline (WGS84). */
  projectedPosition: LonLat;
  /** Distance from route start to the projected point in metres. */
  distanceAlongM: number;
  /** Remaining distance from projected point to route end in metres. */
  distanceRemainingM: number;
  /** Perpendicular distance from user position to the route polyline in metres. */
  crossTrackErrorM: number;
  /** Index of the route segment containing the projected point. */
  segmentIndex: number;
  /** Pure-pursuit target ("carrot") point ahead along the route (WGS84). */
  carrotPosition: LonLat;
  /** Distance from the user's current position to the carrot point in metres. */
  distanceToCarrotM: number;
  /** Distance from the user's current position directly to the final waypoint in metres. */
  distanceToDestinationM: number;
  /** True-north bearing (0..360) from user position to the carrot point. */
  bearingToCarrotDegrees: number;
  /** Signed angle (-180..+180) from user heading to carrot bearing (+ = turn right, - = turn left). */
  turnAngleDegrees: number;
}

export function pointAlongMetricPolyline(
  points: readonly MetricPoint[],
  distanceM: number,
): MetricPoint {
  if (!points.length) throw new RangeError('Empty polyline.');
  if (points.length === 1 || distanceM <= 0) return points[0]!;
  let remaining = distanceM;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    const segLen = metricDistance(a, b);
    if (segLen <= 0) continue;
    if (remaining <= segLen || i === points.length - 1) {
      const t = Math.max(0, Math.min(1, remaining / segLen));
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    remaining -= segLen;
  }
  return points[points.length - 1]!;
}

export function metricBearingDegrees(from: MetricPoint, to: MetricPoint): number {
  const dx = to[0] - from[0],
    dy = to[1] - from[1];
  if (Math.hypot(dx, dy) < 1e-6) return 0;
  return normalizeDegrees((Math.atan2(dx, dy) * 180) / Math.PI);
}

/**
 * Projects `position` onto `waypoints` in LKS94 metres and computes a pure-pursuit
 * carrot point `lookaheadM` (default 5 m) ahead along the route.
 */
export function sampleCarrot(
  waypoints: readonly LonLat[],
  position: LonLat,
  headingDegrees: number,
  lookaheadM = 5,
): CarrotSample {
  if (waypoints.length === 0) throw new RangeError('Route must contain at least one waypoint.');
  if (!Number.isFinite(lookaheadM) || lookaheadM <= 0)
    throw new RangeError('Lookahead distance must be positive.');
  const metricPoints = waypoints.map(toLks94);
  const userMetric = toLks94(position);
  const totalM = polylineLength(metricPoints);
  const proj = projectOnPolyline(userMetric, metricPoints);
  const targetAlongM = Math.min(totalM, proj.distanceM + lookaheadM);
  const carrotMetric = pointAlongMetricPolyline(metricPoints, targetAlongM);
  const endMetric = metricPoints[metricPoints.length - 1]!;
  const distanceToCarrotM = metricDistance(userMetric, carrotMetric);
  const distanceToDestinationM = metricDistance(userMetric, endMetric);
  // If user is practically on top of carrot (e.g. at destination), use final segment bearing.
  let bearingToCarrotDegrees = metricBearingDegrees(userMetric, carrotMetric);
  if (distanceToCarrotM < 1e-3 && metricPoints.length >= 2) {
    bearingToCarrotDegrees = metricBearingDegrees(
      metricPoints[metricPoints.length - 2]!,
      endMetric,
    );
  }
  const normalizedHeading = normalizeDegrees(headingDegrees);
  const turnAngleDegrees = signedAngleDiff(normalizedHeading, bearingToCarrotDegrees);
  return {
    projectedPosition: toWgs84(proj.point),
    distanceAlongM: proj.distanceM,
    distanceRemainingM: Math.max(0, totalM - proj.distanceM),
    crossTrackErrorM: proj.distanceToLineM,
    segmentIndex: proj.segmentIndex,
    carrotPosition: toWgs84(carrotMetric),
    distanceToCarrotM,
    distanceToDestinationM,
    bearingToCarrotDegrees,
    turnAngleDegrees,
  };
}

/** Closest point on any feature geometry in LKS94 metres, returned in LKS94. */
export function closestPointOnRing(p: MetricPoint, ring: readonly MetricPoint[]): MetricPoint {
  if (!ring.length) throw new RangeError('Empty ring.');
  let best = ring[0]!,
    bestDist = metricDistance(p, best);
  for (let i = 1; i < ring.length; i++) {
    const candidate = closestOnSegment(p, ring[i - 1]!, ring[i]!);
    const d = metricDistance(p, candidate);
    if (d < bestDist) {
      best = candidate;
      bestDist = d;
    }
  }
  return best;
}
