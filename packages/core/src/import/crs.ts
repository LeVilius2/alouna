import { toWgs84 } from '../geo/projection';
import type { LonLat } from '../geo/sphere';
import type { Geometry } from '../rules/types';
import type { ImportedFeature, RawFeature, RawGeometry, RawPosition } from './types';

/**
 * Coordinate reference systems accepted on import.
 * - `wgs84`: [longitude, latitude] (GeoJSON order)
 * - `wgs84-latlon`: [latitude, longitude] (common in spreadsheets / Google Maps copy-paste)
 * - `lks94`: EPSG:3346 [easting, northing]
 * - `lks94-ne`: EPSG:3346 [northing, easting] (the formal EPSG axis order)
 */
export type ImportCrs = 'wgs84' | 'wgs84-latlon' | 'lks94' | 'lks94-ne';
export const IMPORT_CRS: readonly ImportCrs[] = ['wgs84', 'wgs84-latlon', 'lks94', 'lks94-ne'];

// Generous bounds around Lithuania.
const LT = { lonMin: 20, lonMax: 27.5, latMin: 53, latMax: 57 };
const LKS = { eMin: 250_000, eMax: 750_000, nMin: 5_900_000, nMax: 6_300_000 };

function allPositions(g: RawGeometry): readonly RawPosition[] {
  return g.type === 'Point'
    ? [g.coordinates]
    : g.type === 'LineString'
      ? g.coordinates
      : g.coordinates.flat();
}

const inLt = ([lon, lat]: RawPosition) =>
  lon >= LT.lonMin && lon <= LT.lonMax && lat >= LT.latMin && lat <= LT.latMax;
const inLks = ([e, n]: RawPosition) =>
  e >= LKS.eMin && e <= LKS.eMax && n >= LKS.nMin && n <= LKS.nMax;
const swap = ([a, b]: RawPosition): RawPosition => [b, a];

/** Guess the CRS of a batch. Returns null when no candidate fits every coordinate. */
export function detectCrs(features: readonly RawFeature[]): ImportCrs | null {
  const pts = features.flatMap((f) => allPositions(f.geometry));
  if (!pts.length) return null;
  if (pts.every(inLt)) return 'wgs84';
  if (pts.every((p) => inLt(swap(p)))) return 'wgs84-latlon';
  if (pts.every(inLks)) return 'lks94';
  if (pts.every((p) => inLks(swap(p)))) return 'lks94-ne';
  // Outside Lithuania: accept plain WGS84 if every value is a valid lon/lat.
  if (pts.every(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) < 90)) return 'wgs84';
  return null;
}

function converter(crs: ImportCrs): (p: RawPosition) => LonLat {
  switch (crs) {
    case 'wgs84':
      return ([x, y]) => [x, y];
    case 'wgs84-latlon':
      return ([lat, lon]) => [lon, lat];
    case 'lks94':
      return ([e, n]) => toWgs84([e, n]);
    case 'lks94-ne':
      return ([n, e]) => toWgs84([e, n]);
  }
}

const round = (v: number) => Math.round(v * 1e8) / 1e8; // ~1 mm

export function convertGeometry(g: RawGeometry, crs: ImportCrs): Geometry {
  const c = converter(crs);
  const p = (pos: RawPosition): LonLat => {
    const [lon, lat] = c(pos);
    if (
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      Math.abs(lon) > 180 ||
      Math.abs(lat) >= 90
    )
      throw new RangeError('Coordinate outside the valid range for the chosen coordinate system.');
    return [round(lon), round(lat)];
  };
  switch (g.type) {
    case 'Point':
      return { type: 'Point', coordinates: p(g.coordinates) };
    case 'LineString':
      return { type: 'LineString', coordinates: g.coordinates.map(p) };
    case 'Polygon':
      return { type: 'Polygon', coordinates: g.coordinates.map((r) => r.map(p)) };
  }
}

export interface ConvertResult {
  readonly crs: ImportCrs | null;
  readonly features: ImportedFeature[];
  readonly warnings: string[];
}

/** Convert a parsed batch to WGS84. `crs: 'auto'` uses {@link detectCrs}. */
export function convertImport(
  features: readonly RawFeature[],
  crs: ImportCrs | 'auto',
): ConvertResult {
  const chosen = crs === 'auto' ? detectCrs(features) : crs;
  if (!chosen)
    return {
      crs: null,
      features: [],
      warnings: ['Could not detect the coordinate system. Choose it manually.'],
    };
  const warnings: string[] = [];
  const out: ImportedFeature[] = [];
  features.forEach((f, i) => {
    try {
      out.push({ geometry: convertGeometry(f.geometry, chosen), properties: f.properties });
    } catch (e) {
      warnings.push(`Item ${i + 1}: ${(e as Error).message}`);
    }
  });
  return { crs: chosen, features: out, warnings };
}
