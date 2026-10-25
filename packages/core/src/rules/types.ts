import type { LonLat } from '../geo/sphere';

/** All persisted/transferred coordinates use GeoJSON [longitude, latitude]. */
export type Geometry =
  | { readonly type: 'Point'; readonly coordinates: LonLat }
  | { readonly type: 'LineString'; readonly coordinates: readonly LonLat[] }
  | { readonly type: 'Polygon'; readonly coordinates: readonly (readonly LonLat[])[] };

export interface FeatureProperties {
  readonly category: string;
  readonly name?: string;
  readonly spoken_name?: string;
  readonly enabled?: boolean;
  readonly width_m?: number | null;
  readonly radius_m?: number | null;
  readonly is_destination?: boolean;
  readonly owner_label?: string;
}

export interface MapFeature {
  readonly id: string;
  readonly type: 'Feature';
  readonly geometry: Geometry;
  readonly properties: FeatureProperties;
}

export interface CategoryRule {
  readonly category: string;
  readonly label: string;
  readonly passable: boolean;
  readonly cost: number;
  readonly buffer_m: number;
  readonly warn_m: number | null;
  readonly overrides: readonly string[];
  readonly priority: number;
  readonly color: string;
}
