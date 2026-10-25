import { Link } from 'react-router';
import { strings } from './strings';

export function NotFoundPage() {
  return (
    <main className="page page--center">
      <p role="alert">{strings.notFound}</p>
      <Link className="big-button" to="/">
        {strings.navigator.back}
      </Link>
    </main>
  );
}
