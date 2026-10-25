import { createStore, del, get, update } from 'idb-keyval';
import { parseProfile, parseSnapshot } from './validation';
import { emptyData, type DataStorage, type LocalData } from './types';

/** The backend URL and authenticated account are both part of the cache namespace. */
export function createDataStorage(
  backendUrl: string,
  userId: string,
  database = 'alouna-data-v1',
): DataStorage {
  const store = createStore(database, 'accounts'),
    key = `${new URL(backendUrl).origin}${new URL(backendUrl).pathname}:${userId}`;
  const validate = (value: LocalData | undefined): LocalData => {
    if (!value) return emptyData();
    try {
      if (
        !Array.isArray(value.queue) ||
        !value.queue.every(
          (m) =>
            typeof m.operationId === 'string' &&
            typeof m.entityId === 'string' &&
            Number.isSafeInteger(m.expectedRevision) &&
            m.expectedRevision >= 0 &&
            ['save-feature', 'delete-feature', 'save-rule'].includes(m.kind) &&
            ['pending', 'conflict', 'denied', 'invalid-data'].includes(m.status),
        )
      )
        throw new Error('Invalid queue');
      return {
        ...value,
        snapshot: value.snapshot ? parseSnapshot(value.snapshot, value.snapshot.fetchedAt) : null,
        profile: value.profile ? parseProfile(value.profile, userId) : null,
      };
    } catch {
      return { ...emptyData(), error: 'invalid-data' };
    }
  };
  return {
    read: async () => validate(await get<LocalData>(key, store)),
    update: async (change) => {
      let next = emptyData();
      await update<LocalData>(
        key,
        (previous) => {
          next = change(validate(previous));
          return next;
        },
        store,
      );
      return next;
    },
    clear: () => del(key, store),
  };
}
