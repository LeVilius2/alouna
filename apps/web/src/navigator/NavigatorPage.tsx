import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import {
  GuidanceEngine,
  blendCompassAndCourse,
  boundsOf,
  geometryPoints,
  moveWalker,
  normalizeDegrees,
  projectFeature,
  sampleWalk,
  toWgs84,
  type GuidanceSpeechCue,
  type GuidanceStepResult,
  type LonLat,
  type MapFeature,
  type RoutingResponse,
} from '@alouna/core';
import { formatSpeechCue, formatWhereAmISpeech } from '../audio/cues';
import { WebAudioSonar, type Sonar } from '../audio/sonar';
import { BrowserSpeech, type Speech } from '../audio/speech';
import { useData } from '../data/context';
import { DataPanel } from '../data/DataPanel';
import { emptyData } from '../data/types';
import { useLiveSharing } from '../data/useLiveSharing';
import { LiveSharingControl } from './LiveSharingControl';
import type { PlannerRequest } from '../editor/planner.worker';
import { pointDestinations, routingMap } from '../editor/routeState';
import { BrowserHeadingProvider } from '../sensors/headingProvider';
import { BrowserLocationProvider } from '../sensors/locationProvider';
import { SimulatedSensors } from '../sensors/simulated';
import type { HeadingFix, LocationFix } from '../sensors/types';
import { BrowserHaptics, createWakeLockManager, readBatteryPercent } from '../sensors/wakeLock';
import { strings } from '../strings';
import { NavigatorSettings } from './NavigatorSettings';
import {
  loadNavigatorPreferences,
  saveNavigatorPreferences,
  sortDestinationsByDistance,
  type NavigatorPreferences,
  type SortedDestination,
} from './settingsState';

const empty = emptyData(),
  subscribe = () => () => {},
  getEmpty = () => empty;

function defaultSimulatedStartPosition(features: readonly MapFeature[]): LonLat {
  const destinations = pointDestinations(features);
  if (destinations.length >= 2 && destinations[0]?.geometry.type === 'Point') {
    return destinations[0].geometry.coordinates;
  }
  const areas = features.filter(
    (f) => f.properties.category === 'walkable_area' && f.properties.enabled !== false,
  );
  if (areas.length > 0) {
    const projected = projectFeature(structuredClone(areas[0]!));
    const b = boundsOf(geometryPoints(projected.geometry));
    return toWgs84([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]);
  }
  if (destinations[0]?.geometry.type === 'Point') {
    return moveWalker(destinations[0].geometry.coordinates, 180, 12);
  }
  return [25.695, 55.636];
}

