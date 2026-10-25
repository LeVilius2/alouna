import { describe, expect, it } from 'vitest';
import { toLks94 } from '../geo/projection';
import { DEFAULT_RULES } from '../rules/defaults';
import { RoutingGrid } from './rasterize';
import { RoutingEngine, type RouteResult } from './router';
import { cellsAlongSegment, lineOfSight } from './smooth';
import { area, feature, location, metric, rectangle } from './test-maps';
import { createRoutingHandler } from './worker-protocol';

function success(result: RouteResult): asserts result is Extract<RouteResult, { status: 'ok' }> {
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error(result.status);
}
const options = { cellSizeM: 0.5, marginM: 2 };

function verifySegments(engine: RoutingEngine, result: RouteResult) {
  success(result);
  for (let i = 1; i < result.waypoints.length; i++) {
    expect(
      lineOfSight(
        engine.grid,
        toLks94(result.waypoints[i - 1]!),
        toLks94(result.waypoints[i]!),
        false,
      ),
    ).toBe(true);
  }
}

describe('rule-aware routes', () => {
  it('routes around a buffered obstacle and keeps smoothing out of it', () => {
    const engine = new RoutingEngine(
      [
        area(),
        feature(
          'rock',
          'obstacle',
          { type: 'Point', coordinates: metric(15, 15) },
          { radius_m: 3 },
        ),
      ],
      DEFAULT_RULES,
      options,
    );
    const result = engine.route(location(3, 15), location(27, 15));
    success(result);
    expect(result.distanceM).toBeGreaterThan(24);
    expect(result.waypoints.length).toBeGreaterThan(2);
    verifySegments(engine, result);
  });
  it('uses a distant crossing rather than crossing a road directly', () => {
    const engine = new RoutingEngine(
      [
        area(),
        feature('road', 'road', rectangle(13, -1, 17, 31)),
        feature('crossing', 'crossing', rectangle(10, 22, 20, 27)),
      ],
      DEFAULT_RULES,
      options,
    );
    const result = engine.route(location(5, 5), location(25, 5));
    success(result);
    expect(result.distanceM).toBeGreaterThan(40);
    expect(result.events.some((e) => e.kind === 'enter' && e.category === 'crossing')).toBe(true);
    expect(result.waypoints.some((p) => toLks94(p)[1] > metric(0, 22)[1])).toBe(true);
    verifySegments(engine, result);
  });
  it('uses a gate in a fence', () => {
    const engine = new RoutingEngine(
      [
        area(),
        feature(
          'fence',
          'fence',
          { type: 'LineString', coordinates: [metric(15, -1), metric(15, 31)] },
          { width_m: 0.2 },
        ),
        feature('gate', 'gate', { type: 'Point', coordinates: metric(15, 23) }, { radius_m: 2 }),
      ],
      DEFAULT_RULES,
      options,
    );
    const result = engine.route(location(5, 5), location(25, 5));
    success(result);
    expect(result.events.some((e) => e.kind === 'enter' && e.category === 'gate')).toBe(true);
    verifySegments(engine, result);
  });
  it('returns no route when the destination is enclosed', () => {
    const engine = new RoutingEngine(
      [
        area(),
        feature(
          'wall',
          'fence',
          {
            type: 'LineString',
            coordinates: [
              metric(12, 12),
              metric(18, 12),
              metric(18, 18),
              metric(12, 18),
              metric(12, 12),
            ],
          },
          { width_m: 0.2 },
        ),
      ],
      DEFAULT_RULES,
      options,
    );
    expect(engine.route(location(3, 3), location(15, 15)).status).toBe('no-route');
  });
  it('prefers a path over a shorter grass route and preserves it during smoothing', () => {
    const engine = new RoutingEngine(
      [
        area(40, 25),
        feature(
          'path',
          'path',
          {
            type: 'LineString',
            coordinates: [metric(4, 5), metric(4, 11), metric(36, 11), metric(36, 5)],
          },
          { width_m: 2 },
        ),
      ],
      DEFAULT_RULES,
      options,
    );
    const result = engine.route(location(4, 5), location(36, 5));
    success(result);
    expect(result.waypoints.some((p) => toLks94(p)[1] > metric(0, 9)[1])).toBe(true);
    expect(result.distanceM).toBeLessThan(48);
    verifySegments(engine, result);
  });
  it('never lets a crossing override water or extend outside walkable areas', () => {
    const grid = new RoutingGrid(
      [
        area(),
        feature('road', 'road', rectangle(12, -1, 18, 31)),
        feature('water', 'water', rectangle(12, 10, 18, 20)),
        feature('crossing', 'crossing', rectangle(8, 8, 22, 22)),
      ],
      DEFAULT_RULES,
      options,
    );
    expect(grid.inspect(grid.cellAt(metric(15, 15))).blockedBy).toContain('water');
    expect(grid.inspect(grid.cellAt(metric(-1, 15))).passable).toBe(false);
  });
  it('lets a dock override water but preserves an overlapping ditch', () => {
    const grid = new RoutingGrid(
      [
        area(),
        feature('water', 'water', rectangle(10, 0, 20, 30)),
        feature('ditch', 'ditch', rectangle(13, 10, 17, 20)),
        feature('dock', 'dock', rectangle(8, 8, 22, 22)),
      ],
      DEFAULT_RULES,
      options,
    );
    expect(grid.inspect(grid.cellAt(metric(10, 12))).passable).toBe(true);
    expect(grid.inspect(grid.cellAt(metric(15, 15))).blockedBy).toContain('ditch');
  });
  it('keeps all overlapping hard obstacles regardless of paint priority', () => {
    const grid = new RoutingGrid(
      [
        area(),
        feature('water', 'water', rectangle(10, 10, 20, 20)),
        feature('path', 'path', rectangle(0, 14, 30, 16)),
      ],
      DEFAULT_RULES.map((r) => ({ ...r, priority: r.category === 'path' ? 999 : r.priority })),
      options,
    );
    expect(grid.inspect(grid.cellAt(metric(15, 15))).blockedBy).toEqual(['water']);
  });
  it('never routes through a disabled neighbour plot', () => {
    const engine = new RoutingEngine(
      [
        area(10, 10),
        feature('neighbour', 'walkable_area', rectangle(10, 0, 20, 10), { enabled: false }),
      ],
      DEFAULT_RULES,
      options,
    );
    expect(engine.route(location(5, 5), location(17, 5)).status).toBe('blocked-end');
  });
  it('cannot cross a sub-cell obstacle or a hole in a walkable polygon', () => {
    const shape = rectangle(0, 0, 30, 30);
    if (shape.type !== 'Polygon') throw new Error('fixture');
    const hole = rectangle(10, 10, 20, 20);
    if (hole.type !== 'Polygon') throw new Error('fixture');
    const engine = new RoutingEngine(
      [
        feature('area', 'walkable_area', {
          type: 'Polygon',
          coordinates: [...shape.coordinates, ...hole.coordinates],
        }),
      ],
      DEFAULT_RULES,
      options,
    );
    const result = engine.route(location(5, 15), location(25, 15));
    success(result);
    expect(result.distanceM).toBeGreaterThan(24);
    verifySegments(engine, result);
    const thin = new RoutingEngine(
      [
        area(),
        feature(
          'thin',
          'fence',
          { type: 'LineString', coordinates: [metric(15.11, -1), metric(15.11, 31)] },
          { width_m: 0 },
        ),
      ],
      DEFAULT_RULES.map((r) => (r.category === 'fence' ? { ...r, buffer_m: 0 } : r)),
      options,
    );
    expect(thin.route(location(5, 5), location(25, 5)).status).toBe('no-route');
  });
});

