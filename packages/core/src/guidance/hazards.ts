import { metricDistance, signedGeometryDistance } from '../geo/planar';
import { projectFeature, toLks94, type MetricPoint } from '../geo/projection';
import { normalizeDegrees, signedAngleDiff, type LonLat } from '../geo/sphere';
import type { CategoryRule, MapFeature } from '../rules/types';
import { closestPointOnRing, metricBearingDegrees } from './carrot';

export type RelativeSector = 'ahead' | 'left' | 'right' | 'behind';

export interface NearbyHazard {
  featureId: string;
  category: string;
  label: string;
  name: string;
  spokenName: string;
  distanceM: number;
  warnM: number;
  bearingDegrees: number;
  relativeDegrees: number;
  sector: RelativeSector;
}

export interface NearestLandmarkInfo {
  featureId: string;
  name: string;
  spokenName: string;
  distanceM: number;
  bearingDegrees: number;
  relativeDegrees: number;
  sector: RelativeSector;
}

export function classifySector(relativeDegrees: number): RelativeSector {
  const abs = Math.abs(relativeDegrees);
  if (abs <= 35) return 'ahead';
  if (abs >= 135) return 'behind';
  return relativeDegrees > 0 ? 'right' : 'left';
}

function closestPointOnProjectedFeature(p: MetricPoint, feature: MapFeature): MetricPoint {
  const geom = feature.geometry;
  switch (geom.type) {
    case 'Point':
      return geom.coordinates;
    case 'LineString':
      return closestPointOnRing(p, geom.coordinates);
    case 'Polygon': {
      let best = geom.coordinates[0]?.[0] ?? p;
      let bestDist = Infinity;
      for (const ring of geom.coordinates) {
        if (!ring.length) continue;
        const candidate = closestPointOnRing(p, ring);
        const d = metricDistance(p, candidate);
        if (d < bestDist) {
          best = candidate;
          bestDist = d;
        }
      }
      return best;
    }
  }
}

/**
 * Finds all enabled hazard features within their configured `warn_m` of `position`.
 * If the walker is currently inside an override feature (e.g. `crossing` over `road`,
 * `dock` over `water`, `gate`/`door` over `fence`/`wall`/`building`), the overridden
 * blocker categories are suppressed at that position so a crossing does not buzz as a road hazard.
 */
export function detectNearbyHazards(
  position: LonLat,
  headingDegrees: number,
  features: readonly MapFeature[],
  rules: readonly CategoryRule[],
): NearbyHazard[] {
  const p = toLks94(position);
  const heading = normalizeDegrees(headingDegrees);
  const ruleMap = new Map(rules.map((r) => [r.category, r]));
  const projected = features
    .filter((f) => f.properties.enabled !== false)
    .map((f) => projectFeature(structuredClone(f)));

  // Determine which blocker categories are actively overridden at the walker's current position.
  const suppressedCategories = new Set<string>();
  for (const feature of projected) {
    const rule = ruleMap.get(feature.properties.category);
    if (!rule || !rule.passable || !rule.overrides.length) continue;
    // Allow 1 m grace around the override footprint for GPS noise while on a crossing/dock/gate.
    if (signedGeometryDistance(p, feature) <= 1.0) {
      for (const target of rule.overrides) suppressedCategories.add(target);
    }
  }

  // Passable entrance/surface categories that have their own route event prompts rather than hazard buzzes.
  const passableEntrances = new Set(['crossing', 'gate', 'door', 'dock', 'steps', 'caution']);

  const hazards: NearbyHazard[] = [];
  for (const feature of projected) {
    const category = feature.properties.category;
    if (category === 'walkable_area' || category === 'landmark') continue;
    if (suppressedCategories.has(category)) continue;
    if (passableEntrances.has(category)) continue;
    const rule = ruleMap.get(category);
    if (!rule || rule.warn_m === null || rule.warn_m <= 0) continue;

    const rawDistance = signedGeometryDistance(p, feature);
    const distanceM = Math.max(0, rawDistance);
    if (distanceM > rule.warn_m) continue;

    const closest = closestPointOnProjectedFeature(p, feature);
    const bearingDegrees = metricBearingDegrees(p, closest);
    const relativeDegrees = signedAngleDiff(heading, bearingDegrees);
    const name = feature.properties.name?.trim() || rule.label;
    const spokenName = feature.properties.spoken_name?.trim() || name;

    hazards.push({
      featureId: feature.id,
      category,
      label: rule.label,
      name,
      spokenName,
      distanceM,
      warnM: rule.warn_m,
      bearingDegrees,
      relativeDegrees,
      sector: classifySector(relativeDegrees),
    });
  }

  return hazards.sort(
    (a, b) => a.distanceM - b.distanceM || a.featureId.localeCompare(b.featureId),
  );
}

/**
 * Finds the nearest enabled landmark or named feature to answer "Where am I?".
 */
export function findNearestLandmark(
  position: LonLat,
  headingDegrees: number,
  features: readonly MapFeature[],
  rules: readonly CategoryRule[],
): NearestLandmarkInfo | null {
  const p = toLks94(position);
  const heading = normalizeDegrees(headingDegrees);
  const ruleMap = new Map(rules.map((r) => [r.category, r]));
  const candidates = features.filter(
    (f) =>
      f.properties.enabled !== false &&
      f.properties.category !== 'walkable_area' &&
      (f.properties.is_destination ||
        f.properties.category === 'landmark' ||
        Boolean(f.properties.spoken_name?.trim() || f.properties.name?.trim())),
  );
  if (!candidates.length) return null;

  // Prefer explicit landmarks/destinations if any exist, otherwise fall back to any named feature.
  const primary = candidates.filter(
    (f) => f.properties.is_destination || f.properties.category === 'landmark',
  );
  const pool = primary.length > 0 ? primary : candidates;

  let best: NearestLandmarkInfo | null = null;
  for (const rawFeature of pool) {
    const feature = projectFeature(structuredClone(rawFeature));
    const distanceM = Math.max(0, signedGeometryDistance(p, feature));
    if (best && distanceM >= best.distanceM) continue;
    const closest = closestPointOnProjectedFeature(p, feature);
    const bearingDegrees = metricBearingDegrees(p, closest);
    const relativeDegrees = signedAngleDiff(heading, bearingDegrees);
    const rule = ruleMap.get(feature.properties.category);
    const name = feature.properties.name?.trim() || rule?.label || feature.properties.category;
    const spokenName = feature.properties.spoken_name?.trim() || name;
    best = {
      featureId: feature.id,
      name,
      spokenName,
      distanceM,
      bearingDegrees,
      relativeDegrees,
      sector: classifySector(relativeDegrees),
    };
  }
  return best;
}
