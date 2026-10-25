import { Link } from 'react-router';
import { strings } from '../strings';

/** Placeholder – the map editor is built in M3/M4. */
export function EditorPage() {
  return (
    <main className="page">
      <header className="toolbar">
        <Link to="/">← {strings.appName}</Link>
        <h1>{strings.editor.title}</h1>
      </header>
      <p className="muted">{strings.editor.placeholder}</p>
    </main>
  );
}
