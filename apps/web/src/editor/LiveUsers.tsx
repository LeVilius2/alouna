import type { MapFeature } from '@alouna/core';
import { freshPosition, type LiveUser } from '../data/livePosition';
import { strings } from '../strings';

export function LiveUsers({
  users,
  now,
  error,
  unavailable,
  features,
  showTrails,
  onTrails,
  onFocus,
}: {
  users: readonly LiveUser[];
  now: number;
  error: boolean;
  unavailable: boolean;
  features: readonly MapFeature[];
  showTrails: boolean;
  onTrails: (enabled: boolean) => void;
  onFocus: (key: string) => void;
}) {
  const t = strings.live;
  return (
    <section className="editor-form live-users" aria-label={t.heading}>
      <h2>{t.heading}</h2>
      <p className="muted">{t.privacy}</p>
      {unavailable ? (
        <p role="status">{t.unavailable}</p>
      ) : (
        error && <p role="status">{t.reconnecting}</p>
      )}
      <label className="check-row">
        <input type="checkbox" checked={showTrails} onChange={(e) => onTrails(e.target.checked)} />
        {t.showTrail}
      </label>
      {!users.length && <p role="status">{t.waiting}</p>}
      <ul className="live-user-list">
        {users.map((user) => {
          const p = user.packet,
            position = freshPosition(user, now),
            name = user.name || t.unnamed;
          const destination = p?.destination_id
            ? features.find((f) => f.id === p.destination_id)
            : null;
          return (
            <li key={user.key} className="live-user-card">
              <h3>{t.device(name, user.sessionId)}</h3>
              <div className="badge-row">
                <span className="badge">{user.online ? t.online : t.offline}</span>
                {p && (
                  <>
                    <span className="badge">{p.source === 'simulator' ? t.simulated : t.gps}</span>
                    <span className="badge">{t.statuses[p.status]}</span>
                  </>
                )}
              </div>
              <p>
                {user.receivedAt
                  ? t.lastSeen(Math.max(0, (now - user.receivedAt) / 1000))
                  : t.neverSeen}
              </p>
              {!position ? (
                <p className="route-warning">{t.stale}</p>
              ) : (
                <>
                  {p?.accuracy !== null && p?.accuracy !== undefined && (
                    <p>
                      {t.accuracy(p.accuracy)}
                      {p.accuracy > 15 ? ` · ${t.weak}` : ''}
                    </p>
                  )}
                  {p?.heading !== null && p?.heading !== undefined && (
                    <p>{t.headingValue(p.heading)}</p>
                  )}
                  {p?.battery !== null && p?.battery !== undefined && <p>{t.battery(p.battery)}</p>}
                  {p?.destination_id && (
                    <p>{t.destination(destination?.properties.name || t.unknownDestination)}</p>
                  )}
                  {p?.route_progress !== null && p?.route_progress !== undefined && (
                    <p>{t.progress(p.route_progress * 100, p.remaining_m)}</p>
                  )}
                </>
              )}
              <button
                className="control-button control-button--secondary"
                type="button"
                disabled={!position}
                onClick={() => onFocus(user.key)}
              >
                {t.focus(name)}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
