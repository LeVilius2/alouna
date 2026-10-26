import type { LonLat } from '../geo/sphere';
import type { Bounds } from '../geo/planar';
import { debugGrid, inspectEndpoint, type DebugGrid, type EndpointInspection } from './debug';
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
  /** Visible map extent in LKS94. Large views return a zoom-in notice, never coarse cells. */
  debugBounds?: Bounds;
}
export type RoutingResponse =
  | {
      id: string;
      result: RouteResult;
      endpoints: { start: EndpointInspection; end: EndpointInspection };
      debug?: DebugGrid;
    }
  | { id: string; error: 'invalid-input' };

export function routeResponse(engine: RoutingEngine, request: RoutingRequest): RoutingResponse {
  return {
    id: request.id,
    result: engine.route(request.start, request.end, request.routeOptions),
    endpoints: {
      start: inspectEndpoint(engine.grid, request.start),
      end: inspectEndpoint(engine.grid, request.end),
    },
    debug: request.debugBounds ? debugGrid(engine.grid, request.debugBounds) : undefined,
  };
}

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
      return routeResponse(engine!, request);
    } catch {
      return { id: request?.id ?? '', error: 'invalid-input' };
    }
  };
}
