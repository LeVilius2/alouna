import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import {
  isUuid,
  liveTopic,
  LIVE_INTERVAL_MS,
  makeLivePosition,
  type LivePosition,
  type LiveSample,
} from './livePosition';

export type LiveConnectionStatus = 'connecting' | 'connected' | 'error';
export interface LiveMember {
  id: string;
  display_name: string;
}
export interface LiveChannel {
  send(position: LivePosition): Promise<boolean>;
  track(sessionId: string, source: LiveSample['source']): Promise<boolean>;
  close(): Promise<void>;
}
export interface LiveCallbacks {
  status: (status: LiveConnectionStatus) => void;
  position: (payload: unknown) => void;
  presence: (sessionIds: string[]) => void;
}
export interface LiveTransport {
  open: (userId: string, callbacks: LiveCallbacks) => LiveChannel;
  members: (observerId: string) => Promise<LiveMember[]>;
}

// Supabase deduplicates channel objects by topic. Finish an old leave before a rapid
// opt-in/opt-out (or React StrictMode) opens the same topic again.
const topicLeases = new WeakMap<SupabaseClient, Map<string, Promise<void>>>();

/** Only private per-user topics. RLS permits self-send and administrator receive. */
export function createLiveTransport(client: SupabaseClient): LiveTransport {
  return {
    async members(observerId) {
      const { data, error } = await client
        .from('profiles')
        .select('id,display_name,role')
        .eq('active', true);
      if (
        error ||
        !Array.isArray(data) ||
        data.some((p) => !isUuid(p.id) || typeof p.display_name !== 'string') ||
        !data.some((p) => p.id === observerId && p.role === 'admin')
      )
        throw new Error('Live membership unavailable');
      return data as LiveMember[];
    },
    open(userId, callbacks) {
      if (!isUuid(userId)) throw new Error('Invalid live topic identity');
      const topic = liveTopic(userId),
        leases = topicLeases.get(client) ?? new Map<string, Promise<void>>();
      topicLeases.set(client, leases);
      const previous = leases.get(topic) ?? Promise.resolve();
      let release!: () => void;
      const finished = new Promise<void>((resolve) => {
        release = resolve;
      });
      leases.set(topic, finished);
      let ready = false,
        tracked = false,
        closed = false,
        channel: RealtimeChannel | null = null;
      const initialized = previous
        .then(() => {
          if (closed) return;
          const next = client.channel(topic, {
            config: { private: true, broadcast: { ack: true, self: false } },
          });
          channel = next;
          next.on('broadcast', { event: 'position' }, ({ payload }) => {
            if (!closed) callbacks.position(payload);
          });
          next.on('presence', { event: 'sync' }, () => {
            if (closed) return;
            callbacks.presence(
              Object.values(next.presenceState<{ session_id?: unknown }>())
                .flat()
                .map((p) => p.session_id)
                .filter(isUuid),
            );
          });
          next.subscribe((status) => {
            if (closed) return;
            ready = status === 'SUBSCRIBED';
            callbacks.status(
              ready
                ? 'connected'
                : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED'
                  ? 'error'
                  : 'connecting',
            );
          });
        })
        .catch(() => {
          if (!closed) callbacks.status('error');
        });
      return {
        send: async (position) =>
          ready &&
          !closed &&
          !!channel &&
          (await channel.send(
            { type: 'broadcast', event: 'position', payload: position },
            { timeout: 2500 },
          )) === 'ok',
        track: async (sessionId, source) => {
          if (!ready || closed || !channel) return false;
          tracked =
            (await channel.track({ session_id: sessionId, source }, { timeout: 2500 })) === 'ok';
          return tracked;
        },
        async close() {
          if (closed) return;
          closed = true;
          ready = false;
          try {
            await initialized;
            if (tracked) await channel?.untrack({ timeout: 1500 });
          } finally {
            try {
              if (channel) await client.removeChannel(channel);
            } finally {
              release();
              if (leases.get(topic) === finished) leases.delete(topic);
            }
          }
        },
      };
    },
  };
}

/** One volatile sharing session. Reconnect always reads the latest sample; no offline queue. */
export class LivePublisher {
  readonly sessionId = crypto.randomUUID();
  private channel: LiveChannel | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private ready = false;
  private presenceReady = false;
  private busy = false;
  private closed = false;
  constructor(
    private transport: LiveTransport,
    private userId: string,
    private sample: () => LiveSample,
    private status: (status: LiveConnectionStatus) => void,
  ) {}
  start() {
    this.channel = this.transport.open(this.userId, {
      status: (status) => {
        if (this.closed) return;
        this.ready = status === 'connected';
        this.presenceReady = false;
        this.status(status);
        if (this.ready) void this.flush();
      },
      position: () => {},
      presence: () => {},
    });
    this.timer = setInterval(() => {
      void this.flush();
    }, LIVE_INTERVAL_MS);
  }
  async flush() {
    if (!this.ready || this.closed || this.busy || !this.channel) return;
    this.busy = true;
    try {
      if (!this.presenceReady) {
        this.presenceReady = await this.channel.track(this.sessionId, this.sample().source);
        if (!this.presenceReady || this.closed || !this.ready) {
          if (!this.closed) this.status('error');
          return;
        }
      }
      const sent = await this.channel.send(
        makeLivePosition(this.sample(), this.userId, this.sessionId, ++this.seq, Date.now()),
      );
      if (!this.closed) this.status(sent ? 'connected' : 'error');
    } catch {
      if (!this.closed) this.status('error');
    } finally {
      this.busy = false;
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    const channel = this.channel;
    if (!channel) return;
    try {
      if (this.ready)
        await channel.send(
          makeLivePosition(
            { ...this.sample(), status: 'stopped', fix: null },
            this.userId,
            this.sessionId,
            ++this.seq,
            Date.now(),
          ),
        );
    } catch {
      /* Presence leave and receiver expiry also clear the position. */
    } finally {
      await channel.close().catch(() => {});
    }
  }
}
