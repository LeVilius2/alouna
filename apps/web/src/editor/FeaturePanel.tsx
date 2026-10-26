import { useState, type FormEvent } from 'react';
import type { CategoryRule, Geometry } from '@alouna/core';
import type { FeaturePayload } from '../data/types';
import { strings } from '../strings';
import { payloadFromFeature, type EffectiveFeature } from './state';

export function FeaturePanel({
  selected,
  rules,
  isAdmin,
  draftGeometry,
  onClearDraftGeometry,
  onSave,
  onDelete,
  onDiscardLocal,
}: {
  selected: EffectiveFeature | null;
  rules: readonly CategoryRule[];
  isAdmin: boolean;
  draftGeometry: Geometry | null;
  onClearDraftGeometry: () => void;
  onSave: (id: string, baseRevision: number, payload: FeaturePayload) => Promise<void>;
  onDelete: (id: string, baseRevision: number) => Promise<void>;
  onDiscardLocal: (id: string) => Promise<void>;
}) {
  const t = strings.editor.inspector;
  const s = strings.editor.status;
  const f = selected?.feature ?? null;
  const p = f?.properties;
  const editable = !!selected && (isAdmin || selected.own) && selected.status !== 'deleted';

  const [name, setName] = useState(p?.name ?? '');
  const [spokenName, setSpokenName] = useState(p?.spoken_name ?? '');
  const [category, setCategory] = useState(p?.category ?? 'obstacle');
  const [width, setWidth] = useState(p?.width_m != null ? String(p.width_m) : '');
  const [radius, setRadius] = useState(p?.radius_m != null ? String(p.radius_m) : '');
  const [owner, setOwner] = useState(p?.owner_label ?? '');
  const [destination, setDestination] = useState(Boolean(p?.is_destination));
  const [enabled, setEnabled] = useState(p?.enabled !== false);
  const [notes, setNotes] = useState(p?.notes ?? '');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!selected || !f || !p) {
    return <p className="muted">{t.noneSelected}</p>;
  }

  const geom = draftGeometry ?? f.geometry;
  const allowedRules = rules.filter(
    (r) => geom.type === 'Polygon' || r.category !== 'walkable_area',
  );

  const buildPayload = (reviewedOverride?: boolean): FeaturePayload => {
    const parseOpt = (raw: string): number | null => {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) throw new RangeError('Size must be a non-negative number.');
      return n;
    };
    return payloadFromFeature(f, {
      name: name.trim(),
      spoken_name: spokenName.trim(),
      category,
      geometry: geom,
      width_m: geom.type === 'LineString' ? parseOpt(width) : null,
      radius_m: geom.type === 'Point' ? parseOpt(radius) : null,
      owner_label: category === 'walkable_area' ? owner.trim() : '',
      is_destination: destination,
      enabled,
      notes: notes.trim(),
      reviewed: reviewedOverride ?? (isAdmin ? true : false),
    });
  };

  const submit = async (event: FormEvent, approve = false) => {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      await onSave(f.id, selected.baseRevision, buildPayload(approve ? true : undefined));
      onClearDraftGeometry();
      setNotice(t.saved);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <form className="editor-form" onSubmit={(e) => void submit(e)}>
      <div className="badge-row">
        <span className={`badge badge--${selected.status}`}>{s[selected.status]}</span>
        {selected.queued && <span className="badge">{s.queued}</span>}
        {selected.queueError && <span className="badge badge--danger">{s.conflict}</span>}
        <span className="muted">{geom.type}</span>
      </div>
      {selected.created_by_name && <p className="muted">{t.createdBy(selected.created_by_name)}</p>}
      {p.gps_accuracy_m != null && <p className="muted">{t.gpsAccuracy(p.gps_accuracy_m)}</p>}
      {!editable && selected.status !== 'deleted' && <p role="note">{t.readOnlyWalker}</p>}

      <label htmlFor="feat-name">{t.name}</label>
      <input
        id="feat-name"
        value={name}
        disabled={!editable}
        onChange={(e) => setName(e.target.value)}
      />

      <label htmlFor="feat-spoken">{t.spokenName}</label>
      <input
        id="feat-spoken"
        value={spokenName}
        disabled={!editable}
        onChange={(e) => setSpokenName(e.target.value)}
      />

      <label htmlFor="feat-category">{t.category}</label>
      <select
        id="feat-category"
        value={category}
        disabled={!editable}
        onChange={(e) => setCategory(e.target.value)}
      >
        {allowedRules.map((r) => (
          <option key={r.category} value={r.category}>
            {r.label} ({r.category})
          </option>
        ))}
      </select>

      {geom.type === 'LineString' && (
        <>
          <label htmlFor="feat-width">{t.width}</label>
          <input
            id="feat-width"
            type="number"
            min="0"
            step="0.1"
            value={width}
            disabled={!editable}
            onChange={(e) => setWidth(e.target.value)}
          />
        </>
      )}

      {geom.type === 'Point' && (
        <>
          <label htmlFor="feat-radius">{t.radius}</label>
          <input
            id="feat-radius"
            type="number"
            min="0"
            step="0.1"
            value={radius}
            disabled={!editable}
            onChange={(e) => setRadius(e.target.value)}
          />
        </>
      )}

      {category === 'walkable_area' && (
        <>
          <label htmlFor="feat-owner">{t.owner}</label>
          <input
            id="feat-owner"
            value={owner}
            disabled={!editable}
            onChange={(e) => setOwner(e.target.value)}
          />
        </>
      )}

      <label className="check-row">
        <input
          type="checkbox"
          checked={destination}
          disabled={!editable}
          onChange={(e) => setDestination(e.target.checked)}
        />
        {t.destination}
      </label>

      <label className="check-row">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!editable}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        {t.enabled}
      </label>

      <label htmlFor="feat-notes">{t.notes}</label>
      <textarea
        id="feat-notes"
        rows={3}
        value={notes}
        disabled={!editable}
        onChange={(e) => setNotes(e.target.value)}
      />

      <p className="muted">
        {t.source}: {p.source ?? 'drawn'} · {t.revision(p.revision ?? 1)}
      </p>

      {error && <p role="alert">{error}</p>}
      {notice && (
        <p role="status" aria-live="polite">
          {notice}
        </p>
      )}

      <div className="data-actions">
        {editable && (
          <button type="submit" className="control-button">
            {t.save}
          </button>
        )}
        {isAdmin && (selected.status === 'pending-new' || selected.status === 'pending-edit') && (
          <button type="button" className="control-button" onClick={(e) => void submit(e, true)}>
            {t.approve}
          </button>
        )}
        {isAdmin && selected.status === 'pending-delete' && (
          <button
            type="button"
            className="control-button control-button--danger"
            onClick={() => void onDelete(f.id, selected.baseRevision)}
          >
            {t.approve}
          </button>
        )}
        {isAdmin && selected.status === 'deleted' && (
          <button type="button" className="control-button" onClick={(e) => void submit(e, true)}>
            {t.restore}
          </button>
        )}
        {draftGeometry && (
          <button
            type="button"
            className="control-button control-button--secondary"
            onClick={onClearDraftGeometry}
          >
            {t.revertGeometry}
          </button>
        )}
        {editable && selected.status !== 'pending-delete' && (
          <button
            type="button"
            className="control-button control-button--danger"
            onClick={() => void onDelete(f.id, selected.baseRevision)}
          >
            {t.delete}
          </button>
        )}
        {selected.queued && (
          <button
            type="button"
            className="control-button control-button--secondary"
            onClick={() => void onDiscardLocal(f.id)}
          >
            {t.discardLocal}
          </button>
        )}
      </div>
    </form>
  );
}
