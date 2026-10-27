import { describe, expect, it, vi } from 'vitest';
import { metricDistance, toLks94 } from '@alouna/core';
import {
  freshPosition,
  LiveUserStore,
  makeLivePosition,
  parseLivePosition,
  type LiveSample,
} from './livePosition';
import {
  createLiveTransport,
  LivePublisher,
  type LiveCallbacks,
  type LiveChannel,
  type LiveTransport,
} from './realtime';
import { liveGeoJson } from '../editor/liveLayers';

const user = '00000000-0000-0000-0000-000000000001',
  other = '00000000-0000-0000-0000-000000000002';
const session = '10000000-0000-0000-0000-000000000001',
  secondSession = '10000000-0000-0000-0000-000000000002';
const sample = (now = 10000): LiveSample => ({
  fix: { position: [25, 55], accuracyM: 4, timestamp: now, speedMps: 1.2 },
  heading: 90,
  headingTimestamp: now,
  destinationId: 'sauna',
  progress: 0.25,
  remainingM: 75,
  route: [
    [25, 55],
    [25.001, 55.001],
  ],
  source: 'gps',
  battery: 80,
  status: 'guiding',
});
const packet = (seq = 1, now = 10000) => makeLivePosition(sample(now), user, session, seq, now);

describe('private live-position protocol', () => {
  it('binds identity to the subscribed topic and rejects malformed or unbounded payloads', () => {
    expect(parseLivePosition(packet(), user)).toEqual(packet());
    expect(parseLivePosition(packet(), other)).toBeNull();
    for (const patch of [
      { lon: NaN },
      { accuracy: Infinity },
      { seq: 0 },
      { heading: 360 },
      { route_progress: 2 },
      { fix_age_ms: 5001 },
      { lat: null },
      { route: new Array(257).fill([25, 55]) },
      { session_id: 'not-a-session' },
    ]) {
      expect(parseLivePosition({ ...packet(), ...patch }, user)).toBeNull();
    }
    expect(parseLivePosition({ ...packet(), unrelated: 'not retained' }, user)).not.toHaveProperty(
      'unrelated',
    );
  });
  it('removes stale fixes and headings, labels weak accuracy and omits oversized routes intact', () => {
    const stale = makeLivePosition(sample(1000), user, session, 1, 10000);
    expect(stale).toMatchObject({ lon: null, lat: null, heading: null, status: 'weak-gps' });
    expect(parseLivePosition(stale, user)).not.toBeNull();
    const input = sample();
    input.fix!.accuracyM = 25;
    input.headingTimestamp = 0;
    expect(makeLivePosition(input, user, session, 1, 10000)).toMatchObject({
      accuracy: 25,
      status: 'weak-gps',
      heading: null,
    });
    input.route = new Array(257).fill([25, 55]);
    expect(makeLivePosition(input, user, session, 2, 10000).route).toBeNull();
  });
});

describe('volatile live sessions', () => {
  it('requires Presence, ignores replayed packets and clears coordinates on leave and stop', () => {
    const store = new LiveUserStore(vi.fn());
    store.receive(user, 'Walker', packet(), 10000);
    expect(freshPosition(store.values(10000)[0]!, 10000)).toBeNull();
    store.presence(user, 'Walker', [session], 10000);
    expect(freshPosition(store.values(10000)[0]!, 10000)).toEqual([25, 55]);
    store.receive(user, 'Walker', { ...packet(), lon: 26 }, 10001);
    expect(store.values(10001)[0]!.packet?.lon).toBe(25);
    store.presence(user, 'Walker', [], 10002);
    expect(store.values(10002)[0]).toMatchObject({ packet: null, online: false, trail: [] });
    store.presence(user, 'Walker', [session], 10003);
    store.receive(user, 'Walker', packet(2, 10003), 10003);
    store.receive(
      user,
      'Walker',
      makeLivePosition({ ...sample(), status: 'stopped', fix: null }, user, session, 3, 10004),
      10004,
    );
    store.receive(user, 'Walker', packet(4, 10005), 10005);
    expect(store.values(10005)[0]).toMatchObject({ packet: null, closed: true, trail: [] });
  });
  it('keeps devices separate, accounts for transit age, rejects clock anomalies and bounds trails', () => {
    const store = new LiveUserStore(vi.fn());
    store.presence(user, 'Walker', [session, secondSession], 10000);
    for (let seq = 1; seq <= 150; seq++) store.receive(user, 'Walker', packet(seq), 10000);
    store.receive(user, 'Walker', { ...packet(), session_id: secondSession, ts: 999999999 }, 10000);
    expect(store.values(10000).find((row) => row.sessionId === secondSession)?.packet).toBeNull();
    store.receive(user, 'Walker', { ...packet(), session_id: secondSession, ts: 9500 }, 10000);
    const rows = store.values(10000);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.trail).toHaveLength(120);
    expect(freshPosition(rows[1]!, 10000)).not.toBeNull();
    expect(freshPosition(rows[0]!, 15001)).toBeNull();
    expect(liveGeoJson(rows, 15001, true).features).toHaveLength(0);
    store.disconnect();
    expect(store.values(10000).every((row) => row.packet === null)).toBe(true);
  });
  it('renders accuracy circles in LKS94 metres and includes route and heading geometry', () => {
    const store = new LiveUserStore(vi.fn());
    store.presence(user, 'Walker', [session], 10000);
    store.receive(user, 'Walker', packet(), 10000);
    const geojson = liveGeoJson(store.values(10000), 10000, true);
    const circle = geojson.features.find((f) => f.properties?.kind === 'accuracy')!;
    expect(circle.geometry.type).toBe('Polygon');
    if (circle.geometry.type !== 'Polygon') return;
    for (const vertex of circle.geometry.coordinates[0]!)
      expect(metricDistance(toLks94([25, 55]), toLks94([vertex[0]!, vertex[1]!]))).toBeCloseTo(
        4,
        3,
      );
    expect(geojson.features.map((f) => f.properties?.kind)).toEqual([
      'accuracy',
      'route',
      'heading',
      'point',
    ]);
  });
});

