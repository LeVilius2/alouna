import {
  projectFeature,
  validateMap,
  validateProjectedPolygons,
  type CategoryRule,
  type MapFeature,
} from '@alouna/core';
import { BackendError, type Profile, type Snapshot } from './types';

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
    return {
      version: data.version,
      features: structuredClone(features),
      rules: structuredClone(rules),
      fetchedAt,
    };
  } catch {
    throw new BackendError('invalid-data');
  }
}
