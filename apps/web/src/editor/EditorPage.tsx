import { lazy, Suspense, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import type { CategoryRule, Geometry } from '@alouna/core';
import { useData } from '../data/context';
import { DataPanel } from '../data/DataPanel';
import { emptyData, type FeaturePayload, type Mutation } from '../data/types';
import { strings } from '../strings';
import { FeaturePanel } from './FeaturePanel';
import { ImportExportPanel } from './ImportExportPanel';
import type { BasemapId, DrawTool } from './MapView';
import { RulesPanel } from './RulesPanel';
import {
  computeEffectiveState,
  payloadFromFeature,
  validateCandidateFeature,
  validateCandidateRule,
} from './state';

const MapView = lazy(() => import('./MapView').then((m) => ({ default: m.MapView })));

type Tab = 'features' | 'selected' | 'rules' | 'import' | 'account';

const empty = emptyData(),
  subscribe = () => () => {},
  getEmpty = () => empty;

export function EditorPage() {
  const { store } = useData();
  const data = useSyncExternalStore(
    store?.subscribe ?? subscribe,
    store?.getSnapshot ?? getEmpty,
    getEmpty,
  );

  const [tab, setTab] = useState<Tab>('features');
  const [basemap, setBasemap] = useState<BasemapId>('orthophoto');
  const [tool, setTool] = useState<DrawTool>('pan');
  const [newCategory, setNewCategory] = useState('obstacle');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftGeometry, setDraftGeometry] = useState<Geometry | null>(null);
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(() => new Set());
  const [filterCategory, setFilterCategory] = useState('');
  const [showDisabled, setShowDisabled] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [fitTrigger, setFitTrigger] = useState(0);

  // Undo/redo stack of previous unsynced queue snapshots.
  const undoStack = useRef<Mutation[][]>([]);
  const redoStack = useRef<Mutation[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const effective = useMemo(() => computeEffectiveState(data), [data]);
  const isAdmin = data.profile?.role === 'admin';
  const selected = useMemo(
    () => effective.features.find((f) => f.feature.id === selectedId) ?? null,
    [effective.features, selectedId],
  );

  const syncHistoryFlags = () => {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  };

  const recordBeforeQueueChange = () => {
    undoStack.current.push(structuredClone(data.queue));
    if (undoStack.current.length > 40) undoStack.current.shift();
    redoStack.current = [];
    syncHistoryFlags();
  };

  const undo = async () => {
    if (!store || !undoStack.current.length) return;
    const prev = undoStack.current.pop()!;
    redoStack.current.push(structuredClone(data.queue));
    await store.replaceQueue(prev);
    syncHistoryFlags();
  };

  const redo = async () => {
    if (!store || !redoStack.current.length) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(structuredClone(data.queue));
    await store.replaceQueue(next);
    syncHistoryFlags();
  };

  const handleSaveFeature = async (id: string, baseRevision: number, payload: FeaturePayload) => {
    if (!store) return;
    validateCandidateFeature(id, payload, effective.rules);
    recordBeforeQueueChange();
    await store.enqueue({
      kind: 'save-feature',
      entityId: id,
      expectedRevision: baseRevision,
      payload,
    });
  };

  const handleDeleteFeature = async (id: string, baseRevision: number) => {
    if (!store) return;
    recordBeforeQueueChange();
    await store.enqueue({
      kind: 'delete-feature',
      entityId: id,
      expectedRevision: baseRevision,
      payload: null,
    });
  };

  const handleDiscardEntity = async (entityId: string) => {
    if (!store) return;
    recordBeforeQueueChange();
    await store.discardEntity(entityId);
  };

  const handleSaveRule = async (rule: CategoryRule, baseRevision: number) => {
    if (!store) return;
    validateCandidateRule(rule, effective.rules);
    recordBeforeQueueChange();
    await store.enqueue({
      kind: 'save-rule',
      entityId: rule.category,
      expectedRevision: baseRevision,
      payload: rule,
    });
  };

  const handleCreateFromDraw = async (geometry: Geometry, radius_m?: number) => {
    if (!store) return;
    const chosenCat =
      geometry.type !== 'Polygon' && newCategory === 'walkable_area' ? 'obstacle' : newCategory;
    const ruleLabel = effective.rules.find((r) => r.category === chosenCat)?.label ?? chosenCat;
    const id = crypto.randomUUID();
    const payload: FeaturePayload = {
      name: `New ${ruleLabel.toLowerCase()}`,
      category: chosenCat,
      geometry,
      radius_m: radius_m ?? (geometry.type === 'Point' && chosenCat === 'obstacle' ? 0.7 : null),
      width_m: geometry.type === 'LineString' && chosenCat === 'path' ? 1.5 : null,
      source: 'drawn',
      enabled: true,
      reviewed: isAdmin,
    };
    validateCandidateFeature(id, payload, effective.rules);
    recordBeforeQueueChange();
    await store.enqueue({
      kind: 'save-feature',
      entityId: id,
      expectedRevision: 0,
      payload,
    });
    setSelectedId(id);
    setDraftGeometry(null);
    setTool('select');
    setTab('selected');
  };

  const handleImportBatch = async (items: FeaturePayload[]): Promise<number> => {
    if (!store) return 0;
    const valid: Array<{ id: string; payload: FeaturePayload }> = [];
    for (const payload of items) {
      const id = crypto.randomUUID();
      validateCandidateFeature(id, payload, effective.rules);
      valid.push({ id, payload });
    }
    recordBeforeQueueChange();
    for (const { id, payload } of valid) {
      await store.enqueue({
        kind: 'save-feature',
        entityId: id,
        expectedRevision: 0,
        payload,
      });
    }
    return valid.length;
  };

  const toggleCategoryVisibility = (cat: string) => {
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const selectFeature = (id: string | null) => {
    setSelectedId(id);
    setDraftGeometry(null);
    if (id) setTab('selected');
  };

  const togglePlotEnabled = async (id: string) => {
    const item = effective.features.find((f) => f.feature.id === id);
    if (!item) return;
    const nextEnabled = item.feature.properties.enabled === false;
    await handleSaveFeature(
      id,
      item.baseRevision,
      payloadFromFeature(item.feature, {
        enabled: nextEnabled,
        reviewed: isAdmin ? true : false,
      }),
    );
  };

  const plots = effective.features.filter(
    (f) => f.feature.properties.category === 'walkable_area' && f.status !== 'deleted',
  );
  const filteredFeatures = effective.features.filter((item) => {
    const p = item.feature.properties;
    if (filterCategory && p.category !== filterCategory) return false;
    if (!showDisabled && p.enabled === false) return false;
    if (!showDeleted && item.status === 'deleted') return false;
    if (needsReviewOnly && item.status === 'approved') return false;
    return true;
  });

  const t = strings.editor;

  return (
    <main className="page editor-page">
      <header className="toolbar editor-header">
        <Link to="/">← {strings.appName}</Link>
        <h1>{t.title}</h1>
        {store && (
          <div className="toolbar-group" role="toolbar" aria-label={t.draw.label}>
            {(['pan', 'select', 'point', 'circle', 'line', 'polygon'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={tool === mode}
                className={`tool-button${tool === mode ? ' tool-button--active' : ''}`}
                onClick={() => setTool(mode)}
              >
                {t.draw[mode]}
              </button>
            ))}
            <label className="inline-field">
              <span className="sr-only">{t.draw.newCategory}</span>
              <select
                aria-label={t.draw.newCategory}
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              >
                {effective.rules.map((r) => (
                  <option key={r.category} value={r.category}>
                    + {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-field">
              <span className="sr-only">{t.basemaps.label}</span>
              <select
                aria-label={t.basemaps.label}
                value={basemap}
                onChange={(e) => setBasemap(e.target.value as BasemapId)}
              >
                <option value="orthophoto">{t.basemaps.orthophoto}</option>
                <option value="esri">{t.basemaps.esri}</option>
                <option value="osm">{t.basemaps.osm}</option>
              </select>
            </label>
            <button
              type="button"
              className="tool-button"
              onClick={() => setFitTrigger((n) => n + 1)}
            >
              {t.draw.fitAll}
            </button>
            <button
              type="button"
              className="tool-button"
              disabled={!canUndo}
              onClick={() => void undo()}
            >
              {t.draw.undo}
            </button>
            <button
              type="button"
              className="tool-button"
              disabled={!canRedo}
              onClick={() => void redo()}
            >
              {t.draw.redo}
            </button>
          </div>
        )}
      </header>

      {!store ? (
        <DataPanel />
      ) : (
        <div className="editor-workspace">
          <Suspense
            fallback={<div className="editor-map" role="region" aria-label="Property map" />}
          >
            <MapView
              features={effective.features}
              rules={effective.rules}
              hiddenCategories={hiddenCategories}
              showDisabled={showDisabled}
              showDeleted={showDeleted}
              selectedId={selectedId}
              basemap={basemap}
              tool={tool}
              fitTrigger={fitTrigger}
              onSelect={selectFeature}
              onCreateFromDraw={(geom, rad) => void handleCreateFromDraw(geom, rad)}
              onGeometryDraft={setDraftGeometry}
            />
          </Suspense>

          <aside className="editor-sidebar" aria-label="Editor panels">
            <nav className="tab-bar" role="tablist">
              {(['features', 'selected', 'rules', 'import', 'account'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={`tab-button${tab === id ? ' tab-button--active' : ''}`}
                  onClick={() => setTab(id)}
                >
                  {t.tabs[id]}
                </button>
              ))}
            </nav>

            <div className="sidebar-body">
              {tab === 'features' && (
                <div className="editor-form">
                  {plots.length > 0 && (
                    <section aria-label={t.list.plotsHeading}>
                      <h2>{t.list.plotsHeading}</h2>
                      <ul className="feature-list">
                        {plots.map((item) => {
                          const p = item.feature.properties;
                          const editable = isAdmin || item.own;
                          return (
                            <li key={item.feature.id} className="feature-row">
                              <label className="check-row">
                                <input
                                  type="checkbox"
                                  checked={p.enabled !== false}
                                  disabled={!editable}
                                  aria-label={`Enable ${p.name || item.feature.id}`}
                                  onChange={() => void togglePlotEnabled(item.feature.id)}
                                />
                                <span>
                                  {p.name || item.feature.id}
                                  {p.owner_label ? ` (${p.owner_label})` : ''}
                                </span>
                              </label>
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => selectFeature(item.feature.id)}
                              >
                                Edit
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  )}

                  <section aria-label={t.list.itemsHeading}>
                    <h2>{t.list.itemsHeading}</h2>
                    <label htmlFor="filter-cat">{t.list.filterCategory}</label>
                    <select
                      id="filter-cat"
                      value={filterCategory}
                      onChange={(e) => setFilterCategory(e.target.value)}
                    >
                      <option value="">{t.list.filterCategory}</option>
                      {effective.rules.map((r) => (
                        <option key={r.category} value={r.category}>
                          {r.label}
                        </option>
                      ))}
                    </select>

                    <div className="legend-grid" role="group" aria-label="Category visibility">
                      {effective.rules.map((r) => (
                        <label key={r.category} className="legend-chip">
                          <input
                            type="checkbox"
                            checked={!hiddenCategories.has(r.category)}
                            aria-label={t.list.toggleVisibility(r.label)}
                            onChange={() => toggleCategoryVisibility(r.category)}
                          />
                          <span className="swatch" style={{ background: r.color }} />
                          <span>{r.label}</span>
                        </label>
                      ))}
                    </div>

                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={showDisabled}
                        onChange={(e) => setShowDisabled(e.target.checked)}
                      />
                      {t.list.showDisabled}
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={needsReviewOnly}
                        onChange={(e) => setNeedsReviewOnly(e.target.checked)}
                      />
                      {t.list.needsReviewOnly}
                    </label>
                    {isAdmin && (
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={showDeleted}
                          onChange={(e) => setShowDeleted(e.target.checked)}
                        />
                        {t.list.showDeleted}
                      </label>
                    )}

                    {filteredFeatures.length === 0 ? (
                      <p className="muted">{t.list.empty}</p>
                    ) : (
                      <ul className="feature-list">
                        {filteredFeatures.map((item) => {
                          const p = item.feature.properties;
                          const color =
                            effective.rules.find((r) => r.category === p.category)?.color ?? '#888';
                          return (
                            <li key={item.feature.id} className="feature-row">
                              <button
                                type="button"
                                className={`feature-pick${item.feature.id === selectedId ? ' feature-pick--active' : ''}`}
                                onClick={() => selectFeature(item.feature.id)}
                              >
                                <span className="swatch" style={{ background: color }} />
                                <span>
                                  {p.name || item.feature.id}
                                  {p.enabled === false ? strings.data.disabled : ''}
                                </span>
                                {item.status !== 'approved' && (
                                  <span className={`badge badge--${item.status}`}>
                                    {t.status[item.status]}
                                  </span>
                                )}
                                {item.queued && <span className="badge">{t.status.queued}</span>}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                </div>
              )}

              {tab === 'selected' && (
                <FeaturePanel
                  key={`${selected?.feature.id ?? 'none'}:${selected?.feature.properties.revision ?? 0}:${selected?.queued ? 1 : 0}`}
                  selected={selected}
                  rules={effective.rules}
                  isAdmin={isAdmin}
                  draftGeometry={draftGeometry}
                  onClearDraftGeometry={() => setDraftGeometry(null)}
                  onSave={handleSaveFeature}
                  onDelete={handleDeleteFeature}
                  onDiscardLocal={handleDiscardEntity}
                />
              )}

              {tab === 'rules' && (
                <RulesPanel
                  rules={effective.rules}
                  baseRules={data.snapshot?.rules ?? effective.rules}
                  ruleErrors={effective.ruleQueueErrors}
                  isAdmin={isAdmin}
                  onSaveRule={handleSaveRule}
                  onDiscardRule={handleDiscardEntity}
                />
              )}

              {tab === 'import' && (
                <ImportExportPanel
                  features={effective.features}
                  rules={effective.rules}
                  version={data.snapshot?.version ?? '0'}
                  isAdmin={isAdmin}
                  onImportBatch={handleImportBatch}
                />
              )}

              {tab === 'account' && <DataPanel />}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
