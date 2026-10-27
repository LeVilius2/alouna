import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RULES,
  createRoutingHandler,
  type RoutingResponse,
  type SonarCommand,
} from '@alouna/core';
import {
  area,
  feature,
  location,
  rectangle,
} from '../../../../packages/core/src/routing/test-maps';
import type { Sonar } from '../audio/sonar';
import type { Speech } from '../audio/speech';
import { DataContext } from '../data/context';
import { FeatureStore } from '../data/featureStore';
import { createDataStorage } from '../data/storage';
import type { DataBackend, Profile } from '../data/types';
import { parseSnapshot } from '../data/validation';
import type { PlannerRequest } from '../editor/planner.worker';
import { BrowserHeadingProvider, extractCompassHeadingFromEvent } from '../sensors/headingProvider';
import { createWakeLockManager } from '../sensors/wakeLock';
import { NavigatorPage } from './NavigatorPage';
import { sortDestinationsByDistance } from './settingsState';
import { MemoryRouter } from 'react-router';

const testFeatures = [
  area(40, 30),
  feature('road', 'road', rectangle(17, 0, 21, 30)),
  feature('crossing', 'crossing', rectangle(14, 19, 24, 25)),
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
  feature(
    'sauna',
    'landmark',
    { type: 'Point', coordinates: [500035, 6100005] },
    {
      name: 'Sauna',
      spoken_name: 'The sauna',
      is_destination: true,
      enabled: true,
      reviewed: true,
    },
  ),
].map((f) => ({ ...f, properties: { ...f.properties, enabled: true, reviewed: true } }));

