import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_RULES,
  GuidanceEngine,
  moveWalker,
  normalizeDegrees,
  sampleWalk,
  type CategoryRule,
  type LonLat,
  type MapFeature,
  type RouteEvent,
  type SnapNotice,
} from '@alouna/core';
import { formatSpeechCue } from '../audio/cues';
import { WebAudioSonar } from '../audio/sonar';
import { BrowserSpeech } from '../audio/speech';
import { strings } from '../strings';
import { SimulatedSensors } from '../sensors/simulated';
import type { RouteMapOverlay } from './routeState';

export function Simulator({
  waypoints,
  events = [],
  snaps = [],
  features = [],
  rules = DEFAULT_RULES,
  destinationName = 'Destination',
  onWalker,
}: {
  waypoints: readonly LonLat[];
  events?: readonly RouteEvent[];
  snaps?: readonly SnapNotice[];
  features?: readonly MapFeature[];
  rules?: readonly CategoryRule[];
  destinationName?: string;
  onWalker: (walker: RouteMapOverlay['walker']) => void;
}) {
  const t = strings.editor.route;
  const [mode, setMode] = useState<'automatic' | 'manual'>('automatic');
  const [distance, setDistance] = useState(0),
    [speed, setSpeed] = useState(1.2),
    [playing, setPlaying] = useState(false),
    [audioEnabled, setAudioEnabled] = useState(false);
  const sample = useMemo(() => sampleWalk(waypoints, distance), [waypoints, distance]);
  const [manual, setManual] = useState(() => ({
    position: sample.position,
    headingDegrees: sample.headingDegrees,
  }));
  const sensors = useMemo(() => new SimulatedSensors(), []);
  const sonarRef = useRef<WebAudioSonar | null>(null);
  const speechRef = useRef<BrowserSpeech | null>(null);
  const guidanceRef = useRef<GuidanceEngine | null>(null);

  const walker = mode === 'automatic' ? sample : manual;
  const finished = sample.distanceM >= sample.totalM;

  useEffect(() => {
    const sonar = new WebAudioSonar({ volume: 0.65 });
    const speech = new BrowserSpeech();
    sonarRef.current = sonar;
    speechRef.current = speech;
    return () => {
      sonar.stop();
      speech.stop();
      sonarRef.current = null;
      speechRef.current = null;
    };
  }, []);

  useEffect(() => {
    guidanceRef.current = new GuidanceEngine(
      {
        destinationId: 'sim-target',
        destinationName,
        waypoints,
        distanceM: sample.totalM,
        events,
        snaps,
        dataVersion: 'sim',
      },
      features,
      rules,
    );
  }, [waypoints, events, snaps, features, rules, destinationName, sample.totalM]);

  useEffect(() => {
    if (!audioEnabled) {
      sonarRef.current?.stop();
      speechRef.current?.stop();
    }
  }, [audioEnabled]);

  useEffect(() => {
    const unLocation = sensors.location.subscribe((fix) => {
      onWalker({ position: fix.position, headingDegrees: walker.headingDegrees });
      if (audioEnabled && guidanceRef.current) {
        const stepResult = guidanceRef.current.step({
          position: fix.position,
          accuracyM: fix.accuracyM,
          timestampMs: fix.timestamp,
          speedMps: fix.speedMps,
          headingDegrees: walker.headingDegrees,
        });
        sonarRef.current?.update(stepResult.sonar);
        for (const cue of stepResult.cues) {
          if (cue.kind === 'arrived') sonarRef.current?.playArrivalChime();
          speechRef.current?.speak(formatSpeechCue(cue), { interrupt: cue.kind !== 'start' });
        }
      }
    });
    const timestamp = Date.now();
    sensors.emit(
      { position: walker.position, accuracyM: 1.5, timestamp, speedMps: playing ? speed : 0 },
      { degrees: walker.headingDegrees, timestamp },
    );
    return unLocation;
  }, [walker.position, walker.headingDegrees, onWalker, playing, speed, sensors, audioEnabled]);
  useEffect(() => () => onWalker(null), [onWalker]);

  useEffect(() => {
    if (!playing || mode !== 'automatic' || finished) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const elapsed = Math.max(0, Math.min(0.5, (now - last) / 1000));
      last = now;
      setDistance((n) => Math.min(sample.totalM, n + elapsed * speed));
    }, 100);
    const pause = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', pause);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', pause);
    };
  }, [playing, mode, finished, sample.totalM, speed]);

  const turn = (delta: number) =>
    setManual((w) => ({ ...w, headingDegrees: normalizeDegrees(w.headingDegrees + delta) }));
  const step = (metres: number) =>
    setManual((w) => ({ ...w, position: moveWalker(w.position, w.headingDegrees, metres) }));
  return (
    <section className="editor-form simulator" aria-label={t.simulator}>
      <h3>{t.simulator}</h3>
      <p className="muted">{t.simulationHint}</p>
      <label className="check-row">
        <input
          type="checkbox"
          checked={audioEnabled}
          onChange={(e) => {
            const checked = e.target.checked;
            if (checked) {
              void sonarRef.current?.unlockFromTap();
            }
            setAudioEnabled(checked);
          }}
        />
        {t.audioEnabled}
      </label>
      <label>
        {t.mode}
        <select
          value={mode}
          onChange={(e) => {
            if (e.target.value === 'manual')
              setManual({ position: sample.position, headingDegrees: sample.headingDegrees });
            setPlaying(false);
            setMode(e.target.value as 'automatic' | 'manual');
          }}
        >
          <option value="automatic">{t.automatic}</option>
          <option value="manual">{t.manual}</option>
        </select>
      </label>
      {mode === 'automatic' ? (
        <>
          <label>
            {t.speed}
            <input
              type="number"
              min="0.2"
              max="3"
              step="0.1"
              value={speed}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n >= 0.2 && n <= 3) setSpeed(n);
              }}
            />
          </label>
          <p>{t.progress(sample.distanceM, sample.totalM)}</p>
          <button type="button" disabled={finished} onClick={() => setPlaying((p) => !p)}>
            {playing && !finished ? t.pause : t.play}
          </button>
          {finished && <p role="status">{t.finished}</p>}
        </>
      ) : (
        <>
          <label>
            {t.headingControl}
            <input
              type="range"
              min="0"
              max="359"
              step="1"
              value={Math.round(manual.headingDegrees)}
              onChange={(e) => setManual((w) => ({ ...w, headingDegrees: Number(e.target.value) }))}
            />
          </label>
          <p id="manual-help" className="muted">
            {t.keyboardHint}
          </p>
          <div
            role="group"
            tabIndex={0}
            aria-label={t.keyboardPad}
            aria-describedby="manual-help"
            className="manual-pad"
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'ArrowUp') step(1);
              else if (e.key === 'ArrowDown') step(-1);
              else if (e.key === 'ArrowLeft') turn(-15);
              else if (e.key === 'ArrowRight') turn(15);
              else return;
              e.preventDefault();
            }}
          >
            <button type="button" onClick={() => step(1)}>
              {t.forward}
            </button>
            <button type="button" onClick={() => step(-1)}>
              {t.backward}
            </button>
            <button type="button" onClick={() => turn(-15)}>
              {t.left}
            </button>
            <button type="button" onClick={() => turn(15)}>
              {t.right}
            </button>
          </div>
        </>
      )}
      <p>{t.headingValue(walker.headingDegrees)}</p>
      <button
        type="button"
        onClick={() => {
          setPlaying(false);
          setDistance(0);
          const first = sampleWalk(waypoints, 0);
          setManual({ position: first.position, headingDegrees: first.headingDegrees });
        }}
      >
        {t.reset}
      </button>
    </section>
  );
}
