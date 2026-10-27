import { strings } from '../strings';

export function LiveSharingControl({
  enabled,
  onChange,
  status,
  compact = false,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  status: keyof typeof strings.live.sharing;
  compact?: boolean;
}) {
  const t = strings.live;
  return (
    <section className="live-sharing">
      <label className="check-row nav-check">
        <input type="checkbox" checked={enabled} onChange={(e) => onChange(e.target.checked)} />
        <span>{t.share}</span>
      </label>
      {!compact && (
        <>
          <p className="muted">{t.shareHint}</p>
          <p className="muted">{t.previewHint}</p>
        </>
      )}
      <p role="status" aria-live="polite">
        {t.sharing[status]}
      </p>
    </section>
  );
}
