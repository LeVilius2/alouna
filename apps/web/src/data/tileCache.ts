import { createStore, del, get, set } from 'idb-keyval';
import type { RoutingGrid, TileSnapshot } from '@alouna/core';

/** One versioned tile set per account/backend; core decides whether it can be reused. */
export function createTileCache(scope: string, database = 'alouna-tiles-v1') {
  const store = createStore(database, 'tiles');
  return {
    async restore(grid: RoutingGrid): Promise<boolean> {
      try {
        const cached = await get<TileSnapshot>(scope, store);
        if (!cached) return false;
        if (grid.restoreTiles(cached)) return true;
      } catch {
        /* A cache miss is safe: core regenerates the tiles. */
      }
      try {
        await del(scope, store);
      } catch {
        /* Storage can be unavailable; regenerate instead. */
      }
      return false;
    },
    save: (grid: RoutingGrid) => set(scope, grid.exportTiles(), store),
    clear: () => del(scope, store),
  };
}
