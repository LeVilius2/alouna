import { Link } from 'react-router';
import { strings } from './strings';

export function HomePage() {
  return (
    <main className="page page--center">
      <h1>{strings.appName}</h1>
      <p className="muted">{strings.home.tagline}</p>
      <nav className="stack" aria-label="Choose mode">
        <Link className="big-button" to="/navigate" aria-describedby="nav-hint">
          {strings.home.openNavigator}
          <span id="nav-hint" className="big-button__hint">
            {strings.home.openNavigatorHint}
          </span>
        </Link>
        <Link className="big-button big-button--secondary" to="/editor" aria-describedby="ed-hint">
          {strings.home.openEditor}
          <span id="ed-hint" className="big-button__hint">
            {strings.home.openEditorHint}
          </span>
        </Link>
      </nav>
    </main>
  );
}
