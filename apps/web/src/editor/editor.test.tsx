import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { DEFAULT_RULES, toLks94, type MapFeature } from '@alouna/core';
import { DataContext } from '../data/context';
import { FeatureStore } from '../data/featureStore';
import { createDataStorage } from '../data/storage';
import { parseSnapshot } from '../data/validation';
import type { DataBackend, Profile } from '../data/types';
import { routes } from '../router';
import { parseImportInput } from './fileImport';
import { circlePolygonToPoint } from './state';

const ourPlot: MapFeature = {
  id: 'plot-ours',
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [25.694, 55.636],
        [25.696, 55.636],
        [25.696, 55.637],
        [25.694, 55.637],
        [25.694, 55.636],
      ],
    ],
  },
  properties: {
    name: 'Our plot',
    category: 'walkable_area',
    enabled: true,
    owner_label: 'Ours',
    reviewed: true,
    revision: 1,
  },
};

const neighbourPlot: MapFeature = {
  id: 'plot-neighbour',
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [25.696, 55.636],
        [25.698, 55.636],
        [25.698, 55.637],
        [25.696, 55.637],
        [25.696, 55.636],
      ],
    ],
  },
  properties: {
    name: "Neighbour's plot",
    category: 'walkable_area',
    enabled: false,
    owner_label: 'Neighbour',
    reviewed: true,
    revision: 1,
  },
};

const walkerBench: MapFeature = {
  id: 'feat-bench',
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [25.695, 55.6365] },
  properties: {
    name: 'Lakeside bench',
    category: 'obstacle',
    enabled: true,
    reviewed: false,
    revision: 1,
  },
};

async function setupEditor(role: 'admin' | 'walker' = 'admin') {
  const profile: Profile = { id: 'u1', display_name: 'Admin User', role, active: true };
  const snapshot = parseSnapshot({
    version: '10',
    features: [ourPlot, neighbourPlot],
    rules: DEFAULT_RULES,
    editorFeatures: [
      {
        feature: ourPlot,
        published: ourPlot,
        status: 'approved',
        created_by_name: 'Admin',
        own: true,
      },
      {
        feature: neighbourPlot,
        published: neighbourPlot,
        status: 'approved',
        created_by_name: 'Admin',
        own: true,
      },
      {
        feature: walkerBench,
        published: null,
        status: 'pending-new',
        created_by_name: 'Brother',
        own: role === 'walker',
      },
    ],
  });
  const backend: DataBackend = {
    load: async () => ({ profile, snapshot }),
    mutate: async () => ({}),
  };
  const storage = createDataStorage('https://example.test/supabase', 'u1', crypto.randomUUID());
  const store = new FeatureStore('u1', storage, backend);
  await store.sync();
  const router = createMemoryRouter(routes, { initialEntries: ['/editor'] });
  render(
    <DataContext
      value={{ configured: true, client: null, store, offline: false, signOut: async () => {} }}
    >
      <RouterProvider router={router} />
    </DataContext>,
  );
  return { store };
}

