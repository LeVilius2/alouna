\set ON_ERROR_STOP on
begin;
-- M3 editor working set visibility. Everything is rolled back.
insert into auth.users(id) values
 ('00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-0000000000a2'),
 ('00000000-0000-0000-0000-0000000000a3'),('00000000-0000-0000-0000-0000000000a4');
insert into public.profiles(id,role,display_name) values
 ('00000000-0000-0000-0000-0000000000a1','admin','Admin'),
 ('00000000-0000-0000-0000-0000000000a2','walker','Walker A'),
 ('00000000-0000-0000-0000-0000000000a3','walker','Walker B');
-- Imported/seeded features have no Auth creator. They must have a boolean own=false.
insert into public.features(id,name,category,geom,reviewed,created_by) values
 ('30000000-0000-0000-0000-000000000002','Ownerless import','landmark',
  extensions.st_setsrid(extensions.st_makepoint(25.695,55.636),4326),true,null);
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception '%',message; end if; end $$;
create function pg_temp.expect_error(statement text, expected_code text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlstate = expected_code then return; end if;
    raise exception 'Expected %, got %: %', expected_code,sqlstate,sqlerrm;
  end;
  raise exception 'Expected error % for %', expected_code,statement;
end $$;
create function pg_temp.item(actor uuid, fid text) returns jsonb language sql as $$
  select e from jsonb_array_elements(public.editor_features(actor)) e where e->'feature'->>'id' = fid
$$;

set local role anon;
select pg_temp.expect_error($q$select public.editor_features('00000000-0000-0000-0000-0000000000a2')$q$,'42501');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);

-- Account without membership, and actor mismatch, are denied.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a4',true);
select pg_temp.expect_error($q$select public.editor_features('00000000-0000-0000-0000-0000000000a4')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',true);
select pg_temp.expect_error($q$select public.editor_features('00000000-0000-0000-0000-0000000000a3')$q$,'42501');
select pg_temp.assert_true((select x->'own'='false'::jsonb
  from pg_temp.item('00000000-0000-0000-0000-0000000000a2','30000000-0000-0000-0000-000000000002') x),'Walker ownership flag for imported feature is not false');
select pg_temp.expect_error($q$select public.mutate_feature('00000000-0000-0000-0000-0000000000a2',gen_random_uuid(),'30000000-0000-0000-0000-000000000002',1,'delete','{}')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
select pg_temp.assert_true((select x->'own'='false'::jsonb
  from pg_temp.item('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-000000000002') x),'Admin ownership flag for imported feature is not false');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',true);

-- Walker A submits: visible to A (pending-new, own) and admin, invisible to walker B.
select (public.routing_snapshot('00000000-0000-0000-0000-0000000000a2')->>'version')::bigint as before_approval \gset
select public.mutate_feature('00000000-0000-0000-0000-0000000000a2',gen_random_uuid(),'30000000-0000-0000-0000-000000000001',0,'upsert',
 '{"name":"Bench","category":"obstacle","geometry":{"type":"Point","coordinates":[25.695,55.636]}}');
select pg_temp.assert_true((public.routing_snapshot('00000000-0000-0000-0000-0000000000a2')->>'version')::bigint = :before_approval,'Unapproved feature advanced map revision');
select pg_temp.assert_true((select x->>'status'='pending-new' and (x->>'own')::boolean
  from pg_temp.item('00000000-0000-0000-0000-0000000000a2','30000000-0000-0000-0000-000000000001') x),'Walker cannot see own draft');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',true);
select pg_temp.assert_true(pg_temp.item('00000000-0000-0000-0000-0000000000a3','30000000-0000-0000-0000-000000000001') is null,'Other walker sees draft');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
select pg_temp.assert_true((select x->>'status'='pending-new' and x->>'created_by_name'='Walker A' and not (x->>'own')::boolean
  from pg_temp.item('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-000000000001') x),'Admin cannot review draft');

-- Admin approves; walker A then proposes an edit. B sees only the approved state.
select public.mutate_feature('00000000-0000-0000-0000-0000000000a1',gen_random_uuid(),'30000000-0000-0000-0000-000000000001',1,'upsert',
 '{"name":"Bench","category":"obstacle","geometry":{"type":"Point","coordinates":[25.695,55.636]}}');
select pg_temp.assert_true((public.routing_snapshot('00000000-0000-0000-0000-0000000000a1')->>'version')::bigint = :before_approval + 1,'Approval did not advance the singleton revision once');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',true);
select public.mutate_feature('00000000-0000-0000-0000-0000000000a2',gen_random_uuid(),'30000000-0000-0000-0000-000000000001',2,'upsert',
 '{"name":"Moved bench","category":"obstacle","geometry":{"type":"Point","coordinates":[25.696,55.636]}}');
select pg_temp.assert_true((public.routing_snapshot('00000000-0000-0000-0000-0000000000a2')->>'version')::bigint = :before_approval + 1,'Pending edit advanced map revision');
select pg_temp.assert_true((select x->>'status'='pending-edit' and x->'feature'->'properties'->>'name'='Moved bench'
  and x->'published'->'properties'->>'name'='Bench'
  from pg_temp.item('00000000-0000-0000-0000-0000000000a2','30000000-0000-0000-0000-000000000001') x),'Owner pending edit wrong');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',true);
select pg_temp.assert_true((select x->>'status'='approved' and x->'feature'->'properties'->>'name'='Bench'
  from pg_temp.item('00000000-0000-0000-0000-0000000000a3','30000000-0000-0000-0000-000000000001') x),'Other walker sees pending edit');

-- Admin deletion: admin sees it as deleted (restorable); walkers no longer see it.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
select public.mutate_feature('00000000-0000-0000-0000-0000000000a1',gen_random_uuid(),'30000000-0000-0000-0000-000000000001',3,'delete','{}');
select pg_temp.assert_true((public.routing_snapshot('00000000-0000-0000-0000-0000000000a1')->>'version')::bigint = :before_approval + 2,'Deletion did not advance the singleton revision once');
select pg_temp.assert_true((select x->>'status'='deleted'
  from pg_temp.item('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-000000000001') x),'Admin cannot see deleted');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',true);
select pg_temp.assert_true(pg_temp.item('00000000-0000-0000-0000-0000000000a2','30000000-0000-0000-0000-000000000001') is null,'Walker sees deleted');
-- Restore by admin re-publishes it.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
select public.mutate_feature('00000000-0000-0000-0000-0000000000a1',gen_random_uuid(),'30000000-0000-0000-0000-000000000001',4,'upsert',
 '{"name":"Bench","category":"obstacle","geometry":{"type":"Point","coordinates":[25.695,55.636]}}');
select pg_temp.assert_true((public.routing_snapshot('00000000-0000-0000-0000-0000000000a1')->>'version')::bigint = :before_approval + 3,'Restore did not advance the singleton revision once');
select pg_temp.assert_true((select x->>'status'='approved'
  from pg_temp.item('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-000000000001') x),'Restore failed');
rollback;
