import { createContext, useContext } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeatureStore } from './featureStore';

interface DataContextValue {
  configured: boolean;
  client: SupabaseClient | null;
  store: FeatureStore | null;
  offline: boolean;
  signOut: () => Promise<void>;
}
export const DataContext = createContext<DataContextValue>({
  configured: false,
  client: null,
  store: null,
  offline: false,
  signOut: async () => {},
});
export const useData = () => useContext(DataContext);
