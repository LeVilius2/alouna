begin;

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create schema if not exists alouna_private;
revoke all on schema alouna_private from public;
grant usage on schema alouna_private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null check (role in ('admin','walker')),
  active boolean not null default true
);
alter table public.profiles enable row level security;

create function alouna_private.is_system() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.role() = 'service_role', false)
    or (auth.uid() is null and auth.role() is null and current_user in ('postgres','supabase_admin'));
$$;
create function alouna_private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select alouna_private.is_system() or exists
    (select 1 from public.profiles where id = auth.uid() and active);
$$;
create function alouna_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select alouna_private.is_system() or exists
    (select 1 from public.profiles where id = auth.uid() and active and role = 'admin');
$$;
revoke all on all functions in schema alouna_private from public;
grant execute on function alouna_private.is_member(), alouna_private.is_admin() to authenticated;

create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or alouna_private.is_admin());
create policy profiles_admin on public.profiles for all to authenticated
  using (alouna_private.is_admin()) with check (alouna_private.is_admin());
grant select on public.profiles to authenticated;
-- Membership/role changes are server-admin operations, not self-service profile edits.
revoke insert, update, delete on public.profiles from anon, authenticated;

create table public.category_rules (
  category text primary key check (length(category) between 1 and 80),
  label text not null,
  passable boolean not null,
  cost real not null default 1 check (cost > 0 and cost < 'Infinity'::real),
  buffer_m real not null default 0 check (buffer_m >= 0 and buffer_m < 'Infinity'::real),
  warn_m real check (warn_m >= 0 and warn_m < 'Infinity'::real),
  overrides text[] not null default '{}',
  priority int not null default 0,
  color text not null default '#888888' check (color ~ '^#[0-9a-fA-F]{6}$'),
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  check (passable or cardinality(overrides) = 0)
);
alter table public.category_rules enable row level security;
create policy rules_read on public.category_rules for select to authenticated using (alouna_private.is_member());
create policy rules_admin on public.category_rules for all to authenticated
  using (alouna_private.is_admin()) with check (alouna_private.is_admin());
grant select on public.category_rules to authenticated;
revoke insert,update,delete on public.category_rules from anon,authenticated;

create table public.features (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  category text not null references public.category_rules(category),
  geom extensions.geometry(Geometry,4326) not null,
  width_m real check (width_m >= 0 and width_m < 'Infinity'::real),
  radius_m real check (radius_m >= 0 and radius_m < 'Infinity'::real),
  is_destination boolean not null default false,
  spoken_name text not null default '',
  notes text not null default '',
  source text not null default 'drawn' check (source in ('drawn','gps','import')),
  enabled boolean not null default true,
  owner_label text not null default '',
  reviewed boolean not null default false,
  gps_accuracy_m real check (gps_accuracy_m >= 0 and gps_accuracy_m < 'Infinity'::real),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  revision bigint not null default 1,
  -- Last approved routing state survives a walker's pending edit/deletion.
  published jsonb,
  check (extensions.geometrytype(geom) in ('POINT','LINESTRING','POLYGON')),
  check (extensions.st_ndims(geom) = 2 and not extensions.st_isempty(geom) and extensions.st_isvalid(geom)),
  check (extensions.st_xmin(geom::extensions.box3d) >= -180 and extensions.st_xmax(geom::extensions.box3d) <= 180
    and extensions.st_ymin(geom::extensions.box3d) > -90 and extensions.st_ymax(geom::extensions.box3d) < 90),
  check (category <> 'walkable_area' or extensions.geometrytype(geom) = 'POLYGON')
);
create index features_geom on public.features using gist(geom);
create index features_category on public.features(category,enabled);
create index features_owner on public.features(created_by);
alter table public.features enable row level security;
create policy features_read on public.features for select to authenticated using
  (alouna_private.is_member() and (alouna_private.is_admin() or created_by = auth.uid() or reviewed));
create policy features_insert on public.features for insert to authenticated with check
  (alouna_private.is_member() and (alouna_private.is_admin() or created_by = auth.uid()));
create policy features_update on public.features for update to authenticated using
  (alouna_private.is_member() and (alouna_private.is_admin() or created_by = auth.uid())) with check
  (alouna_private.is_member() and (alouna_private.is_admin() or created_by = auth.uid()));
-- Mutations go through versioned RPCs. DELETE is a reviewed soft deletion.
grant select on public.features to authenticated;
revoke insert, update, delete on public.features from anon, authenticated;

create table alouna_private.map_state (id boolean primary key default true check(id), revision bigint not null default 1);
-- Invalid legacy geometry is retained for review, never repaired or enabled implicitly.
create table alouna_private.seed_rejections (
  source_id uuid primary key,
  source_name text not null,
  feature jsonb not null,
  reason text not null
);
insert into alouna_private.map_state default values;
create table alouna_private.mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,operation_id)
);

