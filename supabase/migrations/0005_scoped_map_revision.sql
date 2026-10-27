-- The self-hosted PostgREST role loads safeupdate. Scope counter writes to the
-- single map-state row instead of weakening that protection for the connection.
begin;
create or replace function alouna_private.feature_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.published is not null)
    or (tg_op = 'UPDATE' and new.published is distinct from old.published) then
    update alouna_private.map_state set revision = revision + 1 where id = true;
  end if;
  return null;
end;
$$;

create or replace function alouna_private.rule_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'DELETE' then
    if exists(select 1 from unnest(new.overrides) o where not exists(select 1 from public.category_rules r where r.category = o)) then
      raise exception 'Unknown override category' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' then new.revision := old.revision + 1; end if;
    new.updated_at := clock_timestamp();
  end if;
  update alouna_private.map_state set revision = revision + 1 where id = true;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
commit;
