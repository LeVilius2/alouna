import {
  toLks94,
  toWgs84,
  type CategoryRule,
  type DebugGrid,
  type LonLat,
  type MapFeature,
  type RoutingResponse,
} from '@alouna/core';
import type { LocalData } from '../data/types';
import { computeEffectiveState } from './state';

export type Endpoint = 'start' | 'end';
export type RouteSource = 'approved' | 'preview';
export type PlannedRoute = Extract<RoutingResponse, { result: unknown }>;

export interface RouteMapOverlay {
  start: LonLat | null;
  end: LonLat | null;
  response: PlannedRoute | null;
  debug: DebugGrid | null;
  walker?: { position: LonLat; headingDegrees: number } | null;
}

/** Preview is explicit and never changes the approved offline/navigation snapshot. */
export function routingMap(
  data: LocalData,
  source: RouteSource,
): { features: readonly MapFeature[]; rules: readonly CategoryRule[] } | null {
  if (
    !data.snapshot ||
    !data.profile?.active ||
    data.error === 'denied' ||
    data.error === 'invalid-data'
  )
    return null;
  if (source === 'approved') return data.snapshot;
  if (data.profile.role !== 'admin' || data.queue.some((m) => m.status !== 'pending')) return null;
  const effective = computeEffectiveState(data);
  return {
    features: effective.features.filter((f) => f.status !== 'deleted').map((f) => f.feature),
    rules: effective.rules,
  };
}

// Polygon/line destinations need an explicit click: a centroid can be inside a hazard or hole.
export function pointDestinations(features: readonly MapFeature[]): MapFeature[] {
  return features.filter(
    (f) =>
      f.geometry.type === 'Point' && f.properties.is_destination && f.properties.enabled !== false,
  );
}

export function debugGeoJson(debug: DebugGrid | null): GeoJSON.FeatureCollection {
  if (!debug || debug.status !== 'ok') return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: debug.costs.map((cost, index) => {
      const x = debug.origin[0] + (index % debug.columns) * debug.cellSizeM;
      const y = debug.origin[1] + Math.floor(index / debug.columns) * debug.cellSizeM;
      const s = debug.cellSizeM;
      return {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              toWgs84([x, y]),
              toWgs84([x + s, y]),
              toWgs84([x + s, y + s]),
              toWgs84([x, y + s]),
              toWgs84([x, y]),
            ].map((p) => [...p]),
          ],
        },
        properties: {
          blocked: !Number.isFinite(cost),
          cost: Number.isFinite(cost) ? cost : null,
          baseCost: Number.isFinite(debug.baseCosts[index]) ? debug.baseCosts[index] : null,
        },
      };
    }),
  };
}

export function viewportBounds(corners: readonly LonLat[]) {
  const pts = corners.map(toLks94);
  return [
    Math.min(...pts.map((p) => p[0])),
    Math.min(...pts.map((p) => p[1])),
    Math.max(...pts.map((p) => p[0])),
    Math.max(...pts.map((p) => p[1])),
  ] as const;
}
