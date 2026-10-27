-- M6: identity-bound, private Broadcast + Presence channels.
-- Supabase owns realtime.messages and already enables RLS. Do not ALTER its schema/table.
begin;
do $$ begin
  if not (select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass) then
    raise exception 'Realtime messages must have RLS enabled';
  end if;
  if not has_table_privilege('authenticated','realtime.messages','SELECT')
     or not has_table_privilege('authenticated','realtime.messages','INSERT') then
    raise exception 'The supported Supabase Realtime grants are required';
  end if;
end $$;

create policy alouna_live_receive on realtime.messages for select to authenticated
using (
  extension in ('broadcast','presence')
  and topic = (select realtime.topic())
  and (select alouna_private.is_member())
  and exists (
    select 1 from public.profiles p
    where p.active and topic = 'live-positions:' || p.id::text
  )
  and (topic = 'live-positions:' || (select auth.uid())::text or (select alouna_private.is_admin()))
);

create policy alouna_live_send on realtime.messages for insert to authenticated
with check (
  extension in ('broadcast','presence')
  and topic = (select realtime.topic())
  and topic = 'live-positions:' || (select auth.uid())::text
  and (select alouna_private.is_member())
);
commit;
