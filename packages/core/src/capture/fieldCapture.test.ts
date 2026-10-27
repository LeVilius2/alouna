import { describe, expect, it } from 'vitest';
import {
  averageGpsFixes,
  buildWalkTrackGeometry,
  computeOffsetPosition,
  metricDistance,
  simplifyMetricPoints,
  toLks94,
} from '../index';
import { location } from '../routing/test-maps';

describe('averageGpsFixes (10-20s GPS averaging)', () => {
  it('discards fixes worse than 10 m accuracy and computes a weighted LKS94 average', () => {
    const res = averageGpsFixes([
      { position: location(10, 20), accuracyM: 3 },
      { position: location(12, 20), accuracyM: 3 },
      { position: location(100, 100), accuracyM: 18 }, // discarded (> 10 m)
      { position: location(200, 200), accuracyM: NaN }, // discarded
    ]);
    expect(res).not.toBeNull();
    expect(res!.acceptedCount).toBe(2);
    expect(res!.discardedCount).toBe(2);
    const lks = toLks94(res!.position);
    expect(lks[0]).toBeCloseTo(500011, 2);
    expect(lks[1]).toBeCloseTo(6100020, 2);
    expect(res!.accuracyM).toBeGreaterThanOrEqual(0.5);
    expect(res!.accuracyM).toBeLessThanOrEqual(3);
  });

  it('returns null when all fixes exceed the 10 m accuracy limit', () => {
    const res = averageGpsFixes([
      { position: location(10, 20), accuracyM: 14 },
      { position: location(11, 21), accuracyM: 25 },
    ]);
    expect(res).toBeNull();
  });
});

describe('computeOffsetPosition (compass + distance offset capture)', () => {
  it('places a point N metres ahead along the compass heading in LKS94', () => {
    const start = location(10, 10);
    const north2m = computeOffsetPosition(start, 0, 2);
    const east3m = computeOffsetPosition(start, 90, 3);

    const [sx, sy] = toLks94(start);
    const [nx, ny] = toLks94(north2m);
    const [ex, ey] = toLks94(east3m);

    expect(nx - sx).toBeCloseTo(0, 3);
    expect(ny - sy).toBeCloseTo(2, 3);
    expect(ex - sx).toBeCloseTo(3, 3);
    expect(ey - sy).toBeCloseTo(0, 3);
    expect(metricDistance([sx, sy], [ex, ey])).toBeCloseTo(3, 3);
  });
});

describe('simplifyMetricPoints and buildWalkTrackGeometry (walk recording)', () => {
  it('simplifies collinear and near-collinear points within 0.5 m tolerance while preserving corners', () => {
    const raw = [
      [500000, 6100000],
      [500002, 6100000.1],
      [500004, 6100000.2],
      [500006, 6100000.1],
      [500010, 6100000],
      [500010, 6100010],
    ] as const;
    const simplified = simplifyMetricPoints(raw, 0.5);
    expect(simplified).toEqual([
      [500000, 6100000],
      [500010, 6100000],
      [500010, 6100010],
    ]);
  });

  it('builds a simplified LineString from a walked ditch track and filters out inaccurate fixes', () => {
    const track = [
      { position: location(0, 0), accuracyM: 3 },
      { position: location(2, 0.1), accuracyM: 4 },
      { position: location(4, -0.1), accuracyM: 3 },
      { position: location(50, 50), accuracyM: 25 }, // ignored (> 15 m)
      { position: location(8, 0), accuracyM: 3 },
      { position: location(8, 6), accuracyM: 4 },
    ];
    const result = buildWalkTrackGeometry(track, 'line', { toleranceM: 0.5 });
    expect(result.geometry.type).toBe('LineString');
    expect(result.vertexCount).toBe(3);
    expect(result.lengthM).toBeCloseTo(14, 0);
    expect(result.accuracyM).toBeCloseTo(3.4, 1);
  });

  it('builds a closed, valid Polygon from a walked perimeter and rejects self-intersecting walks', () => {
    const perimeter = [
      { position: location(0, 0), accuracyM: 2 },
      { position: location(5, 0.1), accuracyM: 2 },
      { position: location(10, 0), accuracyM: 2 },
      { position: location(10, 10), accuracyM: 2 },
      { position: location(0, 10), accuracyM: 2 },
      { position: location(0.1, 0.1), accuracyM: 2 },
    ];
    const poly = buildWalkTrackGeometry(perimeter, 'polygon', { toleranceM: 0.5 });
    expect(poly.geometry.type).toBe('Polygon');
    if (poly.geometry.type === 'Polygon') {
      const ring = poly.geometry.coordinates[0]!;
      expect(ring.length).toBe(5); // 4 corners + closing vertex
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }

    // Bowtie self-intersecting polygon must be rejected
    const bowtie = [
      { position: location(0, 0), accuracyM: 2 },
      { position: location(10, 10), accuracyM: 2 },
      { position: location(10, 0), accuracyM: 2 },
      { position: location(0, 10), accuracyM: 2 },
    ];
    expect(() => buildWalkTrackGeometry(bowtie, 'polygon')).toThrow(/intersect/i);
  });
});
