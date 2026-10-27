import type { LonLat } from '../geo/sphere';
import type { RouteEvent } from '../routing/events';
import type { SnapNotice } from '../routing/router';
import type { CategoryRule, MapFeature } from '../rules/types';
import { sampleCarrot, type CarrotSample } from './carrot';
import {
  detectNearbyHazards,
  findNearestLandmark,
  type NearbyHazard,
  type NearestLandmarkInfo,
} from './hazards';
import { evaluateOffRoute } from './offRoute';

export interface GuidanceRouteInput {
  destinationId: string;
  destinationName: string;
  waypoints: readonly LonLat[];
  distanceM: number;
  events: readonly RouteEvent[];
  snaps: readonly SnapNotice[];
  dataVersion: string;
}

export interface GuidanceFixInput {
  position: LonLat;
  accuracyM: number;
  timestampMs: number;
  speedMps: number;
  headingDegrees: number;
}

export interface SonarCommand {
  active: boolean;
  /** Interval between pings in milliseconds (300 ms close .. 1500 ms far). */
  pingIntervalMs: number;
  /** Stereo pan in [-1, 1] (-1 = hard left, +1 = hard right). */
  pan: number;
  /** Alignment mode: 'aligned' (±10°), 'off-course' (10°..135°), or 'behind' (>135°). */
  alignment: 'aligned' | 'off-course' | 'behind';
  /** Signed turn angle in degrees (-180..+180). */
  turnAngleDegrees: number;
  /** Distance to carrot in metres. */
  distanceToCarrotM: number;
  /** Active hazard buzz (nearest hazard within warn_m), or null. */
  hazard: NearbyHazard | null;
}

export type GuidanceSpeechCue =
  | { kind: 'start'; destinationName: string; distanceM: number; snapStartM: number | null }
  | { kind: 'weak-gps'; reason: 'accuracy' | 'stale'; accuracyM: number | null }
  | { kind: 'gps-restored' }
  | { kind: 'recalculating' }
  | { kind: 'turn'; direction: 'left' | 'right'; angleDegrees: number }
  | { kind: 'crossing' }
  | { kind: 'enter'; category: string; label: string }
  | { kind: 'hazard'; hazard: NearbyHazard }
  | { kind: 'arrived'; destinationName: string };

export interface GuidanceEngineOptions {
  lookaheadM?: number;
  maxAccuracyM?: number;
  maxFixAgeMs?: number;
  minOffRouteM?: number;
  offRouteSustainMs?: number;
  minArrivalRadiusM?: number;
  maxArrivalRadiusM?: number;
  eventLeadDistanceM?: number;
  hazardRepeatCooldownMs?: number;
}

export interface GuidanceStepResult {
  status: 'guiding' | 'weak-gps' | 'recalculating' | 'arrived';
  carrot: CarrotSample | null;
  sonar: SonarCommand;
  cues: GuidanceSpeechCue[];
  shouldReplan: boolean;
  hazards: NearbyHazard[];
  nearestLandmark: NearestLandmarkInfo | null;
  lastInstructionCue: GuidanceSpeechCue | null;
}

const INACTIVE_SONAR: SonarCommand = {
  active: false,
  pingIntervalMs: 1500,
  pan: 0,
  alignment: 'off-course',
  turnAngleDegrees: 0,
  distanceToCarrotM: 0,
  hazard: null,
};

export function computeSonarCommand(
  carrot: CarrotSample,
  hazards: readonly NearbyHazard[],
): SonarCommand {
  // Map distanceToCarrotM (0.5 m .. 15 m) to pingIntervalMs (300 ms .. 1500 ms)
  const clampedDist = Math.max(0.5, Math.min(15, carrot.distanceToCarrotM));
  const t = (clampedDist - 0.5) / (15 - 0.5);
  const pingIntervalMs = Math.round(300 + t * (1500 - 300));

  // Stereo pan: full left/right at ±90°
  const pan = Math.max(-1, Math.min(1, Math.sin((carrot.turnAngleDegrees * Math.PI) / 180)));
  const absAngle = Math.abs(carrot.turnAngleDegrees);
  const alignment: SonarCommand['alignment'] =
    absAngle <= 10 ? 'aligned' : absAngle > 135 ? 'behind' : 'off-course';

  return {
    active: true,
    pingIntervalMs,
    pan: Math.abs(pan) < 1e-4 ? 0 : pan,
    alignment,
    turnAngleDegrees: carrot.turnAngleDegrees,
    distanceToCarrotM: carrot.distanceToCarrotM,
    hazard: hazards[0] ?? null,
  };
}

/**
 * Pure stateful guidance engine. Evaluates GPS fixes + headings against an active
 * route and map rules, emitting deterministic sonar commands and semantic speech cues.
 */
