-- Seed/imported features can have no creator. The editor contract requires a boolean
-- ownership flag; NULL must never imply ownership or invalidate the working set.
begin;

create or replace function public.editor_features(expected_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  admin boolean;
begin
  if actor is distinct from expected_actor or actor is null or not alouna_private.is_member() then
    raise exception 'Membership required' using errcode = '42501';
  end if;
  admin := alouna_private.is_admin();
  return coalesce((
    select jsonb_agg(item order by item->'feature'->>'id')
    from (
      select case
        when admin or f.created_by = actor then jsonb_build_object(
          'feature', alouna_private.feature_json(f),
          'published', f.published,
          'status', case
            when f.deleted_at is not null and f.reviewed then 'deleted'
            when f.deleted_at is not null then 'pending-delete'
            when f.reviewed then 'approved'
            when f.published is null then 'pending-new'
            else 'pending-edit' end,
          'created_by_name', coalesce(p.display_name, ''),
          'own', coalesce(f.created_by = actor, false))
        else jsonb_build_object(
          -- Someone else's pending change: show only the approved state, read-only.
          'feature', f.published,
          'published', f.published,
          'status', 'approved',
          'created_by_name', coalesce(p.display_name, ''),
          'own', false)
        end as item
      from public.features f
      left join public.profiles p on p.id = f.created_by
      where
        case
          when admin then
            f.deleted_at is null or not f.reviewed
            or f.deleted_at > clock_timestamp() - interval '30 days'
          when f.created_by = actor then
            f.deleted_at is null or not f.reviewed
          else f.published is not null
        end
    ) visible
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.editor_features(uuid) from public, anon;
grant execute on function public.editor_features(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
