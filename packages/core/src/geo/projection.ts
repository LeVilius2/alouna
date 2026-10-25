import proj4 from 'proj4';
import type { Geometry, MapFeature } from '../rules/types';
import type { LonLat } from './sphere';

/** Internal planar order is [easting, northing], in metres (not EPSG axis order). */
export type MetricPoint = readonly [easting: number, northing: number];

export const LKS94_DEFINITION =
  '+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9998 +x_0=500000 +y_0=0 ' +
  '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

const projection = proj4('EPSG:4326', LKS94_DEFINITION);

export function assertPoint(point: MetricPoint): void {
  if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) {
    throw new RangeError('Expected two finite coordinates.');
  }
}

export function toLks94(point: LonLat): MetricPoint {
  assertPoint(point);
  if (Math.abs(point[0]) > 180 || Math.abs(point[1]) >= 90) {
    throw new RangeError('Invalid WGS84 longitude/latitude.');
  }
  const result = projection.forward([point[0], point[1]]);
  const projected: MetricPoint = [result[0]!, result[1]!];
  assertPoint(projected);
  return projected;
}

export function toWgs84(point: MetricPoint): LonLat {
  assertPoint(point);
  const result = projection.inverse([point[0], point[1]]);
  const geographic: LonLat = [result[0]!, result[1]!];
  assertPoint(geographic);
  return geographic;
}

export function mapGeometry(geometry: Geometry, transform: (p: LonLat) => LonLat): Geometry {
  switch (geometry.type) {
    case 'Point':
      return { type: 'Point', coordinates: transform(geometry.coordinates) };
    case 'LineString':
      return { type: 'LineString', coordinates: geometry.coordinates.map(transform) };
    case 'Polygon':
      return { type: 'Polygon', coordinates: geometry.coordinates.map((r) => r.map(transform)) };
    default:
      throw new RangeError('Unsupported geometry.');
  }
}

/** Returned geometry is LKS94. Never store it as WGS84 GeoJSON. */
export function projectFeature(feature: MapFeature): MapFeature {
  return { ...feature, geometry: mapGeometry(feature.geometry, toLks94) };
}
