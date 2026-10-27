import type { GuidanceSpeechCue, NearestLandmarkInfo } from '@alouna/core';
import { strings } from '../strings';

export function formatSpeechCue(cue: GuidanceSpeechCue): string {
  const s = strings.navigator.spoken;
  switch (cue.kind) {
    case 'start':
      return s.start(cue.destinationName, cue.distanceM, cue.snapStartM);
    case 'weak-gps':
      return s.weakGps;
    case 'gps-restored':
      return s.gpsRestored;
    case 'recalculating':
      return s.recalculating;
    case 'turn':
      return s.turn(cue.direction, cue.angleDegrees);
    case 'crossing':
      return s.crossing;
    case 'enter':
      if (cue.category === 'steps') return s.steps;
      if (cue.category === 'caution') return s.caution;
      return s.enter(cue.label);
    case 'hazard':
      return s.hazard(cue.hazard.spokenName, cue.hazard.distanceM, cue.hazard.sector);
    case 'arrived':
      return s.arrived(cue.destinationName);
  }
}

export function formatWhereAmISpeech(
  landmark: NearestLandmarkInfo | null,
  remainingM: number | null,
  accuracyM: number | null,
): string {
  const s = strings.navigator.spoken;
  const landmarkText = landmark
    ? s.nearestLandmark(landmark.spokenName, landmark.distanceM, landmark.sector)
    : s.noLandmark;
  return s.whereAmI(landmarkText, remainingM, accuracyM);
}
