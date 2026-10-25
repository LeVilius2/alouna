#!/usr/bin/env bash
# Disposable CI database only (bootstrap.sql). Never run against field data.
set -euo pipefail
psql -v ON_ERROR_STOP=1 -q <<'SQL'
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000010');
insert into public.profiles(id,role) values ('00000000-0000-0000-0000-000000000010','admin');
SQL
alouna_tmp=$(mktemp -d)
trap 'rm -rf "$alouna_tmp"' EXIT
psql -v ON_ERROR_STOP=1 -q >"$alouna_tmp/first" 2>&1 <<'SQL' &
begin;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
select public.mutate_feature('00000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000010',0,'upsert','{"name":"First","category":"obstacle","geometry":{"type":"Point","coordinates":[25,55]}}');
select pg_sleep(3);
commit;
SQL
alouna_first=$!
# Wait until the first transaction owns the entity lock before racing a new create.
for _ in {1..50}; do
  if psql -Atqc "select exists(select 1 from pg_locks where locktype='advisory' and granted)" | rg -q '^t$'; then break; fi
  sleep 0.1
done
if psql -v ON_ERROR_STOP=1 -q >"$alouna_tmp/second" 2>&1 <<'SQL'
\set VERBOSITY verbose
begin;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
select public.mutate_feature('00000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000010',0,'upsert','{"name":"Second","category":"obstacle","geometry":{"type":"Point","coordinates":[25,55]}}');
commit;
SQL
then
  cat "$alouna_tmp/second"
  echo 'Concurrent create overwrote an existing feature' >&2
  exit 1
fi
wait "$alouna_first"
rg -q '40001:.*Revision conflict' "$alouna_tmp/second"
test "$(psql -Atqc "select name || ':' || revision from public.features where id='20000000-0000-0000-0000-000000000010'")" = 'First:1'
echo 'Concurrent revision-zero creates cannot overwrite each other'
