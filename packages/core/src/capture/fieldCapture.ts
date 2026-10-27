import { closestOnSegment, EPSILON, metricDistance, polylineLength } from '../geo/planar';
import { toLks94, toWgs84, type MetricPoint } from '../geo/projection';
import { normalizeDegrees, type LonLat } from '../geo/sphere';
import type { Geometry } from '../rules/types';
import { validateProjectedPolygons } from '../routing/validation';

export interface CaptureFixSample {
  position: LonLat;
  accuracyM: number;
  timestampMs?: number;
}

export interface AveragedFixResult {
  position: LonLat;
  /** Resulting estimated accuracy in metres (combined mean accuracy and sample scatter). */
  accuracyM: number;
  acceptedCount: number;
  discardedCount: number;
  spreadM: number;
}

/**
 * Averages GPS fixes in LKS94 metres (`EPSG:3346`), discarding any sample whose
 * reported accuracy is worse than `maxAccuracyM` (default 10 m) or non-finite.
 * Weights each accepted sample by inverse variance (`1 / max(1, accuracyM)^2`).
 */
export function averageGpsFixes(
  samples: readonly CaptureFixSample[],
  options: { maxAccuracyM?: number } = {},
): AveragedFixResult | null {
  const maxAccuracyM = options.maxAccuracyM ?? 10;
  if (!Number.isFinite(maxAccuracyM) || maxAccuracyM <= 0) {
    throw new RangeError('maxAccuracyM must be a positive number.');
  }

  const accepted: { point: MetricPoint; accuracyM: number; weight: number }[] = [];
  let discardedCount = 0;

  for (const sample of samples) {
    if (
      !sample ||
      !Number.isFinite(sample.accuracyM) ||
      sample.accuracyM <= 0 ||
      sample.accuracyM > maxAccuracyM
    ) {
      discardedCount++;
      continue;
    }
    try {
      const point = toLks94(sample.position);
      const clampedAcc = Math.max(0.5, sample.accuracyM);
      const weight = 1 / (clampedAcc * clampedAcc);
      accepted.push({ point, accuracyM: sample.accuracyM, weight });
    } catch {
      discardedCount++;
    }
  }

  if (accepted.length === 0) return null;

  let sumX = 0,
    sumY = 0,
    sumWeight = 0,
    sumAccuracy = 0;
  for (const item of accepted) {
    sumX += item.point[0] * item.weight;
    sumY += item.point[1] * item.weight;
    sumWeight += item.weight;
    sumAccuracy += item.accuracyM;
  }

  const meanPoint: MetricPoint = [sumX / sumWeight, sumY / sumWeight];
  const meanAccuracy = sumAccuracy / accepted.length;

  let sumSqDist = 0;
  for (const item of accepted) {
    const d = metricDistance(meanPoint, item.point);
    sumSqDist += d * d;
  }
  const rmsSpread = Math.sqrt(sumSqDist / accepted.length);
  // Standard error improves with sqrt(N), bounded by actual sample scatter and a realistic 0.5 m floor.
  const combinedAccuracy = Math.max(
    0.5,
    Math.hypot(meanAccuracy / Math.sqrt(accepted.length), rmsSpread),
  );

  return {
    position: toWgs84(meanPoint),
    accuracyM: Math.round(combinedAccuracy * 10) / 10,
    acceptedCount: accepted.length,
    discardedCount,
    spreadM: Math.round(rmsSpread * 10) / 10,
  };
}

/**
 * Places an offset point `distanceM` ahead along `headingDegrees` (clockwise from true north)
 * in LKS94 metres (`EPSG:3346`).
 */
export function computeOffsetPosition(
  origin: LonLat,
  headingDegrees: number,
  distanceM: number,
): LonLat {
  if (!Number.isFinite(headingDegrees) || !Number.isFinite(distanceM) || distanceM < 0) {
    throw new RangeError('Offset heading must be finite and distance must be non-negative.');
  }
  const start = toLks94(origin);
  const rad = (normalizeDegrees(headingDegrees) * Math.PI) / 180;
  const target: MetricPoint = [
    start[0] + Math.sin(rad) * distanceM,
    start[1] + Math.cos(rad) * distanceM,
  ];
  return toWgs84(target);
}

/**
 * Ramer-Douglas-Peucker polyline simplification in LKS94 metres.
 */
