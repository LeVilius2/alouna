\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values
 ('00000000-0000-0000-0000-0000000000b1'),('00000000-0000-0000-0000-0000000000b2'),
 ('00000000-0000-0000-0000-0000000000b3'),('00000000-0000-0000-0000-0000000000b4');
insert into public.profiles(id,role,display_name,active) values
 ('00000000-0000-0000-0000-0000000000b1','admin','Live admin',true),
 ('00000000-0000-0000-0000-0000000000b2','walker','Live walker',true),
 ('00000000-0000-0000-0000-0000000000b3','walker','Other walker',true),
 ('00000000-0000-0000-0000-0000000000b4','walker','Suspended walker',false);
insert into realtime.messages(topic,extension) values
 ('live-positions:00000000-0000-0000-0000-0000000000b2','broadcast'),
 ('live-positions:00000000-0000-0000-0000-0000000000b2','presence'),
 ('live-positions:00000000-0000-0000-0000-0000000000b3','broadcast'),
 ('live-positions:00000000-0000-0000-0000-0000000000b4','broadcast');
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception '%',message; end if; end $$;
create function pg_temp.expect_denied(statement text) returns void language plpgsql as $$
begin
  begin execute statement; exception when insufficient_privilege then return; end;
  raise exception 'Unauthorized live write succeeded';
end $$;

set local role anon;
select set_config('realtime.topic','live-positions:00000000-0000-0000-0000-0000000000b2',true);
select pg_temp.assert_true((select count(*)=0 from realtime.messages),'Anonymous live read');
select pg_temp.expect_denied($q$insert into realtime.messages(topic,extension) values('live-positions:00000000-0000-0000-0000-0000000000b2','broadcast')$q$);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',true);
-- Only the exact own topic can be read or written, for both protocols.
select pg_temp.assert_true((select count(*)=2 from realtime.messages),'Own channel read failed');
insert into realtime.messages(topic,extension) values
 ('live-positions:00000000-0000-0000-0000-0000000000b2','broadcast'),
 ('live-positions:00000000-0000-0000-0000-0000000000b2','presence');
select pg_temp.expect_denied($q$insert into realtime.messages(topic,extension) values('live-positions:00000000-0000-0000-0000-0000000000b3','broadcast')$q$);
select set_config('realtime.topic','live-positions:00000000-0000-0000-0000-0000000000b3',true);
select pg_temp.assert_true((select count(*)=0 from realtime.messages),'Walker read another walker');
select pg_temp.expect_denied($q$insert into realtime.messages(topic,extension) values('live-positions:00000000-0000-0000-0000-0000000000b3','presence')$q$);
select set_config('realtime.topic','live-positions',true);
select pg_temp.expect_denied($q$insert into realtime.messages(topic,extension) values('live-positions','broadcast')$q$);

-- Admins can receive active members' topics, never impersonate those members.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true);
select set_config('realtime.topic','live-positions:00000000-0000-0000-0000-0000000000b2',true);
select pg_temp.assert_true((select count(*)=4 from realtime.messages),'Admin receive failed');
select pg_temp.expect_denied($q$insert into realtime.messages(topic,extension) values('live-positions:00000000-0000-0000-0000-0000000000b2','broadcast')$q$);
select set_config('realtime.topic','live-positions:00000000-0000-0000-0000-0000000000b4',true);
select pg_temp.assert_true((select count(*)=0 from realtime.messages),'Suspended channel visible');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b4',true);
select pg_temp.expect_denied($q$insert into realtime.messages(topic,extension) values('live-positions:00000000-0000-0000-0000-0000000000b4','broadcast')$q$);
select pg_temp.assert_true((select count(*)=0 from realtime.messages),'Suspended member read live data');
rollback;
\echo 'Alouna private Realtime topic authorization checks passed'
