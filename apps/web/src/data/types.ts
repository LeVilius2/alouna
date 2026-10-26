import type { CategoryRule, MapFeature } from '@alouna/core';

export interface Profile {
  id: string;
  display_name: string;
  role: 'admin' | 'walker';
  active: boolean;
}
export type EditorStatus =
  'approved' | 'pending-new' | 'pending-edit' | 'pending-delete' | 'deleted';

export interface EditorFeatureItem {
  feature: MapFeature;
  published: MapFeature | null;
  status: EditorStatus;
  created_by_name: string;
  own: boolean;
}

export interface Snapshot {
  version: string;
  features: MapFeature[];
  rules: CategoryRule[];
  fetchedAt: number;
  editorFeatures?: EditorFeatureItem[];
}
export type FeaturePayload = {
  name: string;
  category: string;
  geometry: MapFeature['geometry'];
  width_m?: number | null;
  radius_m?: number | null;
  is_destination?: boolean;
  spoken_name?: string;
  notes?: string;
  source?: 'drawn' | 'gps' | 'import';
  enabled?: boolean;
  owner_label?: string;
  reviewed?: boolean;
  gps_accuracy_m?: number | null;
};
export interface Mutation {
  operationId: string;
  entityId: string;
  expectedRevision: number;
  kind: 'save-feature' | 'delete-feature' | 'save-rule';
  payload: FeaturePayload | CategoryRule | null;
  status: 'pending' | 'conflict' | 'denied' | 'invalid-data';
}
export type DataError = 'offline' | 'conflict' | 'denied' | 'invalid-data' | null;
export interface LocalData {
  snapshot: Snapshot | null;
  profile: Profile | null;
  queue: Mutation[];
  error: DataError;
}
export interface DataBackend {
  load(userId: string): Promise<{ snapshot: Snapshot; profile: Profile }>;
  mutate(userId: string, mutation: Mutation): Promise<unknown>;
}
export interface DataStorage {
  read(): Promise<LocalData>;
  update(change: (current: LocalData) => LocalData): Promise<LocalData>;
  clear(): Promise<void>;
}
export const emptyData = (): LocalData => ({
  snapshot: null,
  profile: null,
  queue: [],
  error: null,
});
export class BackendError extends Error {
  constructor(readonly code: Exclude<DataError, null>) {
    super(code);
  }
}
