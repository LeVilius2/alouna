/**
 * Basic spherical geo helpers on WGS84 coordinates.
 * Coordinates are `[lon, lat]` in degrees (GeoJSON order).
 * For metric planning work use the LKS94 projection (added in M1).
 */

export type LonLat = readonly [lon: number, lat: number];

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Great-circle distance in meters (haversine). */
export function distanceMeters(a: LonLat, b: LonLat): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, degrees clockwise from true north, in [0, 360). */
export function bearingDegrees(a: LonLat, b: LonLat): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return normalizeDegrees(toDeg(Math.atan2(y, x)));
}

/** Normalize any angle to [0, 360). */
export function normalizeDegrees(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

/**
 * Signed smallest difference `target - heading` in (-180, 180].
 * Positive = target is to the right (turn clockwise), negative = to the left.
 */
export function signedAngleDiff(heading: number, target: number): number {
  const d = normalizeDegrees(target - heading);
  return d > 180 ? d - 360 : d;
}
