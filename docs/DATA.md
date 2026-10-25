# M2 data and offline behavior

## Database contract

`supabase/migrations/0001_init.sql` installs PostGIS in `extensions`, profiles,
category rules, features, tracks, RLS and versioned RPCs. Apply it once to a fresh
Supabase database with `psql -v ON_ERROR_STOP=1`. It is transactional. Do not run
`supabase/tests/bootstrap.sql` on Supabase; that file only supplies Auth stubs in
the disposable CI PostgreSQL database.

Authentication uses email and password, following the owner's 25 October 2026
SMTP-free override after checking `taskwardly-research`. Passwords are handled by
Supabase Auth; no SMTP or email verification link is required for server-created
confirmed accounts. Password recovery is an administrator operation. Auth users must also have an active
`profiles` row before reading or writing map data. Membership and roles are
managed server-side. There is no automatic first-user admin or self-service role
change. Disable public signup and phone authentication in self-hosted GoTrue.

Only the admin can edit rules or review features. Walkers can submit and modify
only their own features. Every walker mutation becomes a pending review, even
when the request asks for approval. The `published` snapshot retains the last
approved geometry/properties during a pending move or deletion. Newly submitted
walkable plots, gates and crossings cannot open routes before approval. Admin
approval replaces the published snapshot; admin deletion removes it. This is a
safety clarification to the plan's review flag.

Direct feature/rule writes are revoked. Use `mutate_feature` / `mutate_rule` with
an expected revision, stable operation UUID and expected actor UUID. Receipts make
retries safe after a lost response. Reusing an operation UUID with different
input fails. Stale updates fail with SQLSTATE `40001`; no automatic overwrite or
rebase occurs. Advisory locks also serialize creation when the row does not yet
exist. Expected actors prevent another signed-in account from sending an old
account's persisted queue.

`routing_snapshot` returns published GeoJSON and rules from a consistent database
snapshot. Store/transfer coordinates remain `[longitude, latitude]` in EPSG:4326;
the pure core projects into LKS94 metres. Tracks are readable by their contributor
and admins, and can be inserted only for the current contributor. Live publication
and presence are M6 work.

## Legacy seed

Run `pnpm seed:generate`, then apply `supabase/seed/seed.sql`. `pnpm seed:check`
checks deterministic generation against the retained, unchanged GeoJSON and core
rules. Reapplying the seed does not overwrite existing features or custom rules.
Only Our plot is initially enabled as a walkable plot; the lake is an enabled
water hazard. Other valid plots are retained, disabled, for later review. The four
old map-boundary lines are viewport metadata and are omitted.

PostGIS rejects the self-intersecting legacy **Other plot** (`Kažkieno sklypas`).
Its original feature and validation reason are retained in
`alouna_private.seed_rejections`; its geometry is never repaired automatically or
published. Check that table before enabling neighbouring plots. Correct the
boundary using reliable source data in a later reviewed change.

## Browser cache and queue

`apps/web/src/data/` owns Supabase, IndexedDB and React integration. Core remains
independent of browser/storage/backend libraries. The editor's M2 panel exposes
sign-in, account role, map/cache status, feature names, pending count, sync and
sign-out. Map editing and conflict-resolution UI remain M3.

The data cache is scoped by backend URL and account ID. It stores the last approved
snapshot separately from queued drafts, and validates geometry/rules on read.
Offline reload restores the last authenticated account's cache; it never creates a
server identity. Reconnection verifies membership before replay. Suspension or
identity mismatch clears readable routing data; corrupt maps fail closed while
valid pending work remains. An offline device cannot learn about a later server
revocation until it reconnects. Use offline mode only on a trusted device.

An edit is persisted before enqueue succeeds. Queue IDs survive restarts and
network failures. A conflict blocks further edits to that entity until explicitly
discarded/reviewed. Published routing data never changes optimistically. Sign-out
requires an extra tap when it will discard queued work and clears the account's
data/tile cache and last-account hint. Other accounts use separate namespaces.

The tile cache adapter stores core's full versioned tile snapshot in IndexedDB.
Core rejects stale settings/rules/features or malformed tiles; a rejected cache is
discarded and regenerated. Worker integration is M4/M5.

## Verification

CI runs schema application, seed twice, ownership/RLS/review/idempotency/track
checks and a concurrent-create race against PostgreSQL/PostGIS. SQL permission
fixtures are transactionally rolled back; the concurrent test is CI-only.
Browser-side tests use `fake-indexeddb`, a test-only dependency added to exercise
real IndexedDB transactions and persistence instead of a hand-written cache mock.

For a live offline check: sign in on `/editor`, sync, confirm the cached feature
list, disconnect the device's network, reload `/editor`, and confirm the same
snapshot/date with Offline status. Reconnect and sync. Check Safari on the target
iPhone separately; automated IndexedDB tests do not establish iOS field behavior.
