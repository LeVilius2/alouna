import { Link } from 'react-router';
import { strings } from '../strings';

/** Placeholder – the navigator is built in M5. Must stay fully VoiceOver-accessible. */
export function NavigatorPage() {
  return (
    <main className="page page--center navigator">
      <h1>{strings.navigator.title}</h1>
      <p aria-live="polite">{strings.navigator.placeholder}</p>
      <Link className="big-button" to="/">
        {strings.navigator.back}
      </Link>
    </main>
  );
}
