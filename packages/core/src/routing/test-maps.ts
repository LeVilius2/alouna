import { mapGeometry, toWgs84, type MetricPoint } from '../geo/projection';
import type { LonLat } from '../geo/sphere';
import type { FeatureProperties, Geometry, MapFeature } from '../rules/types';

// Synthetic fixtures, deliberately unrelated to the real property's coordinates.
export const metric = (x: number, y: number): MetricPoint => [500_000 + x, 6_100_000 + y];
export const location = (x: number, y: number): LonLat => toWgs84(metric(x, y));
export const rectangle = (x1: number, y1: number, x2: number, y2: number): Geometry => ({
  type: 'Polygon',
  coordinates: [[metric(x1, y1), metric(x2, y1), metric(x2, y2), metric(x1, y2), metric(x1, y1)]],
});
export function feature(
  id: string,
  category: string,
  geometry: Geometry,
  properties: Partial<FeatureProperties> = {},
): MapFeature {
  return {
    type: 'Feature',
    id,
    geometry: mapGeometry(geometry, toWgs84),
    properties: { category, ...properties },
  };
}
export const area = (width = 30, height = 30): MapFeature =>
  feature('area', 'walkable_area', rectangle(0, 0, width, height));
