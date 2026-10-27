import type { LonLat } from '@alouna/core';

export interface LocationFix {
  position: LonLat;
  accuracyM: number;
  timestamp: number;
  speedMps: number;
  courseDegrees?: number | null;
}
export interface HeadingFix {
  degrees: number;
  timestamp: number;
}
export interface LocationProvider {
  subscribe(listener: (fix: LocationFix) => void): () => void;
}
export interface HeadingProvider {
  subscribe(listener: (fix: HeadingFix) => void): () => void;
  requestPermission?: () => Promise<boolean>;
}
export interface Haptics {
  pulse(kind: 'aligned' | 'hazard' | 'arrived'): void;
}
