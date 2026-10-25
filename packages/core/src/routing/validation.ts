import { EPSILON, geometryPoints, inPolygon, metricDistance } from '../geo/planar';
import { assertPoint, type MetricPoint } from '../geo/projection';
import type { CategoryRule, MapFeature } from '../rules/types';

function nonnegative(value: number | null | undefined): boolean {
  return value == null || (Number.isFinite(value) && value >= 0);
}

export function validateMap(features: readonly MapFeature[], rules: readonly CategoryRule[]): void {
  const categories = new Set<string>(),
    ids = new Set<string>();
  for (const rule of rules) {
    if (
      !rule.category ||
      categories.has(rule.category) ||
      typeof rule.passable !== 'boolean' ||
      !Number.isFinite(rule.cost) ||
      rule.cost <= 0 ||
      !Number.isFinite(Math.fround(rule.cost)) ||
      Math.fround(rule.cost) <= 0 ||
      !nonnegative(rule.buffer_m) ||
      !nonnegative(rule.warn_m) ||
      !Number.isFinite(rule.priority) ||
      !Array.isArray(rule.overrides)
    ) {
      throw new RangeError('Invalid or duplicate category rule.');
    }
    categories.add(rule.category);
  }
  for (const rule of rules) {
    if (
      rule.overrides.some((category) => !categories.has(category)) ||
      (!rule.passable && rule.overrides.length)
    )
      throw new RangeError('Invalid category override.');
  }
  for (const feature of features) {
    if (!feature.id || ids.has(feature.id))
      throw new RangeError('Invalid or duplicate feature ID.');
    ids.add(feature.id);
    if (feature.properties.enabled === false) continue;
    if (
      !categories.has(feature.properties.category) ||
      !nonnegative(feature.properties.width_m) ||
      !nonnegative(feature.properties.radius_m)
    )
      throw new RangeError('Unknown category or invalid feature size.');
    const geometry = feature.geometry;
    if (!geometry || !['Point', 'LineString', 'Polygon'].includes(geometry.type))
      throw new RangeError('Unsupported geometry.');
    geometryPoints(geometry).forEach(assertPoint);
    if (geometry.type === 'LineString' && geometry.coordinates.length < 2)
      throw new RangeError('A line needs two points.');
    if (geometry.type === 'Polygon') {
      if (!geometry.coordinates.length) throw new RangeError('Empty polygon.');
      for (const ring of geometry.coordinates) {
        if (ring.length < 4 || ring[0]![0] !== ring.at(-1)![0] || ring[0]![1] !== ring.at(-1)![1])
          throw new RangeError('Polygon rings must be closed.');
        let area = 0;
        const origin = ring[0]!;
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1]!,
            b = ring[i]!;
          area += (a[0] - origin[0]) * (b[1] - origin[1]) - (b[0] - origin[0]) * (a[1] - origin[1]);
        }
        if (Math.abs(area) < 1e-12) throw new RangeError('Degenerate polygon.');
      }
    }
    if (feature.properties.category === 'walkable_area' && geometry.type !== 'Polygon')
      throw new RangeError('Walkable areas must be polygons.');
  }
}

/** Invalid polygon topology must not quietly turn into traversable land. Metres only. */
export function validateProjectedPolygons(features: readonly MapFeature[]): void {
  const intersects = (a: MetricPoint, b: MetricPoint, c: MetricPoint, d: MetricPoint): boolean => {
    const orientation = (p: MetricPoint, q: MetricPoint, r: MetricPoint) => {
      const cross = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      return Math.abs(cross) < EPSILON ? 0 : Math.sign(cross);
    };
    const on = (p: MetricPoint, q: MetricPoint, r: MetricPoint) =>
      q[0] >= Math.min(p[0], r[0]) - EPSILON &&
      q[0] <= Math.max(p[0], r[0]) + EPSILON &&
      q[1] >= Math.min(p[1], r[1]) - EPSILON &&
      q[1] <= Math.max(p[1], r[1]) + EPSILON;
    const a1 = orientation(a, b, c),
      a2 = orientation(a, b, d),
      b1 = orientation(c, d, a),
      b2 = orientation(c, d, b);
    return (
      (a1 * a2 < 0 && b1 * b2 < 0) ||
      (!a1 && on(a, c, b)) ||
      (!a2 && on(a, d, b)) ||
      (!b1 && on(c, a, d)) ||
      (!b2 && on(c, b, d))
    );
  };
  for (const feature of features) {
    if (feature.geometry.type !== 'Polygon') continue;
    const rings = feature.geometry.coordinates;
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r]!;
      if (r && !inPolygon(ring[0]!, [rings[0]!]))
        throw new RangeError('Polygon hole outside exterior.');
      for (let i = 1; i < ring.length; i++) {
        if (metricDistance(ring[i - 1]!, ring[i]!) <= EPSILON)
          throw new RangeError('Repeated polygon vertex.');
        for (let j = i + 2; j < ring.length; j++) {
          if (i === 1 && j === ring.length - 1) continue;
          if (intersects(ring[i - 1]!, ring[i]!, ring[j - 1]!, ring[j]!))
            throw new RangeError('Self-intersecting polygon.');
        }
      }
      for (let s = r + 1; s < rings.length; s++) {
        const other = rings[s]!;
        if (r && (inPolygon(ring[0]!, [other]) || inPolygon(other[0]!, [ring])))
          throw new RangeError('Nested polygon holes.');
        for (let i = 1; i < ring.length; i++)
          for (let j = 1; j < other.length; j++) {
            if (intersects(ring[i - 1]!, ring[i]!, other[j - 1]!, other[j]!))
              throw new RangeError('Intersecting polygon rings.');
          }
      }
    }
  }
}

/** Stable full snapshot is compared for cache reuse; the hash is only an external label. */
export function mapSnapshot(
  features: readonly MapFeature[],
  rules: readonly CategoryRule[],
  options: object,
): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, v]) => [key, canonical(v)]),
      );
    return value;
  };
  return JSON.stringify(
    canonical({
      features: [...features].sort((a, b) => a.id.localeCompare(b.id)),
      rules: [...rules].sort((a, b) => a.category.localeCompare(b.category)),
      options,
    }),
  );
}

export function snapshotVersion(snapshot: string): string {
  let hash = 2166136261;
  for (let i = 0; i < snapshot.length; i++)
    hash = Math.imul(hash ^ snapshot.charCodeAt(i), 16777619);
  return `routing-v1-${(hash >>> 0).toString(16)}`;
}
