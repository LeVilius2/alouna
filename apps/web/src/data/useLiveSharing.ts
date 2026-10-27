import { useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLiveTransport, LivePublisher, type LiveConnectionStatus } from './realtime';
import type { LiveSample } from './livePosition';

export function useLiveSharing(
  client: SupabaseClient | null,
  userId: string | null,
  enabled: boolean,
  sample: LiveSample,
) {
  const latest = useRef(sample);
  useEffect(() => {
    latest.current = sample;
  }, [sample]);
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden');
  const [connection, setConnection] = useState<{
    scope: object;
    status: LiveConnectionStatus;
  } | null>(null);
  const scope = useMemo(
    () => ({ client, userId, enabled, visible }),
    [client, userId, enabled, visible],
  );
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  useEffect(() => {
    if (!client || !userId || !enabled || !visible) return;
    let active = true;
    const publisher = new LivePublisher(
      createLiveTransport(client),
      userId,
      () => latest.current,
      (status) => {
        if (active) setConnection({ scope, status });
      },
    );
    publisher.start();
    return () => {
      active = false;
      void publisher.close();
    };
  }, [client, userId, enabled, visible, scope]);
  return !enabled
    ? 'off'
    : !visible
      ? 'background'
      : !client
        ? 'error'
        : connection?.scope === scope
          ? connection.status
          : 'connecting';
}
