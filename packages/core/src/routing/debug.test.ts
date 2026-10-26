import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../rules/defaults';
import { debugGrid, inspectEndpoint } from './debug';
import { RoutingEngine } from './router';
import { area, feature, location, metric, rectangle } from './test-maps';

describe('route debugging uses the routing grid', () => {
  const engine = () =>
    new RoutingEngine(
      [
        area(),
        feature('road', 'road', rectangle(12, 0, 15, 30)),
        feature('crossing', 'crossing', rectangle(9, 20, 18, 25)),
      ],
      DEFAULT_RULES,
      { cellSizeM: 1 },
    );

  it('shows buffers, the crossing override and the same clearance costs used by A*', () => {
    const { grid } = engine();
    const [x, y] = metric(10, 10);
    const debug = debugGrid(grid, [x, y, x + 7, y + 15]);
    expect(debug.status).toBe('ok');
    if (debug.status !== 'ok') return;
    const road = inspectEndpoint(grid, location(11.5, 10.5));
    expect(road.blockedBy).toEqual(['road']);
    expect(road.featureIds).toContain('road');
    expect(road.ring).toHaveLength(5);
    expect(inspectEndpoint(grid, location(13, 22)).passable).toBe(true);
    for (let row = 0; row < debug.rows; row++)
      for (let col = 0; col < debug.columns; col++) {
        const cell = grid.cellAt([
          debug.origin[0] + (col + 0.5) * debug.cellSizeM,
          debug.origin[1] + (row + 0.5) * debug.cellSizeM,
        ]);
        expect(debug.costs[row * debug.columns + col]).toBe(grid.costAt(cell));
        expect(debug.baseCosts[row * debug.columns + col]).toBe(grid.costAt(cell, true));
      }
  });

  it('caps work before rasterizing large views, clips empty views and rejects invalid bounds', () => {
    const { grid } = engine(),
      [x, y] = metric(0, 0);
    expect(debugGrid(grid, [x - 100, y - 100, x + 100, y + 100], 10).status).toBe('too-large');
    expect(grid.cachedTileCount).toBe(0);
    const empty = debugGrid(grid, [x - 100, y - 100, x - 90, y - 90]);
    expect(empty.status === 'ok' && empty.costs).toEqual([]);
    expect(() => debugGrid(grid, [NaN, y, x, y])).toThrow();
    expect(() => debugGrid(grid, [x, y, x + 1, y + 1], 100_000)).toThrow();
    expect(inspectEndpoint(grid, location(-30, -30)).blockedBy).toEqual(['outside_walkable_area']);
  });
});
