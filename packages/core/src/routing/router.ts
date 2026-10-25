import { metricDistance, polylineLength } from '../geo/planar';
import { toLks94, toWgs84, type MetricPoint } from '../geo/projection';
import type { LonLat } from '../geo/sphere';
import { DEFAULT_RULES } from '../rules/defaults';
import type { CategoryRule, MapFeature } from '../rules/types';
import { findPath } from './astar';
import { routeEvents, type RouteEvent } from './events';
import { RoutingGrid, type GridCell, type GridOptions } from './rasterize';
import { smoothPath } from './smooth';

export interface RouteOptions {
  maxSnapM?: number;
  maxVisited?: number;
}
export interface SnapNotice {
  endpoint: 'start' | 'end';
  from: LonLat;
  to: LonLat;
  distanceM: number;
}
export type RouteResult =
  | {
      status: 'ok';
      waypoints: LonLat[];
      distanceM: number;
      cost: number;
      events: RouteEvent[];
      snaps: SnapNotice[];
      visited: number;
      dataVersion: string;
    }
  | {
      status: 'no-route' | 'search-limit' | 'blocked-start' | 'blocked-end';
      visited: number;
      dataVersion: string;
    };

/** A reusable planner owns one immutable map version and its lazily rasterized tiles. */
export class RoutingEngine {
  readonly grid: RoutingGrid;
  private readonly rules: readonly CategoryRule[];
  constructor(
    features: readonly MapFeature[],
    rules: readonly CategoryRule[] = DEFAULT_RULES,
    options: GridOptions = {},
  ) {
    this.rules = structuredClone(rules);
    this.grid = new RoutingGrid(features, this.rules, options);
  }

  private snap(
    point: MetricPoint,
    maxM: number,
  ): { cell: GridCell; point: MetricPoint; distance: number } | null {
    const current = this.grid.cellAt(point);
    if (Number.isFinite(this.grid.costAt(current))) return { cell: current, point, distance: 0 };
    let best: { cell: GridCell; point: MetricPoint; distance: number } | null = null;
    const radius = Math.ceil(maxM / this.grid.cellSizeM) + 1;
    for (let y = current.y - radius; y <= current.y + radius; y++)
      for (let x = current.x - radius; x <= current.x + radius; x++) {
        const cell = { x, y },
          center = this.grid.center(cell),
          distance = metricDistance(point, center);
        if (
          distance > maxM ||
          (best && distance >= best.distance) ||
          !Number.isFinite(this.grid.costAt(cell))
        )
          continue;
        best = { cell, point: center, distance };
      }
    return best;
  }

  route(start: LonLat, end: LonLat, options: RouteOptions = {}): RouteResult {
    const maxSnapM = options.maxSnapM ?? 2;
    if (!Number.isFinite(maxSnapM) || maxSnapM < 0 || maxSnapM > 15)
      throw new RangeError('Snap limit must be between 0 and 15 metres.');
    const from = this.snap(toLks94(start), maxSnapM);
    const dataVersion = this.grid.version;
    if (!from) return { status: 'blocked-start', visited: 0, dataVersion };
    const to = this.snap(toLks94(end), maxSnapM);
    if (!to) return { status: 'blocked-end', visited: 0, dataVersion };
    const result = findPath(this.grid, from.cell, to.cell, options.maxVisited);
    if (result.status !== 'ok') return { ...result, dataVersion };
    const raw = [from.point, ...result.cells.map((cell) => this.grid.center(cell)), to.point];
    const distinct = raw.filter((p, i) => !i || metricDistance(raw[i - 1]!, p) > 1e-7);
    const points = smoothPath(this.grid, distinct);
    const snaps: SnapNotice[] = [];
    if (from.distance > 0)
      snaps.push({
        endpoint: 'start',
        from: start,
        to: toWgs84(from.point),
        distanceM: from.distance,
      });
    if (to.distance > 0)
      snaps.push({ endpoint: 'end', from: end, to: toWgs84(to.point), distanceM: to.distance });
    return {
      status: 'ok',
      waypoints: points.map(toWgs84),
      distanceM: polylineLength(points),
      cost: result.cost,
      events: routeEvents(points, this.grid.features, this.rules, this.grid.cellSizeM / 2),
      snaps,
      visited: result.visited,
      dataVersion,
    };
  }
}
