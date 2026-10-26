import { describe, expect, it } from 'vitest';
import { metricDistance } from '../geo/planar';
import { toLks94 } from '../geo/projection';
import { location } from '../routing/test-maps';
import { moveWalker, sampleWalk } from './walk';

describe('metric walk simulation', () => {
  const points = [location(0, 0), location(0, 10), location(10, 10)];
  it('advances across segments, clamps endpoints and follows heading through a turn', () => {
    expect(sampleWalk(points, -2).position[0]).toBeCloseTo(points[0]![0], 8);
    const corner = sampleWalk(points, 15);
    expect(metricDistance(toLks94(corner.position), toLks94(location(5, 10)))).toBeLessThan(0.001);
    expect(corner.headingDegrees).toBeCloseTo(90);
    expect(corner.totalM).toBeCloseTo(20);
    expect(sampleWalk(points, 200).distanceM).toBeCloseTo(20);
    expect(sampleWalk([points[0]!, points[0]!], 5).totalM).toBe(0);
    expect(sampleWalk([points[0]!], 5).position).toEqual(points[0]);
  });
  it('moves a manual walker forwards and backwards in metres', () => {
    expect(
      metricDistance(toLks94(moveWalker(points[0]!, 90, 3)), toLks94(location(3, 0))),
    ).toBeLessThan(0.001);
    expect(
      metricDistance(toLks94(moveWalker(points[0]!, 0, -2)), toLks94(location(0, -2))),
    ).toBeLessThan(0.001);
    expect(() => sampleWalk([], 0)).toThrow();
    expect(() => sampleWalk(points, NaN)).toThrow();
    expect(() => moveWalker(points[0]!, Infinity, 1)).toThrow();
  });
});
