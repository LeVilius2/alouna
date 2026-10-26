# AGENTS.md – instructions for AI coding agents (Codex etc.)

## Source of truth

**Read `docs/PLAN.md` fully before doing anything.** It defines the goal, tech stack, data model,
routing algorithm, audio design, milestones (M0–M9) and decisions already made.
If something in the plan is impossible or clearly wrong, explain why and propose an alternative
before deviating.

## How to work

- Implement **one milestone at a time** (the user will say which, e.g. "do M1").
  If no milestone is given, continue with the first one not marked done in the
  "Progress" section below.
- When a milestone is finished, tick it in the Progress section and add short notes
  (what was built, deviations, known issues).
- Before finishing: run lint, tests and build — all must pass.
- Keep this project's packages at their latest stable releases (owner preference,
  25 October 2026). Check `pnpm -r outdated`, upgrade and verify compatibility as
  part of ongoing work. Honor the environment's release-age and integrity policy.
  Use supported compatibility adapters where necessary; document any remaining pin.

## Conventions

- TypeScript **strict** mode everywhere. pnpm workspaces.
- `packages/core` is **pure TS**: no React, no DOM, no Supabase. Everything there is unit-tested with Vitest.
- All distances/geometry computations in meters in **LKS94 (EPSG:3346)**; store/transfer WGS84 (EPSG:4326, `[lon, lat]` order as in GeoJSON).
- Never hard-code the property bbox, feature IDs or coordinates in code (the map must be able to expand to neighbours' plots). Seed data lives in `supabase/seed/`.
- Sensors and outputs behind interfaces (`LocationProvider`, `HeadingProvider`, `Haptics`, `Sonar`, `Speech`) so the same app runs in Safari/Chrome and in the simulator.
- **Web only (PWA). No native apps, no Capacitor/React Native/App Store.** iPhone Safari is the primary target; test iOS constraints (wake lock, compass permission from a tap, AudioContext resume, silent switch).
- All user-facing / spoken text in English, kept in `apps/web/src/strings.ts`.
- Navigator UI must be fully usable with VoiceOver: large targets, meaningful `aria-label`s, `aria-live` for status.
- Safety first: when GPS accuracy is poor or data is missing, the navigator must **stop guiding and say so** rather than guess.
- No new dependencies beyond the plan's stack without a short justification in the PR/summary.
- Secrets (Supabase keys) only via `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`); commit a `.env.example`, never `.env`.

## Commands

Requires Node ≥ 24.19 (24 LTS, see `.nvmrc`) and pnpm 12.15.0 (see `packageManager`).
TypeScript 7 supplies `tsc`; Microsoft's TypeScript 6 API compatibility alias is used
by typescript-eslint until its native-compiler API support is ready.
pnpm 12 records its own version in a leading lockfile document. When updating the
package-manager pin, regenerate and commit that metadata too. Release verification
must enforce the pin (`--config.pmOnFail=error`); the managed host can otherwise
default to `pmOnFail=ignore` and hide errors that CI catches.