describe('failure and endpoint handling', () => {
  it('rejects self-intersections, exterior holes and intersecting rings', () => {
    const bow = feature('bow', 'walkable_area', {
      type: 'Polygon',
      coordinates: [[metric(0, 0), metric(20, 0), metric(0, 15), metric(20, 20), metric(0, 0)]],
    });
    expect(() => new RoutingEngine([bow])).toThrow();
    const outer = rectangle(0, 0, 20, 20),
      outside = rectangle(25, 25, 28, 28),
      touching = rectangle(0, 5, 5, 10);
    if (outer.type !== 'Polygon' || outside.type !== 'Polygon' || touching.type !== 'Polygon')
      throw new Error('fixture');
    for (const hole of [outside, touching]) {
      expect(
        () =>
          new RoutingEngine([
            feature('bad', 'walkable_area', {
              type: 'Polygon',
              coordinates: [...outer.coordinates, ...hole.coordinates],
            }),
          ]),
      ).toThrow();
    }
  });
  it('bounds snapping, returns notices and rejects distant blocked endpoints', () => {
    const engine = new RoutingEngine([area()], DEFAULT_RULES, options);
    const result = engine.route(location(-0.2, 5), location(15, 15));
    success(result);
    expect(result.snaps).toHaveLength(1);
    expect(result.snaps[0]!.endpoint).toBe('start');
    expect(result.snaps[0]!.distanceM).toBeLessThanOrEqual(2);
    expect(engine.route(location(-5, 5), location(15, 15)).status).toBe('blocked-start');
    expect(engine.route(location(-0.2, 5), location(15, 15), { maxSnapM: 0 }).status).toBe(
      'blocked-start',
    );
    expect(() => engine.route(location(1, 1), location(2, 2), { maxSnapM: Infinity })).toThrow();
  });
  it('returns a bounded-search failure instead of a partial route', () => {
    const engine = new RoutingEngine([area()], DEFAULT_RULES, options);
    expect(engine.route(location(2, 2), location(28, 28), { maxVisited: 1 }).status).toBe(
      'search-limit',
    );
  });
  it('handles the same start and destination', () => {
    const engine = new RoutingEngine([area()], DEFAULT_RULES, options);
    const result = engine.route(location(5.25, 5.25), location(5.25, 5.25));
    success(result);
    expect(result.distanceM).toBeLessThan(0.01);
  });
  it('fails closed for missing areas, unknown categories, malformed geometry and invalid rules', () => {
    expect(() => new RoutingEngine([])).toThrow();
    expect(
      () => new RoutingEngine([area(), feature('unknown', 'unknown', rectangle(2, 2, 3, 3))]),
    ).toThrow();
    expect(
      () =>
        new RoutingEngine(
          [area()],
          DEFAULT_RULES.map((r) => ({ ...r, cost: 0 })),
        ),
    ).toThrow();
    expect(() => new RoutingEngine([area()], DEFAULT_RULES, { cellSizeM: 0 })).toThrow();
    const invalid = feature('bad', 'water', {
      type: 'Polygon',
      coordinates: [[metric(1, 1), metric(2, 1), metric(2, 2), metric(1, 2)]],
    });
    expect(() => new RoutingEngine([area(), invalid])).toThrow();
  });
});

