import type { HeadingFix, HeadingProvider, LocationFix, LocationProvider } from './types';

/** Sensor adapters for the editor now and the real guidance engine in M5. No browser sensors. */
export class SimulatedSensors {
  private locations = new Set<(fix: LocationFix) => void>();
  private headings = new Set<(fix: HeadingFix) => void>();
  readonly location: LocationProvider = {
    subscribe: (listener) => {
      this.locations.add(listener);
      return () => {
        this.locations.delete(listener);
      };
    },
  };
  readonly heading: HeadingProvider = {
    subscribe: (listener) => {
      this.headings.add(listener);
      return () => {
        this.headings.delete(listener);
      };
    },
  };
  emit(location: LocationFix, heading: HeadingFix) {
    for (const listener of this.locations) listener(location);
    for (const listener of this.headings) listener(heading);
  }
}
