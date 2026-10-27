import { expect, test, type BrowserContext, type WebSocketRoute } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { DEFAULT_RULES } from '@alouna/core';
import { area, feature } from '../../../packages/core/src/routing/test-maps';

const admin = {
  id: '00000000-0000-0000-0000-000000000001',
  display_name: 'Administrator',
  role: 'admin',
  active: true,
};
const walker = {
  id: '00000000-0000-0000-0000-000000000002',
  display_name: 'Walker',
  role: 'walker',
  active: true,
};
const features = [
  area(40, 30),
  feature(
    'house',
    'landmark',
    { type: 'Point', coordinates: [500005, 6100005] },
    { name: 'House', is_destination: true },
  ),
  feature(
    'sauna',
    'landmark',
    { type: 'Point', coordinates: [500035, 6100025] },
    { name: 'Sauna', is_destination: true },
  ),
].map((f) => ({ ...f, properties: { ...f.properties, enabled: true, reviewed: true } }));
type Frame = [string | null, string | null, string, string, Record<string, unknown>];
type Peer = {
  socket: WebSocketRoute;
  userId: string;
  topics: Map<string, string | null>;
  presence: Map<string, Record<string, unknown>>;
};

/** A protocol fixture, not a replacement application transport: both pages use supabase-js.
 * SQL policy checks separately exercise the server's actual PostgreSQL RLS boundaries. */
class RealtimeFixture {
  peers = new Set<Peer>();
  positions: Record<string, unknown>[] = [];
  joins: Record<string, unknown>[] = [];
  private send(
    peer: Peer,
    topic: string,
    event: string,
    payload: Record<string, unknown>,
    ref: string | null = null,
    joinRef: string | null = peer.topics.get(topic) ?? null,
  ) {
    peer.socket.send(JSON.stringify([joinRef, ref, topic, event, payload]));
  }
  private presence(topic: string) {
    const state: Record<string, unknown> = {};
    for (const peer of this.peers) {
      const p = peer.presence.get(topic);
      if (p) state[String(p.session_id)] = { metas: [{ ...p, phx_ref: p.session_id }] };
    }
    for (const peer of this.peers)
      if (peer.topics.has(topic)) this.send(peer, topic, 'presence_state', state);
  }
  attach(socket: WebSocketRoute, userId: string) {
    const peer: Peer = { socket, userId, topics: new Map(), presence: new Map() };
    this.peers.add(peer);
    socket.onMessage((raw) => {
      const [joinRef, ref, topic, event, payload] = this.decode(raw);
      const ok = () =>
        this.send(
          peer,
          topic,
          'phx_reply',
          { status: 'ok', response: { postgres_changes: [] } },
          ref,
          joinRef,
        );
      if (event === 'phx_join') {
        const config = payload.config as Record<string, unknown>;
        this.joins.push({ userId, topic, private: config.private });
        const allowed =
          config.private === true &&
          (userId === admin.id || topic === `realtime:live-positions:${userId}`);
        if (!allowed) {
          this.send(peer, topic, 'phx_reply', { status: 'error', response: {} }, ref, joinRef);
          return;
        }
        peer.topics.set(topic, joinRef);
        ok();
        this.presence(topic);
      } else if (event === 'presence') {
        if (payload.event === 'track')
          peer.presence.set(topic, payload.payload as Record<string, unknown>);
        else peer.presence.delete(topic);
        ok();
        this.presence(topic);
      } else if (event === 'broadcast') {
        const position = payload.payload as Record<string, unknown>;
        expect(position.user_id).toBe(userId);
        expect(topic).toBe(`realtime:live-positions:${userId}`);
        this.positions.push(position);
        ok();
        for (const receiver of this.peers)
          if (receiver !== peer && receiver.topics.has(topic))
            this.send(receiver, topic, 'broadcast', { event: payload.event, payload: position });
      } else if (event === 'phx_leave') {
        peer.topics.delete(topic);
        peer.presence.delete(topic);
        ok();
        this.presence(topic);
      } else if (event === 'heartbeat') ok();
    });
    socket.onClose(() => {
      this.peers.delete(peer);
      for (const topic of peer.topics.keys()) this.presence(topic);
    });
  }
  private decode(raw: string | Buffer): Frame {
    if (typeof raw === 'string') return JSON.parse(raw) as Frame;
    // supabase-js 2.118 uses the documented Phoenix v2 JSON frames and compact binary broadcasts.
    expect(raw[0]).toBe(3);
    let offset = 7;
    const take = (length: number) => {
      const text = raw.subarray(offset, offset + length).toString('utf8');
      offset += length;
      return text;
    };
    const joinRef = take(raw[1]!),
      ref = take(raw[2]!),
      topic = take(raw[3]!),
      event = take(raw[4]!);
    take(raw[5]!);
    expect(raw[6]).toBe(1);
    return [
      joinRef,
      ref,
      topic,
      'broadcast',
      { event, payload: JSON.parse(raw.subarray(offset).toString('utf8')) },
    ];
  }
}