```
pnpm install
pnpm dev         # web app on http://localhost:5173 (also on LAN for phone testing; GPS/compass need HTTPS on a phone)
pnpm test        # vitest in all packages
pnpm test:e2e    # Playwright editor smoke tests on port 5174; synthetic offline account
pnpm typecheck   # tsc --noEmit in all packages
pnpm lint        # eslint + prettier --check
pnpm format      # prettier --write
pnpm build       # production build -> apps/web/dist
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test and build on every push/PR.

## Progress

- [x] M0 – Scaffold, CI, deploy config
- [x] M1 – Core: geo, rules, routing (+ tests)
- [x] M2 – Supabase schema, RLS, seed, offline data layer
- [x] M3 – Editor: map, drawing, rules panel, import/export
- [x] M4 – Editor: route tester, cost overlay, walk simulator
- [ ] M5 – Navigator (web): heading, location, guidance, sonar, speech, hazards
- [ ] M6 – Live location (Realtime)
- [ ] M7 – Field capture: Add here, record walk, offset capture
- [ ] M8 – PWA polish, accessibility audit, field testing
- [ ] M9 – (optional) External GNSS receiver support (hardware; minimal code)

## Notes

_(agents: append milestone notes here)_

### M0 (done)

- pnpm monorepo: `packages/core` (pure TS, consumed as source – no build step) and `apps/web` (Vite + React + React Router, PWA via vite-plugin-pwa).
- Routes: `/` (mode chooser), `/navigate` and `/editor` (placeholders), `*` (not found). Router defined in `apps/web/src/router.tsx`; tests use `createMemoryRouter(routes)`.
- `packages/core/src/geo/sphere.ts`: `distanceMeters`, `bearingDegrees`, `normalizeDegrees`, `signedAngleDiff` (+ tests). Coordinates are `[lon, lat]`.
- Strings in `apps/web/src/strings.ts`; global styles in `apps/web/src/styles.css` (big accessible buttons).
- PWA manifest + icons in `apps/web/public` (icons are generated placeholders).
- Hosting override (25 October 2026): use the owner's existing Hostinger/Coolify VPS
  for **both the web app and Supabase**. Web hostname: `alouna.leveris.lt`.
  `Dockerfile` + `deploy/nginx.conf` replace Netlify/Pages configuration. See
  `docs/DEPLOYMENT.md`. Supabase provisioning/schema remain M2 work.
- Current stack: React 19 / React Router 8 / Vite 8 / Vitest 5.
- Dependency updates: TypeScript 7 + official TS6 compatibility alias, jsdom 30,
  Node 24 LTS and pnpm 12.15.0. Do not restore the superseded TS6/jsdom26 pins.
- Playwright smoke tests are deferred until there are real screens (M3/M5).

### M1 (done)

- Pure core: proj4 WGS84/LKS94 projection, planar geometry/polyline helpers, typed
  feature/rule model and all default categories. Internal coordinates are
  `[easting, northing]` metres; API/storage coordinates are `[longitude, latitude]`.
- Lazy 64 m tiles, 0.5 m cells (at least 1 m above 1 km²), enabled-area union,
  physical widths/radii, safety buffers, priority costs, and category-specific overrides.
- Heap-based eight-neighbour A*, octile heuristic, clearance penalty, no corner
  cutting, supercover cost-preserving smoothing, semantic route events, bounded snaps.
- Worker entry/protocol and reusable tiles keyed by a full versioned snapshot.
  IndexedDB persistence remains M2. UI/worker lifecycle remains M4/M5.
- Tests cover the five required routing cases, unrelated overlapping hazards,
  polygon holes/invalid topology, thin fences, disabled/adjoining plots, tile growth,
  cache invalidation, endpoint/search failures and events. See `docs/CORE.md`.
- Safety clarifications to the plan: only named blockers are overridden; whole-cell
  footprints are conservative; endpoint snapping returns notices and has a distance cap.
- VPS Dockerfile/nginx deployment replaces Pages; Supabase self-hosting is recorded
  for M2. Dependencies updated, with the official TS6 API adapter needed by ESLint.
- Web deployment verified at `https://alouna.leveris.lt`: healthy container, trusted
  HTTPS, redirects, SPA/PWA files and local/live build hashes. Deploy manually in
  Coolify after GitHub CI passes. Supabase is not provisioned yet.

### M2 (done)

- PostGIS schema, active admin/walker membership, RLS, private helper schema and
  versioned RPCs are live on the VPS. Direct feature/rule/profile writes are
  revoked; actor checks, receipts and entity locks protect offline retries and
  concurrent creation. Pending walker moves/deletions preserve the last approved
  routing snapshot. See `docs/DATA.md`.
- Six legacy features imported; only Our plot is an enabled walkable plot. The
  self-intersecting Other plot is preserved in `alouna_private.seed_rejections`,
  unavailable for routing. Source GeoJSON is untouched; seed metadata lives in
  `supabase/seed/legacy-map.json`.
- IndexedDB account/backend isolation, persistent queue, conflict blocking,
  fail-closed validation and full-version tile caching. `fake-indexeddb` is a
  test-only dependency for actual IndexedDB transaction/persistence checks.
- Owner auth override: email/password, following the SMTP-free implementation in
  `taskwardly-research`; magic links/SMTP are superseded. Signup/phone/anonymous
  access are disabled. Account provisioning is private and interactive via
  `scripts/create-member.py`; the owner enters new passwords personally.
- Supabase Coolify service `y9unof4mljl5gzdcscwbqzjs`, no public domains/host ports.
  Only Kong joins the existing web network. Web proxies Auth/REST/Realtime under
  `/supabase`; Studio, Auth administration and other gateway paths are blocked.
- Full database backups run from `/etc/cron.d/alouna-database-backup` at 01:00 UTC,
  retaining 14 copies / 14 days / 2 GB in `/data/coolify/backups/alouna` (0700/0600).
  Restore plus RLS checks passed in a separate database, then that database was
  removed. The GraphQL wrapper companion is required with each dump. Coolify's
  native backup schedule is **disabled** because it strips ownership/ACLs; do not
  re-enable it as a replacement. No off-site destination/failure alert is configured.
