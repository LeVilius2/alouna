import { MinHeap } from './heap';
import type { GridCell, RoutingGrid } from './rasterize';

export type SearchResult =
  | { status: 'ok'; cells: GridCell[]; cost: number; visited: number }
  | { status: 'no-route' | 'search-limit'; visited: number };

export function findPath(
  grid: RoutingGrid,
  start: GridCell,
  end: GridCell,
  maxVisited = 1_000_000,
): SearchResult {
  if (!Number.isInteger(maxVisited) || maxVisited < 1)
    throw new RangeError('Invalid search limit.');
  if (!Number.isFinite(grid.costAt(start)) || !Number.isFinite(grid.costAt(end)))
    return { status: 'no-route', visited: 0 };
  const id = (p: GridCell) => p.y * grid.width + p.x;
  const cell = (key: number): GridCell => ({
    x: key % grid.width,
    y: Math.floor(key / grid.width),
  });
  const heuristic = (p: GridCell): number => {
    const dx = Math.abs(p.x - end.x),
      dy = Math.abs(p.y - end.y);
    return (
      (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * grid.cellSizeM * grid.minimumCost
    );
  };
  const open = new MinHeap<{ key: number; g: number }>(),
    scores = new Map<number, number>(),
    parents = new Map<number, number>();
  const closed = new Set<number>(),
    target = id(end);
  scores.set(id(start), 0);
  open.push({ key: id(start), g: 0 }, heuristic(start));
  while (open.size) {
    const current = open.pop()!;
    if (closed.has(current.key) || current.g !== scores.get(current.key)) continue;
    if (closed.size >= maxVisited) return { status: 'search-limit', visited: closed.size };
    closed.add(current.key);
    const p = cell(current.key);
    if (current.key === target) {
      const cells = [p];
      let key = current.key;
      while (parents.has(key)) {
        key = parents.get(key)!;
        cells.push(cell(key));
      }
      return { status: 'ok', cells: cells.reverse(), cost: current.g, visited: closed.size };
    }
    const fromCost = grid.costAt(p);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const next = { x: p.x + dx, y: p.y + dy },
          toCost = grid.costAt(next);
        if (!Number.isFinite(toCost)) continue;
        // Never squeeze diagonally between blocked cells.
        if (
          dx &&
          dy &&
          (!Number.isFinite(grid.costAt({ x: p.x + dx, y: p.y })) ||
            !Number.isFinite(grid.costAt({ x: p.x, y: p.y + dy })))
        )
          continue;
        const key = id(next);
        if (closed.has(key)) continue;
        const g =
          current.g + (grid.cellSizeM * (dx && dy ? Math.SQRT2 : 1) * (fromCost + toCost)) / 2;
        if (g >= (scores.get(key) ?? Infinity)) continue;
        scores.set(key, g);
        parents.set(key, current.key);
        open.push({ key, g }, g + heuristic(next));
      }
  }
  return { status: 'no-route', visited: closed.size };
}