async function account(context: BrowserContext, profile: typeof admin, fixture: RealtimeFixture) {
  const now = Math.floor(Date.now() / 1000),
    encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: profile.id, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now })}.test-signature`;
  await context.addInitScript(
    ({ profile, token, now }) => {
      localStorage.setItem(
        'sb-127-auth-token',
        JSON.stringify({
          access_token: token,
          refresh_token: 'test-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: now + 3600,
          user: {
            id: profile.id,
            aud: 'authenticated',
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        }),
      );
    },
    { profile, token, now },
  );
  await context.route('**/supabase/**', (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname.endsWith('/profiles'))
      body = url.searchParams.has('id') ? [profile] : [admin, walker];
    else if (url.pathname.endsWith('/rpc/routing_snapshot'))
      body = { version: '1', features, rules: DEFAULT_RULES };
    else if (url.pathname.endsWith('/rpc/editor_features'))
      body = features.map((f) => ({
        feature: f,
        published: f,
        own: false,
        status: 'approved',
        created_by_name: '',
      }));
    else if (url.pathname.endsWith('/auth/v1/user'))
      body = { id: profile.id, aud: 'authenticated', app_metadata: {}, user_metadata: {} };
    return route.fulfill({ json: body });
  });
  await context.route(
    /https:\/\/(www\.geoportal\.lt|services\.arcgisonline\.com|tile\.openstreetmap\.org)\//,
    (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQ0ND4DwACbAF4RS6SMAAAAABJRU5ErkJggg==',
          'base64',
        ),
      }),
  );
  await context.routeWebSocket(/\/supabase\/realtime\/v1\/websocket/, (socket) =>
    fixture.attach(socket, profile.id),
  );
}

test('a separate editor sees the navigator move, and opt-out removes its live position', async ({
  browser,
}) => {
  const fixture = new RealtimeFixture();
  const editorContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const phoneContext = await browser.newContext();
  try {
    await account(editorContext, admin, fixture);
    await account(phoneContext, walker, fixture);
    const editor = await editorContext.newPage(),
      phone = await phoneContext.newPage();
    const errors: string[] = [];
    editor.on('pageerror', (error) => errors.push(error.message));
    phone.on('pageerror', (error) => errors.push(error.message));
    await editor.goto('http://127.0.0.1:5174/editor');
    await editor.getByRole('tab', { name: 'Live users' }).click();
    await expect(editor.getByRole('heading', { name: 'Live walkers' })).toBeVisible();
    await phone.goto('http://127.0.0.1:5174/navigate');
    const share = phone.getByLabel('Share live location with administrators while navigating');
    await expect(share).not.toBeChecked();
    await phone.getByLabel('Use simulated walker (indoor test mode)').check();
    await phone.getByRole('button', { name: 'Start walking to Sauna' }).click();
    await expect(phone.getByText(/m remaining/)).toBeVisible();
    expect(fixture.positions).toHaveLength(0);
    await share.check();
    await expect(editor.getByText('Simulated test', { exact: true })).toBeVisible();
    await expect(editor.getByText('To Sauna', { exact: true })).toBeVisible();
    const marker = editor.locator('.live-map-marker').filter({ hasText: 'Walker' });
    await expect(marker).toBeVisible();
    const before = await marker.getAttribute('style');
    await phone.getByRole('button', { name: 'Step forward 2 m' }).click();
    await expect.poll(() => marker.getAttribute('style')).not.toBe(before);
    await phone.getByRole('button', { name: 'Simulate weak GPS (±25 m)' }).click();
    await expect(editor.getByText('GPS weak', { exact: true })).toBeVisible();
    await phone.getByRole('button', { name: 'Restore good GPS (±2 m)' }).click();
    await phone.getByRole('button', { name: 'Auto-walk route', exact: true }).click();
    await expect(editor.getByText('Reported accuracy ±2.0 m', { exact: true })).toBeVisible();
    await editor.getByLabel('Show temporary session trails').check();
    await editor.getByRole('button', { name: 'Show Walker on map', exact: true }).click();
    await editor.screenshot({ path: 'test-results/live-users.png' });
    await phone.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(marker).toHaveCount(0);
    await phone.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(marker).toBeVisible();
    await share.uncheck();
    await expect(marker).toHaveCount(0);
    await expect(
      editor.getByText('Not sharing / disconnected', { exact: true }).first(),
    ).toBeVisible();
    const sent = fixture.positions.length;
    await phone.waitForTimeout(1700);
    expect(fixture.positions).toHaveLength(sent);
    await share.check();
    await expect(marker).toBeVisible();
    await phone.getByRole('button', { name: /Stop navigation/ }).click();
    await expect(marker).toHaveCount(0);
    expect(fixture.joins.every((join) => join.private === true)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await editorContext.close().catch(() => {});
    await phoneContext.close().catch(() => {});
  }
});
