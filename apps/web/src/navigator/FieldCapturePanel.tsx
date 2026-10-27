import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  averageGpsFixes,
  buildWalkTrackGeometry,
  computeOffsetPosition,
  type CategoryRule,
  type Geometry,
  type GpsSample,
} from '@alouna/core';
import type { FeaturePayload } from '../data/types';
import { validateCandidateFeature } from '../editor/state';
import type { LocationFix } from '../sensors/types';
import { strings } from '../strings';

const POINT_DEFAULT_CATEGORIES = ['obstacle', 'landmark', 'steps', 'crossing', 'caution'];
const LINE_DEFAULT_CATEGORIES = ['ditch', 'path', 'fence', 'crossing', 'caution'];
const POLYGON_DEFAULT_CATEGORIES = [
  'rough',
  'caution',
  'water',
  'no_go',
  'walkable_area',
  'building',
];

function categoriesForGeometry(
  rules: readonly CategoryRule[],
  geomType: Geometry['type'],
): CategoryRule[] {
  const preferred =
    geomType === 'Point'
      ? POINT_DEFAULT_CATEGORIES
      : geomType === 'LineString'
        ? LINE_DEFAULT_CATEGORIES
        : POLYGON_DEFAULT_CATEGORIES;
  const available = rules.filter((r) => {
    if (geomType !== 'Polygon' && r.category === 'walkable_area') return false;
    return true;
  });
  return [...available].sort((a, b) => {
    const ia = preferred.indexOf(a.category);
    const ib = preferred.indexOf(b.category);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.label.localeCompare(b.label);
  });
}

export interface CapturedGeometryState {
  geometry: Geometry;
  accuracyM: number;
  summaryText: string;
}