create function alouna_private.feature_json(f public.features) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('type','Feature','id',f.id,'geometry',extensions.st_asgeojson(f.geom)::jsonb,
    'properties',jsonb_build_object('name',f.name,'category',f.category,'width_m',f.width_m,
      'radius_m',f.radius_m,'is_destination',f.is_destination,'spoken_name',f.spoken_name,
      'notes',f.notes,'source',f.source,'enabled',f.enabled,'owner_label',f.owner_label,
      'reviewed',f.reviewed,'gps_accuracy_m',f.gps_accuracy_m,'created_by',f.created_by,
      'created_at',f.created_at,'updated_at',f.updated_at,'deleted_at',f.deleted_at,'revision',f.revision));
$$;

create function alouna_private.prepare_feature() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.revision := old.revision + 1;
  else
    new.revision := 1;
    if not alouna_private.is_system() then new.created_by := auth.uid(); end if;
  end if;
  new.updated_at := clock_timestamp();
  if not alouna_private.is_admin() then
    new.reviewed := false;
    new.published := case when tg_op = 'UPDATE' then old.published else null end;
  elsif new.reviewed then
    new.published := case when new.deleted_at is null then alouna_private.feature_json(new) else null end;
  else
    new.published := case when tg_op = 'UPDATE' then old.published else null end;
  end if;
  return new;
end;
$$;
create trigger prepare_feature before insert or update on public.features
  for each row execute function alouna_private.prepare_feature();
create function alouna_private.feature_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.published is not null)
    or (tg_op = 'UPDATE' and new.published is distinct from old.published) then
    update alouna_private.map_state set revision = revision + 1;
  end if;
  return null;
end;
$$;
create trigger feature_changed after insert or update on public.features for each row execute function alouna_private.feature_changed();

create function alouna_private.rule_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'DELETE' then
    if exists(select 1 from unnest(new.overrides) o where not exists(select 1 from public.category_rules r where r.category = o)) then
      raise exception 'Unknown override category' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' then new.revision := old.revision + 1; end if;
    new.updated_at := clock_timestamp();
  end if;
  update alouna_private.map_state set revision = revision + 1;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger rule_changed before insert or update or delete on public.category_rules for each row execute function alouna_private.rule_changed();

