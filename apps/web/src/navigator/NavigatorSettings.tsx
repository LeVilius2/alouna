import type { VoiceLocale } from '../audio/speech';
import type { ReactNode } from 'react';
import { strings } from '../strings';
import type { NavigatorPreferences } from './settingsState';

export function NavigatorSettings({
  prefs,
  onChange,
  onTestSonar,
  onTestSpeech,
  onClose,
  sharingControl,
}: {
  prefs: NavigatorPreferences;
  onChange: (next: NavigatorPreferences) => void;
  onTestSonar: () => void;
  onTestSpeech: () => void;
  onClose: () => void;
  sharingControl?: ReactNode;
}) {
  const t = strings.navigator.settings;
  return (
    <section className="navigator-settings stack" aria-label={t.heading}>
      <h2>{t.heading}</h2>
      {sharingControl}

      <label className="nav-field">
        <span>{t.voiceLocale}</span>
        <select
          aria-label={t.voiceLocale}
          value={prefs.voiceLocale}
          onChange={(e) => onChange({ ...prefs, voiceLocale: e.target.value as VoiceLocale })}
        >
          <option value="en-US">{t.localeEnUs}</option>
          <option value="en-GB">{t.localeEnGb}</option>
        </select>
      </label>

      <label className="nav-field">
        <span>
          {t.speechRate} ({prefs.speechRate.toFixed(1)}×)
        </span>
        <input
          type="range"
          aria-label={t.speechRate}
          min="0.7"
          max="1.4"
          step="0.1"
          value={prefs.speechRate}
          onChange={(e) => onChange({ ...prefs, speechRate: Number(e.target.value) })}
        />
      </label>

      <label className="nav-field">
        <span>
          {t.sonarVolume} ({Math.round(prefs.sonarVolume * 100)}%)
        </span>
        <input
          type="range"
          aria-label={t.sonarVolume}
          min="0"
          max="1"
          step="0.05"
          value={prefs.sonarVolume}
          onChange={(e) => onChange({ ...prefs, sonarVolume: Number(e.target.value) })}
        />
      </label>

      <label className="nav-field">
        <span>{t.declination}</span>
        <input
          type="number"
          aria-label={t.declination}
          min="-30"
          max="30"
          step="1"
          value={prefs.declinationDegrees}
          onChange={(e) => {
            const val = Number(e.target.value);
            if (Number.isFinite(val)) onChange({ ...prefs, declinationDegrees: val });
          }}
        />
      </label>

      <label className="check-row nav-check">
        <input
          type="checkbox"
          checked={prefs.iosHapticsEnabled}
          onChange={(e) => onChange({ ...prefs, iosHapticsEnabled: e.target.checked })}
        />
        <span>{t.iosHaptics}</span>
      </label>

      <label className="check-row nav-check">
        <input
          type="checkbox"
          checked={prefs.showFieldCapture}
          onChange={(e) => onChange({ ...prefs, showFieldCapture: e.target.checked })}
        />
        <span>{t.showFieldCapture}</span>
      </label>

      <div className="data-actions">
        <button type="button" className="control-button" onClick={onTestSonar}>
          {t.testSonar}
        </button>
        <button
          type="button"
          className="control-button control-button--secondary"
          onClick={onTestSpeech}
        >
          {t.testSpeech}
        </button>
      </div>

      <section className="safety-box" aria-label={t.safetyTipsHeading}>
        <h3>{t.safetyTipsHeading}</h3>
        <ul>
          <li>{t.safetyTipHeadphones}</li>
          <li>{t.safetyTipHoldFlat}</li>
          <li>{t.safetyTipScreenOn}</li>
          <li>{t.safetyTipBattery}</li>
        </ul>
      </section>

      <button type="button" className="big-button big-button--secondary" onClick={onClose}>
        {strings.navigator.closeSettings}
      </button>
    </section>
  );
}
