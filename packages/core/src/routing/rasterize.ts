import { union } from '@turf/union';
import {
  boundsOf,
  boundsOverlap,
  EPSILON,
  expandBounds,
  geometryPoints,
  physicalRadius,
  signedGeometryDistance,
  type Bounds,
} from '../geo/planar';
import { projectFeature, type MetricPoint } from '../geo/projection';
import type { CategoryRule, MapFeature } from '../rules/types';
import { mapSnapshot, snapshotVersion, validateMap, validateProjectedPolygons } from './validation';

export interface GridOptions {
  cellSizeM?: number;
  marginM?: number;
  clearanceRadiusM?: number;
  clearanceWeight?: number;
}
export interface GridCell {
  x: number;
  y: number;
}
export interface CellInspection {
  passable: boolean;
  cost: number;
  blockedBy: string[];
  featureIds: string[];
  categories: string[];
}
interface PreparedFeature {
  feature: MapFeature;
  rule: CategoryRule;
  bounds: Bounds;
}
interface Tile {
  base: Float32Array;
  costs: Float32Array;
}
export interface TileSnapshot {
  snapshot: string;
  tiles: { x: number; y: number; base: Float32Array; costs: Float32Array }[];
}

/** Lazy, immutable metric grid. No browser/storage dependency; M2 owns persistence. */
export class RoutingGrid {
  readonly cellSizeM: number;
  readonly width: number;
  readonly height: number;
  readonly origin: MetricPoint;
  readonly tileSizeM = 64;
  readonly tileCells: number;
  readonly snapshot: string;
  readonly version: string;
  readonly minimumCost: number;
  readonly features: readonly MapFeature[];
  private readonly prepared: readonly PreparedFeature[];
  private readonly tiles = new Map<string, Tile>();
  private readonly halfDiagonal: number;
  private readonly clearanceRadiusM: number;
  private readonly clearanceWeight: number;
  private readonly defaultCost: number;

