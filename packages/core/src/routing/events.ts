import { metricDistance, signedGeometryDistance } from '../geo/planar';
import { toWgs84, type MetricPoint } from '../geo/projection';
import { normalizeDegrees, signedAngleDiff, type LonLat } from '../geo/sphere';
import type { CategoryRule, MapFeature } from '../rules/types';

interface EventPosition {
  distanceM: number;
  waypointIndex: number;
  position: LonLat;
}
export type RouteEvent =
  | (EventPosition & { kind: 'enter' | 'hazard'; featureId: string; category: string })
  | (EventPosition & { kind: 'turn'; direction: 'left' | 'right'; angleDegrees: number });

/** Semantic events only: the web app owns all displayed/spoken English strings. */
export function routeEvents(
  points: readonly MetricPoint[],
  features: readonly MapFeature[],
  rules: readonly CategoryRule[],
  stepM: number,
): RouteEvent[] {
  const events: RouteEvent[] = [],
    entered = new Set<string>(),
    warned = new Set<string>();
  const ruleMap = new Map(rules.map((rule) => [rule.category, rule]));
  const entrances = new Set(['crossing', 'gate', 'door', 'dock', 'steps', 'caution']);
  let travelled = 0;
  for (let segment = 1; segment < points.length; segment++) {
    const a = points[segment - 1]!,
      b = points[segment]!,
      length = metricDistance(a, b);
    const count = Math.max(1, Math.ceil(length / stepM));
    for (let sample = 0; sample <= count; sample++) {
      const t = sample / count,
        p: MetricPoint = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      for (const feature of features) {
        const rule = ruleMap.get(feature.properties.category)!;
        const distance = signedGeometryDistance(p, feature);
        const position = {
          distanceM: travelled + length * t,
          waypointIndex: sample === 0 ? segment - 1 : segment,
          position: toWgs84(p),
        };
        if (entrances.has(rule.category)) {
          if (distance <= 0 && !entered.has(feature.id)) {
            events.push({
              ...position,
              kind: 'enter',
              featureId: feature.id,
              category: rule.category,
            });
            entered.add(feature.id);
          } else if (distance > 0) entered.delete(feature.id);
        } else if (rule.warn_m !== null && distance <= rule.warn_m && !warned.has(feature.id)) {
          events.push({
            ...position,
            kind: 'hazard',
            featureId: feature.id,
            category: rule.category,
          });
          warned.add(feature.id);
        }
      }
    }
    travelled += length;
    if (segment < points.length - 1) {
      const next = points[segment + 1]!;
      const bearing = (from: MetricPoint, to: MetricPoint) =>
        normalizeDegrees((Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI);
      const angle = signedAngleDiff(bearing(a, b), bearing(b, next));
      if (Math.abs(angle) > 45)
        events.push({
          kind: 'turn',
          direction: angle > 0 ? 'right' : 'left',
          angleDegrees: Math.abs(angle),
          distanceM: travelled,
          waypointIndex: segment,
          position: toWgs84(b),
        });
    }
  }
  return events.sort((a, b) => a.distanceM - b.distanceM);
}
