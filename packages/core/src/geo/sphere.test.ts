import { describe, expect, it } from 'vitest';
import { bearingDegrees, distanceMeters, normalizeDegrees, signedAngleDiff } from './sphere';

// Near the property (Lithuania).
const origin = [25.695, 55.636] as const;

describe('distanceMeters', () => {
  it('is zero for identical points', () => {
    expect(distanceMeters(origin, origin)).toBe(0);
  });

  it('measures ~111 m per 0.001° latitude', () => {
    const north = [25.695, 55.637] as const;
    expect(distanceMeters(origin, north)).toBeCloseTo(111.2, 0);
  });
});

describe('bearingDegrees', () => {
  it('returns cardinal directions', () => {
    expect(bearingDegrees(origin, [25.695, 55.637])).toBeCloseTo(0, 3);
    expect(bearingDegrees(origin, [25.696, 55.636])).toBeCloseTo(90, 1);
    expect(bearingDegrees(origin, [25.695, 55.635])).toBeCloseTo(180, 3);
    expect(bearingDegrees(origin, [25.694, 55.636])).toBeCloseTo(270, 1);
  });
});

describe('angle helpers', () => {
  it('normalizes into [0, 360)', () => {
    expect(normalizeDegrees(-10)).toBe(350);
    expect(normalizeDegrees(720)).toBe(0);
  });

  it('signedAngleDiff gives turn direction', () => {
    expect(signedAngleDiff(350, 10)).toBe(20); // turn right
    expect(signedAngleDiff(10, 350)).toBe(-20); // turn left
    expect(signedAngleDiff(0, 180)).toBe(180);
  });
});