export class GuidanceEngine {
  private readonly options: Required<GuidanceEngineOptions>;
  private readonly features: readonly MapFeature[];
  private readonly rules: readonly CategoryRule[];
  private readonly ruleMap: ReadonlyMap<string, CategoryRule>;
  private route: GuidanceRouteInput;
  private startAnnounced = false;
  private arrived = false;
  private weakGpsActive = false;
  private offRouteSinceMs: number | null = null;
  private replanningAnnounced = false;
  private announcedEventIndices = new Set<number>();
  private hazardLastSpokenMs = new Map<string, number>();
  private lastFix: GuidanceFixInput | null = null;
  private lastInstructionCue: GuidanceSpeechCue | null = null;

  constructor(
    route: GuidanceRouteInput,
    features: readonly MapFeature[],
    rules: readonly CategoryRule[],
    options: GuidanceEngineOptions = {},
  ) {
    this.route = route;
    this.features = features;
    this.rules = rules;
    this.ruleMap = new Map(rules.map((r) => [r.category, r]));
    this.options = {
      lookaheadM: options.lookaheadM ?? 5,
      maxAccuracyM: options.maxAccuracyM ?? 15,
      maxFixAgeMs: options.maxFixAgeMs ?? 5000,
      minOffRouteM: options.minOffRouteM ?? 4,
      offRouteSustainMs: options.offRouteSustainMs ?? 3000,
      minArrivalRadiusM: options.minArrivalRadiusM ?? 2,
      maxArrivalRadiusM: options.maxArrivalRadiusM ?? 6,
      eventLeadDistanceM: options.eventLeadDistanceM ?? 4,
      hazardRepeatCooldownMs: options.hazardRepeatCooldownMs ?? 12000,
    };
  }

  /** Replaces the route after an off-route recalculation without resetting hazard cooldowns. */
  setRoute(route: GuidanceRouteInput, announceStart = false): void {
    this.route = route;
    this.startAnnounced = !announceStart;
    this.arrived = false;
    this.offRouteSinceMs = null;
    this.replanningAnnounced = false;
    this.announcedEventIndices.clear();
  }

  get currentRoute(): GuidanceRouteInput {
    return this.route;
  }

  get lastInstruction(): GuidanceSpeechCue | null {
    return this.lastInstructionCue;
  }

