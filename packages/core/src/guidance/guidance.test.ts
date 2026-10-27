import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  GuidanceEngine,
  blendCompassAndCourse,
  compensateCompassHeading,
  computeSonarCommand,
  detectNearbyHazards,
  evaluateOffRoute,
  findNearestLandmark,
  sampleCarrot,
  smoothCircularDegrees,
  type GuidanceRouteInput,
} from '../index';
import { area, feature, location, rectangle } from '../routing/test-maps';

describe('carrot pure-pursuit and stereo pan math', () => {
  const waypoints = [location(0, 0), location(0, 20), location(20, 20)];

  it('projects onto the polyline and places the carrot lookahead ahead along the route', () => {
    const sample = sampleCarrot(waypoints, location(0, 5), 0, 5);
    expect(sample.distanceAlongM).toBeCloseTo(5, 1);
    expect(sample.distanceRemainingM).toBeCloseTo(35, 1);
    expect(sample.crossTrackErrorM).toBeCloseTo(0, 2);
    expect(sample.distanceToCarrotM).toBeCloseTo(5, 1);
    expect(sample.bearingToCarrotDegrees).toBeCloseTo(0, 1);
    expect(sample.turnAngleDegrees).toBeCloseTo(0, 1);
  });

  it('smoothly turns the carrot around a 90-degree corner before reaching the vertex', () => {
    // At (0, 17), 5 m lookahead reaches 2 m along the eastbound segment -> (2, 20)
    const sample = sampleCarrot(waypoints, location(0, 17), 0, 5);
    expect(sample.turnAngleDegrees).toBeGreaterThan(25);
    expect(sample.turnAngleDegrees).toBeLessThan(45);
    const sonar = computeSonarCommand(sample, []);
    expect(sonar.pan).toBeGreaterThan(0.4);
    expect(sonar.alignment).toBe('off-course');
  });

  it('maps alignment, behind (>135 deg) whoop, left/right pan, and ping repetition rate', () => {
    const onCourse = sampleCarrot(waypoints, location(0, 2), 5, 5);
    const sonarAligned = computeSonarCommand(onCourse, []);
    expect(sonarAligned.alignment).toBe('aligned');
    expect(sonarAligned.pan).toBeLessThan(0); // Heading +5 deg, target at 0 deg -> turn left

    const facingSouth = sampleCarrot(waypoints, location(0, 2), 180, 5);
    const sonarBehind = computeSonarCommand(facingSouth, []);
    expect(sonarBehind.alignment).toBe('behind');

    const close = sampleCarrot([location(0, 0), location(0, 1)], location(0, 0.5), 0, 5);
    const far = sampleCarrot([location(0, 0), location(0, 30)], location(0, 0), 0, 15);
    expect(computeSonarCommand(close, []).pingIntervalMs).toBe(300);
    expect(computeSonarCommand(far, []).pingIntervalMs).toBe(1500);
  });
});

describe('off-route sustained threshold', () => {
  it('requires exceeding max(4 m, accuracy) for at least 3 seconds before replanning', () => {
    // 5 m off route, but GPS accuracy is 8 m -> threshold is 8 m -> not off route
    const withinAccuracy = evaluateOffRoute(5, 8, 1000, null);
    expect(withinAccuracy.isOffRouteNow).toBe(false);
    expect(withinAccuracy.shouldReplan).toBe(false);

    // 5 m off route with 2 m accuracy -> threshold is 4 m -> off route starts
    const t0 = evaluateOffRoute(5, 2, 1000, null);
    expect(t0.isOffRouteNow).toBe(true);
    expect(t0.offRouteSinceMs).toBe(1000);
    expect(t0.shouldReplan).toBe(false);

    const t2 = evaluateOffRoute(5.5, 2, 3500, t0.offRouteSinceMs);
    expect(t2.shouldReplan).toBe(false);

    const t3 = evaluateOffRoute(5.5, 2, 4000, t2.offRouteSinceMs);
    expect(t3.shouldReplan).toBe(true);

    // Returning to route resets timer
    const back = evaluateOffRoute(1.2, 2, 4500, t3.offRouteSinceMs);
    expect(back.offRouteSinceMs).toBeNull();
    expect(back.shouldReplan).toBe(false);
  });
});

