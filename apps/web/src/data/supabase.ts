import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseProfile, parseSnapshot } from './validation';
import { BackendError, type DataBackend } from './types';

export function createSupabase(url: string, anonKey: string): SupabaseClient {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' &&
    parsed.hostname !== 'localhost' &&
    parsed.hostname !== '127.0.0.1'
  )
    throw new Error('Supabase requires HTTPS.');
  // The deployment may use either a legacy anon JWT or the newer publishable key.
  if (anonKey.startsWith('sb_secret_'))
    throw new Error('A server key cannot be used in the browser.');
  if (anonKey.split('.').length === 3) {
    const raw = anonKey.split('.')[1]!;
    const claims = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string };
    if (claims.role !== 'anon')
      throw new Error('Only an anonymous public API key belongs in the browser.');
  } else if (!anonKey.startsWith('sb_publishable_')) throw new Error('Invalid public API key.');
  return createClient(url, anonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

function check(error: { code?: string; status?: number } | null): void {
  if (!error) return;
  if (error.code === '40001') throw new BackendError('conflict');
  if (
    error.code === '42501' ||
    error.code === 'PGRST301' ||
    error.status === 401 ||
    error.status === 403
  )
    throw new BackendError('denied');
  if (error.code?.startsWith('22') || error.code?.startsWith('23'))
    throw new BackendError('invalid-data');
  throw new BackendError('offline');
}

export function createBackend(client: SupabaseClient): DataBackend {
  return {
    async load(userId) {
      const { data: profile, error: profileError } = await client
        .from('profiles')
        .select('id,display_name,role,active')
        .eq('id', userId)
        .maybeSingle();
      check(profileError);
      const parsedProfile = parseProfile(profile, userId);
      const { data, error } = await client.rpc('routing_snapshot', { expected_actor: userId });
      check(error);
      return { profile: parsedProfile, snapshot: parseSnapshot(data) };
    },
    async mutate(userId, mutation) {
      const shared = {
        expected_actor: userId,
        operation_id: mutation.operationId,
        expected_revision: mutation.expectedRevision,
      };
      const { data, error } =
        mutation.kind === 'save-rule'
          ? await client.rpc('mutate_rule', {
              ...shared,
              rule_category: mutation.entityId,
              payload: mutation.payload,
            })
          : await client.rpc('mutate_feature', {
              ...shared,
              feature_id: mutation.entityId,
              action: mutation.kind === 'delete-feature' ? 'delete' : 'upsert',
              payload: mutation.payload ?? {},
            });
      check(error);
      if (!data) throw new BackendError('invalid-data');
      return data;
    },
  };
}
