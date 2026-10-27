# Live location (M6)

The navigator can share a location with active administrators while a walk is in
progress. Sharing starts **off** and is a choice for the current signed-in page
session. It is not saved in preferences, IndexedDB, tracks, or another account.
Enable **Share live location with administrators while navigating** on the navigator
home screen, in settings, or during a walk. Stop navigation, opt out, hide the page,
go offline, or sign out to stop transmission. Navigation itself still works offline.

The editor's **Live users** tab is available to administrators. It shows each
sharing device separately, with a name, heading arrow, reported accuracy circle,
destination, route/progress, and battery when available. Use **Show … on map** to
focus a walker. Simulated navigator positions have a **Simulated test** label.
The optional trail is a volatile, bounded session trail (120 samples); it is not a
permanent track. Positions are browser-reported information, not walking guidance.

## Transport and authority

Broadcast updates run at 1.5-second intervals. Presence tracks connected sharing
sessions and changes only on join/leave, not on every position update. Channels are
private and scoped as `live-positions:<auth-user-uuid>`. This is a deliberate
refinement of the plan's single `live-positions` topic: a shared writable topic
cannot bind an arbitrary payload's `user_id` to its actual sender. The editor derives
identity from the authorized topic and rejects mismatching payloads. Names come
from membership records, not from broadcast payloads.

Migration `0004_live_location.sql` allows an active member to send Broadcast and
Presence only to their own topic. Only that member or an active administrator can
receive it. Other walkers, anonymous callers, suspended members, unrelated topics,
and administrator impersonation of a walker are denied. The application always
sets `private: true`; it never subscribes or sends to a public location channel.
No service key or new runtime dependency is required.

Realtime authorizes a channel at join and caches that authorization until rejoin or
JWT refresh. The editor additionally rechecks the active membership catalog every
30 seconds and removes revoked users/channels. Access revocation is subject to
Realtime's authorization cache; it is not an immediate revocation protocol for an
already joined socket. See [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).

No offline queue is used. Reconnection reads a new sample and re-announces Presence.
Session UUIDs and increasing sequence numbers reject old or mismatched packets.
Fixes/headings older than five seconds are removed. The receiver includes observed
transit time in fix age and rejects clock differences above ten seconds. Missing,
stale, stopped, and disconnected positions are hidden, not shown as current.
Weak but fresh accuracy is explicitly labelled and shown with its reported circle.
Presence leave and stop clear coordinates/trails immediately; bounded last-seen
rows expire after five minutes. Routes above 256 waypoints are omitted intact,
rather than drawing a simplified line through possible obstacles.

Optional database `tracks` recording is deferred. This milestone does not insert
location history or add a retention job. Enabling persistent history later requires
an explicit recording choice and a tested retention policy.

## Deployment

1. Apply `supabase/migrations/0004_live_location.sql` to the Alouna database through
   the private operator connection using `psql -v ON_ERROR_STOP=1`.
2. The supported Supabase bundle must already provide `realtime.messages`, its RLS,
   authenticated SELECT/INSERT grants, and `realtime.topic()`. The migration checks
   those prerequisites. Do not create/alter the Supabase-owned schema or disable RLS.
3. Inspect existing policies for unintended broad grants. The new policies do not
   remove pre-existing policies from another deployment. Keep the Realtime service
   and PostgreSQL private behind Kong; the existing web proxy already forwards
   `/supabase/realtime/v1/websocket` with WebSocket upgrade headers.
4. Use the existing public browser configuration and authenticated sessions. Test
   a navigator and administrator in separate browsers, then opt out/stop/hide the
   navigator and confirm the marker disappears. Verify that a walker cannot join
   another walker's topic and anonymous access is denied on the actual instance.

## Checks

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
- `pnpm test:e2e`: separate browser sessions use the actual Supabase client against
  an isolated Phoenix/Realtime protocol fixture. The test covers private joins,
  explicit opt-in, movement, weak GPS, hidden-page suspension/rejoin, opt-out and stop.
- CI applies the migration to PostgreSQL and runs `supabase/tests/realtime.sql`
  against its RLS policies. The bootstrap contains only a minimal Realtime table
  contract for that disposable database; it must never run on the live stack.

The protocol fixture establishes browser integration, not a real iPhone walk or a
production Supabase verification. Those must be reported separately when performed.