export function FieldCapturePanel({
  rules,
  isAdmin,
  locationFix,
  headingDegrees,
  onSpeak,
  useSimulator = false,
  onSimulateFix,
  onSimulateStep,
  onSaveFeature,
  onClose,
}: {
  rules: readonly CategoryRule[];
  isAdmin: boolean;
  locationFix: LocationFix | null;
  headingDegrees: number;
  onSpeak?: (text: string) => void;
  useSimulator?: boolean;
  onSimulateFix?: (accuracyM: number) => LocationFix | void;
  onSimulateStep?: (meters: number, turnDeltaDegrees?: number) => LocationFix | void;
  onSaveFeature: (id: string, payload: FeaturePayload) => Promise<void>;
  onClose?: () => void;
}) {
  const t = strings.capture;

  const [mode, setMode] = useState<'point' | 'walk'>('point');
  const [durationSec, setDurationSec] = useState<number>(10);
  const [useOffset, setUseOffset] = useState(false);
  const [offsetDistanceM, setOffsetDistanceM] = useState<number>(2);
  const [walkShape, setWalkShape] = useState<'LineString' | 'Polygon'>('LineString');

  // Capture session state
  const [status, setStatus] = useState<'idle' | 'averaging' | 'walking' | 'captured'>('idle');
  const [secondsLeft, setSecondsLeft] = useState<number>(10);
  const [samples, setSamples] = useState<GpsSample[]>([]);
  const [captured, setCaptured] = useState<CapturedGeometryState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // Form fields for the captured feature
  const activeGeometryType: Geometry['type'] =
    captured?.geometry.type ?? (mode === 'point' ? 'Point' : walkShape);
  const availableCategories = useMemo(
    () => categoriesForGeometry(rules, activeGeometryType),
    [rules, activeGeometryType],
  );

  const [category, setCategory] = useState<string>(() => (mode === 'point' ? 'obstacle' : 'ditch'));
  const [name, setName] = useState<string>('');
  const [spokenName, setSpokenName] = useState<string>('');
  const [radiusM, setRadiusM] = useState<string>('0.7');
  const [widthM, setWidthM] = useState<string>('1.5');
  const [isDestination, setIsDestination] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>('');

  const samplesRef = useRef<GpsSample[]>([]);
  const lastFixTimestampRef = useRef<number | null>(null);
  const headingRef = useRef<number>(headingDegrees);
  const useOffsetRef = useRef<boolean>(useOffset);
  const offsetDistanceRef = useRef<number>(offsetDistanceM);

  useEffect(() => {
    headingRef.current = headingDegrees;
    useOffsetRef.current = useOffset;
    offsetDistanceRef.current = offsetDistanceM;
  }, [headingDegrees, useOffset, offsetDistanceM]);

  const appendFixSample = useCallback((fix: LocationFix) => {
    if (lastFixTimestampRef.current === fix.timestamp) return;
    lastFixTimestampRef.current = fix.timestamp;
    const sample: GpsSample = {
      position: fix.position,
      accuracyM: fix.accuracyM,
      timestampMs: fix.timestamp,
    };
    const next = [...samplesRef.current, sample];
    samplesRef.current = next;
    setSamples(next);
  }, []);

  // Append incoming locationFix while averaging or walking
  useEffect(() => {
    if ((status !== 'averaging' && status !== 'walking') || !locationFix) return;
    appendFixSample(locationFix);
  }, [status, locationFix, appendFixSample]);

  const finishPointAveraging = useCallback(() => {
    const avg = averageGpsFixes(samplesRef.current, { maxAccuracyM: 10 });
    if (!avg) {
      setStatus('idle');
      setErrorMessage(t.noValidPointFixes);
      onSpeak?.(t.spoken.pointFailed);
      return;
    }
    const offsetM =
      useOffsetRef.current && offsetDistanceRef.current > 0 ? offsetDistanceRef.current : null;
    const finalPos =
      offsetM !== null
        ? computeOffsetPosition(avg.position, headingRef.current, offsetM)
        : avg.position;
    const summaryText = t.pointCaptured(avg.accuracyM, avg.acceptedCount, offsetM);
    setCaptured({
      geometry: { type: 'Point', coordinates: finalPos },
      accuracyM: avg.accuracyM,
      summaryText,
    });
    setStatus('captured');
    setErrorMessage(null);
    onSpeak?.(t.spoken.pointReady(avg.accuracyM, offsetM));
  }, [onSpeak, t]);

  // Countdown timer during GPS point averaging
  useEffect(() => {
    if (status !== 'averaging') return;
    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          finishPointAveraging();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [status, finishPointAveraging]);

  const handleStartPoint = () => {
    setSavedNotice(null);
    setErrorMessage(null);
    setCaptured(null);
    const initialSamples: GpsSample[] = locationFix
      ? [
          {
            position: locationFix.position,
            accuracyM: locationFix.accuracyM,
            timestampMs: locationFix.timestamp,
          },
        ]
      : [];
    lastFixTimestampRef.current = locationFix?.timestamp ?? null;
    samplesRef.current = initialSamples;
    setSamples(initialSamples);
    setSecondsLeft(durationSec);
    setStatus('averaging');
    if (!availableCategories.some((r) => r.category === category)) {
      setCategory(availableCategories[0]?.category ?? 'obstacle');
    }
    onSpeak?.(t.spoken.averagingStarted(durationSec));
  };

  const handleStartWalk = () => {
    setSavedNotice(null);
    setErrorMessage(null);
    setCaptured(null);
    const initialSamples: GpsSample[] = locationFix
      ? [
          {
            position: locationFix.position,
            accuracyM: locationFix.accuracyM,
            timestampMs: locationFix.timestamp,
          },
        ]
      : [];
    lastFixTimestampRef.current = locationFix?.timestamp ?? null;
    samplesRef.current = initialSamples;
    setSamples(initialSamples);
    setStatus('walking');
    const defaultCat = walkShape === 'LineString' ? 'ditch' : 'rough';
    setCategory(defaultCat);
    onSpeak?.(t.spoken.walkStarted);
  };

  const handleStopWalk = () => {
    try {
      const res = buildWalkTrackGeometry(samplesRef.current, walkShape, {
        toleranceM: 0.5,
        maxAccuracyM: 15,
        minStepM: 0.5,
      });
      const summaryText = t.walkCaptured(res.vertexCount, res.lengthM, res.accuracyM);
      setCaptured({
        geometry: res.geometry,
        accuracyM: res.accuracyM,
        summaryText,
      });
      setStatus('captured');
      setErrorMessage(null);
      onSpeak?.(t.spoken.walkReady(res.vertexCount, res.lengthM, res.accuracyM));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus('idle');
      setErrorMessage(msg);
      onSpeak?.(t.spoken.walkFailed(msg));
    }
  };

  const handleReset = () => {
    setStatus('idle');
    setCaptured(null);
    setErrorMessage(null);
    samplesRef.current = [];
    setSamples([]);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captured) return;
    setErrorMessage(null);

    const ruleLabel = rules.find((r) => r.category === category)?.label ?? category;
    const finalName = name.trim() || `Field ${ruleLabel.toLowerCase()}`;
    const parsedRadius =
      captured.geometry.type === 'Point' && radiusM.trim() !== '' ? Number(radiusM) : null;
    const parsedWidth =
      captured.geometry.type === 'LineString' && widthM.trim() !== '' ? Number(widthM) : null;

    const id = crypto.randomUUID();
    const payload: FeaturePayload = {
      name: finalName,
      spoken_name: spokenName.trim(),
      category,
      geometry: captured.geometry,
      radius_m:
        parsedRadius !== null && Number.isFinite(parsedRadius) && parsedRadius > 0
          ? parsedRadius
          : null,
      width_m:
        parsedWidth !== null && Number.isFinite(parsedWidth) && parsedWidth > 0
          ? parsedWidth
          : null,
      is_destination: captured.geometry.type === 'Point' ? isDestination : false,
      notes: notes.trim(),
      source: 'gps',
      gps_accuracy_m: captured.accuracyM,
      enabled: true,
      reviewed: isAdmin,
    };

    try {
      validateCandidateFeature(id, payload, rules);
      await onSaveFeature(id, payload);
      const notice = t.savedNotice(finalName, isAdmin);
      setSavedNotice(notice);
      onSpeak?.(t.spoken.saved(finalName));
      setCaptured(null);
      setStatus('idle');
      setName('');
      setSpokenName('');
      setNotes('');
      samplesRef.current = [];
      setSamples([]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    }
  };

  const acceptedCount = useMemo(
    () =>
      samples.filter((s) => Number.isFinite(s.accuracyM) && s.accuracyM > 0 && s.accuracyM <= 10)
        .length,
    [samples],
  );
  const discardedCount = samples.length - acceptedCount;

  return (
    <section className="field-capture stack" aria-label={t.heading}>
      <h2>{t.heading}</h2>
      <p className="muted">{t.hint}</p>

      {savedNotice && (
        <p className="status-banner" role="status" aria-live="polite">
          {savedNotice}
        </p>
      )}

      {errorMessage && (
        <p className="route-warning" role="alert">
          {errorMessage}
        </p>
      )}

      {status === 'idle' && (
        <div className="stack">
          <label className="nav-field">
            <span>{t.modeLabel}</span>
            <select
              aria-label={t.modeLabel}
              value={mode}
              onChange={(e) => {
                const nextMode = e.target.value as 'point' | 'walk';
                setMode(nextMode);
                setCategory(
                  nextMode === 'point'
                    ? 'obstacle'
                    : walkShape === 'LineString'
                      ? 'ditch'
                      : 'rough',
                );
              }}
            >
              <option value="point">{t.modePoint}</option>
              <option value="walk">{t.modeWalk}</option>
            </select>
          </label>

          {mode === 'point' ? (
            <div className="stack">
              <label className="nav-field">
                <span>{t.durationLabel}</span>
                <select
                  aria-label={t.durationLabel}
                  value={durationSec}
                  onChange={(e) => setDurationSec(Number(e.target.value))}
                >
                  <option value={10}>{t.durationOption(10)}</option>
                  <option value={15}>{t.durationOption(15)}</option>
                  <option value={20}>{t.durationOption(20)}</option>
                </select>
              </label>

              <label className="check-row nav-check">
                <input
                  type="checkbox"
                  checked={useOffset}
                  onChange={(e) => setUseOffset(e.target.checked)}
                />
                <span>{t.useOffset}</span>
              </label>

              {useOffset && (
                <div className="stack">
                  <label className="nav-field">
                    <span>{t.offsetDistanceLabel}</span>
                    <input
                      type="number"
                      aria-label={t.offsetDistanceLabel}
                      min="0.5"
                      max="30"
                      step="0.5"
                      value={offsetDistanceM}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val) && val > 0) setOffsetDistanceM(val);
                      }}
                    />
                  </label>
                  <p className="muted" role="status">
                    {t.offsetSummary(offsetDistanceM, headingDegrees)}
                  </p>
                </div>
              )}

              <button type="button" className="big-button" onClick={handleStartPoint}>
                {t.startPoint}
              </button>
            </div>
          ) : (
            <div className="stack">
              <label className="nav-field">
                <span>{t.walkShapeLabel}</span>
                <select
                  aria-label={t.walkShapeLabel}
                  value={walkShape}
                  onChange={(e) => {
                    const nextShape = e.target.value as 'LineString' | 'Polygon';
                    setWalkShape(nextShape);
                    setCategory(nextShape === 'LineString' ? 'ditch' : 'rough');
                  }}
                >
                  <option value="LineString">{t.walkShapeLine}</option>
                  <option value="Polygon">{t.walkShapePolygon}</option>
                </select>
              </label>

              <button type="button" className="big-button" onClick={handleStartWalk}>
                {t.startWalk}
              </button>
            </div>
          )}
        </div>
      )}

      {status === 'averaging' && (
        <div className="stack">
          <p className="nav-live-status" role="status" aria-live="polite">
            {t.averagingStatus(secondsLeft, acceptedCount, discardedCount)}
          </p>
          <button type="button" className="big-button" onClick={finishPointAveraging}>
            {t.stopEarly}
          </button>
          <button type="button" className="big-button big-button--secondary" onClick={handleReset}>
            {t.resetCapture}
          </button>
        </div>
      )}

      {status === 'walking' && (
        <div className="stack">
          <p className="nav-live-status" role="status" aria-live="polite">
            {t.recordingWalkStatus(samples.length)}
          </p>
          <button type="button" className="big-button" onClick={handleStopWalk}>
            {t.stopWalk}
          </button>
          <button type="button" className="big-button big-button--secondary" onClick={handleReset}>
            {t.resetCapture}
          </button>
        </div>
      )}

      {useSimulator && (status === 'averaging' || status === 'walking') && (
        <div className="sim-controls" role="group" aria-label={t.simControlsHeading}>
          {onSimulateFix && (
            <>
              <button
                type="button"
                className="control-button"
                onClick={() => {
                  const fix = onSimulateFix(2.0);
                  if (fix) appendFixSample(fix);
                }}
              >
                {t.simEmitFix}
              </button>
              <button
                type="button"
                className="control-button control-button--secondary"
                onClick={() => {
                  const fix = onSimulateFix(18.0);
                  if (fix) appendFixSample(fix);
                }}
              >
                {t.simEmitWeakFix}
              </button>
            </>
          )}
          {onSimulateStep && (
            <>
              <button
                type="button"
                className="control-button"
                onClick={() => {
                  const fix = onSimulateStep(3, 0);
                  if (fix) appendFixSample(fix);
                }}
              >
                {t.simWalkStep}
              </button>
              <button
                type="button"
                className="control-button control-button--secondary"
                onClick={() => {
                  const fix = onSimulateStep(0, 90);
                  if (fix) appendFixSample(fix);
                }}
              >
                {t.simTurnRight}
              </button>
            </>
          )}
        </div>
      )}

      {status === 'captured' && captured && (
        <form className="stack" onSubmit={(e) => void handleSave(e)}>
          <p className="nav-live-status" role="status" aria-live="polite">
            {captured.summaryText}
          </p>

          <label className="nav-field">
            <span>{t.categoryLabel}</span>
            <select
              aria-label={t.categoryLabel}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {availableCategories.map((r) => (
                <option key={r.category} value={r.category}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="nav-field">
            <span>{t.nameLabel}</span>
            <input
              type="text"
              aria-label={t.nameLabel}
              placeholder={t.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="nav-field">
            <span>{t.spokenNameLabel}</span>
            <input
              type="text"
              aria-label={t.spokenNameLabel}
              value={spokenName}
              onChange={(e) => setSpokenName(e.target.value)}
            />
          </label>

          {captured.geometry.type === 'Point' && (
            <>
              <label className="nav-field">
                <span>{t.radiusLabel}</span>
                <input
                  type="number"
                  aria-label={t.radiusLabel}
                  min="0"
                  max="50"
                  step="0.1"
                  value={radiusM}
                  onChange={(e) => setRadiusM(e.target.value)}
                />
              </label>

              <label className="check-row nav-check">
                <input
                  type="checkbox"
                  checked={isDestination}
                  onChange={(e) => setIsDestination(e.target.checked)}
                />
                <span>{t.destinationCheck}</span>
              </label>
            </>
          )}

          {captured.geometry.type === 'LineString' && (
            <label className="nav-field">
              <span>{t.widthLabel}</span>
              <input
                type="number"
                aria-label={t.widthLabel}
                min="0.2"
                max="30"
                step="0.1"
                value={widthM}
                onChange={(e) => setWidthM(e.target.value)}
              />
            </label>
          )}

          <label className="nav-field">
            <span>{t.notesLabel}</span>
            <input
              type="text"
              aria-label={t.notesLabel}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>

          <button type="submit" className="big-button">
            {t.saveButton}
          </button>

          <button type="button" className="big-button big-button--secondary" onClick={handleReset}>
            {t.resetCapture}
          </button>
        </form>
      )}

      {onClose && (
        <button type="button" className="big-button big-button--secondary" onClick={onClose}>
          {t.backButton}
        </button>
      )}
    </section>
  );
}