describe('tiled grid and cache', () => {
  it('joins adjoining enabled plots and routes across tile boundaries', () => {
    const engine = new RoutingEngine(
      [area(70.2, 20), feature('neighbour', 'walkable_area', rectangle(70.2, 0, 140, 20))],
      DEFAULT_RULES,
      options,
    );
    const result = engine.route(location(5, 10), location(135, 10));
    success(result);
    verifySegments(engine, result);
    expect(engine.grid.cachedTileCount).toBeGreaterThan(1);
    expect(result.distanceM).toBeCloseTo(130, 0);
  });
  it('rasterizes lazily, grows across tiles and coarsens large extents', () => {
    const grid = new RoutingGrid([area(200, 200)], DEFAULT_RULES, options);
    expect(grid.cachedTileCount).toBe(0);
    grid.costAt(grid.cellAt(metric(5, 5)));
    expect(grid.cachedTileCount).toBe(1);
    grid.costAt(grid.cellAt(metric(130, 5)));
    expect(grid.cachedTileCount).toBe(2);
    const large = new RoutingGrid([area(1500, 1000)], DEFAULT_RULES);
    expect(large.cellSizeM).toBe(1);
    expect(large.cachedTileCount).toBe(0);
  });
  it('reuses tiles only for an exact map/rule/config snapshot', () => {
    const source = new RoutingGrid([area()], DEFAULT_RULES, options);
    const cell = source.cellAt(metric(5, 5)),
      cost = source.costAt(cell),
      cache = source.exportTiles();
    const restored = new RoutingGrid([area()], [...DEFAULT_RULES].reverse(), options);
    expect(restored.restoreTiles(cache)).toBe(true);
    expect(restored.costAt(cell)).toBe(cost);
    const changed = new RoutingGrid([area(31, 30)], DEFAULT_RULES, options);
    expect(changed.restoreTiles(cache)).toBe(false);
    expect(
      new RoutingGrid([area()], DEFAULT_RULES, { ...options, clearanceWeight: 0 }).restoreTiles(
        cache,
      ),
    ).toBe(false);
    cache.tiles[0]!.costs[0] = NaN;
    expect(new RoutingGrid([area()], DEFAULT_RULES, options).restoreTiles(cache)).toBe(false);
  });
  it('adds clearance cost near blocked cells', () => {
    const grid = new RoutingGrid([area()], DEFAULT_RULES, options);
    expect(grid.costAt(grid.cellAt(metric(1, 5)))).toBeGreaterThan(
      grid.costAt(grid.cellAt(metric(10, 10))),
    );
  });
  it('includes both side cells when a segment crosses a corner', () => {
    const grid = new RoutingGrid([area()], DEFAULT_RULES, options),
      start = grid.cellAt(metric(5, 5));
    const cells = cellsAlongSegment(
      grid,
      grid.center(start),
      grid.center({ x: start.x + 1, y: start.y + 1 }),
    );
    expect(cells).toContainEqual({ x: start.x + 1, y: start.y });
    expect(cells).toContainEqual({ x: start.x, y: start.y + 1 });
  });
});

describe('worker protocol', () => {
  it('returns serializable results, keeps request IDs and reports bad data', () => {
    const handle = createRoutingHandler(),
      request = {
        id: 'one',
        features: [area()],
        start: location(3, 3),
        end: location(20, 20),
        gridOptions: options,
      };
    const response = handle(request);
    expect(response.id).toBe('one');
    expect('result' in response && response.result.status).toBe('ok');
    expect(structuredClone(response)).toEqual(response);
    expect(handle({ ...request, id: 'two', features: [] })).toEqual({
      id: 'two',
      error: 'invalid-input',
    });
    expect('result' in handle({ ...request, id: 'three' })).toBe(true);
  });
});
