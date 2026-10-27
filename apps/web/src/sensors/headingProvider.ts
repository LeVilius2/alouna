import {
  compensateCompassHeading,
  smoothCircularDegrees,
  type CircularSmoothingState,
} from '@alouna/core';
import type { HeadingFix, HeadingProvider } from './types';

export interface BrowserHeadingProviderOptions {
  /** Magnetic declination in degrees (+8° in Lithuania). */
  declinationDegrees?: number;
  /** Smoothing factor in (0, 1] (default 0.25). */
  smoothingAlpha?: number;
}

type OrientationEventWithWebkit = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

type DeviceOrientationConstructorWithPermission = {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
};

export async function requestCompassPermission(): Promise<boolean> {
  if (typeof globalThis === 'undefined' || !('DeviceOrientationEvent' in globalThis)) {
    return true;
  }
  const ctor = (
    globalThis as unknown as { DeviceOrientationEvent: DeviceOrientationConstructorWithPermission }
  ).DeviceOrientationEvent;
  if (typeof ctor?.requestPermission === 'function') {
    try {
      const state = await ctor.requestPermission();
      return state === 'granted';
    } catch {
      return false;
    }
  }
  return true;
}

function getScreenOrientationAngle(): number {
  if (
    typeof screen !== 'undefined' &&
    screen.orientation &&
    Number.isFinite(screen.orientation.angle)
  ) {
    return screen.orientation.angle;
  }
  return 0;
}

/**
 * Extracts raw compass heading from a DeviceOrientationEvent:
 * - iOS Safari: `webkitCompassHeading` (clockwise degrees from north; 0..360)
 * - Android Chrome (`deviceorientationabsolute` or `deviceorientation` with `absolute === true`):
 *   `360 - alpha` (clockwise degrees from north; 0..360).
 * Plain relative `deviceorientation` without `webkitCompassHeading` or `absolute === true` is ignored
 * because its alpha is relative to an arbitrary initial device yaw, not north.
 */
export function extractCompassHeadingFromEvent(
  event: OrientationEventWithWebkit,
  eventType: 'deviceorientationabsolute' | 'deviceorientation',
): { rawDegrees: number; isMagnetic: boolean } | null {
  if (
    typeof event.webkitCompassHeading === 'number' &&
    Number.isFinite(event.webkitCompassHeading) &&
    event.webkitCompassHeading >= 0
  ) {
    if (typeof event.webkitCompassAccuracy === 'number' && event.webkitCompassAccuracy < 0) {
      return null;
    }
    return {
      rawDegrees: event.webkitCompassHeading,
      // iOS webkitCompassHeading is magnetic north unless location calibration overrides it;
      // allow user-configurable declination.
      isMagnetic: true,
    };
  }
  if (
    (eventType === 'deviceorientationabsolute' || event.absolute === true) &&
    typeof event.alpha === 'number' &&
    Number.isFinite(event.alpha)
  ) {
    return {
      rawDegrees: (360 - event.alpha) % 360,
      isMagnetic: true,
    };
  }
  return null;
}

export class BrowserHeadingProvider implements HeadingProvider {
  private declinationDegrees: number;
  private readonly smoothingAlpha: number;

  constructor(options: BrowserHeadingProviderOptions = {}) {
    this.declinationDegrees = options.declinationDegrees ?? 8;
    this.smoothingAlpha = options.smoothingAlpha ?? 0.25;
  }

  setDeclinationDegrees(degrees: number): void {
    if (Number.isFinite(degrees)) this.declinationDegrees = degrees;
  }

  async requestPermission(): Promise<boolean> {
    return requestCompassPermission();
  }

  subscribe(listener: (fix: HeadingFix) => void): () => void {
    if (typeof window === 'undefined') return () => {};
    let smoothing: CircularSmoothingState | null = null;
    let hasAbsoluteEvent = false;

    const handle = (event: Event, type: 'deviceorientationabsolute' | 'deviceorientation') => {
      if (type === 'deviceorientationabsolute') hasAbsoluteEvent = true;
      if (type === 'deviceorientation' && hasAbsoluteEvent) return;
      const extracted = extractCompassHeadingFromEvent(event as OrientationEventWithWebkit, type);
      if (!extracted) return;
      const compensated = compensateCompassHeading(extracted.rawDegrees, {
        screenOrientationAngle: getScreenOrientationAngle(),
        declinationDegrees: this.declinationDegrees,
        applyDeclination: extracted.isMagnetic,
      });
      const smoothed = smoothCircularDegrees(smoothing, compensated, this.smoothingAlpha);
      smoothing = smoothed.state;
      listener({
        degrees: smoothed.degrees,
        timestamp: Date.now(),
      });
    };

    const onAbsolute = (e: Event) => handle(e, 'deviceorientationabsolute');
    const onStandard = (e: Event) => handle(e, 'deviceorientation');

    window.addEventListener('deviceorientationabsolute', onAbsolute as EventListener, true);
    window.addEventListener('deviceorientation', onStandard as EventListener, true);

    return () => {
      window.removeEventListener('deviceorientationabsolute', onAbsolute as EventListener, true);
      window.removeEventListener('deviceorientation', onStandard as EventListener, true);
    };
  }
}