describe('fileImport (KML, GPX, GeoJSON, CSV, LKS94)', () => {
  it('parses KML and GPX documents into WGS84 features', () => {
    const kmlText = `<?xml version="1.0" encoding="UTF-8"?>
      <kml xmlns="http://www.opengis.net/kml/2.2">
        <Document><Placemark><name>Sauna</name>
          <Point><coordinates>25.6952,55.6362,0</coordinates></Point>
        </Placemark></Document>
      </kml>`;
    const kmlRes = parseImportInput(kmlText, { filename: 'sauna.kml' });
    expect(kmlRes.format).toBe('kml');
    expect(kmlRes.crs).toBe('wgs84');
    expect(kmlRes.features).toEqual([
      {
        geometry: { type: 'Point', coordinates: [25.6952, 55.6362] },
        properties: { name: 'Sauna' },
      },
    ]);

    const gpxText = `<?xml version="1.0"?>
      <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
        <trk><name>Ditch walk</name><trkseg>
          <trkpt lat="55.6361" lon="25.6951"></trkpt>
          <trkpt lat="55.6364" lon="25.6955"></trkpt>
        </trkseg></trk>
      </gpx>`;
    const gpxRes = parseImportInput(gpxText, { filename: 'ditch.gpx' });
    expect(gpxRes.format).toBe('gpx');
    expect(gpxRes.features[0]?.geometry.type).toBe('LineString');
  });

  it('auto-detects LKS94 coordinates and converts circle polygons to point+radius', () => {
    const [e, n] = toLks94([25.6953, 55.6363]);
    const res = parseImportInput(`${e}, ${n}, Oak`);
    expect(res.crs).toBe('lks94');
    const coords = res.features[0]?.geometry.coordinates as readonly number[];
    expect(coords[0]).toBeCloseTo(25.6953, 6);
    expect(coords[1]).toBeCloseTo(55.6363, 6);

    // 12-vertex ring around (25.695, 55.636) with ~2 m radius.
    const ring = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return [25.695 + (Math.cos(a) * 2) / 63000, 55.636 + (Math.sin(a) * 2) / 111000] as const;
    });
    const circle = circlePolygonToPoint({ type: 'Polygon', coordinates: [[...ring, ring[0]!]] });
    expect(circle?.radius_m).toBeCloseTo(2, 0);
  });
});

describe('EditorPage', () => {
  it('toggles neighbour plots on and supports undo/redo of queued edits', async () => {
    const { store } = await setupEditor('admin');
    const toggle = screen.getByRole('checkbox', { name: /enable neighbour's plot/i });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(store.getSnapshot().queue).toHaveLength(1));
    expect(toggle).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.getSnapshot().queue).toHaveLength(0));
    expect(toggle).not.toBeChecked();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(() => expect(store.getSnapshot().queue).toHaveLength(1));
    expect(toggle).toBeChecked();
  });

  it('lets an admin review and approve a walker submission, or edit and delete features', async () => {
    const { store } = await setupEditor('admin');
    fireEvent.click(screen.getByRole('button', { name: /lakeside bench/i }));
    expect(screen.getByText(/added by brother/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Spoken name (TTS)'), {
      target: { value: 'Bench by the lake' },
    });
    fireEvent.click(screen.getByRole('button', { name: /approve & publish/i }));
    await waitFor(() => expect(store.getSnapshot().queue).toHaveLength(1));
    const queued = store.getSnapshot().queue[0]!;
    expect(queued.entityId).toBe('feat-bench');
    expect(queued.payload).toMatchObject({
      spoken_name: 'Bench by the lake',
      reviewed: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(store.getSnapshot().queue).toHaveLength(2));
    expect(store.getSnapshot().queue[1]?.kind).toBe('delete-feature');
  });

  it('queues rule changes for admins and imports pasted coordinates', async () => {
    const { store } = await setupEditor('admin');
    fireEvent.click(screen.getByRole('tab', { name: 'Rules' }));
    const ditchSummary = screen.getByText('Ditch').closest('details')!;
    ditchSummary.open = true;
    const bufferInputs = ditchSummary.querySelectorAll('input[type="number"]');
    fireEvent.change(bufferInputs[1]!, { target: { value: '2.5' } });
    fireEvent.click(ditchSummary.querySelector('button')!);
    await waitFor(() => expect(store.getSnapshot().queue).toHaveLength(1));
    expect(store.getSnapshot().queue[0]).toMatchObject({
      kind: 'save-rule',
      entityId: 'ditch',
    });

    fireEvent.click(screen.getByRole('tab', { name: /import \/ export/i }));
    fireEvent.change(screen.getByLabelText(/or paste/i), {
      target: { value: '25.6951, 55.6362, Apple tree\n25.6954, 55.6364, Pear tree' },
    });
    expect(screen.getByText(/2 features ready/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /import 2 features/i }));
    await waitFor(() => expect(store.getSnapshot().queue).toHaveLength(3));
  });
});
