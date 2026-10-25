import { EPSILON } from '../geo/planar';
import type { MetricPoint } from '../geo/projection';
import type { GridCell, RoutingGrid } from './rasterize';

/** Supercover: include both side cells at corner crossings, never just sample points. */
export function cellsAlongSegment(
  grid: RoutingGrid,
  from: MetricPoint,
  to: MetricPoint,
): GridCell[] {
  const a = [
    (from[0] - grid.origin[0]) / grid.cellSizeM,
    (from[1] - grid.origin[1]) / grid.cellSizeM,
  ];
  const b = [(to[0] - grid.origin[0]) / grid.cellSizeM, (to[1] - grid.origin[1]) / grid.cellSizeM];
  let x = Math.floor(a[0]!),
    y = Math.floor(a[1]!);
  const endX = Math.floor(b[0]!),
    endY = Math.floor(b[1]!);
  const dx = b[0]! - a[0]!,
    dy = b[1]! - a[1]!,
    sx = Math.sign(dx),
    sy = Math.sign(dy);
  const deltaX = dx === 0 ? Infinity : 1 / Math.abs(dx),
    deltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let tX = dx === 0 ? Infinity : ((sx > 0 ? x + 1 : x) - a[0]!) / dx;
  let tY = dy === 0 ? Infinity : ((sy > 0 ? y + 1 : y) - a[1]!) / dy;
  const cells = new Map<string, GridCell>();
  const add = (cx: number, cy: number) => {
    cells.set(`${cx},${cy}`, { x: cx, y: cy });
  };
  const limit = Math.abs(endX - x) + Math.abs(endY - y) + 3;
  for (let step = 0; step < limit; step++) {
    add(x, y);
    if (x === endX && y === endY) break;
    if (Math.abs(tX - tY) < EPSILON) {
      add(x + sx, y);
      add(x, y + sy);
      x += sx;
      y += sy;
      tX += deltaX;
      tY += deltaY;
    } else if (tX < tY) {
      x += sx;
      tX += deltaX;
    } else {
      y += sy;
      tY += deltaY;
    }
  }
  // A segment lying on a grid boundary touches both sides.
  if (dx === 0 && Math.abs(a[0]! - Math.round(a[0]!)) < EPSILON)
    for (const c of [...cells.values()]) add(c.x - 1, c.y);
  if (dy === 0 && Math.abs(a[1]! - Math.round(a[1]!)) < EPSILON)
    for (const c of [...cells.values()]) add(c.x, c.y - 1);
  return [...cells.values()];
}

export function lineOfSight(
  grid: RoutingGrid,
  from: MetricPoint,
  to: MetricPoint,
  preserveCost = true,
): boolean {
  const costLimit = preserveCost
    ? Math.max(grid.costAt(grid.cellAt(from), true), grid.costAt(grid.cellAt(to), true))
    : Infinity;
  return cellsAlongSegment(grid, from, to).every((c) => {
    const cost = grid.costAt(c, true);
    return Number.isFinite(cost) && cost <= costLimit + EPSILON;
  });
}

export function smoothPath(grid: RoutingGrid, points: readonly MetricPoint[]): MetricPoint[] {
  if (points.length < 3) return [...points];
  const result = [points[0]!];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    for (let candidate = anchor + 2; candidate < points.length; candidate++) {
      if (!lineOfSight(grid, points[anchor]!, points[candidate]!)) break;
      next = candidate;
    }
    result.push(points[next]!);
    anchor = next;
  }
  return result;
}