describe('live publisher lifecycle', () => {
  it('retries a failed Presence announcement before publishing positions', async () => {
    let callbacks!: LiveCallbacks;
    const track = vi
      .fn(async () => false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const send = vi.fn<LiveChannel['send']>(async () => true);
    const publisher = new LivePublisher(
      {
        members: async () => [],
        open: (_id, cb) => {
          callbacks = cb;
          return { track, send, close: async () => {} };
        },
      },
      user,
      () => sample(),
      vi.fn(),
    );
    try {
      publisher.start();
      callbacks.status('connected');
      await Promise.resolve();
      expect(send).not.toHaveBeenCalled();
      await publisher.flush();
      expect(track).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      await publisher.close();
    }
  });
  it('throttles to 1.5 seconds, never queues offline fixes, re-tracks after reconnect and withdraws on close', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10000);
    let callbacks!: LiveCallbacks,
      input = sample();
    const send = vi.fn<LiveChannel['send']>(async () => true),
      track = vi.fn(async () => true),
      close = vi.fn(async () => {});
    const transport: LiveTransport = {
      members: async () => [],
      open: (_id, cb) => {
        callbacks = cb;
        return { send, track, close };
      },
    };
    const publisher = new LivePublisher(transport, user, () => input, vi.fn());
    try {
      publisher.start();
      expect(send).not.toHaveBeenCalled();
      callbacks.status('connected');
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(1);
      expect(track).toHaveBeenCalledTimes(1);
      input = sample(11000);
      await vi.advanceTimersByTimeAsync(1499);
      expect(send).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(send).toHaveBeenCalledTimes(2);
      callbacks.status('error');
      await vi.advanceTimersByTimeAsync(6000);
      expect(send).toHaveBeenCalledTimes(2);
      input = sample(Date.now());
      callbacks.status('connected');
      await vi.advanceTimersByTimeAsync(0);
      expect(track).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenCalledTimes(3);
      await publisher.close();
      expect(send.mock.calls.at(-1)?.[0]).toMatchObject({
        status: 'stopped',
        lon: null,
        route: null,
      });
      expect(close).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(6000);
      expect(send).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
  it('does not transmit until the private channel has joined', async () => {
    let callback!: (status: string) => void;
    const sdk = {
      on: vi.fn().mockReturnThis(),
      subscribe: (cb: typeof callback) => {
        callback = cb;
      },
      send: vi.fn(async () => 'ok'),
      track: vi.fn(async () => 'ok'),
      untrack: vi.fn(async () => 'ok'),
      presenceState: () => ({}),
    };
    const client = { channel: vi.fn(() => sdk), removeChannel: vi.fn(async () => 'ok') };
    const channel = createLiveTransport(
      client as unknown as Parameters<typeof createLiveTransport>[0],
    ).open(user, { status: vi.fn(), position: vi.fn(), presence: vi.fn() });
    await Promise.resolve();
    expect(client.channel).toHaveBeenCalledWith(
      `live-positions:${user}`,
      expect.objectContaining({ config: expect.objectContaining({ private: true }) }),
    );
    expect(await channel.send(packet())).toBe(false);
    expect(sdk.send).not.toHaveBeenCalled();
    callback('SUBSCRIBED');
    expect(await channel.send(packet())).toBe(true);
    await channel.close();
    expect(await channel.send(packet())).toBe(false);
  });
});