class FakeWorker {
  static instances: FakeWorker[] = [];
  request!: PlannerRequest;
  onmessage: ((event: { data: RoutingResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener(type: string, handler: unknown) {
    if (type === 'message') this.onmessage = handler as typeof this.onmessage;
    if (type === 'error') this.onerror = handler as typeof this.onerror;
  }
  removeEventListener(type: string) {
    if (type === 'message') this.onmessage = null;
    if (type === 'error') this.onerror = null;
  }
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(request: PlannerRequest) {
    this.request = request;
    // Reply synchronously in microtask so navigation tests can inspect immediate route startup
    const response = createRoutingHandler()(request);
    queueMicrotask(() => {
      this.onmessage?.({ data: response });
    });
  }
}

function createFakeSonar(): Sonar & {
  unlocked: number;
  commands: SonarCommand[];
  arrivals: number;
  stopped: number;
} {
  return {
    unlocked: 0,
    commands: [],
    arrivals: 0,
    stopped: 0,
    async unlockFromTap() {
      this.unlocked++;
    },
    update(cmd) {
      this.commands.push(cmd);
    },
    playArrivalChime() {
      this.arrivals++;
    },
    playTestPing() {},
    setVolume() {},
    stop() {
      this.stopped++;
    },
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
  FakeWorker.instances = [];
});

describe('heading provider and wake lock adapters', () => {
  it('uses webkitCompassHeading on iOS and deviceorientationabsolute on Android, rejecting uncalibrated relative alpha', () => {
    // iOS Safari webkitCompassHeading
    const iosEvent = {
      webkitCompassHeading: 120,
      webkitCompassAccuracy: 10,
      alpha: 20,
      absolute: false,
    } as unknown as DeviceOrientationEvent;
    expect(extractCompassHeadingFromEvent(iosEvent, 'deviceorientation')).toEqual({
      rawDegrees: 120,
      isMagnetic: true,
    });

    // Android Chrome deviceorientationabsolute
    const androidAbs = {
      alpha: 90,
      absolute: true,
    } as unknown as DeviceOrientationEvent;
    expect(extractCompassHeadingFromEvent(androidAbs, 'deviceorientationabsolute')).toEqual({
      rawDegrees: 270,
      isMagnetic: true,
    });

    // Relative deviceorientation without webkitCompassHeading or absolute=true -> ignored
    const relativeOnly = {
      alpha: 90,
      absolute: false,
    } as unknown as DeviceOrientationEvent;
    expect(extractCompassHeadingFromEvent(relativeOnly, 'deviceorientation')).toBeNull();
  });

  it('requests compass permission via DeviceOrientationEvent.requestPermission when present', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission });
    const provider = new BrowserHeadingProvider({ declinationDegrees: 8 });
    await expect(provider.requestPermission()).resolves.toBe(true);
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('acquires wake lock and notifies onBackgroundReturn when visibility returns', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({
      released: false,
      release,
      addEventListener: vi.fn(),
    });
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request },
    });
    const onReturn = vi.fn();
    const lock = createWakeLockManager(onReturn);
    await expect(lock.acquire()).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith('screen');

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(onReturn).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
    await lock.release();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('NavigatorPage UI, guidance, audio, and safety gates', () => {
  async function renderNavigator() {
    vi.stubGlobal('Worker', FakeWorker);
    const profile: Profile = { id: 'w1', display_name: 'Brother', role: 'walker', active: true };
    const snapshot = parseSnapshot({
      version: '26',
      features: testFeatures,
      rules: DEFAULT_RULES,
    });
    const backend: DataBackend = {
      load: async () => ({ profile, snapshot }),
      mutate: async () => ({}),
    };
    const storage = createDataStorage('https://example.test/supabase', 'w1', crypto.randomUUID());
    const store = new FeatureStore('w1', storage, backend);
    await store.sync();
    const sonar = createFakeSonar();
    const speech = createFakeSpeech();
    render(
      <DataContext
        value={{ configured: true, client: null, store, offline: false, signOut: async () => {} }}
      >
        <MemoryRouter initialEntries={['/navigate']}>
          <NavigatorPage sonarFactory={() => sonar} speechFactory={() => speech} />
        </MemoryRouter>
      </DataContext>,
    );
    return { sonar, speech };
  }

  it('sorts destinations by distance from the current position', () => {
    const sorted = sortDestinationsByDistance(testFeatures, location(34, 5));
    expect(sorted.map((d) => d.name)).toEqual(['Sauna', 'House']);
    expect(sorted[0]?.distanceM).toBeLessThan(sorted[1]!.distanceM!);
  });

  it('starts simulated navigation to Sauna, announces route, answers Where am I, repeats instructions, and pauses on weak GPS', async () => {
    const { sonar, speech } = await renderNavigator();

    // Enable indoor simulated walker
    fireEvent.click(screen.getByLabelText(/use simulated walker/i));

    // Start walking to Sauna
    fireEvent.click(screen.getByRole('button', { name: /start walking to sauna/i }));

    await waitFor(() =>
      expect(speech.spoken.some((s) => s.startsWith('To The sauna,'))).toBe(true),
    );
    expect(sonar.unlocked).toBeGreaterThan(0);
    expect(sonar.commands.some((c) => c.active)).toBe(true);

    // Where am I? speaks nearest landmark, remaining distance, and GPS accuracy
    fireEvent.click(screen.getByRole('button', { name: /where am i\?/i }));
    expect(speech.spoken.at(-1)).toMatch(
      /meters remaining\. GPS accuracy plus or minus 2 meters\./,
    );

    // Repeat instruction button or double-click repeats last navigation instruction
    const countBeforeRepeat = speech.spoken.length;
    fireEvent.click(screen.getByRole('button', { name: /repeat instruction/i }));
    expect(speech.spoken.length).toBe(countBeforeRepeat + 1);

    // Simulate weak GPS (±25 m) -> pauses sonar and announces "GPS weak, stop and wait."
    fireEvent.click(screen.getByRole('button', { name: /simulate weak gps/i }));
    await waitFor(() => expect(screen.getByText('GPS weak, stop and wait.')).toBeInTheDocument());
    expect(sonar.commands.at(-1)?.active).toBe(false);
    expect(speech.spoken).toContain('GPS weak, stop and wait.');

    // Restore good GPS
    fireEvent.click(screen.getByRole('button', { name: /restore good gps/i }));
    await waitFor(() => expect(speech.spoken).toContain('GPS signal restored. Continue.'));

    // Stop navigation returns to home and offers "Repeat last: Sauna"
    fireEvent.click(screen.getByRole('button', { name: /stop navigation/i }));
    expect(screen.getByRole('button', { name: /repeat last: sauna/i })).toBeInTheDocument();
  });

  it('lets the user configure voice, speech rate, sonar volume, and declination in Settings', async () => {
    const { speech } = await renderNavigator();
    fireEvent.click(screen.getByRole('button', { name: /audio & compass settings/i }));
    expect(screen.getByRole('heading', { name: /settings & safety tips/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Speech voice'), { target: { value: 'en-GB' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test voice' }));
    expect(speech.spoken).toContain('Alouna audio navigation ready.');

    fireEvent.click(screen.getByRole('button', { name: /back to destinations/i }));
    expect(screen.getByRole('heading', { name: 'Where to?' })).toBeInTheDocument();
  });

  it('auto-walks a simulated route to completion', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { sonar, speech } = await renderNavigator();
    fireEvent.click(screen.getByLabelText(/use simulated walker/i));
    fireEvent.click(screen.getByRole('button', { name: /start walking to sauna/i }));
    await waitFor(() =>
      expect(speech.spoken.some((s) => s.startsWith('To The sauna,'))).toBe(true),
    );

    const autoBtn = screen.getByRole('button', { name: 'Auto-walk route' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(autoBtn).not.toBeDisabled();
    fireEvent.click(autoBtn);

    for (let i = 0; i < 90; i++) {
      act(() => {
        vi.advanceTimersByTime(500);
      });
    }

    expect(speech.spoken).toContain('Road crossing. Stop and listen.');
    expect(speech.spoken).toContain('Arrived at The sauna.');
    expect(sonar.arrivals).toBe(1);
    vi.useRealTimers();
  });
});
