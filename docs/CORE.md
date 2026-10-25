# Routing core (M1)

`@alouna/core` is framework-free TypeScript. Use `new RoutingEngine(features, rules)`
and `engine.route(start, end)`. Feature inputs are GeoJSON-like `MapFeature` values
with a stable `id` and category in `properties`. Coordinates crossing the public API
are WGS84 `[longitude, latitude]`. Internal LKS94 coordinates are **[easting, northing]**
in metres, even though EPSG's formal axis labels list northing first. Projection uses
[Proj4js](https://github.com/proj4js/proj4js) and the EPSG:3346 parameters.

Results contain WGS84 waypoints, metre distances, weighted grid cost, semantic events,
snapping notices, visited-cell count and a data-version label. The UI converts event
codes to the English strings in `strings.ts`. A failure has no partial route.
`blocked-start`, `blocked-end`, `no-route`, and `search-limit` must stop guidance.
Endpoint snaps are limited to 2 m by default (configurable up to 15 m); a returned
snap is a notice requiring explicit handling in M5, never an instruction to walk the
unchecked segment from the original GPS position to the snapped point.

## Grid and rules

- 0.5 m cells, lazy 64 m tiles, 20 m margin around all enabled walkable areas.
  Extents larger than 1 km² use at least 1 m cells. No property coordinates or IDs
  are embedded in production code. Cell sizes must divide 64 m exactly.
- Enabled walkable polygons are unioned, so adjoining plots remain connected.
  Complete cell footprints must fit within that union; holes stay blocked.
  Obstacles include their physical width/radius, rule buffer, and a half-cell
  diagonal allowance so a thin fence cannot fall between samples. This conservative
  rasterization can close very narrow passages; widen/review surveyed geometry rather
  than silently reducing safety buffers.
- Normal passable surfaces paint in ascending priority (feature ID breaks ties).
  Hard blockers accumulate independently. Override categories paint last and remove
  **only the named blocker categories**. A crossing cannot remove water/ditch or reopen
  land outside every walkable area. Openings must contain the entire cell footprint.
- Eight-neighbour A* uses an admissible octile heuristic scaled by the lowest
  passable cost, and rejects diagonal corner cutting. A tile-halo distance transform
  adds a small clearance penalty near blocked cells. The penalty improves path choice;
  it is not a measured physical safety guarantee.
- Smoothing uses a supercover line traversal including side cells at corner crossings.
  Every touched cell must be passable and no more expensive than the endpoints.
- Events cover crossings, gates/doors, docks, steps/caution, nearby hazards, and turns
  over 45°. Feature entry/warning locations are sampled at half-cell spacing and are
  approximate; M5 handles approach prompts, accuracy gates and playback timing.

## Worker and cache

`packages/core/src/routing/router.worker.ts` is the browser module-worker entry.
It accepts `RoutingRequest` and replies with `RoutingResponse` using the same request ID.
`createRoutingHandler()` exposes the same protocol for unit tests. The worker retains
tiles across requests with identical inputs. Terminate and recreate the worker to
cancel an in-flight synchronous search; each search is also bounded by `maxVisited`.

`grid.exportTiles()` / `restoreTiles()` transfer typed-array tiles for M2's IndexedDB
adapter. Cache reuse compares the **complete canonical snapshot**, including rules,
geometry, feature metadata and grid settings; the short version hash is not trusted
as a collision-free cache key. Algorithm changes must bump the routing version.

No database, IndexedDB, React, sensor, speech or audio code lives in core. M2 owns
persistent cache storage; M4/M5 own the UI and worker lifecycle.

## Dependency updates

TypeScript 7 is installed as `@typescript/native` and supplies `tsc`; the `typescript`
name aliases Microsoft's `@typescript/typescript6` compatibility API for the current
ESLint parser. This is the official
[side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0).
Remove the compatibility alias when typescript-eslint supports the native compiler API.