  constructor(
    features: readonly MapFeature[],
    rules: readonly CategoryRule[],
    options: GridOptions = {},
  ) {
    validateMap(features, rules);
    // Own the snapshot so later mutations by an editor cannot corrupt cached tiles.
    this.features = features
      .filter((f) => f.properties.enabled !== false)
      .map((f) => projectFeature(structuredClone(f)));
    validateProjectedPolygons(this.features);
    const ownedRules = structuredClone(rules);
    const areas = this.features.filter((f) => f.properties.category === 'walkable_area');
    if (!areas.length) throw new RangeError('No enabled walkable areas.');
    const bounds = boundsOf(areas.flatMap((f) => geometryPoints(f.geometry)));
    const areaM2 = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]);
    const requestedSize = options.cellSizeM ?? 0.5;
    this.cellSizeM = areaM2 > 1_000_000 ? Math.max(1, requestedSize) : requestedSize;
    const margin = options.marginM ?? 20;
    this.clearanceRadiusM = options.clearanceRadiusM ?? 2;
    this.clearanceWeight = options.clearanceWeight ?? 0.15;
    if (
      ![this.cellSizeM, margin, this.clearanceRadiusM, this.clearanceWeight].every(
        Number.isFinite,
      ) ||
      requestedSize < 0.125 ||
      this.cellSizeM < 0.125 ||
      this.cellSizeM > 8 ||
      margin < 0 ||
      this.clearanceRadiusM < 0 ||
      this.clearanceRadiusM > 10 ||
      this.clearanceWeight < 0 ||
      !Number.isInteger(64 / this.cellSizeM)
    ) {
      throw new RangeError('Invalid grid options (cell size must divide 64 metres).');
    }
    this.tileCells = 64 / this.cellSizeM;
    this.halfDiagonal = this.cellSizeM / Math.SQRT2;
    this.origin = [
      Math.floor((bounds[0] - margin) / this.cellSizeM) * this.cellSizeM,
      Math.floor((bounds[1] - margin) / this.cellSizeM) * this.cellSizeM,
    ];
    this.width = Math.ceil((bounds[2] + margin - this.origin[0]) / this.cellSizeM);
    this.height = Math.ceil((bounds[3] + margin - this.origin[1]) / this.cellSizeM);
    if (!Number.isSafeInteger(this.width * this.height) || this.width <= 0 || this.height <= 0)
      throw new RangeError('Invalid routing extent.');
    this.defaultCost = ownedRules.find((r) => r.category === 'grass')?.cost ?? 1;
    this.minimumCost = Math.min(
      this.defaultCost,
      ...ownedRules.filter((r) => r.passable).map((r) => Math.fround(r.cost)),
    );
    const ruleMap = new Map(ownedRules.map((r) => [r.category, r]));
    // Merge enabled areas before testing full-cell containment. Otherwise a shared
    // boundary between adjoining plots could become an artificial blocked strip.
    const merged =
      areas.length > 1
        ? union({
            type: 'FeatureCollection',
            features: areas.map((f) => {
              if (f.geometry.type !== 'Polygon') throw new RangeError('Expected polygon.');
              return {
                type: 'Feature' as const,
                properties: {},
                geometry: {
                  type: 'Polygon' as const,
                  coordinates: f.geometry.coordinates.map((ring) => ring.map((p) => [p[0], p[1]])),
                },
              };
            }),
          })
        : null;
    const mergedCoordinates = merged
      ? merged.geometry.type === 'Polygon'
        ? [merged.geometry.coordinates]
        : merged.geometry.coordinates
      : areas.map((f) => {
          if (f.geometry.type !== 'Polygon') throw new RangeError('Expected polygon.');
          return f.geometry.coordinates;
        });
    const mergedAreas: MapFeature[] = mergedCoordinates.map((rings) => ({
      ...areas[0]!,
      geometry: {
        type: 'Polygon',
        coordinates: rings.map((r) => r.map((p) => [p[0]!, p[1]!] as MetricPoint)),
      },
    }));
    this.prepared = [
      ...this.features.filter((f) => f.properties.category !== 'walkable_area'),
      ...mergedAreas,
    ]
      .map((feature) => {
        const rule = ruleMap.get(feature.properties.category)!;
        return {
          feature,
          rule,
          bounds: expandBounds(
            boundsOf(geometryPoints(feature.geometry)),
            physicalRadius(feature) + rule.buffer_m + this.halfDiagonal,
          ),
        };
      })
      .sort(
        (a, b) => a.rule.priority - b.rule.priority || a.feature.id.localeCompare(b.feature.id),
      );
    this.snapshot =
      'routing-v1:' +
      mapSnapshot(features, ownedRules, {
        cellSizeM: this.cellSizeM,
        margin,
        clearanceRadiusM: this.clearanceRadiusM,
        clearanceWeight: this.clearanceWeight,
      });
    this.version = snapshotVersion(this.snapshot);
  }

  get cachedTileCount(): number {
    return this.tiles.size;
  }

  contains({ x, y }: GridCell): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      y < this.height
    );
  }

  cellAt(point: MetricPoint): GridCell {
    return {
      x: Math.floor((point[0] - this.origin[0]) / this.cellSizeM),
      y: Math.floor((point[1] - this.origin[1]) / this.cellSizeM),
    };
  }

  center({ x, y }: GridCell): MetricPoint {
    return [
      this.origin[0] + (x + 0.5) * this.cellSizeM,
      this.origin[1] + (y + 0.5) * this.cellSizeM,
    ];
  }

  private paint(cell: GridCell, prepared = this.prepared): CellInspection {
    const p = this.center(cell);
    // Require the complete cell to be inside at least one allowed polygon.
    const allowed = prepared.some(
      ({ feature }) =>
        feature.properties.category === 'walkable_area' &&
        signedGeometryDistance(p, feature) <= -this.halfDiagonal + EPSILON,
    );
    if (!this.contains(cell) || !allowed)
      return {
        passable: false,
        cost: Infinity,
        blockedBy: ['outside_walkable_area'],
        featureIds: [],
        categories: [],
      };
    const blockers = new Set<string>(),
      featureIds: string[] = [],
      categories = new Set<string>();
    const overrides: PreparedFeature[] = [];
    let cost = this.defaultCost;
    for (const item of prepared) {
      const { feature, rule } = item;
      if (rule.category === 'walkable_area' || rule.category === 'landmark') continue;
      const distance = signedGeometryDistance(p, feature);
      const threshold = rule.passable
        ? rule.overrides.length
          ? -this.halfDiagonal
          : 0
        : rule.buffer_m + this.halfDiagonal;
      if (distance > threshold + EPSILON) continue;
      featureIds.push(feature.id);
      categories.add(rule.category);
      if (!rule.passable) blockers.add(rule.category);
      else if (rule.overrides.length) overrides.push(item);
      else cost = rule.cost;
    }
    // Only remove explicitly named blockers; never reopen outside allowed areas.
    for (const { rule } of overrides) {
      for (const category of rule.overrides) blockers.delete(category);
      cost = rule.cost;
    }
    return {
      passable: blockers.size === 0,
      cost: blockers.size ? Infinity : cost,
      blockedBy: [...blockers],
      featureIds,
      categories: [...categories],
    };
  }

  inspect(cell: GridCell): CellInspection {
    return this.paint(cell);
  }

  private tile(tx: number, ty: number): Tile {
    const key = `${tx},${ty}`;
    const cached = this.tiles.get(key);
    if (cached) return cached;
    const n = this.tileCells,
      halo = Math.ceil(this.clearanceRadiusM / this.cellSizeM) + 1,
      side = n + 2 * halo;
    const min = this.center({ x: tx * n - halo, y: ty * n - halo });
    const max = this.center({ x: (tx + 1) * n + halo, y: (ty + 1) * n + halo });
    const relevant = this.prepared.filter((f) =>
      boundsOverlap(f.bounds, [min[0], min[1], max[0], max[1]]),
    );
    const raw = new Float32Array(side * side),
      distances = new Float32Array(side * side);
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) {
        const index = y * side + x;
        raw[index] = this.paint({ x: tx * n + x - halo, y: ty * n + y - halo }, relevant).cost;
        distances[index] = Number.isFinite(raw[index]) ? Infinity : 0;
      }
    // Chamfer distance transform, including a halo so adjacent tiles agree.
    const relax = (index: number, adjacent: number, step: number) => {
      distances[index] = Math.min(distances[index]!, distances[adjacent]! + step);
    };
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) {
        const i = y * side + x;
        if (x) relax(i, i - 1, 1);
        if (y) relax(i, i - side, 1);
        if (x && y) relax(i, i - side - 1, Math.SQRT2);
        if (y && x + 1 < side) relax(i, i - side + 1, Math.SQRT2);
      }
    for (let y = side - 1; y >= 0; y--)
      for (let x = side - 1; x >= 0; x--) {
        const i = y * side + x;
        if (x + 1 < side) relax(i, i + 1, 1);
        if (y + 1 < side) relax(i, i + side, 1);
        if (x && y + 1 < side) relax(i, i + side - 1, Math.SQRT2);
        if (x + 1 < side && y + 1 < side) relax(i, i + side + 1, Math.SQRT2);
      }
    const base = new Float32Array(n * n),
      costs = new Float32Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x,
          source = (y + halo) * side + x + halo;
        base[i] = raw[source]!;
        const clearance = Math.min(
          this.clearanceRadiusM,
          Math.max(0, distances[source]! * this.cellSizeM - this.halfDiagonal),
        );
        const penalty =
          this.clearanceRadiusM > 0
            ? this.clearanceWeight * (1 - clearance / this.clearanceRadiusM)
            : 0;
        costs[i] = base[i]! + penalty;
      }
    const tile = { base, costs };
    this.tiles.set(key, tile);
    return tile;
  }

  costAt(cell: GridCell, baseOnly = false): number {
    if (!this.contains(cell)) return Infinity;
    const n = this.tileCells,
      tile = this.tile(Math.floor(cell.x / n), Math.floor(cell.y / n));
    return (baseOnly ? tile.base : tile.costs)[(cell.y % n) * n + (cell.x % n)]!;
  }

  exportTiles(): TileSnapshot {
    return {
      snapshot: this.snapshot,
      tiles: [...this.tiles].map(([key, tile]) => {
        const [x, y] = key.split(',').map(Number);
        return { x: x!, y: y!, base: tile.base.slice(), costs: tile.costs.slice() };
      }),
    };
  }

  restoreTiles(cache: TileSnapshot): boolean {
    if (cache.snapshot !== this.snapshot) return false;
    // Do not trust stale or malformed IndexedDB payloads.
    if (
      cache.tiles.some(
        (t) =>
          !Number.isInteger(t.x) ||
          !Number.isInteger(t.y) ||
          t.x < 0 ||
          t.y < 0 ||
          t.x * this.tileCells >= this.width ||
          t.y * this.tileCells >= this.height ||
          !(t.base instanceof Float32Array) ||
          !(t.costs instanceof Float32Array) ||
          t.base.length !== this.tileCells ** 2 ||
          t.costs.length !== this.tileCells ** 2 ||
          t.base.some((cost, i) => !(cost > 0) || !(t.costs[i]! >= cost)),
      )
    )
      return false;
    for (const t of cache.tiles)
      this.tiles.set(`${t.x},${t.y}`, { base: t.base.slice(), costs: t.costs.slice() });
    return true;
  }
}
