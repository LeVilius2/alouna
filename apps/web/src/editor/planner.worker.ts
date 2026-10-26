import { RoutingEngine, routeResponse, type RoutingRequest } from '@alouna/core';
import { createTileCache } from '../data/tileCache';

export type PlannerRequest = RoutingRequest & { scope: string; mapKey: string };

let engine: RoutingEngine | undefined, key: string | undefined;
// Serialize requests so an IndexedDB restore cannot race another map version.
let pending = Promise.resolve();
globalThis.addEventListener('message', (event: MessageEvent<PlannerRequest>) => {
  const request = event.data;
  pending = pending.then(async () => {
    try {
      const nextKey = `${request.scope}:${request.mapKey}`;
      const cache = createTileCache(request.scope);
      if (key !== nextKey || !engine) {
        const next = new RoutingEngine(request.features, request.rules, request.gridOptions);
        await cache.restore(next.grid);
        engine = next;
        key = nextKey;
      }
      globalThis.postMessage(routeResponse(engine, request));
      // Persistence is an optimization; failure never prevents a route result.
      try {
        await cache.save(engine.grid);
      } catch {
        /* Regenerate tiles next time. */
      }
    } catch {
      globalThis.postMessage({ id: request.id, error: 'invalid-input' });
    }
  });
});
