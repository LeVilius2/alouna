import { distanceMeters, type LonLat, type MapFeature } from '@alouna/core';
import type { VoiceLocale } from '../audio/speech';
import { pointDestinations } from '../editor/routeState';

export interface SortedDestination {
  feature: MapFeature;
  name: string;
  spokenName: string;
  position: LonLat;
  distanceM: number | null;
}

export function sortDestinationsByDistance(
  features: readonly MapFeature[],
  currentPosition: LonLat | null,
): SortedDestination[] {
  const points = pointDestinations(features);
  const items: SortedDestination[] = points.map((feature) => {
    const coords =
      feature.geometry.type === 'Point' ? feature.geometry.coordinates : ([0, 0] as LonLat);
    const name = feature.properties.name?.trim() || feature.id;
    const spokenName = feature.properties.spoken_name?.trim() || name;
    const distanceM = currentPosition ? distanceMeters(currentPosition, coords) : null;
    return {
      feature,
      name,
      spokenName,
      position: coords,
      distanceM: distanceM !== null && Number.isFinite(distanceM) ? distanceM : null,
    };
  });
  return items.sort((a, b) => {
    if (a.distanceM !== null && b.distanceM !== null) {
      return a.distanceM - b.distanceM || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });
}

export interface NavigatorPreferences {
  voiceLocale: VoiceLocale;
  speechRate: number;
  sonarVolume: number;
  declinationDegrees: number;
  iosHapticsEnabled: boolean;
  showFieldCapture: boolean;
  lastDestinationId: string | null;
}

const STORAGE_KEY = 'alouna-navigator-prefs-v1';

export const DEFAULT_NAVIGATOR_PREFERENCES: NavigatorPreferences = {
  voiceLocale: 'en-US',
  speechRate: 1.0,
  sonarVolume: 0.75,
  declinationDegrees: 8,
  iosHapticsEnabled: false,
  showFieldCapture: true,
  lastDestinationId: null,
};

export function loadNavigatorPreferences(): NavigatorPreferences {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_NAVIGATOR_PREFERENCES };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_NAVIGATOR_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<NavigatorPreferences>;
    return {
      voiceLocale: parsed.voiceLocale === 'en-GB' ? 'en-GB' : 'en-US',
      speechRate:
        typeof parsed.speechRate === 'number' &&
        Number.isFinite(parsed.speechRate) &&
        parsed.speechRate >= 0.6 &&
        parsed.speechRate <= 1.6
          ? parsed.speechRate
          : DEFAULT_NAVIGATOR_PREFERENCES.speechRate,
      sonarVolume:
        typeof parsed.sonarVolume === 'number' &&
        Number.isFinite(parsed.sonarVolume) &&
        parsed.sonarVolume >= 0 &&
        parsed.sonarVolume <= 1
          ? parsed.sonarVolume
          : DEFAULT_NAVIGATOR_PREFERENCES.sonarVolume,
      declinationDegrees:
        typeof parsed.declinationDegrees === 'number' &&
        Number.isFinite(parsed.declinationDegrees) &&
        parsed.declinationDegrees >= -30 &&
        parsed.declinationDegrees <= 30
          ? parsed.declinationDegrees
          : DEFAULT_NAVIGATOR_PREFERENCES.declinationDegrees,
      iosHapticsEnabled: Boolean(parsed.iosHapticsEnabled),
      showFieldCapture:
        typeof parsed.showFieldCapture === 'boolean'
          ? parsed.showFieldCapture
          : DEFAULT_NAVIGATOR_PREFERENCES.showFieldCapture,
      lastDestinationId:
        typeof parsed.lastDestinationId === 'string' && parsed.lastDestinationId
          ? parsed.lastDestinationId
          : null,
    };
  } catch {
    return { ...DEFAULT_NAVIGATOR_PREFERENCES };
  }
}

export function saveNavigatorPreferences(prefs: NavigatorPreferences): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota errors */
  }
}
