import type { Geometry, MapFeature } from '../rules/types';
import type { MetricPoint } from './projection';

export type Bounds = readonly [minX: number, minY: number, maxX: number, maxY: number];
export const EPSILON = 1e-7;

export const metricDistance = (a: MetricPoint, b: MetricPoint): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

export function closestOnSegment(p: MetricPoint, a: MetricPoint, b: MetricPoint): MetricPoint {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
  return [a[0] + t * dx, a[1] + t * dy];
}

function lineDistance(p: MetricPoint, line: readonly MetricPoint[]): number {
  let distance = Infinity;
  for (let i = 1; i < line.length; i++) {
    distance = Math.min(distance, metricDistance(p, closestOnSegment(p, line[i - 1]!, line[i]!)));
  }
  return distance;
}

function inRing(p: MetricPoint, ring: readonly MetricPoint[]): boolean {
  if (lineDistance(p, ring) <= EPSILON) return true;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!,
      b = ring[j]!;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

export function inPolygon(p: MetricPoint, rings: readonly (readonly MetricPoint[])[]): boolean {
  return !!rings[0] && inRing(p, rings[0]) && !rings.slice(1).some((ring) => inRing(p, ring));
}

export function geometryPoints(geometry: Geometry): readonly MetricPoint[] {
  switch (geometry.type) {
    case 'Point':
      return [geometry.coordinates];
    case 'LineString':
      return geometry.coordinates;
    case 'Polygon':
      return geometry.coordinates.flat();
  }
}

export function boundsOf(points: readonly MetricPoint[]): Bounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

export function expandBounds(b: Bounds, margin: number): Bounds {
  return [b[0] - margin, b[1] - margin, b[2] + margin, b[3] + margin];
}

export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function physicalRadius(feature: MapFeature): number {
  if (feature.geometry.type === 'Point')
    return feature.properties.radius_m ?? (feature.properties.category === 'obstacle' ? 0.7 : 1);
  if (feature.geometry.type === 'LineString')
    return (feature.properties.width_m ?? (feature.properties.category === 'path' ? 1.5 : 1)) / 2;
  return 0;
}

/** Negative inside the feature footprint, positive outside; polygon holes are respected. */
export function signedGeometryDistance(p: MetricPoint, feature: MapFeature): number {
  const geometry = feature.geometry;
  switch (geometry.type) {
    case 'Point':
      return metricDistance(p, geometry.coordinates) - physicalRadius(feature);
    case 'LineString':
      return lineDistance(p, geometry.coordinates) - physicalRadius(feature);
    case 'Polygon': {
      const distance = Math.min(...geometry.coordinates.map((ring) => lineDistance(p, ring)));
      return inPolygon(p, geometry.coordinates) ? -distance : distance;
    }
  }
}

export function polylineLength(points: readonly MetricPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += metricDistance(points[i - 1]!, points[i]!);
  return length;
}

export interface PolylinePosition {
  point: MetricPoint;
  distanceM: number;
  segmentIndex: number;
  distanceToLineM: number;
}

export function projectOnPolyline(
  p: MetricPoint,
  points: readonly MetricPoint[],
): PolylinePosition {
  if (!points.length) throw new RangeError('Empty polyline.');
  let result: PolylinePosition = {
    point: points[0]!,
    distanceM: 0,
    segmentIndex: 0,
    distanceToLineM: metricDistance(p, points[0]!),
  };
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    const point = closestOnSegment(p, a, b),
      distanceToLineM = metricDistance(p, point);
    if (distanceToLineM < result.distanceToLineM)
      result = {
        point,
        distanceM: travelled + metricDistance(a, point),
        segmentIndex: i - 1,
        distanceToLineM,
      };
    travelled += metricDistance(a, b);
  }
  return result;
}
