import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RULES, distanceMeters } from '@alouna/core';
import { area, feature, location } from '../../../../packages/core/src/routing/test-maps';
import type { Sonar } from '../audio/sonar';
import type { Speech } from '../audio/speech';
import { DataContext } from '../data/context';
import { FeatureStore } from '../data/featureStore';
import { createDataStorage } from '../data/storage';
import type { DataBackend, FeaturePayload, Profile } from '../data/types';
import { parseSnapshot } from '../data/validation';
import { NavigatorPage } from './NavigatorPage';
import { MemoryRouter } from 'react-router';

const testFeatures = [
  area(40, 30),
  feature(
    'house',
    'landmark',
    { type: 'Point', coordinates: [500005, 6100005] },
    {
      name: 'House',
      spoken_name: 'The house',
      is_destination: true,
      enabled: true,
      reviewed: true,
    },
  ),
].map((f) => ({ ...f, properties: { ...f.properties, enabled: true, reviewed: true } }));

function createFakeSonar(): Sonar {
  return {
    async unlockFromTap() {},
    update() {},
    playArrivalChime() {},
    playTestPing() {},
    setVolume() {},
    stop() {},
  };
}

function createFakeSpeech(): Speech & { spoken: string[] } {
  return {
    spoken: [],
    speak(text) {
      this.spoken.push(text);
    },
    stop() {},
    setConfig() {},
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

async function setupFieldCapture(role: 'walker' | 'admin' = 'walker', offline = true) {
  const profile: Profile = { id: 'u1', display_name: 'Walker', role, active: true };
  const snapshot = parseSnapshot({
    version: '10',
    features: testFeatures,
    rules: DEFAULT_RULES,
  });
  const backend: DataBackend = {
    load: async () => ({ profile, snapshot }),
    mutate: async () => {
      if (offline) throw new Error('Network offline');
      return {};
    },
  };
  const storage = createDataStorage('https://example.test/supabase', 'u1', crypto.randomUUID());
  const store = new FeatureStore('u1', storage, backend);
  await store.sync();
  const sonar = createFakeSonar();
  const speech = createFakeSpeech();
  render(
    <DataContext
      value={{ configured: true, client: null, store, offline, signOut: async () => {} }}
    >
      <MemoryRouter initialEntries={['/navigate']}>
        <NavigatorPage sonarFactory={() => sonar} speechFactory={() => speech} />
      </MemoryRouter>
    </DataContext>,
  );
  return { store, speech };
}

describe('Field capture (Add here, compass offset, and Record walk)', () => {
  it('captures an averaged GPS point with compass+distance offset and queues source="gps" offline', async () => {
    const { store, speech } = await setupFieldCapture('walker', true);

    // Enable simulator so we have deterministic GPS fixes
    fireEvent.click(screen.getByLabelText(/use simulated walker/i));

    // Open Add here / Record walk
    fireEvent.click(screen.getByRole('button', { name: /add here \/ record walk/i }));
    expect(
      screen.getByRole('heading', { name: /field capture \(add here\)/i }),
    ).toBeInTheDocument();

    // Enable 2m compass offset
    fireEvent.click(screen.getByLabelText(/object is in front of me/i));
    fireEvent.change(screen.getByLabelText(/offset distance ahead/i), { target: { value: '3' } });

    // Start averaging GPS
    fireEvent.click(screen.getByRole('button', { name: /start averaging gps/i }));
    expect(speech.spoken.some((s) => s.includes('Averaging GPS for 10 seconds'))).toBe(true);

    // Emit one good fix (±2m) and one weak fix (±18m)
    fireEvent.click(screen.getByRole('button', { name: /emit gps fix here/i }));
    fireEvent.click(screen.getByRole('button', { name: /emit weak gps fix/i }));
    expect(screen.getByText(/1 weak \(>10 m\) discarded/i)).toBeInTheDocument();

    // Finish averaging early
    fireEvent.click(screen.getByRole('button', { name: /finish averaging now/i }));

    expect(
      speech.spoken.some((s) =>
        s.includes('Captured point 3 meters ahead. GPS accuracy plus or minus'),
      ),
    ).toBe(true);

    // Fill in category and name
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'obstacle' } });
    fireEvent.change(screen.getByLabelText(/name \(use keyboard microphone/i), {
      target: { value: 'Fallen birch' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save to map \(works offline\)/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/saved "fallen birch" on this device \(marked needs review/i),
      ).toBeInTheDocument(),
    );
    expect(speech.spoken).toContain('Saved Fallen birch to map.');

    // Verify offline queue has the GPS feature with 3m offset North from area center (20,15) -> (20,18)
    const snap = store.getSnapshot();
    expect(snap.queue).toHaveLength(1);
    const payload = snap.queue[0]!.payload as FeaturePayload;
    expect(payload.name).toBe('Fallen birch');
    expect(payload.source).toBe('gps');
    expect(payload.reviewed).toBe(false);
    expect(payload.gps_accuracy_m).toBeGreaterThanOrEqual(0.5);
    expect(payload.geometry.type).toBe('Point');
    if (payload.geometry.type === 'Point') {
      expect(distanceMeters(payload.geometry.coordinates, location(20, 18))).toBeLessThan(0.2);
    }
  });

  it('records a walked LineString and a walked closed Polygon, simplifies them, and queues offline', async () => {
    const { store, speech } = await setupFieldCapture('admin', true);

    fireEvent.click(screen.getByLabelText(/use simulated walker/i));
    fireEvent.click(screen.getByRole('button', { name: /add here \/ record walk/i }));

    // Switch to Record walk (LineString)
    fireEvent.change(screen.getByLabelText('Capture method'), { target: { value: 'walk' } });
    fireEvent.click(screen.getByRole('button', { name: /start recording walk/i }));
    expect(speech.spoken).toContain(
      'Recording walk. Walk along the feature, then tap Stop recording.',
    );

    // Walk 3 steps forward (9 m total)
    fireEvent.click(screen.getByRole('button', { name: 'Walk forward 3 m' }));
    fireEvent.click(screen.getByRole('button', { name: 'Walk forward 3 m' }));
    fireEvent.click(screen.getByRole('button', { name: 'Walk forward 3 m' }));

    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    expect(screen.getByText(/simplified walk to 2 vertices \(9\.0 m/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/name \(use keyboard microphone/i), {
      target: { value: 'North ditch' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save to map \(works offline\)/i }));

    await waitFor(() =>
      expect(screen.getByText(/saved "north ditch" to map/i)).toBeInTheDocument(),
    );

    // Now record a closed Polygon walk
    fireEvent.change(screen.getByLabelText('Walked geometry type'), {
      target: { value: 'Polygon' },
    });
    fireEvent.click(screen.getByRole('button', { name: /start recording walk/i }));

    // Walk a 6m x 6m square
    fireEvent.click(screen.getByRole('button', { name: 'Walk forward 3 m' }));
    fireEvent.click(screen.getByRole('button', { name: 'Walk forward 3 m' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn right 90°' }));
    fireEvent.click(screen.getByRole('button', { name: 'Walk forward 3 m' }));
    fireEvent.click(screen.getByRole('button', { name: 'Walk forward 3 m' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn right 90°' }));
    fireEvent.click(screen.getByRole('button', { name: 'Walk forward 3 m' }));
    fireEvent.click(screen.getByRole('button', { name: 'Walk forward 3 m' }));

    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    fireEvent.change(screen.getByLabelText(/name \(use keyboard microphone/i), {
      target: { value: 'Wet meadow' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save to map \(works offline\)/i }));

    await waitFor(() => expect(screen.getByText(/saved "wet meadow" to map/i)).toBeInTheDocument());

    const queue = store.getSnapshot().queue;
    expect(queue).toHaveLength(2);
    const linePayload = queue[0]!.payload as FeaturePayload;
    const polyPayload = queue[1]!.payload as FeaturePayload;
    expect(linePayload.geometry.type).toBe('LineString');
    expect(linePayload.source).toBe('gps');
    expect(linePayload.reviewed).toBe(true);
    expect(polyPayload.geometry.type).toBe('Polygon');
    expect(polyPayload.source).toBe('gps');
    expect(polyPayload.reviewed).toBe(true);
  });

  it('allows hiding the Add here button from the home screen via NavigatorSettings', async () => {
    await setupFieldCapture('walker', true);
    expect(screen.getByRole('button', { name: /add here \/ record walk/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /audio & compass settings/i }));
    fireEvent.click(screen.getByLabelText(/show 'add here' field capture on home screen/i));
    fireEvent.click(screen.getByRole('button', { name: /back to destinations/i }));

    expect(
      screen.queryByRole('button', { name: /add here \/ record walk/i }),
    ).not.toBeInTheDocument();
  });
});
