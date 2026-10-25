// @vitest-environment node
import legacyText from '../../../../supabase/seed/wgs84coord.geojson?raw';
import mappingText from '../../../../supabase/seed/legacy-map.json?raw';
import { expect, it } from 'vitest';
import { DEFAULT_RULES, type MapFeature } from '@alouna/core';
import { parseSnapshot } from './validation';

type Entry = {
  name: string;
  category: string;
  enabled: boolean;
  owner: string;
  quarantined?: boolean;
};
const mapping = JSON.parse(mappingText) as Record<string, Entry>;
const source = JSON.parse(legacyText) as {
  features: { geometry: MapFeature['geometry']; properties: { name: string } }[];
};
it('loads all accepted legacy polygons through the browser routing-data validator', () => {
  const accepted: MapFeature[] = [],
    rejected: MapFeature[] = [];
  for (const feature of source.features) {
    const entry = mapping[feature.properties.name];
    if (!entry) continue;
    const transformed: MapFeature = {
      id: feature.properties.name,
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        name: entry.name,
        category: entry.category,
        enabled: entry.enabled,
        owner_label: entry.owner,
      },
    };
    (entry.quarantined ? rejected : accepted).push(transformed);
  }
  const input = { version: '1', features: accepted, rules: DEFAULT_RULES };
  expect(parseSnapshot(input).features).toHaveLength(6);
  expect(
    accepted.filter((f) => f.properties.category === 'walkable_area' && f.properties.enabled),
  ).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(() => parseSnapshot({ ...input, features: [...accepted, ...rejected] })).toThrow(
    'invalid-data',
  );
});
