import {
  DEFAULT_RULES,
  distanceMeters,
  projectFeature,
  validateMap,
  validateProjectedPolygons,
  type CategoryRule,
  type Geometry,
  type LonLat,
  type MapFeature,
} from '@alouna/core';
import type {
  EditorFeatureItem,
  EditorStatus,
  FeaturePayload,
  LocalData,
  Mutation,
  Profile,
} from '../data/types';

export interface EffectiveFeature extends EditorFeatureItem {
  /** Has unsynced local mutations in `queue`. */
  readonly queued: boolean;
  /** Latest queued mutation status if not pending (e.g. 'conflict'). */
  readonly queueError: Exclude<Mutation['status'], 'pending'> | null;
  /** Expected revision for the *next* mutation when starting from the server snapshot. */
  readonly baseRevision: number;
}

export interface EffectiveState {
  readonly features: EffectiveFeature[];
  readonly rules: CategoryRule[];
  readonly ruleQueueErrors: ReadonlyMap<string, Exclude<Mutation['status'], 'pending'>>;
}

function baseItems(data: LocalData): Map<string, EditorFeatureItem> {
  const map = new Map<string, EditorFeatureItem>();
  const snap = data.snapshot;
  if (!snap) return map;
  if (snap.editorFeatures) {
    for (const item of snap.editorFeatures) map.set(item.feature.id, structuredClone(item));
    return map;
  }
  for (const f of snap.features) {
    map.set(f.id, {
      feature: structuredClone(f),
      published: structuredClone(f),
      status: f.properties.reviewed === false ? 'pending-new' : 'approved',
      created_by_name: '',
      own: data.profile?.role === 'admin' || f.properties.created_by === data.profile?.id,
    });
  }
  return map;
}

function applyPayload(
  id: string,
  payload: FeaturePayload,
  previous: MapFeature | null,
  profile: Profile | null,
): MapFeature {
  const admin = profile?.role === 'admin';
  const reviewed = admin && (payload.reviewed ?? true);
  return {
    id,
    type: 'Feature',
    geometry: structuredClone(payload.geometry),
    properties: {
      name: payload.name ?? '',
      category: payload.category,
      width_m: payload.width_m ?? null,
      radius_m: payload.radius_m ?? null,
      is_destination: payload.is_destination ?? false,
      spoken_name: payload.spoken_name ?? '',
      notes: payload.notes ?? '',
      source: payload.source ?? 'drawn',
      enabled: payload.enabled ?? true,
      owner_label: payload.owner_label ?? '',
      reviewed,
      gps_accuracy_m: payload.gps_accuracy_m ?? null,
      created_by: previous?.properties.created_by ?? profile?.id ?? null,
      created_at: previous?.properties.created_at,
      updated_at: new Date().toISOString(),
      deleted_at: null,
      revision: (previous?.properties.revision ?? 0) + 1,
    },
  };
}

/**
 * Overlay queued local mutations onto the server snapshot for the editor UI.
 * Published routing data in `data.snapshot` is never modified.
 */
export function computeEffectiveState(data: LocalData): EffectiveState {
  const items = baseItems(data);
  const baseRevisions = new Map<string, number>();
  for (const [id, item] of items) baseRevisions.set(id, item.feature.properties.revision ?? 1);

  const rulesByCat = new Map<string, CategoryRule>();
  for (const r of data.snapshot?.rules ?? DEFAULT_RULES)
    rulesByCat.set(r.category, structuredClone(r));
  const ruleQueueErrors = new Map<string, Exclude<Mutation['status'], 'pending'>>();

  const queuedIds = new Set<string>();
  const featureErrors = new Map<string, Exclude<Mutation['status'], 'pending'>>();

  for (const m of data.queue) {
    if (m.kind === 'save-rule') {
      if (m.payload)
        rulesByCat.set(m.entityId, { ...(m.payload as CategoryRule), category: m.entityId });
      if (m.status !== 'pending') ruleQueueErrors.set(m.entityId, m.status);
      continue;
    }
    queuedIds.add(m.entityId);
    if (m.status !== 'pending') featureErrors.set(m.entityId, m.status);
    const existing = items.get(m.entityId);
    const admin = data.profile?.role === 'admin';
    if (m.kind === 'delete-feature') {
      if (!existing) continue;
      const deletedFeature: MapFeature = {
        ...existing.feature,
        properties: {
          ...existing.feature.properties,
          deleted_at: new Date().toISOString(),
          reviewed: admin,
          revision: (existing.feature.properties.revision ?? 1) + 1,
        },
      };
      items.set(m.entityId, {
        ...existing,
        feature: deletedFeature,
        published: admin ? null : existing.published,
        status: admin ? 'deleted' : 'pending-delete',
      });
    } else if (m.payload) {
      const payload = m.payload as FeaturePayload;
      const next = applyPayload(m.entityId, payload, existing?.feature ?? null, data.profile);
      const status: EditorStatus = next.properties.reviewed
        ? 'approved'
        : existing?.published
          ? 'pending-edit'
          : 'pending-new';
      items.set(m.entityId, {
        feature: next,
        published: next.properties.reviewed ? next : (existing?.published ?? null),
        status,
        created_by_name: existing?.created_by_name ?? data.profile?.display_name ?? '',
        own: existing?.own ?? true,
      });
    }
  }

  const features: EffectiveFeature[] = [...items.values()].map((item) => ({
    ...item,
    queued: queuedIds.has(item.feature.id),
    queueError: featureErrors.get(item.feature.id) ?? null,
    baseRevision: baseRevisions.get(item.feature.id) ?? 0,
  }));
  features.sort((a, b) =>
    (a.feature.properties.name || a.feature.id).localeCompare(
      b.feature.properties.name || b.feature.id,
    ),
  );
  const rules = [...rulesByCat.values()].sort((a, b) => a.category.localeCompare(b.category));
  return { features, rules, ruleQueueErrors };
}

