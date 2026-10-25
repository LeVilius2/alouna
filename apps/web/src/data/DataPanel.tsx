import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { strings } from '../strings';
import { useData } from './context';
import { emptyData } from './types';

const empty = emptyData(),
  subscribe = () => () => {},
  getEmpty = () => empty;

/** M2 exposes account/cache health; map editing remains M3. */
export function DataPanel() {
  const { configured, client, store, offline, signOut } = useData();
  const data = useSyncExternalStore(
    store?.subscribe ?? subscribe,
    store?.getSnapshot ?? getEmpty,
    getEmpty,
  );
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmLogout, setConfirmLogout] = useState(false);
  const text = strings.data;
  const login = async (event: FormEvent) => {
    event.preventDefault();
    if (!client) return;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await client.auth.signInWithPassword({ email, password });
      setMessage(error ? text.signInFailed : '');
    } catch {
      setMessage(text.signInFailed);
    } finally {
      setPassword('');
      setBusy(false);
    }
  };
  const logout = async () => {
    if (data.queue.length && !confirmLogout) {
      setConfirmLogout(true);
      return;
    }
    setBusy(true);
    try {
      await signOut();
      setConfirmLogout(false);
    } finally {
      setBusy(false);
    }
  };
  const status = data.error
    ? text.errors[data.error]
    : offline
      ? text.offline
      : data.snapshot
        ? text.ready
        : text.loading;
  return (
    <section className="data-panel" aria-label={text.title}>
      <h2>{text.title}</h2>
      {!configured ? (
        <p role="status">{text.notConfigured}</p>
      ) : !store ? (
        <form onSubmit={(event) => void login(event)} className="stack">
          <p>{text.signInHint}</p>
          <label htmlFor="sign-in-email">{text.email}</label>
          <input
            id="sign-in-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="sign-in-password">{text.password}</label>
          <input
            id="sign-in-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button className="control-button" disabled={busy || offline}>
            {busy ? text.signingIn : text.signIn}
          </button>
          <p role="status" aria-live="polite">
            {message}
          </p>
        </form>
      ) : (
        <>
          <p role="status" aria-live="polite">
            {status}
          </p>
          {data.profile && (
            <p>
              {data.profile.display_name} ·{' '}
              {data.profile.role === 'admin' ? text.admin : text.walker}
            </p>
          )}
          <p>{text.pending(data.queue.length)}</p>
          {data.snapshot && data.error !== 'denied' && data.error !== 'invalid-data' && (
            <>
              <p>{text.version(data.snapshot.version)}</p>
              <p>{text.cached(new Date(data.snapshot.fetchedAt).toLocaleString())}</p>
              <ul>
                {data.snapshot.features.map((f) => (
                  <li key={f.id}>
                    {f.properties.name}
                    {f.properties.enabled === false ? text.disabled : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.queue.some((m) => m.status !== 'pending') && (
            <p role="alert">{text.reviewConflicts}</p>
          )}
          <div className="data-actions">
            <button
              className="control-button"
              disabled={busy || offline}
              onClick={() => {
                setBusy(true);
                void store.sync().finally(() => setBusy(false));
              }}
            >
              {text.sync}
            </button>
            <button
              className="control-button control-button--secondary"
              disabled={busy}
              onClick={() => void logout()}
            >
              {confirmLogout ? text.confirmSignOut(data.queue.length) : text.signOut}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