export function simplifyMetricPoints(
  points: readonly MetricPoint[],
  toleranceM = 0.5,
): MetricPoint[] {
  if (!Number.isFinite(toleranceM) || toleranceM < 0) {
    throw new RangeError('Simplification tolerance must be non-negative.');
  }
  // Remove consecutive duplicate or sub-centimetre jitter vertices first.
  const deduped: MetricPoint[] = [];
  for (const pt of points) {
    if (!deduped.length || metricDistance(deduped[deduped.length - 1]!, pt) > 0.05) {
      deduped.push(pt);
    }
  }
  if (deduped.length <= 2 || toleranceM === 0) return deduped;

  const keep = new Uint8Array(deduped.length);
  keep[0] = 1;
  keep[deduped.length - 1] = 1;

  const stack: [number, number][] = [[0, deduped.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last - first <= 1) continue;
    const a = deduped[first]!,
      b = deduped[last]!;
    let maxDist = -1,
      index = -1;
    for (let i = first + 1; i < last; i++) {
      const p = deduped[i]!;
      const closest = closestOnSegment(p, a, b);
      const d = metricDistance(p, closest);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > toleranceM && index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  return deduped.filter((_, idx) => keep[idx] === 1);
}

export type GpsSample = CaptureFixSample;

export type WalkCaptureShape = 'line' | 'polygon' | 'LineString' | 'Polygon';

export interface SimplifiedWalkTrackResult {
  geometry: Extract<Geometry, { type: 'LineString' | 'Polygon' }>;
  vertexCount: number;
  rawCount: number;
  lengthM: number;
  accuracyM: number;
}

/**
 * Filters, simplifies (0.5 m default tolerance in LKS94), and validates a recorded
 * walk track into a `LineString` or closed `Polygon`.
 */
export function buildWalkTrackGeometry(
  samples: readonly CaptureFixSample[],
  shape: WalkCaptureShape,
  options: { toleranceM?: number; maxAccuracyM?: number; minStepM?: number } = {},
): SimplifiedWalkTrackResult {
  const toleranceM = options.toleranceM ?? 0.5;
  const maxAccuracyM = options.maxAccuracyM ?? 15;
  const minStepM = options.minStepM ?? 0.5;
  const isLine = shape === 'line' || shape === 'LineString';

  const validMetric: MetricPoint[] = [];
  const accuracies: number[] = [];

  for (const s of samples) {
    if (!s || !Number.isFinite(s.accuracyM) || s.accuracyM <= 0 || s.accuracyM > maxAccuracyM) {
      continue;
    }
    const pt = toLks94(s.position);
    if (
      !validMetric.length ||
      metricDistance(validMetric[validMetric.length - 1]!, pt) >= minStepM
    ) {
      validMetric.push(pt);
      accuracies.push(s.accuracyM);
    }
  }

  if (isLine) {
    const simplified = simplifyMetricPoints(validMetric, toleranceM);
    if (simplified.length < 2) {
      throw new RangeError('Walk further: a line needs at least 2 distinct points.');
    }
    const lengthM = polylineLength(simplified);
    if (lengthM < 0.5) {
      throw new RangeError('Walk further: recorded line is shorter than 0.5 metres.');
    }
    const meanAccuracy =
      accuracies.length > 0
        ? Math.round((accuracies.reduce((a, b) => a + b, 0) / accuracies.length) * 10) / 10
        : 2;
    return {
      geometry: {
        type: 'LineString',
        coordinates: simplified.map(toWgs84),
      },
      vertexCount: simplified.length,
      rawCount: validMetric.length,
      lengthM: Math.round(lengthM * 10) / 10,
      accuracyM: meanAccuracy,
    };
  }

  // Polygon mode: simplify open chain, strip closing duplicate if user walked back to start, then close ring
  const simplifiedOpen = simplifyMetricPoints(validMetric, toleranceM);
  const ringOpen = [...simplifiedOpen];
  if (
    ringOpen.length > 3 &&
    metricDistance(ringOpen[0]!, ringOpen[ringOpen.length - 1]!) <= Math.max(toleranceM, 0.5)
  ) {
    ringOpen.pop();
  }
  if (ringOpen.length < 3) {
    throw new RangeError('Walk around the area: a polygon needs at least 3 distinct corners.');
  }
  const closedMetric: MetricPoint[] = [...ringOpen, ringOpen[0]!];

  validateProjectedPolygons([
    {
      id: 'walk-capture-check',
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [closedMetric] },
      properties: { category: 'rough', enabled: true },
    },
  ]);

  // Validate non-degenerate area after checking for self-intersections
  let signedArea2 = 0;
  const origin = closedMetric[0]!;
  for (let i = 1; i < closedMetric.length; i++) {
    const a = closedMetric[i - 1]!,
      b = closedMetric[i]!;
    signedArea2 +=
      (a[0] - origin[0]) * (b[1] - origin[1]) - (b[0] - origin[0]) * (a[1] - origin[1]);
  }
  if (Math.abs(signedArea2) * 0.5 < 1.0 - EPSILON) {
    throw new RangeError('Recorded area is too small or collinear (less than 1 square metre).');
  }

  const wgsRing = closedMetric.map(toWgs84);
  // Ensure exact IEEE-754 coordinate equality between first and last ring vertex
  wgsRing[wgsRing.length - 1] = wgsRing[0]!;

  const lengthM = polylineLength(closedMetric);
  const meanAccuracy =
    accuracies.length > 0
      ? Math.round((accuracies.reduce((a, b) => a + b, 0) / accuracies.length) * 10) / 10
      : 2;

  return {
    geometry: {
      type: 'Polygon',
      coordinates: [wgsRing],
    },
    vertexCount: ringOpen.length,
    rawCount: validMetric.length,
    lengthM: Math.round(lengthM * 10) / 10,
    accuracyM: meanAccuracy,
  };
}
