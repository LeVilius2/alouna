// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, RoutingGrid, type MapFeature } from '@alouna/core';
import { FeatureStore } from './featureStore';
import { createDataStorage } from './storage';
import { createTileCache } from './tileCache';
import { parseSnapshot } from './validation';
import { BackendError, type DataBackend, type Mutation, type Profile } from './types';
import { createSupabase } from './supabase';

const profile: Profile = { id: 'alice', display_name: 'Alice', role: 'admin', active: true };
const snapshot = parseSnapshot({ version: '1', features: [], rules: DEFAULT_RULES });
const draft = {
  kind: 'save-feature',
  entityId: 'feature-a',
  expectedRevision: 0,
  payload: { name: 'Tree', category: 'tree', geometry: { type: 'Point', coordinates: [25, 55] } },
} as const;
function fixture() {
  const db = crypto.randomUUID();
  let failure: BackendError | null = null,
    lost = false,
    applied = 0;
  const received: Mutation[] = [];
  const receipts = new Set<string>();
  const backend: DataBackend = {
    load: async () => {
      if (failure?.code === 'denied') throw failure;
      return { profile, snapshot };
    },
    mutate: async (_user, mutation) => {
      received.push(mutation);
      if (failure) throw failure;
      if (!receipts.has(mutation.operationId)) {
        receipts.add(mutation.operationId);
        applied++;
      }
      if (lost) {
        lost = false;
        throw new BackendError('offline');
      }
      return {};
    },
  };
  const storage = createDataStorage('https://example.test/supabase', 'alice', db);
  const store = new FeatureStore('alice', storage, backend);
  return {
    db,
    storage,
    store,
    backend,
    received,
    setFailure: (e: BackendError | null) => {
      failure = e;
    },
    loseResponse: () => {
      lost = true;
    },
    applied: () => applied,
  };
}

describe('persistent offline data', () => {
  it('reopens approved data and queued edits without changing the routing snapshot', async () => {
    const f = fixture();
    await f.store.sync();
    await f.store.enqueue(draft);
    const reopened = new FeatureStore(
      'alice',
      createDataStorage('https://example.test/supabase', 'alice', f.db),
      f.backend,
    );
    await reopened.open();
    expect(reopened.getSnapshot().snapshot).toEqual(snapshot);
    expect(reopened.getSnapshot().queue).toHaveLength(1);
    expect(
      (await createDataStorage('https://example.test/supabase', 'bob', f.db).read()).snapshot,
    ).toBeNull();
    expect(
      (await createDataStorage('https://other.test/supabase', 'alice', f.db).read()).queue,
    ).toEqual([]);
  });
  it('retries a lost response with the same ID and applies only once', async () => {
    const f = fixture();
    await f.store.sync();
    const id = await f.store.enqueue(draft);
    f.loseResponse();
    await f.store.sync();
    expect(f.store.getSnapshot().queue[0]?.operationId).toBe(id);
    const reopened = new FeatureStore('alice', f.storage, f.backend);
    await reopened.open();
    await reopened.sync();
    expect(f.received.map((m) => m.operationId)).toEqual([id, id]);
    expect(f.applied()).toBe(1);
    expect(reopened.getSnapshot().queue).toEqual([]);
  });
  it('stops a conflicting entity chain and requires explicit discard', async () => {
    const f = fixture();
    await f.store.sync();
    await f.store.enqueue(draft);
    await f.store.enqueue(draft);
    expect(f.store.getSnapshot().queue.map((m) => m.expectedRevision)).toEqual([0, 1]);
    f.setFailure(new BackendError('conflict'));
    await f.store.sync();
    f.setFailure(null);
    await f.store.sync();
    expect(f.received).toHaveLength(1);
    expect(f.store.getSnapshot().error).toBe('conflict');
    expect(f.store.getSnapshot().queue).toHaveLength(2);
    await f.store.discardEntity(draft.entityId);
    expect(f.store.getSnapshot().queue).toEqual([]);
  });
  it('clears readable maps when membership is denied and never sends queued work', async () => {
    const f = fixture();
    await f.store.sync();
    await f.store.enqueue(draft);
    f.setFailure(new BackendError('denied'));
    await f.store.sync();
    expect(f.received).toEqual([]);
    expect(f.store.getSnapshot().snapshot).toBeNull();
    expect(f.store.getSnapshot().profile).toBeNull();
    expect(f.store.getSnapshot().queue).toHaveLength(1);
  });
  it('keeps concurrent IndexedDB queue updates from separate tabs', async () => {
    const f = fixture();
    await f.store.sync();
    const other = new FeatureStore(
      'alice',
      createDataStorage('https://example.test/supabase', 'alice', f.db),
      f.backend,
    );
    await Promise.all([f.store.enqueue(draft), other.enqueue(draft)]);
    expect((await f.storage.read()).queue.map((m) => m.expectedRevision)).toEqual([0, 1]);
  });
  it('rejects malformed routing snapshots and browser server keys', () => {
    expect(() => parseSnapshot({ ...snapshot, features: [{ type: 'Feature' }] })).toThrow(
      'invalid-data',
    );
    expect(() => createSupabase('https://example.test', 'sb_secret_example')).toThrow();
    const key = `e30.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`;
    expect(() => createSupabase('https://example.test', key)).toThrow();
  });
  it('persists tiles only for the same complete routing snapshot', async () => {
    const cache = createTileCache('alice', crypto.randomUUID());
    const area: MapFeature = {
      id: 'test-plot',
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [25, 55],
            [25.0001, 55],
            [25.0001, 55.0001],
            [25, 55.0001],
            [25, 55],
          ],
        ],
      },
      properties: { category: 'walkable_area', enabled: true },
    };
    const grid = new RoutingGrid([area], DEFAULT_RULES);
    grid.costAt({ x: 1, y: 1 });
    await cache.save(grid);
    expect(await cache.restore(new RoutingGrid([area], DEFAULT_RULES))).toBe(true);
    expect(
      await cache.restore(
        new RoutingGrid(
          [area],
          DEFAULT_RULES.map((r) => ({ ...r, cost: r.cost + 1 })),
        ),
      ),
    ).toBe(false);
    expect(await cache.restore(grid)).toBe(false);
  });
});
