import { normalizeDegrees, signedAngleDiff } from '../geo/sphere';

export interface CircularSmoothingState {
  sin: number;
  cos: number;
}

/**
 * Updates a circular exponential moving average of an angle in degrees (0..360).
 * Averaging sin and cos avoids wrap-around glitches at 359° <-> 0°.
 */
export function smoothCircularDegrees(
  previous: CircularSmoothingState | null,
  rawDegrees: number,
  alpha = 0.25,
): { degrees: number; state: CircularSmoothingState } {
  if (!Number.isFinite(rawDegrees)) throw new RangeError('Heading degrees must be finite.');
  const clampedAlpha = Math.max(0.01, Math.min(1, alpha));
  const rad = (normalizeDegrees(rawDegrees) * Math.PI) / 180;
  const sin = Math.sin(rad),
    cos = Math.cos(rad);
  if (!previous) {
    return {
      degrees: normalizeDegrees(rawDegrees),
      state: { sin, cos },
    };
  }
  const nextSin = previous.sin * (1 - clampedAlpha) + sin * clampedAlpha;
  const nextCos = previous.cos * (1 - clampedAlpha) + cos * clampedAlpha;
  const norm = Math.hypot(nextSin, nextCos);
  const safeSin = norm > 1e-6 ? nextSin / norm : sin;
  const safeCos = norm > 1e-6 ? nextCos / norm : cos;
  return {
    degrees: normalizeDegrees((Math.atan2(safeSin, safeCos) * 180) / Math.PI),
    state: { sin: safeSin, cos: safeCos },
  };
}

/**
 * Compensates compass heading for screen orientation angle (e.g. 0, 90, 180, 270)
 * and optional magnetic declination (+8° in Lithuania when source is magnetic north).
 */
export function compensateCompassHeading(
  rawCompassDegrees: number,
  options: {
    screenOrientationAngle?: number;
    declinationDegrees?: number;
    applyDeclination?: boolean;
  } = {},
): number {
  const screenAngle = Number.isFinite(options.screenOrientationAngle)
    ? options.screenOrientationAngle!
    : 0;
  const declination =
    options.applyDeclination && Number.isFinite(options.declinationDegrees)
      ? options.declinationDegrees!
      : 0;
  return normalizeDegrees(rawCompassDegrees + screenAngle + declination);
}

/**
 * When walking faster than `minSpeedMps` (default 0.7 m/s) with good GPS accuracy
 * (`<= maxAccuracyM`, default 12 m) and a valid GPS course (`coords.heading`),
 * blends the GPS course over ground into the compass heading.
 */
export function blendCompassAndCourse(
  compassDegrees: number,
  gpsCourseDegrees: number | null | undefined,
  speedMps: number,
  accuracyM: number,
  options: { minSpeedMps?: number; maxAccuracyM?: number; courseWeight?: number } = {},
): number {
  const minSpeed = options.minSpeedMps ?? 0.7;
  const maxAccuracy = options.maxAccuracyM ?? 12;
  const weight = Math.max(0, Math.min(1, options.courseWeight ?? 0.35));
  if (
    gpsCourseDegrees === null ||
    gpsCourseDegrees === undefined ||
    !Number.isFinite(gpsCourseDegrees) ||
    gpsCourseDegrees < 0 ||
    !Number.isFinite(speedMps) ||
    speedMps < minSpeed ||
    !Number.isFinite(accuracyM) ||
    accuracyM > maxAccuracy
  ) {
    return normalizeDegrees(compassDegrees);
  }
  const diff = signedAngleDiff(compassDegrees, gpsCourseDegrees);
  return normalizeDegrees(compassDegrees + diff * weight);
}
