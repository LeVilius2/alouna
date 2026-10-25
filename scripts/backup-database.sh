#!/usr/bin/env bash
# Root on the Alouna VPS. Full ownership/ACL dump; no credentials in argv or logs.
set -euo pipefail
umask 077
alouna_stack=${1:?Coolify Supabase service UUID required}
[[ "$alouna_stack" =~ ^[a-z0-9]{20,32}$ ]] || exit 2
alouna_dir=/data/coolify/backups/alouna
install -d -m 700 "$alouna_dir"
exec 9>"$alouna_dir/.lock"
flock -n 9 || exit 0
alouna_file="$alouna_dir/alouna-postgres-$(date -u +%Y%m%dT%H%M%SZ).dump"
trap 'rm -f "$alouna_file.tmp"' EXIT
docker exec "supabase-db-$alouna_stack" pg_dump -U supabase_admin --format=custom --dbname=postgres >"$alouna_file.tmp"
# A truncated/unreadable dump must never replace a completed backup.
docker exec -i "supabase-db-$alouna_stack" pg_restore --list <"$alouna_file.tmp" >/dev/null
mv "$alouna_file.tmp" "$alouna_file"
sha256sum "$alouna_file" >"$alouna_file.sha256"
# Keep at least the latest copy, then enforce all three scoped retention limits.
python3 - "$alouna_dir" <<'PY'
import pathlib
import sys
import time
root = pathlib.Path(sys.argv[1])
files = sorted(root.glob('alouna-postgres-*.dump'), key=lambda path: path.stat().st_mtime, reverse=True)
size = 0
for index, path in enumerate(files):
    size += path.stat().st_size
    if index and (index >= 14 or time.time() - path.stat().st_mtime > 14 * 86400 or size > 2 * 1024**3):
        path.unlink()
        path.with_suffix('.dump.sha256').unlink(missing_ok=True)
PY
printf 'Completed full Alouna database backup: %s\n' "$alouna_file"
