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

```
pnpm install
pnpm dev         # web app on http://localhost:5173 (also on LAN for phone testing; GPS/compass need HTTPS on a phone)
pnpm test        # vitest in all packages
pnpm typecheck   # tsc --noEmit in all packages
pnpm lint        # eslint + prettier --check
pnpm format      # prettier --write
pnpm build       # production build -> apps/web/dist
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test and build on every push/PR.

## Progress

- [x] M0 – Scaffold, CI, deploy config
- [x] M1 – Core: geo, rules, routing (+ tests)
- [ ] M2 – Supabase schema, RLS, seed, offline data layer
- [ ] M3 – Editor: map, drawing, rules panel, import/export
- [ ] M4 – Editor: route tester, cost overlay, walk simulator
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
- Versions deviate from the plan's "React 18": the current React 19 / React Router 8 / Vite 8 / Vitest 5 are used.
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
