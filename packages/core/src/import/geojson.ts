import type { ParseResult, RawFeature, RawGeometry, RawPosition } from './types';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function position(value: unknown): RawPosition | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [x, y] = value as unknown[];
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)
    ? [x, y] // Any Z/M value is dropped.
    : null;
}

function positions(value: unknown): RawPosition[] | null {
  if (!Array.isArray(value)) return null;
  const out: RawPosition[] = [];
  for (const item of value) {
    const p = position(item);
    if (!p) return null;
    const last = out.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p); // drop repeated vertices
  }
  return out;
}

function ring(value: unknown): RawPosition[] | null {
  const pts = positions(value);
  if (!pts || pts.length < 3) return null;
  const first = pts[0]!,
    last = pts.at(-1)!;
  if (first[0] !== last[0] || first[1] !== last[1]) pts.push(first);
  return pts.length >= 4 ? pts : null;
}

/**
 * Split any GeoJSON geometry into the single-part geometries the map supports
 * (Point, LineString, Polygon). Multi-geometries and collections become several features.
 */
function explode(geometry: unknown, warnings: string[], label: string): RawGeometry[] {
  if (!isObject(geometry)) {
    warnings.push(`${label}: missing geometry, skipped.`);
    return [];
  }
  const c = geometry.coordinates;
  const bad = (): RawGeometry[] => {
    warnings.push(`${label}: invalid ${String(geometry.type)} coordinates, skipped.`);
    return [];
  };
  switch (geometry.type) {
    case 'Point': {
      const p = position(c);
      return p ? [{ type: 'Point', coordinates: p }] : bad();
    }
    case 'MultiPoint':
      return Array.isArray(c)
        ? c.flatMap((p) => explode({ type: 'Point', coordinates: p }, warnings, label))
        : bad();
    case 'LineString': {
      const pts = positions(c);
      return pts && pts.length >= 2 ? [{ type: 'LineString', coordinates: pts }] : bad();
    }
    case 'MultiLineString':
      return Array.isArray(c)
        ? c.flatMap((l) => explode({ type: 'LineString', coordinates: l }, warnings, label))
        : bad();
    case 'Polygon': {
      if (!Array.isArray(c) || !c.length) return bad();
      const rings = c.map(ring);
      if (rings.some((r) => !r)) return bad();
      return [{ type: 'Polygon', coordinates: rings as RawPosition[][] }];
    }
    case 'MultiPolygon':
      return Array.isArray(c)
        ? c.flatMap((p) => explode({ type: 'Polygon', coordinates: p }, warnings, label))
        : bad();
    case 'GeometryCollection':
      return Array.isArray(geometry.geometries)
        ? geometry.geometries.flatMap((g) => explode(g, warnings, label))
        : bad();
    default:
      warnings.push(`${label}: unsupported geometry type ${String(geometry.type)}, skipped.`);
      return [];
  }
}

/** Accepts a FeatureCollection, a Feature, a bare geometry, or an array of features. */
export function parseGeoJson(input: unknown): ParseResult {
  const warnings: string[] = [];
  const features: RawFeature[] = [];
  const add = (feature: unknown, index: number) => {
    const label = `Item ${index + 1}`;
    if (isObject(feature) && feature.type === 'Feature') {
      const properties = isObject(feature.properties) ? feature.properties : {};
      for (const geometry of explode(feature.geometry, warnings, label))
        features.push({ geometry, properties });
    } else {
      for (const geometry of explode(feature, warnings, label))
        features.push({ geometry, properties: {} });
    }
  };
  if (Array.isArray(input)) input.forEach(add);
  else if (isObject(input) && input.type === 'FeatureCollection' && Array.isArray(input.features))
    input.features.forEach(add);
  else if (isObject(input)) add(input, 0);
  else warnings.push('Not GeoJSON.');
  return { features, warnings };
}
