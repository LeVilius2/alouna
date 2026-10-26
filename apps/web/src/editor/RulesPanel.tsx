import { useState } from 'react';
import type { CategoryRule } from '@alouna/core';
import { strings } from '../strings';

export function RulesPanel({
  rules,
  baseRules,
  ruleErrors,
  isAdmin,
  onSaveRule,
  onDiscardRule,
}: {
  rules: readonly CategoryRule[];
  baseRules: readonly CategoryRule[];
  ruleErrors: ReadonlyMap<string, string>;
  isAdmin: boolean;
  onSaveRule: (rule: CategoryRule, baseRevision: number) => Promise<void>;
  onDiscardRule: (category: string) => Promise<void>;
}) {
  const t = strings.editor.rules;
  const baseRev = (cat: string) => baseRules.find((r) => r.category === cat)?.revision ?? 1;

  return (
    <div className="rules-list">
      <h2>{t.heading}</h2>
      {!isAdmin && <p role="note">{t.readOnly}</p>}
      {rules.map((r) => (
        <RuleRow
          key={`${r.category}:${r.revision ?? 1}:${r.color}:${r.cost}:${r.buffer_m}:${r.warn_m}:${r.passable}`}
          rule={r}
          baseRevision={baseRev(r.category)}
          error={ruleErrors.get(r.category) ?? null}
          isAdmin={isAdmin}
          onSave={onSaveRule}
          onDiscard={onDiscardRule}
        />
      ))}
    </div>
  );
}

function RuleRow({
  rule,
  baseRevision,
  error,
  isAdmin,
  onSave,
  onDiscard,
}: {
  rule: CategoryRule;
  baseRevision: number;
  error: string | null;
  isAdmin: boolean;
  onSave: (rule: CategoryRule, baseRevision: number) => Promise<void>;
  onDiscard: (category: string) => Promise<void>;
}) {
  const t = strings.editor.rules;
  const [label, setLabel] = useState(rule.label);
  const [passable, setPassable] = useState(rule.passable);
  const [cost, setCost] = useState(String(rule.cost));
  const [buffer, setBuffer] = useState(String(rule.buffer_m));
  const [warn, setWarn] = useState(rule.warn_m != null ? String(rule.warn_m) : '');
  const [priority, setPriority] = useState(String(rule.priority));
  const [color, setColor] = useState(rule.color);
  const [overrides, setOverrides] = useState(rule.overrides.join(', '));
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const save = async () => {
    setMsg('');
    setErr('');
    try {
      const ov = passable
        ? overrides
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const next: CategoryRule = {
        category: rule.category,
        label: label.trim() || rule.category,
        passable,
        cost: Number(cost),
        buffer_m: Number(buffer),
        warn_m: warn.trim() === '' ? null : Number(warn),
        priority: Number(priority),
        color: color.trim(),
        overrides: ov,
        revision: rule.revision,
      };
      await onSave(next, baseRevision);
      setMsg(t.saved);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <details className="rule-card">
      <summary>
        <span className="swatch" style={{ background: color }} />
        <strong>{rule.label}</strong> <span className="muted">({rule.category})</span>
        {error && <span className="badge badge--danger">{error}</span>}
      </summary>
      <div className="editor-form">
        <label>
          Label
          <input value={label} disabled={!isAdmin} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={passable}
            disabled={!isAdmin}
            onChange={(e) => setPassable(e.target.checked)}
          />
          {t.passable}
        </label>
        <label>
          {t.cost}
          <input
            type="number"
            step="0.1"
            min="0.01"
            value={cost}
            disabled={!isAdmin}
            onChange={(e) => setCost(e.target.value)}
          />
        </label>
        <label>
          {t.buffer}
          <input
            type="number"
            step="0.1"
            min="0"
            value={buffer}
            disabled={!isAdmin}
            onChange={(e) => setBuffer(e.target.value)}
          />
        </label>
        <label>
          {t.warn}
          <input
            type="number"
            step="0.5"
            min="0"
            value={warn}
            disabled={!isAdmin}
            onChange={(e) => setWarn(e.target.value)}
          />
        </label>
        <label>
          {t.priority}
          <input
            type="number"
            step="1"
            value={priority}
            disabled={!isAdmin}
            onChange={(e) => setPriority(e.target.value)}
          />
        </label>
        <label>
          {t.color}
          <input value={color} disabled={!isAdmin} onChange={(e) => setColor(e.target.value)} />
        </label>
        <label>
          {t.overrides}
          <input
            value={overrides}
            disabled={!isAdmin || !passable}
            onChange={(e) => setOverrides(e.target.value)}
          />
        </label>
        {err && <p role="alert">{err}</p>}
        {msg && <p role="status">{msg}</p>}
        {isAdmin && (
          <div className="data-actions">
            <button type="button" className="control-button" onClick={() => void save()}>
              {t.save}
            </button>
            {error && (
              <button
                type="button"
                className="control-button control-button--secondary"
                onClick={() => void onDiscard(rule.category)}
              >
                {strings.editor.inspector.discardLocal}
              </button>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
