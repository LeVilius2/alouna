import type { RouteEvent } from '@alouna/core';
import { strings } from '../strings';
import { pointDestinations, type Endpoint, type RouteMapOverlay } from './routeState';
import type { RouteTesterState } from './useRouteTester';
import { Simulator } from './Simulator';

export function RouteTester({
  test,
  isAdmin,
  onPick,
  onWalker,
}: {
  test: RouteTesterState;
  isAdmin: boolean;
  onPick: (endpoint: Endpoint) => void;
  onWalker: (walker: RouteMapOverlay['walker']) => void;
}) {
  const t = strings.editor.route;
  const destinations = pointDestinations(test.map?.features ?? []);
  const route = test.result?.result;
  const hasArea = test.map?.features.some(
    (f) => f.properties.category === 'walkable_area' && f.properties.enabled !== false,
  );
  const label = (category: string) =>
    category === 'outside_walkable_area'
      ? t.outside
      : (test.map?.rules.find((r) => r.category === category)?.label ?? category);
  const eventText = (event: RouteEvent) =>
    event.kind === 'turn'
      ? t.turn(event.direction, event.angleDegrees)
      : event.category === 'crossing'
        ? t.crossing
        : event.kind === 'enter'
          ? t.enter(label(event.category))
          : t.hazard(label(event.category));
  return (
    <div className="editor-form route-tester">
      <h2>{t.heading}</h2>
      <p className="muted">{t.hint}</p>
      <label>
        {t.source}
        <select
          value={test.source}
          onChange={(e) => test.setSource(e.target.value as 'approved' | 'preview')}
        >
          <option value="approved">{t.approved}</option>
          {isAdmin && <option value="preview">{t.preview}</option>}
        </select>
      </label>
      <p className={test.source === 'preview' ? 'route-warning' : 'muted'}>
        {test.source === 'approved' ? t.approvedHint : t.previewHint}
      </p>
      {!test.map ? <p role="alert">{t.unavailable}</p> : !hasArea && <p role="alert">{t.noArea}</p>}
      {(['start', 'end'] as const).map((endpoint) => (
        <fieldset key={endpoint}>
          <legend>{t[endpoint]}</legend>
          <p>{test[endpoint] ? t.coordinate(test[endpoint]) : t.unset}</p>
          <button
            type="button"
            aria-pressed={test.picking === endpoint}
            onClick={() => onPick(endpoint)}
          >
            {endpoint === 'start' ? t.pickStart : t.pickEnd}
          </button>
          <label>
            <span className="sr-only">
              {t[endpoint]} · {t.pointDestination}
            </span>
            <select
              aria-label={`${t[endpoint]} · ${t.pointDestination}`}
              value=""
              onChange={(e) => {
                const dest = destinations.find((d) => d.id === e.target.value);
                if (dest?.geometry.type === 'Point') {
                  (endpoint === 'start' ? test.setStart : test.setEnd)(dest.geometry.coordinates);
                  test.setPicking(null);
                }
              }}
            >
              <option value="">{t.pointDestination}</option>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.properties.name || d.id}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      ))}
      <p className="muted">{t.pointHint}</p>
      {test.picking && (
        <p role="status">{test.picking === 'start' ? t.pickingStart : t.pickingEnd}</p>
      )}
      <label className="check-row">
        <input
          type="checkbox"
          checked={test.showCosts}
          onChange={(e) => test.setShowCosts(e.target.checked)}
        />
        {t.costs}
      </label>
      {test.showCosts && (
        <>
          <p className="muted">{t.costHint}</p>
          {test.bounds && (
            <p>{t.viewport(test.bounds[2] - test.bounds[0], test.bounds[3] - test.bounds[1])}</p>
          )}
          <p className="cost-legend">{t.costLegend}</p>
        </>
      )}
      <button
        type="button"
        disabled={!test.map || !hasArea || !test.start || !test.end || test.busy}
        onClick={test.run}
      >
        {test.busy ? t.calculating : t.calculate}
      </button>
      {test.busy && (
        <button type="button" onClick={test.cancel}>
          {t.cancel}
        </button>
      )}
      <button type="button" onClick={test.clear}>
        {t.clear}
      </button>
      {test.failed && <p role="alert">{t.failed}</p>}
      {test.showCosts && test.result?.debug?.status === 'too-large' && (
        <p role="status">{t.zoomIn(test.result.debug.cellCount)}</p>
      )}
      {test.showCosts && test.result?.debug?.status === 'ok' && (
        <p role="status">
          {t.gridSummary(
            test.result.debug.columns * test.result.debug.rows,
            test.result.debug.cellSizeM,
          )}
        </p>
      )}
      {route && route.status !== 'ok' && (
        <section role="status">
          <h3>{t.why}</h3>
          <p>{t.failures[route.status]}</p>
        </section>
      )}
      {test.result &&
        (['start', 'end'] as const)
          .filter((endpoint) => !test.result!.endpoints[endpoint].passable)
          .map((endpoint) => (
            <p className="route-warning" key={endpoint}>
              {t.endpointBlocked(
                t[endpoint],
                test.result!.endpoints[endpoint].blockedBy.map(label).join(', '),
              )}
            </p>
          ))}
      {route?.status === 'ok' && (
        <>
          <p role="status">{t.summary(route.distanceM, route.cost, route.visited)}</p>
          {route.snaps.map((snap) => (
            <p className="route-warning" key={snap.endpoint}>
              {t.snap(t[snap.endpoint], snap.distanceM)}
            </p>
          ))}
          <h3>{t.events}</h3>
          {route.events.length ? (
            <ol className="route-events">
              {route.events.map((event, i) => (
                <li key={i}>
                  {t.eventDistance(event.distanceM)}: {eventText(event)}
                </li>
              ))}
            </ol>
          ) : (
            <p>{t.noEvents}</p>
          )}
          <Simulator
            key={test.result!.id}
            waypoints={route.waypoints}
            events={route.events}
            snaps={route.snaps}
            features={test.map?.features ?? []}
            rules={test.map?.rules ?? []}
            onWalker={onWalker}
          />
        </>
      )}
    </div>
  );
}
