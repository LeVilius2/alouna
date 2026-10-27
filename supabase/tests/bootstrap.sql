-- Only for a disposable plain Postgres/PostGIS CI database. Never run in Supabase.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on all functions in schema auth to anon,authenticated,service_role;

-- Minimal authorization-table contract of the Supabase-owned Realtime service.
-- CI only: the real stack supplies this schema, grants, and helper itself.
create schema realtime;
create table realtime.messages (id bigint generated always as identity primary key, topic text not null, extension text not null);
alter table realtime.messages enable row level security;
grant usage on schema realtime to anon,authenticated;
grant select,insert on realtime.messages to anon,authenticated;
grant usage on sequence realtime.messages_id_seq to anon,authenticated;
create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
grant execute on function realtime.topic() to anon,authenticated;
