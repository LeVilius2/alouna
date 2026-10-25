import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FeatureStore } from './featureStore';
import { createBackend, createSupabase } from './supabase';
import { createDataStorage } from './storage';
import { lastAccount } from './authCache';
import { createTileCache } from './tileCache';
import { DataContext } from './context';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const configured = !!url && !!key;
let client: ReturnType<typeof createSupabase> | null = null;
try {
  if (configured) client = createSupabase(url!, key!);
} catch {
  /* UI fails closed on invalid public config. */
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null),
    [offline, setOffline] = useState(!navigator.onLine);
  const store = useMemo(
    () =>
      userId && client && url
        ? new FeatureStore(userId, createDataStorage(url, userId), createBackend(client))
        : null,
    [userId],
  );
  useEffect(() => {
    if (!client || !url) return;
    let live = true;
    const { data: subscription } = client.auth.onAuthStateChange((event, session) => {
      if (!live) return;
      if (!session && event === 'INITIAL_SESSION' && !navigator.onLine) return;
      setUserId(session?.user.id ?? null);
      // Keep async work outside the auth callback to avoid Supabase lock deadlocks.
      if (session) void lastAccount.write(url, session.user.id);
    });
    const restore = async () => {
      if (!navigator.onLine) {
        const previous = await lastAccount.read(url);
        if (live && previous) setUserId(previous);
      } else {
        const { data } = await client!.auth.getSession();
        if (live) setUserId(data.session?.user.id ?? null);
      }
    };
    void restore();
    return () => {
      live = false;
      subscription.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    const online = () => setOffline(false),
      offline = () => setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);
  useEffect(() => {
    if (!store) return;
    let live = true;
    void store.open().then(() => {
      if (live && navigator.onLine) void store.sync();
    });
    const online = () => {
      void store.sync();
    };
    window.addEventListener('online', online);
    return () => {
      live = false;
      window.removeEventListener('online', online);
    };
  }, [store]);
  const signOut = async () => {
    if (store) await store.clear();
    if (store && url) await createTileCache(`${url}:${store.userId}`).clear();
    if (url) await lastAccount.clear(url);
    await client?.auth.signOut({ scope: 'local' });
    setUserId(null);
  };
  return (
    <DataContext value={{ configured: configured && !!client, client, store, offline, signOut }}>
      {children}
    </DataContext>
  );
}