export function NavigatorPage({
  sonarFactory,
  speechFactory,
}: {
  sonarFactory?: () => Sonar;
  speechFactory?: () => Speech;
} = {}) {
  const { store, client, offline } = useData();
  const data = useSyncExternalStore(
    store?.subscribe ?? subscribe,
    store?.getSnapshot ?? getEmpty,
    getEmpty,
  );
  const t = strings.navigator;

  const [prefs, setPrefs] = useState<NavigatorPreferences>(() => loadNavigatorPreferences());
  const [screenMode, setScreenMode] = useState<'home' | 'settings' | 'navigating'>('home');
  const [useSimulator, setUseSimulator] = useState(false);
  const [activeDest, setActiveDest] = useState<SortedDestination | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [stepResult, setStepResult] = useState<GuidanceStepResult | null>(null);
  const [locationFix, setLocationFix] = useState<LocationFix | null>(null);
  const [headingFix, setHeadingFix] = useState<HeadingFix | null>(null);
  const [batteryPercent, setBatteryPercent] = useState<number | null>(null);
  const [sharingChoice, setSharingChoice] = useState<{ account: object; enabled: boolean } | null>(
    null,
  );

  // Simulator controls state
  const [simAutoPlaying, setSimAutoPlaying] = useState(false);
  const [, setSimWalkDistanceM] = useState(0);
  const [simWeakGps, setSimWeakGps] = useState(false);
  const [simRouteWaypoints, setSimRouteWaypoints] = useState<readonly LonLat[] | null>(null);

  const map = useMemo(() => routingMap(data, 'approved'), [data]);
  const scope = `${import.meta.env.VITE_SUPABASE_URL}:${store?.userId ?? ''}`;
  const mapKey = useMemo(
    () => (map ? JSON.stringify([scope, 'approved', map.features, map.rules]) : ''),
    [map, scope],
  );
  const hasWalkableArea = useMemo(
    () =>
      Boolean(
        map?.features.some(
          (f) => f.properties.category === 'walkable_area' && f.properties.enabled !== false,
        ),
      ),
    [map],
  );

  const hapticsRef = useRef<BrowserHaptics | null>(null);
  const sonarRef = useRef<Sonar | null>(null);
  const speechRef = useRef<Speech | null>(null);
  const headingProviderRef = useRef<BrowserHeadingProvider | null>(null);
  const simSensors = useMemo(() => new SimulatedSensors(), []);
  const workerRef = useRef<Worker | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const guidanceRef = useRef<GuidanceEngine | null>(null);
  const lastSpokenInstructionRef = useRef<string | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  // Initialize audio & speech engines once
  useEffect(() => {
    const haptics = new BrowserHaptics({ iosHapticSwitchEnabled: prefs.iosHapticsEnabled });
    hapticsRef.current = haptics;
    const sonar =
      sonarFactory?.() ??
      new WebAudioSonar({
        volume: prefs.sonarVolume,
        haptics,
      });
    const speech =
      speechFactory?.() ??
      new BrowserSpeech({
        locale: prefs.voiceLocale,
        rate: prefs.speechRate,
      });
    sonarRef.current = sonar;
    speechRef.current = speech;
    return () => {
      sonar.stop();
      speech.stop();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync user preferences to audio, speech, compass, haptics, and localStorage
  useEffect(() => {
    saveNavigatorPreferences(prefs);
    sonarRef.current?.setVolume(prefs.sonarVolume);
    speechRef.current?.setConfig({ locale: prefs.voiceLocale, rate: prefs.speechRate });
    headingProviderRef.current?.setDeclinationDegrees(prefs.declinationDegrees);
    hapticsRef.current?.setIosHapticSwitchEnabled(prefs.iosHapticsEnabled);
  }, [prefs]);

  // Seed initial simulated position when simulator toggle is turned on
  useEffect(() => {
    if (!useSimulator || !map) return;
    const startPos = defaultSimulatedStartPosition(map.features);
    const now = Date.now();
    simSensors.emit(
      { position: startPos, accuracyM: 2, timestamp: now, speedMps: 0 },
      { degrees: 0, timestamp: now },
    );
  }, [useSimulator, map, simSensors]);

  // Subscribe to either real browser sensors or simulated sensors
  useEffect(() => {
    if (!store) return;
    if (useSimulator) {
      const unLoc = simSensors.location.subscribe((fix) => setLocationFix(fix));
      const unHead = simSensors.heading.subscribe((fix) => setHeadingFix(fix));
      return () => {
        unLoc();
        unHead();
      };
    }
    const locProvider = new BrowserLocationProvider();
    const headProvider = new BrowserHeadingProvider({
      declinationDegrees: prefs.declinationDegrees,
    });
    headingProviderRef.current = headProvider;
    const unLoc = locProvider.subscribe((fix) => setLocationFix(fix));
    const unHead = headProvider.subscribe((fix) => setHeadingFix(fix));
    return () => {
      unLoc();
      unHead();
      headingProviderRef.current = null;
    };
  }, [store, useSimulator, prefs.declinationDegrees, simSensors]);

  const effectiveHeadingDegrees = useMemo(() => {
    const rawCompass = headingFix?.degrees ?? 0;
    if (!locationFix) return rawCompass;
    return blendCompassAndCourse(
      rawCompass,
      locationFix.courseDegrees,
      locationFix.speedMps,
      locationFix.accuracyM,
    );
  }, [headingFix, locationFix]);

  const shareEnabled = !!store && sharingChoice?.account === store && sharingChoice.enabled;
  useEffect(() => {
    if (!shareEnabled || screenMode !== 'navigating') return;
    let active = true;
    const read = async () => {
      const percent = await readBatteryPercent();
      if (active) setBatteryPercent(percent);
    };
    const timer = setInterval(() => {
      void read();
    }, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [shareEnabled, screenMode]);
  const sharingStatus = useLiveSharing(
    client,
    store?.userId ?? null,
    shareEnabled &&
      screenMode === 'navigating' &&
      !!map &&
      !offline &&
      data.profile?.active === true,
    {
      fix: locationFix,
      heading: headingFix ? effectiveHeadingDegrees : null,
      headingTimestamp: headingFix?.timestamp ?? null,
      destinationId: activeDest?.feature.id ?? null,
      route: !calculating && !routeError ? simRouteWaypoints : null,
      remainingM: stepResult?.carrot?.distanceRemainingM ?? null,
      progress: stepResult?.carrot
        ? stepResult.carrot.distanceAlongM /
          Math.max(0.001, stepResult.carrot.distanceAlongM + stepResult.carrot.distanceRemainingM)
        : null,
      source: useSimulator ? 'simulator' : 'gps',
      battery: batteryPercent,
      status: calculating
        ? 'recalculating'
        : routeError
          ? 'waiting-gps'
          : (stepResult?.status ?? 'waiting-gps'),
    },
  );
  const sharingControl = (
    <LiveSharingControl
      compact={screenMode === 'navigating'}
      enabled={shareEnabled}
      onChange={(enabled) => {
        if (store) setSharingChoice({ account: store, enabled });
      }}
      status={
        shareEnabled && screenMode === 'navigating' && (offline || !map) ? 'error' : sharingStatus
      }
    />
  );

  const speakCues = useCallback((cues: readonly GuidanceSpeechCue[]) => {
    for (const cue of cues) {
      if (cue.kind === 'arrived') {
        sonarRef.current?.playArrivalChime();
      }
      const text = formatSpeechCue(cue);
      lastSpokenInstructionRef.current = text;
      speechRef.current?.speak(text, { interrupt: cue.kind !== 'start' });
    }
  }, []);

  const planRoute = useCallback(
    (start: LonLat, destination: SortedDestination, isReplan: boolean) => {
      if (!map || !hasWalkableArea) return;
      if (activeRequestIdRef.current) {
        workerRef.current?.terminate();
        workerRef.current = null;
        activeRequestIdRef.current = null;
      }
      const id = crypto.randomUUID();
      activeRequestIdRef.current = id;
      setCalculating(true);
      if (!isReplan) setRouteError(null);

      try {
        const instance =
          workerRef.current ??
          new Worker(new URL('../editor/planner.worker.ts', import.meta.url), {
            type: 'module',
          });
        workerRef.current = instance;

        const onMessage = (event: MessageEvent<RoutingResponse>) => {
          if (activeRequestIdRef.current !== id || event.data.id !== id) return;
          instance.removeEventListener('message', onMessage);
          instance.removeEventListener('error', onError);
          activeRequestIdRef.current = null;
          setCalculating(false);

          if ('error' in event.data) {
            sonarRef.current?.stop();
            setRouteError(t.spoken.routeNotFound);
            speechRef.current?.speak(t.spoken.routeNotFound);
            return;
          }

          const routeRes = event.data.result;
          if (routeRes.status !== 'ok') {
            sonarRef.current?.stop();
            const msg =
              routeRes.status === 'blocked-start'
                ? t.spoken.routeBlockedStart
                : routeRes.status === 'blocked-end'
                  ? t.spoken.routeBlockedEnd
                  : t.spoken.routeNotFound;
            setRouteError(msg);
            speechRef.current?.speak(msg);
            return;
          }

          setRouteError(null);
          setSimRouteWaypoints(routeRes.waypoints);
          setSimWalkDistanceM(0);

          const routeInput = {
            destinationId: destination.feature.id,
            destinationName: destination.spokenName,
            waypoints: routeRes.waypoints,
            distanceM: routeRes.distanceM,
            events: routeRes.events,
            snaps: routeRes.snaps,
            dataVersion: routeRes.dataVersion,
          };

          if (isReplan && guidanceRef.current) {
            guidanceRef.current.setRoute(routeInput, true);
          } else {
            guidanceRef.current = new GuidanceEngine(routeInput, map.features, map.rules);
          }

          // Immediately evaluate the current fix if available
          const currentPos =
            useSimulator && routeRes.waypoints[0]
              ? routeRes.waypoints[0]
              : (locationFix?.position ?? start);
          const firstSample = sampleWalk(routeRes.waypoints, 0);
          const now = Date.now();
          const initialHeading = useSimulator
            ? firstSample.headingDegrees
            : effectiveHeadingDegrees;

          if (useSimulator) {
            simSensors.emit(
              {
                position: currentPos,
                accuracyM: simWeakGps ? 25 : 2,
                timestamp: now,
                speedMps: 1.2,
              },
              { degrees: initialHeading, timestamp: now },
            );
          } else if (guidanceRef.current) {
            const res = guidanceRef.current.step(
              {
                position: currentPos,
                accuracyM: locationFix?.accuracyM ?? 4,
                timestampMs: locationFix?.timestamp ?? now,
                speedMps: locationFix?.speedMps ?? 0,
                headingDegrees: initialHeading,
              },
              now,
            );
            setStepResult(res);
            sonarRef.current?.update(res.sonar);
            speakCues(res.cues);
          }
        };

        const onError = () => {
          if (activeRequestIdRef.current !== id) return;
          instance.removeEventListener('message', onMessage);
          instance.removeEventListener('error', onError);
          activeRequestIdRef.current = null;
          instance.terminate();
          workerRef.current = null;
          setCalculating(false);
          sonarRef.current?.stop();
          setRouteError(t.spoken.routeNotFound);
          speechRef.current?.speak(t.spoken.routeNotFound);
        };

        instance.addEventListener('message', onMessage);
        instance.addEventListener('error', onError);

        const req: PlannerRequest = {
          id,
          scope,
          mapKey,
          features: map.features,
          rules: map.rules,
          start,
          end: destination.position,
        };
        instance.postMessage(req);
      } catch {
        activeRequestIdRef.current = null;
        setCalculating(false);
        sonarRef.current?.stop();
        setRouteError(t.spoken.routeNotFound);
      }
    },
    [
      map,
      hasWalkableArea,
      scope,
      mapKey,
      t.spoken,
      useSimulator,
      locationFix,
      effectiveHeadingDegrees,
      simWeakGps,
      simSensors,
      speakCues,
    ],
  );

  // Wake lock lifecycle while navigating
  useEffect(() => {
    if (screenMode !== 'navigating') return;
    const wakeLock = createWakeLockManager(() => {
      // Returned from background -> announce "Navigation paused. Recalculating." and re-plan
      speechRef.current?.speak(t.spoken.pausedBackground);
      if (activeDest && locationFix) {
        planRoute(locationFix.position, activeDest, true);
      }
    });
    void wakeLock.acquire();
    return () => {
      void wakeLock.release();
    };
  }, [screenMode, activeDest, locationFix, planRoute, t.spoken.pausedBackground]);

  // Step the guidance engine on every sensor update + a 1-second staleness watchdog timer
  useEffect(() => {
    if (screenMode !== 'navigating' || !guidanceRef.current) return;

    const evaluate = (nowMs: number) => {
      const engine = guidanceRef.current;
      if (!engine) return;
      const fixInput = locationFix
        ? {
            position: locationFix.position,
            accuracyM: locationFix.accuracyM,
            timestampMs: locationFix.timestamp,
            speedMps: locationFix.speedMps,
            headingDegrees: effectiveHeadingDegrees,
          }
        : null;
      const res = engine.step(fixInput, nowMs);
      setStepResult(res);
      sonarRef.current?.update(res.sonar);
      if (res.cues.length > 0) {
        speakCues(res.cues);
      }
      if (res.shouldReplan && activeDest && locationFix && !calculating) {
        planRoute(locationFix.position, activeDest, true);
      }
    };

    evaluate(Date.now());
    const watchdog = setInterval(() => {
      evaluate(Date.now());
    }, 1000);
    return () => clearInterval(watchdog);
  }, [
    screenMode,
    locationFix,
    effectiveHeadingDegrees,
    activeDest,
    calculating,
    planRoute,
    speakCues,
  ]);

  // Simulator automatic playback timer
  useEffect(() => {
    if (
      screenMode !== 'navigating' ||
      !useSimulator ||
      !simAutoPlaying ||
      !simRouteWaypoints ||
      simRouteWaypoints.length < 2
    ) {
      return;
    }
    const timer = setInterval(() => {
      setSimWalkDistanceM((prev) => {
        const sample = sampleWalk(simRouteWaypoints, prev + 0.6);
        const now = Date.now();
        simSensors.emit(
          {
            position: sample.position,
            accuracyM: simWeakGps ? 25 : 2,
            timestamp: now,
            speedMps: 1.2,
          },
          { degrees: sample.headingDegrees, timestamp: now },
        );
        if (sample.distanceM >= sample.totalM) {
          setSimAutoPlaying(false);
        }
        return sample.distanceM;
      });
    }, 500);
    return () => clearInterval(timer);
  }, [screenMode, useSimulator, simAutoPlaying, simRouteWaypoints, simWeakGps, simSensors]);

  const destinations = useMemo(
    () => (map ? sortDestinationsByDistance(map.features, locationFix?.position ?? null) : []),
    [map, locationFix?.position],
  );

  const lastDestination = useMemo(
    () =>
      prefs.lastDestinationId
        ? (destinations.find((d) => d.feature.id === prefs.lastDestinationId) ?? null)
        : null,
    [destinations, prefs.lastDestinationId],
  );

  const handleStartNavigation = async (dest: SortedDestination) => {
    // 1. Unlock WebAudio + start silent <audio> loop on user tap
    await sonarRef.current?.unlockFromTap();
    // 2. Request iOS compass permission on user tap
    if (!useSimulator) {
      await headingProviderRef.current?.requestPermission?.();
    }
    // 3. Check battery if supported
    const bat = await readBatteryPercent();
    if (bat !== null) {
      setBatteryPercent(bat);
    }

    // 4. Persist last destination
    setPrefs((prev) => ({ ...prev, lastDestinationId: dest.feature.id }));
    setActiveDest(dest);
    setStepResult(null);
    setRouteError(null);
    setSimAutoPlaying(false);
    setScreenMode('navigating');

    const startPos =
      locationFix?.position ??
      (useSimulator && map ? defaultSimulatedStartPosition(map.features) : null);

    if (startPos) {
      planRoute(startPos, dest, false);
    } else {
      lastSpokenInstructionRef.current = t.spoken.noInstructionYet;
      speechRef.current?.speak(t.spoken.noInstructionYet);
    }
  };

  // If user tapped Start before first GPS fix arrived, plan as soon as the first fix arrives
  useEffect(() => {
    if (
      screenMode === 'navigating' &&
      activeDest &&
      !guidanceRef.current &&
      !calculating &&
      !routeError &&
      locationFix
    ) {
      planRoute(locationFix.position, activeDest, false);
    }
  }, [screenMode, activeDest, calculating, routeError, locationFix, planRoute]);

  const handleStopNavigation = () => {
    if (activeRequestIdRef.current) {
      workerRef.current?.terminate();
      workerRef.current = null;
      activeRequestIdRef.current = null;
    }
    setSimAutoPlaying(false);
    guidanceRef.current = null;
    setStepResult(null);
    setRouteError(null);
    setCalculating(false);
    sonarRef.current?.stop();
    speechRef.current?.speak(t.spoken.stopped);
    setScreenMode('home');
  };

  const handleWhereAmI = () => {
    void sonarRef.current?.unlockFromTap();
    const landmark = stepResult?.nearestLandmark ?? null;
    const remainingM = stepResult?.carrot?.distanceRemainingM ?? null;
    const accuracyM = locationFix?.accuracyM ?? null;
    const text = formatWhereAmISpeech(landmark, remainingM, accuracyM);
    speechRef.current?.speak(text);
  };

  const handleRepeatInstruction = () => {
    void sonarRef.current?.unlockFromTap();
    const cue = guidanceRef.current?.lastInstruction;
    const text = cue
      ? formatSpeechCue(cue)
      : (lastSpokenInstructionRef.current ?? t.spoken.noInstructionYet);
    speechRef.current?.speak(text);
  };

  const simStep = (metres: number, turnDeltaDegrees = 0) => {
    const pos =
      locationFix?.position ??
      (map ? defaultSimulatedStartPosition(map.features) : ([25.695, 55.636] as LonLat));
    const nextHeading = normalizeDegrees((headingFix?.degrees ?? 0) + turnDeltaDegrees);
    const nextPos = metres !== 0 ? moveWalker(pos, nextHeading, metres) : pos;
    const now = Date.now();
    simSensors.emit(
      {
        position: nextPos,
        accuracyM: simWeakGps ? 25 : 2,
        timestamp: now,
        speedMps: Math.abs(metres) > 0 ? 1.2 : 0,
      },
      { degrees: nextHeading, timestamp: now },
    );
  };

  if (!store) {
    return (
      <main className="page navigator">
        <header className="toolbar">
          <Link to="/">← {strings.appName}</Link>
          <h1>{t.title}</h1>
        </header>
        <p role="status">{t.signInRequired}</p>
        <DataPanel />
      </main>
    );
  }

  return (
    <main className="page navigator">
      <header className="toolbar navigator-header">
        <Link to="/">{t.back}</Link>
        <h1>{t.title}</h1>
        <div className="nav-badges" aria-live="off">
          <span className="badge">{t.gpsBadge(locationFix?.accuracyM ?? null)}</span>
          <span className="badge">{t.headingBadge(effectiveHeadingDegrees)}</span>
          {batteryPercent !== null && (
            <span className="badge">{t.batteryBadge(batteryPercent)}</span>
          )}
        </div>
      </header>

      {screenMode === 'settings' && (
        <NavigatorSettings
          prefs={prefs}
          onChange={setPrefs}
          onTestSonar={() => {
            void sonarRef.current?.unlockFromTap();
            sonarRef.current?.playTestPing(0, 'aligned');
          }}
          onTestSpeech={() => {
            void sonarRef.current?.unlockFromTap();
            speechRef.current?.speak(t.spoken.voiceTestSample);
          }}
          onClose={() => setScreenMode('home')}
          sharingControl={sharingControl}
        />
      )}

      {screenMode === 'home' && (
        <section className="navigator-home stack" aria-label={t.whereTo}>
          <h2>{t.whereTo}</h2>

          <label className="check-row nav-check">
            <input
              type="checkbox"
              checked={useSimulator}
              onChange={(e) => setUseSimulator(e.target.checked)}
            />
            <span>{t.simToggle}</span>
          </label>

          {sharingControl}

          {!map ? (
            <p role="alert">{strings.editor.route.unavailable}</p>
          ) : !hasWalkableArea ? (
            <p role="alert">{t.noWalkableArea}</p>
          ) : destinations.length === 0 ? (
            <p role="status">{t.noDestinations}</p>
          ) : (
            <>
              {lastDestination && (
                <button
                  type="button"
                  className="big-button"
                  aria-label={t.repeatLast(lastDestination.name)}
                  onClick={() => void handleStartNavigation(lastDestination)}
                >
                  <span>{t.repeatLast(lastDestination.name)}</span>
                  <span className="big-button__hint">
                    {lastDestination.distanceM !== null
                      ? t.distanceAway(lastDestination.distanceM)
                      : t.distanceUnknown}
                  </span>
                </button>
              )}

              <ul className="destination-list" aria-label={t.whereTo}>
                {destinations.map((dest) => (
                  <li key={dest.feature.id}>
                    <button
                      type="button"
                      className="big-button"
                      aria-label={t.startTo(dest.name)}
                      onClick={() => void handleStartNavigation(dest)}
                    >
                      <span>{dest.name}</span>
                      <span className="big-button__hint">
                        {dest.distanceM !== null
                          ? t.distanceAway(dest.distanceM)
                          : t.distanceUnknown}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <button
            type="button"
            className="big-button big-button--secondary"
            onClick={() => setScreenMode('settings')}
          >
            {t.settingsButton}
          </button>
        </section>
      )}

      {screenMode === 'navigating' && activeDest && (
        <section
          className="navigating-screen stack"
          aria-label={t.navigatingTo(activeDest.name)}
          onDoubleClick={handleRepeatInstruction}
          onTouchStart={(e) => {
            touchStartXRef.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            const startX = touchStartXRef.current;
            const endX = e.changedTouches[0]?.clientX ?? null;
            touchStartXRef.current = null;
            if (startX !== null && endX !== null && Math.abs(endX - startX) >= 60) {
              handleRepeatInstruction();
            }
          }}
        >
          <h2>{t.navigatingTo(activeDest.name)}</h2>

          <p className="nav-live-status" role="status" aria-live="polite">
            {routeError
              ? t.statusRouteFailed(routeError)
              : calculating
                ? t.statusCalculating
                : !stepResult
                  ? t.statusCalculating
                  : stepResult.status === 'weak-gps'
                    ? t.statusWeakGps
                    : stepResult.status === 'recalculating'
                      ? t.statusRecalculating
                      : stepResult.status === 'arrived'
                        ? t.statusArrived(activeDest.name)
                        : stepResult.carrot
                          ? t.statusGuiding(
                              stepResult.carrot.distanceRemainingM,
                              stepResult.carrot.turnAngleDegrees,
                            )
                          : t.statusCalculating}
          </p>

          {stepResult?.hazards && stepResult.hazards.length > 0 && (
            <p className="route-warning" role="alert">
              {t.spoken.hazard(
                stepResult.hazards[0]!.spokenName,
                stepResult.hazards[0]!.distanceM,
                stepResult.hazards[0]!.sector,
              )}
            </p>
          )}

          <button
            type="button"
            className="big-button big-button--danger nav-stop-button"
            onClick={handleStopNavigation}
          >
            <span>{t.stopButton}</span>
            <span className="big-button__hint">{t.stopHint}</span>
          </button>
          {sharingControl}

          <button
            type="button"
            className="big-button big-button--secondary"
            onClick={handleWhereAmI}
          >
            <span>{t.whereAmIButton}</span>
            <span className="big-button__hint">{t.whereAmIHint}</span>
          </button>

          <button
            type="button"
            className="big-button big-button--secondary"
            onClick={handleRepeatInstruction}
          >
            <span>{t.repeatButton}</span>
            <span className="big-button__hint">{t.repeatHint}</span>
          </button>

          {useSimulator && (
            <section className="nav-sim-panel" role="group" aria-label={t.simControlsLabel}>
              <h3>{t.simControlsLabel}</h3>
              <div className="manual-pad">
                <button
                  type="button"
                  className="control-button"
                  disabled={!simRouteWaypoints}
                  onClick={() => setSimAutoPlaying((p) => !p)}
                >
                  {simAutoPlaying ? t.simPause : t.simPlay}
                </button>
                <button
                  type="button"
                  className="control-button control-button--secondary"
                  onClick={() => simStep(2, 0)}
                >
                  {t.simStepForward}
                </button>
                <button
                  type="button"
                  className="control-button control-button--secondary"
                  onClick={() => simStep(0, -20)}
                >
                  {t.simTurnLeft}
                </button>
                <button
                  type="button"
                  className="control-button control-button--secondary"
                  onClick={() => simStep(0, 20)}
                >
                  {t.simTurnRight}
                </button>
                <button
                  type="button"
                  className="control-button control-button--secondary"
                  onClick={() => {
                    const pos = locationFix?.position;
                    if (!pos) return;
                    const sideHeading = normalizeDegrees((headingFix?.degrees ?? 0) + 90);
                    const offPos = moveWalker(pos, sideHeading, 6);
                    const now = Date.now();
                    simSensors.emit(
                      { position: offPos, accuracyM: 2, timestamp: now, speedMps: 1.2 },
                      { degrees: headingFix?.degrees ?? 0, timestamp: now },
                    );
                  }}
                >
                  {t.simStepOffRoute}
                </button>
                <button
                  type="button"
                  className="control-button control-button--secondary"
                  onClick={() => {
                    const nextWeak = !simWeakGps;
                    setSimWeakGps(nextWeak);
                    if (locationFix) {
                      const now = Date.now();
                      simSensors.emit(
                        {
                          position: locationFix.position,
                          accuracyM: nextWeak ? 25 : 2,
                          timestamp: now,
                          speedMps: 0,
                        },
                        { degrees: headingFix?.degrees ?? 0, timestamp: now },
                      );
                    }
                  }}
                >
                  {simWeakGps ? t.simGoodGps : t.simWeakGps}
                </button>
              </div>
            </section>
          )}
        </section>
      )}
    </main>
  );
}
