import {
  projectFeature,
  validateMap,
  validateProjectedPolygons,
  type CategoryRule,
  type MapFeature,
} from '@alouna/core';
import { BackendError, type EditorFeatureItem, type Profile, type Snapshot } from './types';

const STATUSES = ['approved', 'pending-new', 'pending-edit', 'pending-delete', 'deleted'];

export function parseEditorFeatures(
  value: unknown,
  rules: readonly CategoryRule[],
): EditorFeatureItem[] {
  if (!Array.isArray(value)) throw new BackendError('invalid-data');
  const out: EditorFeatureItem[] = [];
  for (const raw of value) {
    const item = raw as Partial<EditorFeatureItem> | null;
    if (
      !item ||
      !item.feature ||
      typeof item.feature.id !== 'string' ||
      !STATUSES.includes(item.status ?? '') ||
      typeof item.created_by_name !== 'string' ||
      typeof item.own !== 'boolean'
    )
      throw new BackendError('invalid-data');
    try {
      validateMap(
        [{ ...item.feature, properties: { ...item.feature.properties, enabled: true } }],
        rules,
      );
      validateProjectedPolygons([projectFeature(item.feature)]);
      if (item.published) {
        validateMap(
          [{ ...item.published, properties: { ...item.published.properties, enabled: true } }],
          rules,
        );
        validateProjectedPolygons([projectFeature(item.published)]);
      }
    } catch {
      throw new BackendError('invalid-data');
    }
    out.push(structuredClone(item as EditorFeatureItem));
  }
  return out;
}

export function parseProfile(value: unknown, userId: string): Profile {
  const p = value as Partial<Profile> | null;
  if (
    !p ||
    p.id !== userId ||
    typeof p.display_name !== 'string' ||
    !['admin', 'walker'].includes(p.role ?? '') ||
    p.active !== true
  )
    throw new BackendError('denied');
  return p as Profile;
}

/** Validate cached data too; malformed snapshots must never silently enable routing. */
export function parseSnapshot(value: unknown, fetchedAt = Date.now()): Snapshot {
  try {
    const data = value as Partial<Snapshot> | null;
    if (
      !data ||
      typeof data.version !== 'string' ||
      !/^\d+$/.test(data.version) ||
      !Array.isArray(data.features) ||
      !Array.isArray(data.rules)
    )
      throw new Error('Invalid snapshot');
    const features = data.features as MapFeature[],
      rules = data.rules as CategoryRule[];
    for (const f of features) {
      if (
        f.type !== 'Feature' ||
        typeof f.id !== 'string' ||
        typeof f.properties?.category !== 'string' ||
        typeof f.properties.enabled !== 'boolean'
      )
        throw new Error('Invalid feature');
    }
    // Validate disabled plots too, while allowing an empty map. Routing itself refuses
    // to start until an enabled walkable area exists.
    validateMap(
      features.map((f) => ({ ...f, properties: { ...f.properties, enabled: true } })),
      rules,
    );
    validateProjectedPolygons(features.map(projectFeature));
    const editorFeatures =
      data.editorFeatures !== undefined
        ? parseEditorFeatures(data.editorFeatures, rules)
        : undefined;
    return {
      version: data.version,
      features: structuredClone(features),
      rules: structuredClone(rules),
      fetchedAt,
      ...(editorFeatures ? { editorFeatures } : {}),
    };
  } catch {
    throw new BackendError('invalid-data');
  }
}
