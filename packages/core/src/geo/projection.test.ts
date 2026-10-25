import { describe, expect, it } from 'vitest';
import { toLks94, toWgs84 } from './projection';
import { inPolygon, metricDistance, projectOnPolyline, signedGeometryDistance } from './planar';

describe('LKS94 projection', () => {
  it('uses the central meridian and documented easting/northing order', () => {
    const [easting, northing] = toLks94([24, 55]);
    expect(easting).toBeCloseTo(500_000, 6);
    expect(Math.abs(northing - 6_096_011)).toBeLessThan(0.5);
    const equator = toLks94([24, 0]);
    expect(equator[0]).toBeCloseTo(500_000, 6);
    expect(equator[1]).toBeCloseTo(0, 6);
  });
  it('round trips without swapping axes', () => {
    const p = [23.75, 55.1] as const;
    const result = toWgs84(toLks94(p));
    expect(result[0]).toBeCloseTo(p[0], 9);
    expect(result[1]).toBeCloseTo(p[1], 9);
    expect(metricDistance(toLks94(p), toLks94([p[0], p[1] + 0.00001]))).toBeCloseTo(1.113, 2);
  });
  it('rejects invalid or already projected WGS84 inputs', () => {
    expect(() => toLks94([500000, 6100000])).toThrow();
    expect(() => toLks94([NaN, 55])).toThrow();
    expect(() => toWgs84([Infinity, 0])).toThrow();
  });
});

describe('planar geometry', () => {
  const outer = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ] as const;
  const hole = [
    [4, 4],
    [6, 4],
    [6, 6],
    [4, 6],
    [4, 4],
  ] as const;
  it('respects polygon holes and their boundaries', () => {
    expect(inPolygon([2, 2], [outer, hole])).toBe(true);
    expect(inPolygon([5, 5], [outer, hole])).toBe(false);
    expect(inPolygon([4, 5], [outer, hole])).toBe(false);
    expect(
      signedGeometryDistance([5, 5], {
        type: 'Feature',
        id: 'a',
        properties: { category: 'water' },
        geometry: { type: 'Polygon', coordinates: [outer, hole] },
      }),
    ).toBe(1);
  });
  it('projects onto the nearest polyline segment with progress in metres', () => {
    const result = projectOnPolyline(
      [8, 4],
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    );
    expect(result.point).toEqual([10, 4]);
    expect(result.distanceM).toBe(14);
    expect(result.distanceToLineM).toBe(2);
    expect(() => projectOnPolyline([0, 0], [])).toThrow();
  });
});
