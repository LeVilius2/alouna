#!/usr/bin/env bash
# Only creates a new disposable verification database; never restores over live data.
set -euo pipefail
alouna_stack=${1:?Coolify service UUID required}
alouna_dump=${2:?Full Alouna dump path required}
alouna_target=${3:?New disposable database name required}
[[ "$alouna_stack" =~ ^[a-z0-9]{20,32}$ && "$alouna_target" =~ ^alouna_m2_restore_[a-z0-9_]+$ ]] || exit 2
[[ -f "$alouna_dump.graphql.sql" && -f "$alouna_dump.sha256" ]] || { echo 'Missing backup companion files' >&2; exit 2; }
(cd "$(dirname "$alouna_dump")" && sha256sum -c "$alouna_dump.sha256")
alouna_container="supabase-db-$alouna_stack"
docker exec "$alouna_container" createdb -U supabase_admin -T template0 "$alouna_target"
# This generated platform wrapper is not in the archive's CREATE entries. Its
# exact definition/owner/grants are in the companion, applied after the full dump.
alouna_list=$(mktemp)
alouna_container_list="/tmp/$alouna_target.list"
trap 'rm -f "$alouna_list"; docker exec "$alouna_container" rm -f "$alouna_container_list"' EXIT
docker exec -i "$alouna_container" pg_restore --list <"$alouna_dump" | python3 -c 'import sys; sys.stdout.writelines(line for line in sys.stdin if "ACL graphql_public FUNCTION graphql(" not in line)' >"$alouna_list"
docker exec -i "$alouna_container" sh -c 'umask 077; cat > "$1"' sh "$alouna_container_list" <"$alouna_list"
docker exec -i "$alouna_container" pg_restore -U supabase_admin --exit-on-error --use-list="$alouna_container_list" -d "$alouna_target" <"$alouna_dump"
docker exec -i "$alouna_container" psql -U supabase_admin -v ON_ERROR_STOP=1 -d "$alouna_target" <"$alouna_dump.graphql.sql"
alouna_script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
docker exec -i "$alouna_container" psql -U supabase_admin -v ON_ERROR_STOP=1 -d "$alouna_target" <"$alouna_script_dir/../supabase/tests/rls.sql"
echo "Restore and RLS checks passed in $alouna_target. Remove only this disposable database after inspection."