  /**
   * Evaluates the current state at `nowMs` given the latest fix (or `null` if no fix yet).
   */
  step(fix: GuidanceFixInput | null, nowMs = fix?.timestampMs ?? Date.now()): GuidanceStepResult {
    const cues: GuidanceSpeechCue[] = [];
    if (fix) this.lastFix = fix;
    const activeFix = fix ?? this.lastFix;

    // 1. Check for missing or stale fix (> 5 s old) or poor accuracy (> 15 m).
    const isStale = !activeFix || nowMs - activeFix.timestampMs > this.options.maxFixAgeMs;
    const isInaccurate =
      !activeFix ||
      !Number.isFinite(activeFix.accuracyM) ||
      activeFix.accuracyM < 0 ||
      activeFix.accuracyM > this.options.maxAccuracyM;

    if (isStale || isInaccurate) {
      if (!this.weakGpsActive) {
        this.weakGpsActive = true;
        const cue: GuidanceSpeechCue = {
          kind: 'weak-gps',
          reason: isStale ? 'stale' : 'accuracy',
          accuracyM: activeFix && Number.isFinite(activeFix.accuracyM) ? activeFix.accuracyM : null,
        };
        cues.push(cue);
        this.lastInstructionCue = cue;
      }
      return {
        status: 'weak-gps',
        carrot: null,
        sonar: INACTIVE_SONAR,
        cues,
        shouldReplan: false,
        hazards: [],
        nearestLandmark: activeFix
          ? findNearestLandmark(
              activeFix.position,
              activeFix.headingDegrees,
              this.features,
              this.rules,
            )
          : null,
        lastInstructionCue: this.lastInstructionCue,
      };
    }

    if (this.weakGpsActive) {
      this.weakGpsActive = false;
      cues.push({ kind: 'gps-restored' });
    }

    // 2. Announce start once on first valid fix.
    if (!this.startAnnounced) {
      this.startAnnounced = true;
      const startSnap = this.route.snaps.find((s) => s.endpoint === 'start');
      const startCue: GuidanceSpeechCue = {
        kind: 'start',
        destinationName: this.route.destinationName,
        distanceM: this.route.distanceM,
        snapStartM: startSnap ? startSnap.distanceM : null,
      };
      cues.push(startCue);
      this.lastInstructionCue = startCue;
    }

    // 3. Compute carrot sample, nearby hazards, and nearest landmark.
    const carrot = sampleCarrot(
      this.route.waypoints,
      activeFix.position,
      activeFix.headingDegrees,
      this.options.lookaheadM,
    );
    const hazards = detectNearbyHazards(
      activeFix.position,
      activeFix.headingDegrees,
      this.features,
      this.rules,
    );
    const nearestLandmark = findNearestLandmark(
      activeFix.position,
      activeFix.headingDegrees,
      this.features,
      this.rules,
    );

    // 4. Check arrival (within 2 m, or accuracy radius capped at maxArrivalRadiusM).
    const effectiveArrivalRadiusM = Math.max(
      this.options.minArrivalRadiusM,
      Math.min(this.options.maxArrivalRadiusM, activeFix.accuracyM),
    );
    if (
      this.arrived ||
      carrot.distanceToDestinationM <= effectiveArrivalRadiusM ||
      carrot.distanceRemainingM <= this.options.minArrivalRadiusM
    ) {
      if (!this.arrived) {
        this.arrived = true;
        const arrivedCue: GuidanceSpeechCue = {
          kind: 'arrived',
          destinationName: this.route.destinationName,
        };
        cues.push(arrivedCue);
        this.lastInstructionCue = arrivedCue;
      }
      return {
        status: 'arrived',
        carrot,
        sonar: INACTIVE_SONAR,
        cues,
        shouldReplan: false,
        hazards,
        nearestLandmark,
        lastInstructionCue: this.lastInstructionCue,
      };
    }

    // 5. Check off-route condition.
    const offRoute = evaluateOffRoute(
      carrot.crossTrackErrorM,
      activeFix.accuracyM,
      nowMs,
      this.offRouteSinceMs,
      {
        minOffRouteM: this.options.minOffRouteM,
        sustainMs: this.options.offRouteSustainMs,
      },
    );
    this.offRouteSinceMs = offRoute.offRouteSinceMs;

    if (offRoute.shouldReplan) {
      if (!this.replanningAnnounced) {
        this.replanningAnnounced = true;
        const recalcCue: GuidanceSpeechCue = { kind: 'recalculating' };
        cues.push(recalcCue);
        this.lastInstructionCue = recalcCue;
      }
      return {
        status: 'recalculating',
        carrot,
        sonar: computeSonarCommand(carrot, hazards),
        cues,
        shouldReplan: true,
        hazards,
        nearestLandmark,
        lastInstructionCue: this.lastInstructionCue,
      };
    }
    this.replanningAnnounced = false;

    // 6. Check upcoming route events (turns, crossings, steps, entrances).
    for (let i = 0; i < this.route.events.length; i++) {
      if (this.announcedEventIndices.has(i)) continue;
      const ev = this.route.events[i]!;
      // Trigger when walker approaches within eventLeadDistanceM of event and hasn't passed it by > 3 m.
      const deltaM = ev.distanceM - carrot.distanceAlongM;
      if (deltaM <= this.options.eventLeadDistanceM && deltaM >= -3) {
        this.announcedEventIndices.add(i);
        if (ev.kind === 'turn') {
          const cue: GuidanceSpeechCue = {
            kind: 'turn',
            direction: ev.direction,
            angleDegrees: ev.angleDegrees,
          };
          cues.push(cue);
          this.lastInstructionCue = cue;
        } else if (ev.category === 'crossing') {
          const cue: GuidanceSpeechCue = { kind: 'crossing' };
          cues.push(cue);
          this.lastInstructionCue = cue;
        } else if (ev.kind === 'enter') {
          const label = this.ruleMap.get(ev.category)?.label ?? ev.category;
          const cue: GuidanceSpeechCue = {
            kind: 'enter',
            category: ev.category,
            label,
          };
          cues.push(cue);
          this.lastInstructionCue = cue;
        }
      }
    }

    // 7. Check live proximity hazards (ditch/water/road/etc. within warn_m).
    const nearestHazard = hazards[0];
    if (nearestHazard) {
      const lastSpoken = this.hazardLastSpokenMs.get(nearestHazard.featureId);
      if (lastSpoken === undefined || nowMs - lastSpoken >= this.options.hazardRepeatCooldownMs) {
        this.hazardLastSpokenMs.set(nearestHazard.featureId, nowMs);
        const hazardCue: GuidanceSpeechCue = { kind: 'hazard', hazard: nearestHazard };
        cues.push(hazardCue);
        this.lastInstructionCue = hazardCue;
      }
    }

    return {
      status: 'guiding',
      carrot,
      sonar: computeSonarCommand(carrot, hazards),
      cues,
      shouldReplan: false,
      hazards,
      nearestLandmark,
      lastInstructionCue: this.lastInstructionCue,
    };
  }
}