describe('hazard proximity and override suppression', () => {
  const features = [
    area(40, 40),
    feature('ditch-1', 'ditch', {
      type: 'LineString',
      coordinates: [
        [500008, 6100000],
        [500008, 6100020],
      ],
    }),
    feature('road-1', 'road', rectangle(18, 0, 22, 30)),
    feature('crossing-1', 'crossing', rectangle(17, 10, 23, 14)),
    feature(
      'sauna',
      'landmark',
      { type: 'Point', coordinates: [500005, 6100012] },
      { name: 'Sauna', spoken_name: 'The sauna', is_destination: true },
    ),
  ];

  it('detects a nearby ditch with distance and relative direction (left/right/ahead/behind)', () => {
    // Walker at (5, 10) facing North (0 deg); ditch is at x=8 (3 m to the right, minus 0.5m half-width = 2.5 m)
    const hazards = detectNearbyHazards(location(5, 10), 0, features, DEFAULT_RULES);
    expect(hazards).toHaveLength(1);
    expect(hazards[0]?.category).toBe('ditch');
    expect(hazards[0]?.distanceM).toBeCloseTo(2.5, 1);
    expect(hazards[0]?.sector).toBe('right');
  });

  it('suppresses road hazard buzz when the walker is on an overriding road crossing', () => {
    // At (16, 25), away from crossing, road is 2 m to the right -> road hazard reported
    const nearRoad = detectNearbyHazards(location(16, 25), 0, features, DEFAULT_RULES);
    expect(nearRoad.map((h) => h.category)).toContain('road');

    // At (19, 12), inside the crossing -> road hazard is suppressed
    const onCrossing = detectNearbyHazards(location(19, 12), 90, features, DEFAULT_RULES);
    expect(onCrossing.map((h) => h.category)).not.toContain('road');
  });

  it('finds the nearest landmark with spoken name and relative sector', () => {
    const info = findNearestLandmark(location(5, 8), 0, features, DEFAULT_RULES);
    expect(info?.spokenName).toBe('The sauna');
    expect(info?.distanceM).toBeCloseTo(3, 0); // point has 1 m physical radius
    expect(info?.sector).toBe('ahead');
  });
});

describe('circular heading filter, declination, and GPS course blending', () => {
  it('averages across the 359° / 1° north wrap-around without jumping through 180°', () => {
    const first = smoothCircularDegrees(null, 358, 0.5);
    const second = smoothCircularDegrees(first.state, 2, 0.5);
    expect(second.degrees === 0 || second.degrees > 358 || second.degrees < 2).toBe(true);
  });

  it('compensates for screen orientation and magnetic declination', () => {
    expect(
      compensateCompassHeading(355, {
        screenOrientationAngle: 0,
        declinationDegrees: 8,
        applyDeclination: true,
      }),
    ).toBeCloseTo(3, 5);
  });

  it('blends GPS course over ground only when walking >= 0.7 m/s with good accuracy', () => {
    // Slow walk -> ignore GPS course
    expect(blendCompassAndCourse(10, 50, 0.3, 4)).toBeCloseTo(10, 5);
    // Poor accuracy -> ignore GPS course
    expect(blendCompassAndCourse(10, 50, 1.4, 18)).toBeCloseTo(10, 5);
    // Fast walk + accurate fix -> blends toward GPS course
    const blended = blendCompassAndCourse(10, 30, 1.4, 4, { courseWeight: 0.5 });
    expect(blended).toBeCloseTo(20, 1);
  });
});

