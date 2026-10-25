import type { LonLat } from '../geo/sphere';
import { DEFAULT_RULES } from '../rules/defaults';
import type { CategoryRule, MapFeature } from '../rules/types';
import type { GridOptions } from './rasterize';
import { RoutingEngine, type RouteOptions, type RouteResult } from './router';
import { mapSnapshot } from './validation';

export interface RoutingRequest {
  id: string;
  features: readonly MapFeature[];
  rules?: readonly CategoryRule[];
  gridOptions?: GridOptions;
  routeOptions?: RouteOptions;
  start: LonLat;
  end: LonLat;
}
export type RoutingResponse =
  { id: string; result: RouteResult } | { id: string; error: 'invalid-input' };

/** Testable without a DOM. Reuses grid tiles for consecutive requests on the same map. */
export function createRoutingHandler(): (request: RoutingRequest) => RoutingResponse {
  let engine: RoutingEngine | undefined, snapshot: string | undefined;
  return (request) => {
    try {
      const rules = request.rules ?? DEFAULT_RULES,
        options = request.gridOptions ?? {};
      const nextSnapshot = mapSnapshot(request.features, rules, options);
      if (nextSnapshot !== snapshot) {
        engine = new RoutingEngine(request.features, rules, options);
        snapshot = nextSnapshot;
      }
      return {
        id: request.id,
        result: engine!.route(request.start, request.end, request.routeOptions),
      };
    } catch {
      return { id: request?.id ?? '', error: 'invalid-input' };
    }
  };
}