- Latest policy-eligible project packages checked. The supported Coolify Supabase
  bundle retains its tested component pins (Postgres 15); do not upgrade individual
  images blindly. SQL is also tested on Postgres 17/PostGIS in CI.
- Local lint/typecheck/tests/build and SQL ownership/review/idempotency/concurrency
  checks pass; live anonymous data access is denied, trusted HTTPS and asset hashes
  verified. Existing PWA tabs may need one reload after their service worker updates.
  Owner account creation/sign-in verified. A browser reload with requests blocked
  (`ERR_INTERNET_DISCONNECTED`) retained all six features and approved version 26
  from IndexedDB; reconnecting/syncing refreshed the cache. Network overrides were
  removed. All 48 tests, SQL access/concurrency checks and build pass. iPhone field
  testing remains M8; map drawing starts in M3.

### M3 (done)

- `supabase/migrations/0002_editor.sql` + `supabase/tests/editor.sql`: `public.editor_features(expected_actor)`
  returns the editor working set with status (`approved`, `pending-new`, `pending-edit`,
  `pending-delete`, `deleted`), author display name and `own` flag, while keeping other
  walkers' unapproved drafts private. Apply `0002_editor.sql` to the VPS database with
  `psql -v ON_ERROR_STOP=1`; the client falls back to `routing_snapshot` until applied.
- `@alouna/core` import module (`packages/core/src/import/`): GeoJSON (including
  Multi\*/GeometryCollection explosion, Z-stripping, ring closure), CSV / pasted
  coordinate text (headers, groups, Lithuanian decimal commas, point/line/polygon join),
  and CRS auto-detection + conversion (`wgs84`, `wgs84-latlon`, `lks94`, `lks94-ne`).
- Web KML/GPX import (`apps/web/src/editor/fileImport.ts`) via `@tmcw/togeojson` +
  `DOMParser`, feeding the core import pipeline.
- Editor UI (`apps/web/src/editor/`):
  - `MapView` (lazy-loaded): MapLibre GL JS with Lithuanian orthophoto `ORT10LT`
    dynamic export tiles (`{bbox-epsg-3857}`), Esri World Imagery and OSM basemap
    switcher; Terra Draw modes for pan, select/vertex edit, point, obstacle circle
    (converted to `Point` + `radius_m`), line and polygon.
  - Walkable-area (plot) quick toggles for enabling/disabling neighbour plots, category
    visibility legend, status/review filters, and soft-delete restore for admins.
  - `FeaturePanel`: edits name, spoken TTS name, category, width/radius, owner label,
    destination flag, enabled flag and notes; admin approve/publish & restore; conflict
    discard; validates geometry and polygon topology before queuing.
  - `RulesPanel`: admin editing of `category_rules` (passable, cost, buffer, warning
    distance, priority, hex colour, overrides).
  - `ImportExportPanel`: file/paste import with CRS + join selector and live preview;
    full GeoJSON backup export of features and rules.
  - Undo/redo of unsynced queue changes via `FeatureStore.replaceQueue`.

### M4 (done)

- Route tester: click A/B or select point destinations, calculate in a Web Worker,
  and inspect the route, metric distance, weighted cost, events, endpoint blockers
  and bounded-snap notices. Cancel and stale-result invalidation terminate obsolete work.
- Approved routing snapshot is the default. Admins can explicitly test an editor
  preview with unsynced/unapproved edits; its map and rules match the test source.
  Draft previews never publish changes or alter navigation data.
- Exact visible cost cells include buffers, overrides and clearance penalties.
  Views above 12,000 cells ask for a closer zoom. Account/backend-scoped M2 tiles
  are restored/saved in the worker; unavailable IndexedDB is a safe cache miss.
- Pure metric playback, play/pause/reset/speed, manual arrow-key/button movement,
  heading control and a map walker arrow. Simulated location/heading interfaces
  are ready for M5. Audio and real guidance remain M5, as planned.
- MapLibre upgraded to the latest policy-eligible stable release (6.16.0). Added
  its required Vite worker URL and fixed map effects missing the initial load;
  both workers are included in the PWA precache. Playwright and Node types are
  test-only additions for the planned browser smoke tests and strict checks.
- See `docs/EDITOR.md` for use and validation. Chromium smoke tests cover actual
  map clicks, the worker, crossing route, exact overlay, cache persistence,
  simulation and blocked endpoints. CI runs them after build. Production deployment
  and real iPhone field testing have not been performed as part of M4.
- Deployment follow-up: `0003_editor_owner_flag.sql` fixes M3's nullable `own`
  field for imported features without an Auth creator. The API returns `false`,
  preserving authority checks and the client's strict validation. SQL tests cover
  admin/walker reads plus denied walker mutation of an ownerless feature.
