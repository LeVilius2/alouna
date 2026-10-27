import { useEffect, useMemo, useState } from 'react';
import { useData } from './context';
import { createLiveTransport, type LiveChannel } from './realtime';
import { LiveUserStore, type LiveUser } from './livePosition';

export function useLiveUsers(userId: string | null, enabled: boolean) {
  const { client, offline } = useData();
  const [state, setState] = useState<{ scope: object; users: LiveUser[]; error: boolean } | null>(
    null,
  );
  const scope = useMemo(
    () => ({ client, userId, enabled, offline }),
    [client, userId, enabled, offline],
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!client || !enabled || !userId || offline) return;
    let active = true,
      error = false,
      loading = false;
    const failedChannels = new Set<string>();
    const transport = createLiveTransport(client),
      channels = new Map<string, LiveChannel>();
    const publish = () => {
      if (active) {
        const timestamp = Date.now();
        setNow(timestamp);
        setState({
          scope,
          users: users.values(timestamp),
          error: error || failedChannels.size > 0,
        });
      }
    };
    const users = new LiveUserStore(publish);
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const members = await transport.members(userId);
        if (!active) return;
        error = false;
        const ids = new Set(members.map((p) => p.id));
        for (const [id, channel] of channels)
          if (!ids.has(id)) {
            void channel.close().catch(() => {});
            channels.delete(id);
            failedChannels.delete(id);
            users.removeUser(id);
          }
        for (const member of members)
          if (!channels.has(member.id)) {
            const channel = transport.open(member.id, {
              position: (payload) => {
                if (active) users.receive(member.id, member.display_name, payload);
              },
              presence: (sessions) => {
                if (active) users.presence(member.id, member.display_name, sessions);
              },
              status: (status) => {
                if (!active) return;
                if (status !== 'connected') {
                  if (status === 'error') failedChannels.add(member.id);
                  users.disconnect(member.id);
                } else {
                  failedChannels.delete(member.id);
                  publish();
                }
              },
            });
            channels.set(member.id, channel);
          }
        publish();
      } catch {
        if (!active) return;
        error = true;
        users.clear();
        for (const channel of channels.values()) void channel.close().catch(() => {});
        channels.clear();
        publish();
      } finally {
        loading = false;
      }
    };
    void refresh();
    const refreshTimer = setInterval(() => {
      void refresh();
    }, 30_000);
    const ageTimer = setInterval(() => {
      publish();
    }, 1000);
    return () => {
      active = false;
      clearInterval(refreshTimer);
      clearInterval(ageTimer);
      for (const channel of channels.values()) void channel.close().catch(() => {});
    };
  }, [client, enabled, userId, offline, scope]);
  const users = useMemo(
    () => (state?.scope === scope && enabled && !offline ? state.users : []),
    [state, scope, enabled, offline],
  );
  return {
    users,
    now,
    error: offline || (state?.scope === scope && state.error),
    unavailable: !client,
  };
}