export function payloadFromFeature(
  feature: MapFeature,
  overrides: Partial<FeaturePayload> = {},
): FeaturePayload {
  const p = feature.properties;
  return {
    name: p.name ?? '',
    category: p.category,
    geometry: structuredClone(feature.geometry),
    width_m: p.width_m ?? null,
    radius_m: p.radius_m ?? null,
    is_destination: p.is_destination ?? false,
    spoken_name: p.spoken_name ?? '',
    notes: p.notes ?? '',
    source: p.source ?? 'drawn',
    enabled: p.enabled ?? true,
    owner_label: p.owner_label ?? '',
    reviewed: p.reviewed ?? true,
    gps_accuracy_m: p.gps_accuracy_m ?? null,
    ...overrides,
  };
}

/**
 * Validate a candidate feature against the current rule set before queuing.
 * Throws a user-readable `Error` if invalid.
 */
export function validateCandidateFeature(
  id: string,
  payload: FeaturePayload,
  rules: readonly CategoryRule[],
): void {
  const candidate: MapFeature = {
    id,
    type: 'Feature',
    geometry: payload.geometry,
    properties: {
      category: payload.category,
      name: payload.name,
      enabled: true, // Always validate geometry even when saving a disabled plot.
      width_m: payload.width_m ?? null,
      radius_m: payload.radius_m ?? null,
    },
  };
  validateMap([candidate], rules);
  validateProjectedPolygons([projectFeature(candidate)]);
}

export function validateCandidateRule(rule: CategoryRule, allRules: readonly CategoryRule[]): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(rule.color))
    throw new RangeError('Colour must be a 6-digit hex code such as #0a84ff.');
  const next = allRules.map((r) => (r.category === rule.category ? rule : r));
  validateMap([], next);
}

/**
 * Convert a Terra Draw circle polygon (drawn in circle mode) back to a Point obstacle
 * with `radius_m` set to the drawn radius in metres.
 */
export function circlePolygonToPoint(
  geometry: Geometry,
): { point: LonLat; radius_m: number } | null {
  if (geometry.type !== 'Polygon' || !geometry.coordinates[0] || geometry.coordinates[0].length < 8)
    return null;
  const ring = geometry.coordinates[0].slice(0, -1);
  let lon = 0,
    lat = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
  }
  const center: LonLat = [
    Math.round((lon / ring.length) * 1e8) / 1e8,
    Math.round((lat / ring.length) * 1e8) / 1e8,
  ];
  const radius = ring.reduce((sum, pt) => sum + distanceMeters(center, pt), 0) / ring.length;
  return { point: center, radius_m: Math.max(0.1, Math.round(radius * 10) / 10) };
}

export interface ExportBundle {
  readonly type: 'FeatureCollection';
  readonly alounaVersion: string;
  readonly exportedAt: string;
  readonly rules: readonly CategoryRule[];
  readonly features: readonly MapFeature[];
}

export function buildExportBundle(
  features: readonly EffectiveFeature[],
  rules: readonly CategoryRule[],
  version: string,
): ExportBundle {
  return {
    type: 'FeatureCollection',
    alounaVersion: version,
    exportedAt: new Date().toISOString(),
    rules,
    features: features.filter((f) => f.status !== 'deleted').map((f) => f.feature),
  };
}
