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
_(fill in during M0)_
```
pnpm install
pnpm dev        # run web app
pnpm test       # vitest
pnpm lint
pnpm build
```

## Progress
- [ ] M0 – Scaffold, CI, deploy
- [ ] M1 – Core: geo, rules, routing (+ tests)
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
