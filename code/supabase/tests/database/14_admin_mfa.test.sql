-- P9-13: an administrator counts only in a live session that passed multi-factor authentication, beyond the admin page:
-- the token's level, the session row, and the verified factor are all checked in the database.
-- Run with `npx supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

create schema tests;
grant usage on schema tests to anon, authenticated, service_role, pipeline;
grant pipeline to current_user with set true;

-- Signed in as uid at an assurance level ('aal1' = password only, 'aal2' = a verified second factor, null = no claim),
-- with the session `sid` (default: the user's id) in the token.
create function tests.become_at(uid uuid, aal text, sid uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    (jsonb_build_object('sub', uid, 'role', 'authenticated', 'session_id', coalesce(sid, uid)) || coalesce(jsonb_build_object('aal', aal), '{}'))::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function tests.sqlstate_of(q text) returns text
language plpgsql as $$
begin
  execute q;
  return null;
exception when others then
  return sqlstate;
end;
$$;
grant execute on all functions in schema tests to authenticated, pipeline;

truncate public.admin_user;
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000a0f01'), ('00000000-0000-0000-0000-0000000a0f02');
insert into admin_user (user_id, role) values
  ('00000000-0000-0000-0000-0000000a0f01', 'admin'),
  ('00000000-0000-0000-0000-0000000a0f02', 'editor');
-- Both have a verified factor; the admin has an aal2 session, the editor one session at each level.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000af001', '00000000-0000-0000-0000-0000000a0f01', 'app', 'totp', 'verified', now(), now()),
  ('00000000-0000-0000-0000-0000000af002', '00000000-0000-0000-0000-0000000a0f02', 'app', 'totp', 'verified', now(), now());
insert into auth.sessions (id, user_id, aal, created_at) values
  ('00000000-0000-0000-0000-0000000a0f01', '00000000-0000-0000-0000-0000000a0f01', 'aal2', now()),
  ('00000000-0000-0000-0000-0000000a0f02', '00000000-0000-0000-0000-0000000a0f02', 'aal2', now()),
  ('00000000-0000-0000-0000-0000000a1f02', '00000000-0000-0000-0000-0000000a0f02', 'aal1', now());

-- ---- password only ------------------------------------------------------------------------------------------
select tests.become_at('00000000-0000-0000-0000-0000000a0f01', 'aal1');
select is(is_admin('editor'), false, 'a password-only token is no administrator');
select is((select count(*) from admin_user), 1::bigint, 'but it can read its own admin_user row (so the admin page asks for the code)');
select isnt(tests.sqlstate_of('select publish_now()'), null, 'and it cannot publish');
select is((select count(*) from audit_log), 0::bigint, 'nor read the audit log');
select is((select count(*) from field_evidence), 0::bigint, 'nor read evidence');
select is((select count(*) from evidence_report((select id from company where status = 'published' limit 1)) where evidence_id is not null or source_url is not null), 0::bigint,
  'the evidence report shows it no evidence ids or sources');
reset role;
select tests.become_at('00000000-0000-0000-0000-0000000a0f02', 'aal2', '00000000-0000-0000-0000-0000000a1f02');
select is(is_admin('editor'), false, 'a token claiming aal2 for a session that is only aal1 is refused');
reset role;
select tests.become_at('00000000-0000-0000-0000-0000000a0f01', null);
select is(is_admin('editor'), false, 'a token without an assurance level is no administrator');
reset role;

-- ---- with the second factor ----------------------------------------------------------------------------------
select tests.become_at('00000000-0000-0000-0000-0000000a0f01', 'aal2');
select is(is_admin('admin'), true, 'after the second factor, the admin is an admin');
select is((select count(*) from admin_user), 2::bigint, 'and sees every administrator');
select is(tests.sqlstate_of('select publish_now()'), null, 'and can publish');
reset role;
select tests.become_at('00000000-0000-0000-0000-0000000a0f02', 'aal2');
select is(is_admin('editor'), true, 'an editor with a second factor is an editor');
select is(is_admin('reviewer'), false, 'and still not a reviewer');
reset role;

-- ---- the token outlives the session or the factor --------------------------------------------------------------
-- Signing out deletes the session; the token is still unexpired, and still says aal2.
delete from auth.sessions where id = '00000000-0000-0000-0000-0000000a0f02';
select tests.become_at('00000000-0000-0000-0000-0000000a0f02', 'aal2');
select is(is_admin('editor'), false, 'after sign-out, the same unexpired aal2 token is refused');
reset role;
-- A session past its end.
update auth.sessions set not_after = now() - interval '1 minute' where id = '00000000-0000-0000-0000-0000000a0f01';
select tests.become_at('00000000-0000-0000-0000-0000000a0f01', 'aal2');
select is(is_admin('editor'), false, 'a session past its end is refused');
reset role;
update auth.sessions set not_after = null where id = '00000000-0000-0000-0000-0000000a0f01';
-- An administrator removes the factor (lost phone): the same token stops working at once.
delete from auth.mfa_factors where user_id = '00000000-0000-0000-0000-0000000a0f01';
select tests.become_at('00000000-0000-0000-0000-0000000a0f01', 'aal2');
select is(is_admin('editor'), false, 'after the factor is removed, the same aal2 token is refused');
select isnt(tests.sqlstate_of('select publish_now()'), null, 'and cannot publish');
reset role;

-- ---- the pipeline keeps its narrow access -----------------------------------------------------------------------
select tests.become_at('00000000-0000-0000-0000-0000000a0f02', 'aal1');
select is(tests.sqlstate_of('select record_heartbeat(''x'')'), '42501', 'a signed-in user cannot call the pipeline''s functions');
reset role;
-- Run as the pipeline, judged as the owner (pgTAP's functions are not on the pipeline's path).
create temp table pipeline_result (probe text, state text);
grant insert on pipeline_result to pipeline;
set local role pipeline;
insert into pipeline_result values
  ('missed', tests.sqlstate_of('select * from missed_heartbeats()')),
  ('partitions', tests.sqlstate_of('select ensure_verification_partitions(1)'));
reset role;
select is((select state from pipeline_result where probe = 'missed'), null, 'the pipeline still reads missed runs');
select is((select state from pipeline_result where probe = 'partitions'), '42501', 'but does not manage partitions (the cron owner does)');

select * from finish();
rollback;