describe('GuidanceEngine end-to-end state machine', () => {
  const features = [
    area(40, 40),
    feature('ditch-1', 'ditch', {
      type: 'LineString',
      coordinates: [
        [500008, 6100008],
        [500008, 6100016],
      ],
    }),
    feature(
      'sauna',
      'landmark',
      { type: 'Point', coordinates: [500005, 6100025] },
      { name: 'Sauna', is_destination: true },
    ),
  ];

  const route: GuidanceRouteInput = {
    destinationId: 'sauna',
    destinationName: 'Sauna',
    waypoints: [location(5, 2), location(5, 15), location(5, 25)],
    distanceM: 23,
    events: [
      {
        kind: 'enter',
        category: 'crossing',
        featureId: 'cross-1',
        distanceM: 10,
        waypointIndex: 1,
        position: location(5, 12),
      },
      {
        kind: 'turn',
        direction: 'left',
        angleDegrees: 65,
        distanceM: 15,
        waypointIndex: 1,
        position: location(5, 17),
      },
    ],
    snaps: [{ endpoint: 'start', from: location(4, 2), to: location(5, 2), distanceM: 1 }],
    dataVersion: 'v1',
  };

  it('announces start, pauses on weak or stale GPS, triggers events/hazards, replans off-route, and arrives', () => {
    const engine = new GuidanceEngine(route, features, DEFAULT_RULES);

    // 1. First valid fix -> announces start (with snap notice)
    const s1 = engine.step(
      {
        position: location(5, 2),
        accuracyM: 3,
        timestampMs: 1000,
        speedMps: 1.2,
        headingDegrees: 0,
      },
      1000,
    );
    expect(s1.status).toBe('guiding');
    expect(s1.sonar.active).toBe(true);
    expect(s1.cues[0]).toEqual({
      kind: 'start',
      destinationName: 'Sauna',
      distanceM: 23,
      snapStartM: 1,
    });

    // 2. Weak GPS (> 15 m accuracy) -> pauses sonar and emits weak-gps cue once
    const sWeak = engine.step(
      {
        position: location(5, 3),
        accuracyM: 22,
        timestampMs: 2000,
        speedMps: 1,
        headingDegrees: 0,
      },
      2000,
    );
    expect(sWeak.status).toBe('weak-gps');
    expect(sWeak.sonar.active).toBe(false);
    expect(sWeak.cues).toEqual([{ kind: 'weak-gps', reason: 'accuracy', accuracyM: 22 }]);

    // 3. Stale fix (> 5 s without update) -> remains weak-gps without spamming duplicate cues
    const sStale = engine.step(null, 8000);
    expect(sStale.status).toBe('weak-gps');
    expect(sStale.cues).toEqual([]);

    // 4. Good fix near crossing & ditch (at y=9, 7 m along route, 3 m before crossing at 10 m, 2.5 m from ditch)
    const sRestore = engine.step(
      {
        position: location(5, 9),
        accuracyM: 3,
        timestampMs: 9000,
        speedMps: 1.2,
        headingDegrees: 0,
      },
      9000,
    );
    expect(sRestore.status).toBe('guiding');
    expect(sRestore.cues.map((c) => c.kind)).toEqual(['gps-restored', 'crossing', 'hazard']);
    expect(sRestore.sonar.hazard?.category).toBe('ditch');

    // 5. Off-route for > 3 seconds -> requests replan
    engine.step(
      {
        position: location(15, 9),
        accuracyM: 3,
        timestampMs: 10000,
        speedMps: 1.2,
        headingDegrees: 90,
      },
      10000,
    );
    const sOffRoute = engine.step(
      {
        position: location(15, 9),
        accuracyM: 3,
        timestampMs: 13500,
        speedMps: 1.2,
        headingDegrees: 90,
      },
      13500,
    );
    expect(sOffRoute.status).toBe('recalculating');
    expect(sOffRoute.shouldReplan).toBe(true);
    expect(sOffRoute.cues).toEqual([{ kind: 'recalculating' }]);

    // 6. Arrive at destination (5, 24.5)
    const sArrived = engine.step(
      {
        position: location(5, 24.5),
        accuracyM: 2,
        timestampMs: 20000,
        speedMps: 0.8,
        headingDegrees: 0,
      },
      20000,
    );
    expect(sArrived.status).toBe('arrived');
    expect(sArrived.sonar.active).toBe(false);
    expect(sArrived.cues).toEqual([{ kind: 'arrived', destinationName: 'Sauna' }]);
  });
});
