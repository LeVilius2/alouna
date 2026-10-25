\set ON_ERROR_STOP on
begin;
-- Every test is rolled back, including fixture users and membership.
insert into auth.users(id) values
 ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000003'),('00000000-0000-0000-0000-000000000004');
insert into public.profiles(id,role) values
 ('00000000-0000-0000-0000-000000000001','admin'),('00000000-0000-0000-0000-000000000002','walker'),
 ('00000000-0000-0000-0000-000000000003','walker');
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception '%',message; end if; end $$;
create function pg_temp.expect_error(statement text, expected_code text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlstate = expected_code then return; end if;
    raise exception 'Expected %, got %: %', expected_code,sqlstate,sqlerrm;
  end;
  raise exception 'Expected error % for %', expected_code,statement;
end $$;

set local role anon;
select pg_temp.expect_error('select * from public.features','42501');
select pg_temp.expect_error($q$select public.routing_snapshot('00000000-0000-0000-0000-000000000002')$q$,'42501');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select pg_temp.assert_true((select count(*)=0 from public.features),'Uninvited account read features');
select pg_temp.expect_error($q$select public.routing_snapshot('00000000-0000-0000-0000-000000000004')$q$,'42501');

-- Walker creates a draft; no self approval or direct role mutation is possible.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select public.mutate_feature('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',0,'upsert',
 '{"name":"Test tree","category":"tree","geometry":{"type":"Point","coordinates":[25,55]},"reviewed":true}');
select pg_temp.assert_true((select not reviewed and published is null and revision=1 from public.features where id='20000000-0000-0000-0000-000000000001'),'Walker self-approved');
select pg_temp.expect_error($q$update public.profiles set role='admin'$q$,'42501');
select pg_temp.expect_error($q$update public.features set reviewed=true$q$,'42501');
select pg_temp.expect_error($q$delete from public.features$q$,'42501');
select pg_temp.expect_error($q$select public.mutate_rule('00000000-0000-0000-0000-000000000002',gen_random_uuid(),'tree',1,'{}')$q$,'42501');
-- Replayed acknowledgement returns the receipt, without a revision increment.
select public.mutate_feature('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',0,'upsert',
 '{"name":"Test tree","category":"tree","geometry":{"type":"Point","coordinates":[25,55]},"reviewed":true}');
select pg_temp.assert_true((select revision=1 from public.features where id='20000000-0000-0000-0000-000000000001'),'Duplicate replay mutated twice');
select pg_temp.expect_error($q$select public.mutate_feature('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',0,'delete','{}')$q$,'22023');
select pg_temp.expect_error($q$select public.mutate_feature('00000000-0000-0000-0000-000000000002',gen_random_uuid(),'20000000-0000-0000-0000-000000000001',0,'upsert','{}')$q$,'40001');

-- Another walker cannot see/edit the pending feature or replay another account's work.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select pg_temp.assert_true((select count(*)=0 from public.features where id='20000000-0000-0000-0000-000000000001'),'Other walker read draft');
select pg_temp.expect_error($q$select public.mutate_feature('00000000-0000-0000-0000-000000000003',gen_random_uuid(),'20000000-0000-0000-0000-000000000001',1,'delete','{}')$q$,'42501');
select pg_temp.expect_error($q$select public.routing_snapshot('00000000-0000-0000-0000-000000000002')$q$,'42501');

-- Admin approval publishes it. Pending walker edits/deletions preserve that exact snapshot.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select public.mutate_feature('00000000-0000-0000-0000-000000000001',gen_random_uuid(),'20000000-0000-0000-0000-000000000001',1,'upsert',
 '{"name":"Approved tree","category":"tree","geometry":{"type":"Point","coordinates":[25,55]}}');
select pg_temp.assert_true((select published->'properties'->>'name'='Approved tree' and created_by='00000000-0000-0000-0000-000000000002' from public.features where id='20000000-0000-0000-0000-000000000001'),'Approval/ownership incorrect');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select public.mutate_feature('00000000-0000-0000-0000-000000000002',gen_random_uuid(),'20000000-0000-0000-0000-000000000001',2,'upsert',
 '{"name":"Pending move","category":"tree","geometry":{"type":"Point","coordinates":[26,55]},"reviewed":true}');
select pg_temp.assert_true((select published->'properties'->>'name'='Approved tree' and not reviewed from public.features where id='20000000-0000-0000-0000-000000000001'),'Pending move changed routing');
select public.mutate_feature('00000000-0000-0000-0000-000000000002',gen_random_uuid(),'20000000-0000-0000-0000-000000000001',3,'delete','{}');
select pg_temp.assert_true((select published is not null and deleted_at is not null from public.features where id='20000000-0000-0000-0000-000000000001'),'Pending delete removed routing obstacle');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select public.mutate_feature('00000000-0000-0000-0000-000000000001',gen_random_uuid(),'20000000-0000-0000-0000-000000000001',4,'delete','{}');
select pg_temp.assert_true((select published is null from public.features where id='20000000-0000-0000-0000-000000000001'),'Admin delete not published');
-- Rule RPC: successful versioned mutation, stale conflict and invalid override.
select public.mutate_rule('00000000-0000-0000-0000-000000000001',gen_random_uuid(),'tree',1,
 '{"label":"Tree","passable":false,"cost":1,"buffer_m":1,"warn_m":2,"overrides":[],"priority":1,"color":"#112233"}');
select pg_temp.expect_error($q$select public.mutate_rule('00000000-0000-0000-0000-000000000001',gen_random_uuid(),'tree',1,'{}')$q$,'40001');
select pg_temp.expect_error($q$select public.mutate_rule('00000000-0000-0000-0000-000000000001',gen_random_uuid(),'bad',0,'{"label":"Bad","passable":true,"cost":1,"buffer_m":0,"overrides":["missing"],"priority":1,"color":"#112233"}')$q$,'22023');
-- Tracks are private to the contributor/admin.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
insert into public.tracks(lon,lat,accuracy) values(25,55,2);
select pg_temp.expect_error($q$insert into public.tracks(user_id,lon,lat,accuracy) values('00000000-0000-0000-0000-000000000003',25,55,2)$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select pg_temp.assert_true((select count(*)=0 from public.tracks),'Other walker read track');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','',true);
update public.profiles set active=false where id='00000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.expect_error($q$select public.routing_snapshot('00000000-0000-0000-0000-000000000002')$q$,'42501');
rollback;
\echo 'Alouna SQL ownership, review, idempotency and RLS checks passed'