create function public.routing_snapshot(expected_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is distinct from expected_actor or auth.uid() is null or not alouna_private.is_member() then raise exception 'Membership required' using errcode = '42501'; end if;
  return jsonb_build_object('version',(select revision::text from alouna_private.map_state),
    'features',coalesce((select jsonb_agg(published order by id) from public.features where published is not null),'[]'::jsonb),
    'rules',coalesce((select jsonb_agg(to_jsonb(r) order by category) from public.category_rules r),'[]'::jsonb));
end;
$$;

create function public.mutate_feature(expected_actor uuid, operation_id uuid, feature_id uuid, expected_revision bigint, action text, payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); f public.features; receipt alouna_private.mutation_receipts;
  fingerprint text := md5(jsonb_build_array(feature_id,expected_revision,action,payload)::text);
  result jsonb;
begin
  if actor is distinct from expected_actor or actor is null or not alouna_private.is_member() then raise exception 'Membership required' using errcode = '42501'; end if;
  if operation_id is null or feature_id is null or expected_revision is null or expected_revision < 0 or action not in ('upsert','delete') then
    raise exception 'Invalid mutation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || operation_id::text,0));
  -- Lock absent rows too: two creates at revision zero must not become an upsert overwrite.
  perform pg_advisory_xact_lock(hashtextextended('feature:' || feature_id::text,0));
  select * into receipt from alouna_private.mutation_receipts r where r.user_id = actor and r.operation_id = mutate_feature.operation_id;
  if found then
    if receipt.request_hash <> fingerprint then raise exception 'Operation ID reused with different input' using errcode = '22023'; end if;
    return receipt.result;
  end if;
  select * into f from public.features where id = feature_id for update;
  if found then
    if not alouna_private.is_admin() and f.created_by is distinct from actor then raise exception 'Not the owner' using errcode = '42501'; end if;
    if f.revision <> expected_revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
  elsif expected_revision <> 0 or action = 'delete' then
    raise exception 'Revision conflict' using errcode = '40001';
  end if;
  if action = 'delete' then
    update public.features set deleted_at = clock_timestamp(), reviewed = alouna_private.is_admin() where id = feature_id returning * into f;
  else
    insert into public.features as existing(id,name,category,geom,width_m,radius_m,is_destination,spoken_name,notes,source,enabled,owner_label,reviewed,gps_accuracy_m,created_by)
    values(feature_id,coalesce(payload->>'name',''),payload->>'category',extensions.st_setsrid(extensions.st_geomfromgeojson((payload->'geometry')::text),4326),
      (payload->>'width_m')::real,(payload->>'radius_m')::real,coalesce((payload->>'is_destination')::boolean,false),coalesce(payload->>'spoken_name',''),
      coalesce(payload->>'notes',''),coalesce(payload->>'source','drawn'),coalesce((payload->>'enabled')::boolean,true),coalesce(payload->>'owner_label',''),
      alouna_private.is_admin() and coalesce((payload->>'reviewed')::boolean,true),(payload->>'gps_accuracy_m')::real,actor)
    on conflict(id) do update set name=excluded.name,category=excluded.category,geom=excluded.geom,width_m=excluded.width_m,radius_m=excluded.radius_m,
      is_destination=excluded.is_destination,spoken_name=excluded.spoken_name,notes=excluded.notes,source=excluded.source,enabled=excluded.enabled,
      owner_label=excluded.owner_label,reviewed=excluded.reviewed,gps_accuracy_m=excluded.gps_accuracy_m,deleted_at=null
    returning * into f;
  end if;
  result := alouna_private.feature_json(f);
  insert into alouna_private.mutation_receipts values(actor,operation_id,fingerprint,result,now());
  return result;
end;
$$;

create function public.mutate_rule(expected_actor uuid, operation_id uuid, rule_category text, expected_revision bigint, payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); r public.category_rules; receipt alouna_private.mutation_receipts;
  fingerprint text := md5(jsonb_build_array('rule',rule_category,expected_revision,payload)::text); result jsonb;
begin
  if actor is distinct from expected_actor or actor is null or not alouna_private.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  if operation_id is null or expected_revision is null or expected_revision < 0 then raise exception 'Invalid mutation' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || operation_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('rule:' || rule_category,0));
  select * into receipt from alouna_private.mutation_receipts x where x.user_id=actor and x.operation_id=mutate_rule.operation_id;
  if found then
    if receipt.request_hash <> fingerprint then raise exception 'Operation ID reused with different input' using errcode='22023'; end if;
    return receipt.result;
  end if;
  select * into r from public.category_rules where category=rule_category for update;
  if (found and r.revision <> expected_revision) or (not found and expected_revision <> 0) then raise exception 'Revision conflict' using errcode='40001'; end if;
  insert into public.category_rules as existing(category,label,passable,cost,buffer_m,warn_m,overrides,priority,color)
  values(rule_category,payload->>'label',(payload->>'passable')::boolean,(payload->>'cost')::real,(payload->>'buffer_m')::real,
    (payload->>'warn_m')::real,array(select jsonb_array_elements_text(payload->'overrides')),(payload->>'priority')::int,payload->>'color')
  on conflict(category) do update set label=excluded.label,passable=excluded.passable,cost=excluded.cost,buffer_m=excluded.buffer_m,
    warn_m=excluded.warn_m,overrides=excluded.overrides,priority=excluded.priority,color=excluded.color returning * into r;
  result := to_jsonb(r);
  insert into alouna_private.mutation_receipts values(actor,operation_id,fingerprint,result,now());
  return result;
end;
$$;

create table public.tracks (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id),
  ts timestamptz not null default now(),
  lon double precision not null check (lon between -180 and 180),
  lat double precision not null check (lat > -90 and lat < 90),
  accuracy real not null check (accuracy >= 0 and accuracy < 'Infinity'::real),
  heading real check (heading >= 0 and heading < 360)
);
create index tracks_user_ts on public.tracks(user_id,ts);
alter table public.tracks enable row level security;
create policy tracks_read on public.tracks for select to authenticated using
  (alouna_private.is_member() and (user_id = auth.uid() or alouna_private.is_admin()));
create policy tracks_insert on public.tracks for insert to authenticated with check
  (alouna_private.is_member() and user_id = auth.uid());
grant select,insert on public.tracks to authenticated;
grant usage on sequence public.tracks_id_seq to authenticated;

revoke all on public.profiles,public.features,public.category_rules,public.tracks from anon;
revoke all on function public.routing_snapshot(uuid), public.mutate_feature(uuid,uuid,uuid,bigint,text,jsonb),public.mutate_rule(uuid,uuid,text,bigint,jsonb) from public,anon;
grant execute on function public.routing_snapshot(uuid), public.mutate_feature(uuid,uuid,uuid,bigint,text,jsonb),public.mutate_rule(uuid,uuid,text,bigint,jsonb) to authenticated;
revoke all on all functions in schema alouna_private from public;
grant execute on function alouna_private.is_member(),alouna_private.is_admin() to authenticated;
notify pgrst, 'reload schema';
commit;
