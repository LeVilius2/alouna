import type { LonLat } from '@alouna/core';
import type { LocationFix } from '../sensors/types';

export const LIVE_INTERVAL_MS = 1500;
export const LIVE_FIX_MAX_AGE_MS = 5000;
export const LIVE_FORGET_MS = 300_000;
export const LIVE_ROUTE_LIMIT = 256;
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const liveTopic = (userId: string) => `live-positions:${userId}`;
export type LiveNavigationStatus =
  'guiding' | 'weak-gps' | 'recalculating' | 'arrived' | 'waiting-gps' | 'stopped';

export interface LivePosition {
  v: 1;
  user_id: string;
  session_id: string;
  seq: number;
  ts: number;
  lon: number | null;
  lat: number | null;
  accuracy: number | null;
  fix_age_ms: number | null;
  heading: number | null;
  speed: number | null;
  destination_id: string | null;
  route_progress: number | null;
  remaining_m: number | null;
  route: readonly LonLat[] | null;
  battery: number | null;
  source: 'gps' | 'simulator';
  status: LiveNavigationStatus;
}

export interface LiveSample {
  fix: LocationFix | null;
  heading: number | null;
  headingTimestamp: number | null;
  destinationId: string | null;
  progress: number | null;
  remainingM: number | null;
  route: readonly LonLat[] | null;
  battery: number | null;
  source: 'gps' | 'simulator';
  status: LiveNavigationStatus;
}

const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const nullable = (value: unknown, min: number, max: number) =>
  value === null || finite(value, min, max);
const point = (value: unknown): value is LonLat =>
  Array.isArray(value) &&
  value.length === 2 &&
  finite(value[0], -180, 180) &&
  finite(value[1], -89.999, 89.999);

/** Identity comes from the RLS-protected topic, never just a user_id in an arbitrary payload. */
export function parseLivePosition(value: unknown, topicUserId: string): LivePosition | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as LivePosition;
  if (
    p.v !== 1 ||
    p.user_id !== topicUserId ||
    !isUuid(p.user_id) ||
    !isUuid(p.session_id) ||
    !Number.isSafeInteger(p.seq) ||
    p.seq < 1 ||
    !finite(p.ts, 0, Number.MAX_SAFE_INTEGER) ||
    !['gps', 'simulator'].includes(p.source) ||
    !['guiding', 'weak-gps', 'recalculating', 'arrived', 'waiting-gps', 'stopped'].includes(
      p.status,
    ) ||
    !nullable(p.heading, 0, 359.999999) ||
    !nullable(p.speed, 0, 100) ||
    !nullable(p.battery, 0, 100) ||
    !nullable(p.route_progress, 0, 1) ||
    !nullable(p.remaining_m, 0, 10_000_000) ||
    !(
      p.destination_id === null ||
      (typeof p.destination_id === 'string' &&
        p.destination_id.length > 0 &&
        p.destination_id.length <= 128)
    )
  )
    return null;
  if (p.lon === null) {
    if (
      p.lat !== null ||
      p.accuracy !== null ||
      p.fix_age_ms !== null ||
      p.heading !== null ||
      p.speed !== null
    )
      return null;
    if (!['weak-gps', 'waiting-gps', 'stopped'].includes(p.status)) return null;
  } else if (
    !point([p.lon, p.lat]) ||
    !finite(p.accuracy, 0, 1000) ||
    !finite(p.fix_age_ms, 0, LIVE_FIX_MAX_AGE_MS)
  )
    return null;
  if (
    p.route !== null &&
    (!Array.isArray(p.route) ||
      p.route.length < 2 ||
      p.route.length > LIVE_ROUTE_LIMIT ||
      !p.route.every(point))
  )
    return null;
  if (p.status === 'stopped' && (p.lon !== null || p.route !== null)) return null;
  return {
    v: 1,
    user_id: p.user_id,
    session_id: p.session_id,
    seq: p.seq,
    ts: p.ts,
    lon: p.lon,
    lat: p.lat,
    accuracy: p.accuracy,
    fix_age_ms: p.fix_age_ms,
    heading: p.heading,
    speed: p.speed,
    destination_id: p.destination_id,
    route_progress: p.route_progress,
    remaining_m: p.remaining_m,
    route: p.route?.map((point) => [point[0], point[1]] as const) ?? null,
    battery: p.battery,
    source: p.source,
    status: p.status,
  };
}

