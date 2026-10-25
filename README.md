# Alouna

Audio navigation for a blind person around a lakeside property.

- **Editor** – visual map to draw/import areas, lines and objects, set rules (avoid ditches, cross roads only at crossings, …), test routes and see users' live locations.
- **Navigator** – iPhone-first web app (PWA, no install needed) that guides by GPS + compass using sonar-style spatial audio and speech, routing around obstacles according to the rules.

The full plan is in [docs/PLAN.md](docs/PLAN.md). Instructions for AI coding agents are in [AGENTS.md](AGENTS.md).

Hosting: the existing Hostinger/Coolify VPS, including self-hosted Supabase. Web
hostname: **alouna.leveris.lt**. See [deployment setup](docs/DEPLOYMENT.md) and the
[M1 routing API](docs/CORE.md). The editor and navigator screens are still placeholders.

> ⚠️ Phone GPS is accurate to a few meters only. This app is an aid, not a replacement for a cane or companion.
