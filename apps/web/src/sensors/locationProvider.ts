import { distanceMeters, type LonLat } from '@alouna/core';
import type { LocationFix, LocationProvider } from './types';

export interface GeolocationProviderOptions {
  enableHighAccuracy?: boolean;
  maximumAgeMs?: number;
  timeoutMs?: number;
}

export class BrowserLocationProvider implements LocationProvider {
  private readonly options: Required<GeolocationProviderOptions>;

  constructor(options: GeolocationProviderOptions = {}) {
    this.options = {
      enableHighAccuracy: options.enableHighAccuracy ?? true,
      maximumAgeMs: options.maximumAgeMs ?? 1000,
      timeoutMs: options.timeoutMs ?? 10000,
    };
  }

  subscribe(listener: (fix: LocationFix) => void): () => void {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo || typeof geo.watchPosition !== 'function') {
      return () => {};
    }
    let prevFix: { position: LonLat; timestamp: number } | null = null;
    const watchId = geo.watchPosition(
      (pos) => {
        const position: LonLat = [pos.coords.longitude, pos.coords.latitude];
        const timestamp = Number.isFinite(pos.timestamp) ? pos.timestamp : Date.now();
        const accuracyM = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : 999;
        let speedMps =
          pos.coords.speed !== null && Number.isFinite(pos.coords.speed) && pos.coords.speed >= 0
            ? pos.coords.speed
            : 0;
        if (speedMps === 0 && prevFix && timestamp > prevFix.timestamp) {
          const dt = (timestamp - prevFix.timestamp) / 1000;
          if (dt >= 0.4 && dt <= 10) {
            const d = distanceMeters(prevFix.position, position);
            if (Number.isFinite(d)) speedMps = d / dt;
          }
        }
        prevFix = { position, timestamp };
        const courseDegrees =
          pos.coords.heading !== null &&
          Number.isFinite(pos.coords.heading) &&
          pos.coords.heading >= 0
            ? pos.coords.heading
            : null;
        listener({
          position,
          accuracyM,
          timestamp,
          speedMps,
          courseDegrees,
        });
      },
      () => {
        // When geolocation errors or is denied, GuidanceEngine's 5s staleness gate triggers weak-gps.
      },
      {
        enableHighAccuracy: this.options.enableHighAccuracy,
        maximumAge: this.options.maximumAgeMs,
        timeout: this.options.timeoutMs,
      },
    );
    return () => {
      geo.clearWatch(watchId);
    };
  }
}
