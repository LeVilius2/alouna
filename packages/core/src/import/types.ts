import type { Geometry } from '../rules/types';

/** Raw coordinate pair as found in the source, before CRS detection/conversion. */
export type RawPosition = readonly [number, number];

export type RawGeometry =
  | { readonly type: 'Point'; readonly coordinates: RawPosition }
  | { readonly type: 'LineString'; readonly coordinates: readonly RawPosition[] }
  | { readonly type: 'Polygon'; readonly coordinates: readonly (readonly RawPosition[])[] };

export interface RawFeature {
  readonly geometry: RawGeometry;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface ImportedFeature {
  readonly geometry: Geometry;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface ParseResult {
  readonly features: RawFeature[];
  readonly warnings: string[];
}
