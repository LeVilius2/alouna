import type { Bounds } from '../geo/planar';
import { toLks94, toWgs84 } from '../geo/projection';
import type { LonLat } from '../geo/sphere';
import type { CellInspection, GridCell, RoutingGrid } from './rasterize';

export interface EndpointInspection extends CellInspection {
  position: LonLat;
  ring: LonLat[];
}

export type DebugGrid = {
  origin: readonly [number, number];
  cellSizeM: number;
  columns: number;
  rows: number;
} & (
  | { status: 'ok'; costs: number[]; baseCosts: number[] }
  | { status: 'too-large'; cellCount: number }
);

export function inspectEndpoint(grid: RoutingGrid, position: LonLat): EndpointInspection {
  const cell = grid.cellAt(toLks94(position));
  return { position, ...grid.inspect(cell), ring: cellRing(grid, cell) };
}

function cellRing(grid: RoutingGrid, cell: GridCell): LonLat[] {
  const center = grid.center(cell),
    h = grid.cellSizeM / 2;
  return [
    toWgs84([center[0] - h, center[1] - h]),
    toWgs84([center[0] + h, center[1] - h]),
    toWgs84([center[0] + h, center[1] + h]),
    toWgs84([center[0] - h, center[1] + h]),
    toWgs84([center[0] - h, center[1] - h]),
  ];
}

/** Exact cells, including buffers and clearance costs. Never subsample away a thin blocker. */
export function debugGrid(grid: RoutingGrid, bounds: Bounds, maxCells = 12_000): DebugGrid {
  if (
    bounds.length !== 4 ||
    !bounds.every(Number.isFinite) ||
    bounds[0] > bounds[2] ||
    bounds[1] > bounds[3]
  )
    throw new RangeError('Invalid debug bounds.');
  if (!Number.isInteger(maxCells) || maxCells < 1 || maxCells > 20_000)
    throw new RangeError('Invalid debug cell limit.');
  const min = grid.cellAt([bounds[0], bounds[1]]),
    max = grid.cellAt([bounds[2], bounds[3]]);
  const x0 = Math.max(0, Math.min(grid.width, min.x)),
    y0 = Math.max(0, Math.min(grid.height, min.y));
  const x1 = Math.max(0, Math.min(grid.width, max.x + 1)),
    y1 = Math.max(0, Math.min(grid.height, max.y + 1));
  const columns = Math.max(0, x1 - x0);
  const rows = Math.max(0, y1 - y0);
  const origin = [
    grid.origin[0] + x0 * grid.cellSizeM,
    grid.origin[1] + y0 * grid.cellSizeM,
  ] as const;
  const common = { origin, cellSizeM: grid.cellSizeM, columns, rows };
  if (columns * rows > maxCells)
    return { ...common, status: 'too-large', cellCount: columns * rows };
  const costs: number[] = [],
    baseCosts: number[] = [];
  for (let y = y0; y < y0 + rows; y++)
    for (let x = x0; x < x0 + columns; x++) {
      costs.push(grid.costAt({ x, y }));
      baseCosts.push(grid.costAt({ x, y }, true));
    }
  return { ...common, status: 'ok', costs, baseCosts };
}
