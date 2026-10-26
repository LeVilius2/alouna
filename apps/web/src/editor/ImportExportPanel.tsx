import { useMemo, useState, type ChangeEvent } from 'react';
import { IMPORT_CRS, type CategoryRule, type ImportCrs, type JoinMode } from '@alouna/core';
import type { FeaturePayload } from '../data/types';
import { strings } from '../strings';
import { parseImportInput, type ImportFormat } from './fileImport';
import { buildExportBundle, type EffectiveFeature } from './state';

export function ImportExportPanel({
  features,
  rules,
  version,
  isAdmin,
  onImportBatch,
}: {
  features: readonly EffectiveFeature[];
  rules: readonly CategoryRule[];
  version: string;
  isAdmin: boolean;
  onImportBatch: (items: FeaturePayload[]) => Promise<number>;
}) {
  const t = strings.editor.importExport;
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('');
  const [format, setFormat] = useState<ImportFormat>('auto');
  const [crs, setCrs] = useState<ImportCrs | 'auto'>('auto');
  const [join, setJoin] = useState<JoinMode>('points');
  const [category, setCategory] = useState('obstacle');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const preview = useMemo(() => {
    if (!text.trim()) return null;
    return parseImportInput(text, { filename, format, crs, join });
  }, [text, filename, format, crs, join]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setText(await file.text());
    setNotice('');
    setError('');
  };

  const runImport = async () => {
    if (!preview || !preview.features.length) return;
    setNotice('');
    setError('');
    try {
      const catSet = new Set(rules.map((r) => r.category));
      const payloads: FeaturePayload[] = preview.features.map((item, idx) => {
        const rawCat =
          typeof item.properties.category === 'string' && catSet.has(item.properties.category)
            ? item.properties.category
            : category;
        const chosenCat =
          rawCat === 'walkable_area' && item.geometry.type !== 'Polygon' ? 'obstacle' : rawCat;
        const rawName =
          typeof item.properties.name === 'string'
            ? item.properties.name
            : typeof item.properties.title === 'string'
              ? item.properties.title
              : `${chosenCat} ${idx + 1}`;
        return {
          name: rawName,
          category: chosenCat,
          geometry: item.geometry,
          source: 'import',
          enabled: true,
          reviewed: isAdmin,
        };
      });
      const count = await onImportBatch(payloads);
      setNotice(t.imported(count));
      setText('');
      setFilename('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const downloadExport = () => {
    const bundle = buildExportBundle(features, rules, version);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alouna-backup-v${version || 'local'}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="editor-form">
      <h2>{t.importHeading}</h2>

      <label htmlFor="import-file">{t.fileLabel}</label>
      <input
        id="import-file"
        type="file"
        accept=".geojson,.json,.kml,.gpx,.csv,.tsv,.txt"
        onChange={(e) => void onFile(e)}
      />

      <label htmlFor="import-paste">{t.pasteLabel}</label>
      <textarea
        id="import-paste"
        rows={5}
        value={text}
        placeholder="25.6953, 55.6363, Birch tree"
        onChange={(e) => {
          setText(e.target.value);
          setNotice('');
          setError('');
        }}
      />

      <label htmlFor="import-format">{t.format}</label>
      <select
        id="import-format"
        value={format}
        onChange={(e) => setFormat(e.target.value as ImportFormat)}
      >
        <option value="auto">Auto</option>
        <option value="geojson">GeoJSON</option>
        <option value="kml">KML</option>
        <option value="gpx">GPX</option>
        <option value="csv">CSV / text coordinates</option>
      </select>

      <label htmlFor="import-crs">{t.crs}</label>
      <select
        id="import-crs"
        value={crs}
        onChange={(e) => setCrs(e.target.value as ImportCrs | 'auto')}
      >
        <option value="auto">{t.crsOptions.auto}</option>
        {IMPORT_CRS.map((c) => (
          <option key={c} value={c}>
            {t.crsOptions[c]}
          </option>
        ))}
      </select>

      {(format === 'auto' || format === 'csv') && (
        <>
          <label htmlFor="import-join">{t.join}</label>
          <select
            id="import-join"
            value={join}
            onChange={(e) => setJoin(e.target.value as JoinMode)}
          >
            <option value="points">{t.joinOptions.points}</option>
            <option value="line">{t.joinOptions.line}</option>
            <option value="polygon">{t.joinOptions.polygon}</option>
          </select>
        </>
      )}

      <label htmlFor="import-cat">{t.defaultCategory}</label>
      <select id="import-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
        {rules.map((r) => (
          <option key={r.category} value={r.category}>
            {r.label} ({r.category})
          </option>
        ))}
      </select>

      {preview && (
        <div className="import-preview" role="status" aria-live="polite">
          <p>{t.previewCount(preview.features.length, preview.crs)}</p>
          {preview.warnings.length > 0 && (
            <ul className="warn-list">
              {preview.warnings.slice(0, 5).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <button
        type="button"
        className="control-button"
        disabled={!preview || preview.features.length === 0}
        onClick={() => void runImport()}
      >
        {t.importButton(preview?.features.length ?? 0)}
      </button>

      <hr />
      <h2>{t.exportHeading}</h2>
      <p className="muted">{t.exportHint}</p>
      <button
        type="button"
        className="control-button control-button--secondary"
        onClick={downloadExport}
      >
        {t.exportButton}
      </button>
    </div>
  );
}
