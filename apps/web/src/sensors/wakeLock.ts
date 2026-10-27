import type { Haptics } from './types';

export interface WakeLockSession {
  readonly isSupported: boolean;
  readonly isActive: boolean;
  acquire(): Promise<boolean>;
  release(): Promise<void>;
}

/**
 * Keeps the screen awake during navigation (iOS 16.4+ / Android Chrome) and
 * re-acquires the lock when returning to the foreground (`visibilitychange`).
 * Also notifies `onBackgroundReturn` when the page becomes visible again after
 * having been hidden so the navigator can announce "Navigation paused" and re-plan.
 */
export function createWakeLockManager(onBackgroundReturn?: () => void): WakeLockSession {
  let sentinel: WakeLockSentinel | null = null;
  let wanted = false;
  let wasHiddenWhileWanted = false;

  const isSupported =
    typeof navigator !== 'undefined' &&
    'wakeLock' in navigator &&
    typeof navigator.wakeLock?.request === 'function';

  const requestLock = async (): Promise<boolean> => {
    if (!isSupported) return false;
    try {
      // Lock portrait orientation if the browser supports screen.orientation.lock
      const orientation = (typeof screen !== 'undefined' ? screen.orientation : undefined) as
        (ScreenOrientation & { lock?: (mode: string) => Promise<void> }) | undefined;
      if (orientation && typeof orientation.lock === 'function') {
        void orientation.lock('portrait').catch(() => {});
      }
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener?.('release', () => {
        sentinel = null;
      });
      return true;
    } catch {
      sentinel = null;
      return false;
    }
  };

  const onVisibilityChange = () => {
    if (!wanted || typeof document === 'undefined') return;
    if (document.hidden) {
      wasHiddenWhileWanted = true;
    } else {
      if (wasHiddenWhileWanted) {
        wasHiddenWhileWanted = false;
        onBackgroundReturn?.();
      }
      void requestLock();
    }
  };

  return {
    get isSupported() {
      return isSupported;
    },
    get isActive() {
      return sentinel !== null && !sentinel.released;
    },
    async acquire() {
      if (!wanted && typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibilityChange);
      }
      wanted = true;
      wasHiddenWhileWanted = false;
      return requestLock();
    },
    async release() {
      wanted = false;
      wasHiddenWhileWanted = false;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      if (sentinel) {
        try {
          await sentinel.release();
        } catch {
          /* ignore */
        }
        sentinel = null;
      }
    },
  };
}

export class BrowserHaptics implements Haptics {
  private iosHapticSwitchEnabled = false;
  private switchInput: HTMLInputElement | null = null;
  private switchLabel: HTMLLabelElement | null = null;

  constructor(options: { iosHapticSwitchEnabled?: boolean } = {}) {
    this.iosHapticSwitchEnabled = options.iosHapticSwitchEnabled ?? false;
  }

  setIosHapticSwitchEnabled(enabled: boolean): void {
    this.iosHapticSwitchEnabled = enabled;
  }

  private triggerIosSwitchTick(): void {
    if (typeof document === 'undefined' || !this.iosHapticSwitchEnabled) return;
    try {
      if (!this.switchInput || !this.switchLabel) {
        const label = document.createElement('label');
        label.setAttribute('aria-hidden', 'true');
        label.style.position = 'fixed';
        label.style.opacity = '0';
        label.style.pointerEvents = 'none';
        label.style.width = '1px';
        label.style.height = '1px';
        label.style.left = '-9999px';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.setAttribute('switch', '');
        label.appendChild(input);
        document.body.appendChild(label);
        this.switchInput = input;
        this.switchLabel = label;
      }
      this.switchLabel.click();
    } catch {
      /* graceful no-op */
    }
  }

  pulse(kind: 'aligned' | 'hazard' | 'arrived'): void {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        if (kind === 'aligned') navigator.vibrate(25);
        else if (kind === 'hazard') navigator.vibrate([90, 50, 90]);
        else navigator.vibrate([60, 40, 120]);
        return;
      } catch {
        /* fallback */
      }
    }
    this.triggerIosSwitchTick();
  }
}

export async function readBatteryPercent(): Promise<number | null> {
  if (typeof navigator === 'undefined' || !('getBattery' in navigator)) return null;
  try {
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<{ level?: number }> })
      .getBattery;
    if (typeof getBattery !== 'function') return null;
    const battery = await getBattery.call(navigator);
    if (typeof battery?.level === 'number' && Number.isFinite(battery.level)) {
      return Math.round(battery.level * 100);
    }
    return null;
  } catch {
    return null;
  }
}