/** Old fixes are removed, not retransmitted as current positions on a heartbeat. */
export function makeLivePosition(
  sample: LiveSample,
  userId: string,
  sessionId: string,
  seq: number,
  now: number,
): LivePosition {
  const fix = sample.fix;
  const fresh =
    fix &&
    point(fix.position) &&
    finite(fix.accuracyM, 0, 1000) &&
    Number.isFinite(fix.timestamp) &&
    now - fix.timestamp >= 0 &&
    now - fix.timestamp <= LIVE_FIX_MAX_AGE_MS;
  const stopped = sample.status === 'stopped';
  const usable = !stopped && fresh ? fix : null;
  const packet: LivePosition = {
    v: 1,
    user_id: userId,
    session_id: sessionId,
    seq,
    ts: now,
    lon: usable?.position[0] ?? null,
    lat: usable?.position[1] ?? null,
    accuracy: usable?.accuracyM ?? null,
    fix_age_ms: usable ? now - usable.timestamp : null,
    heading:
      usable &&
      sample.headingTimestamp !== null &&
      now - sample.headingTimestamp >= 0 &&
      now - sample.headingTimestamp <= LIVE_FIX_MAX_AGE_MS &&
      nullable(sample.heading, 0, 359.999999)
        ? sample.heading
        : null,
    speed: usable
      ? Math.max(0, Math.min(100, Number.isFinite(usable.speedMps) ? usable.speedMps : 0))
      : null,
    destination_id: sample.destinationId,
    route_progress: sample.progress,
    remaining_m: sample.remainingM,
    route:
      !stopped &&
      sample.route &&
      sample.route.length >= 2 &&
      sample.route.length <= LIVE_ROUTE_LIMIT &&
      sample.route.every(point)
        ? sample.route
        : null,
    battery: nullable(sample.battery, 0, 100) ? sample.battery : null,
    source: sample.source,
    status: stopped
      ? 'stopped'
      : !usable
        ? fix
          ? 'weak-gps'
          : 'waiting-gps'
        : usable.accuracyM > 15
          ? 'weak-gps'
          : sample.status,
  };
  return packet;
}

export interface LiveUser {
  key: string;
  userId: string;
  sessionId: string;
  name: string;
  online: boolean;
  receivedAt: number;
  packet: LivePosition | null;
  sequence: number;
  closed: boolean;
  trail: LonLat[];
}

export function freshPosition(user: LiveUser, now: number): LonLat | null {
  const p = user.packet;
  return user.online &&
    p &&
    p.lon !== null &&
    p.lat !== null &&
    p.fix_age_ms !== null &&
    now >= user.receivedAt &&
    now - user.receivedAt + p.fix_age_ms <= LIVE_FIX_MAX_AGE_MS
    ? [p.lon, p.lat]
    : null;
}

/** Volatile session state only. Leave/stop clears coordinates; no history is persisted. */
export class LiveUserStore {
  private users = new Map<string, LiveUser>();
  private present = new Map<string, ReadonlySet<string>>();
  constructor(private changed: () => void) {}
  receive(userId: string, name: string, raw: unknown, now = Date.now()) {
    let p = parseLivePosition(raw, userId);
    if (!p || Math.abs(now - p.ts) > 10_000) return;
    if (p.fix_age_ms !== null) {
      const age = p.fix_age_ms + Math.max(0, now - p.ts);
      p =
        age <= LIVE_FIX_MAX_AGE_MS
          ? { ...p, fix_age_ms: age }
          : {
              ...p,
              lon: null,
              lat: null,
              accuracy: null,
              fix_age_ms: null,
              heading: null,
              speed: null,
              status: 'weak-gps',
            };
    }
    const key = `${userId}:${p.session_id}`,
      old = this.users.get(key);
    if (old?.closed || p.seq <= (old?.sequence ?? 0)) return;
    const stopped = p.status === 'stopped';
    const position: LonLat | null = p.lon !== null && p.lat !== null ? [p.lon, p.lat] : null;
    const trail =
      stopped || !position || p.accuracy === null || p.accuracy > 15
        ? []
        : [...(old?.trail ?? []), position].slice(-120);
    this.users.set(key, {
      key,
      userId,
      sessionId: p.session_id,
      name,
      online: !stopped && this.present.get(userId)?.has(p.session_id) === true,
      receivedAt: now,
      packet: stopped ? null : p,
      sequence: p.seq,
      closed: stopped,
      trail,
    });
    this.prune(now);
    this.changed();
  }
  presence(userId: string, name: string, sessions: readonly string[], now = Date.now()) {
    const live = new Set(sessions.filter(isUuid));
    this.present.set(userId, live);
    for (const [key, user] of this.users)
      if (user.userId === userId && !live.has(user.sessionId))
        this.users.set(key, { ...user, online: false, packet: null, trail: [] });
    for (const sessionId of live) {
      const key = `${userId}:${sessionId}`,
        old = this.users.get(key);
      if (!old)
        this.users.set(key, {
          key,
          userId,
          sessionId,
          name,
          online: true,
          receivedAt: 0,
          packet: null,
          sequence: 0,
          closed: false,
          trail: [],
        });
      else if (!old.closed) this.users.set(key, { ...old, online: true });
    }
    this.prune(now);
    this.changed();
  }
  disconnect(userId?: string) {
    if (userId) this.present.delete(userId);
    else this.present.clear();
    for (const [key, user] of this.users)
      if (!userId || user.userId === userId)
        this.users.set(key, { ...user, online: false, packet: null, trail: [] });
    this.changed();
  }
  removeUser(userId: string) {
    this.present.delete(userId);
    for (const [key, user] of this.users) if (user.userId === userId) this.users.delete(key);
    this.changed();
  }
  clear() {
    this.present.clear();
    this.users.clear();
    this.changed();
  }
  values(now = Date.now()): LiveUser[] {
    this.prune(now);
    return [...this.users.values()]
      .map((user) => (freshPosition(user, now) ? user : { ...user, trail: [] }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  }
  private prune(now: number) {
    for (const [key, user] of this.users)
      if (!user.online && now - user.receivedAt > LIVE_FORGET_MS) this.users.delete(key);
    if (this.users.size > 256)
      for (const user of [...this.users.values()]
        .sort((a, b) => a.receivedAt - b.receivedAt)
        .slice(0, this.users.size - 256))
        this.users.delete(user.key);
  }
}
