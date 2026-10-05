-- P8-02 and P8-03: the pipeline role's reach, the stale sweep, the log partitions, and the missed-run check.
-- (The two-strike rule and the feed sync are tested from Python against this database: scripts/pipeline/tests.)
-- Run with `npx supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

create schema tests;
-- Postgres 16 and later: the creator of a role cannot SET ROLE to it unless granted. Part of the transaction, so rolled back.
grant pipeline to current_user with set true;
grant usage on schema tests to anon, authenticated, service_role, pipeline;
create function tests.sqlstate_of(q text) returns text
language plpgsql as $$
begin
  execute q;
  return null;
exception when others then
  return sqlstate;
end;
$$;
create function tests.become(uid uuid, r text default 'authenticated') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when uid is null then '' else json_build_object('sub', uid, 'role', r)::text end, true);
  perform set_config('role', r, true);
end;
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role, pipeline;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select ok(exists (select 1 from pg_roles where rolname = 'pipeline' and not rolcanlogin), 'the pipeline role exists and cannot log in by itself');
select ok(not (select rolsuper or rolbypassrls from pg_roles where rolname = 'pipeline'), 'it is not a superuser and does not bypass row-level security');
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity), 0,
  'every table in public still has row-level security, including the new ones');
select is((select count(*)::int from heartbeat), 4, 'there are four scheduled jobs to watch');

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

select tests.become(null, 'anon');
select is(tests.sqlstate_of($$ select * from missed_heartbeats() $$), '42501', 'anon cannot ask which jobs are overdue');
select is(tests.sqlstate_of($$ select record_heartbeat('feed-sync') $$), '42501', 'anon cannot record a heartbeat');
select is(tests.sqlstate_of($$ select record_link_check('00000000-0000-0000-0000-000000000000', true) $$), '42501', 'anon cannot record a link check');
select is(tests.sqlstate_of($$ select sweep_stale_jobs() $$), '42501', 'anon cannot run the sweep');
select is(tests.sqlstate_of($$ select * from heartbeat $$), '42501', 'anon cannot read the heartbeat table');
select is(tests.sqlstate_of($$ select * from verification_check $$), '42501', 'or the link-check log');
select is(tests.sqlstate_of($$ select * from job_feed $$), '42501', 'or the feeds');
reset role;

select tests.become('00000000-0000-0000-0000-00000000e004', 'authenticated');
select is(tests.sqlstate_of($$ select sweep_stale_jobs() $$), '42501', 'a signed-in user cannot run the sweep either');
select is(tests.sqlstate_of($$ select verification_upkeep() $$), '42501', 'nor the partition upkeep');
reset role;

-- The pipeline role cannot call pgTAP's functions (they live in the extensions schema), so what it can do is recorded
-- while it is the active role and judged afterwards, as the owner.
select tests.become(null, 'pipeline');
create temp table pipeline_results as
  select tests.sqlstate_of($$ select * from missed_heartbeats() $$) as asks,
         tests.sqlstate_of($$ select sweep_stale_jobs() $$) as sweeps,
         tests.sqlstate_of($$ select record_heartbeat('feed-sync', 'x') $$) as beats,
         tests.sqlstate_of($$ update company set name = 'Hacked' $$) as edits_company,
         tests.sqlstate_of($$ delete from job $$) as deletes_jobs;
reset role;
select is((select asks from pipeline_results), null, 'the pipeline can ask which jobs are overdue');
select is((select beats from pipeline_results), null, 'and record a heartbeat');
select is((select sweeps from pipeline_results), '42501', 'but cannot run the sweep, which is for cron and the service role');
select is((select edits_company from pipeline_results), '42501', 'cannot change a company');
select is((select deletes_jobs from pipeline_results), '42501', 'and cannot delete a job');

-- ---------------------------------------------------------------------------
-- The missed-run check
-- ---------------------------------------------------------------------------

update heartbeat set last_ok_at = now();
select is((select count(*)::int from missed_heartbeats()), 0, 'when every job has just finished nothing is overdue');

update heartbeat set last_ok_at = now() - interval '7 hours 30 minutes' where name = 'link-check';
select is((select array_agg(name) from missed_heartbeats()), array['link-check'], 'a job 6 hours plus its hour of grace late is named');
select ok((select overdue > interval '0' from missed_heartbeats() where name = 'link-check'), 'with how late it is');

update heartbeat set last_ok_at = now() - interval '6 hours 30 minutes' where name = 'link-check';
select is((select count(*)::int from missed_heartbeats()), 0, 'a little late is forgiven by the grace period');

update heartbeat set last_ok_at = null, created_at = now() - interval '2 days' where name = 'stale-sweep';
select is((select array_agg(name) from missed_heartbeats()), array['stale-sweep'], 'a job that has never finished is overdue once its first window has passed');
update heartbeat set last_ok_at = null, created_at = now() where name = 'stale-sweep';
select is((select count(*)::int from missed_heartbeats()), 0, 'but not on its first day');

-- ---------------------------------------------------------------------------
-- The stale sweep
-- ---------------------------------------------------------------------------

set local app.skip_audit = 'on';
truncate public.city, public.source, public.sector, public.company, public.admin_user restart identity cascade;
insert into source (id, name, kind, permission_note) values (1, 'Fixture', 'manual', 'Test fixture');
insert into company (id, slug, name, domain, website_url, status, source_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'pub-co', 'Pub Co', 'pub.test', 'https://pub.test', 'published', 1);
insert into job (id, company_id, source_id, title, apply_url, status, first_seen_at, last_checked_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 1, 'Fresh', 'https://pub.test/1', 'active', now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 1, 'Stale', 'https://pub.test/2', 'active', now() - interval '30 days', now() - interval '20 days'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', 1, 'Never checked and old', 'https://pub.test/3', 'active', now() - interval '20 days', null),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000c1', 1, 'Suspect a while', 'https://pub.test/4', 'suspect', now() - interval '40 days', now() - interval '25 days'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000c1', 1, 'Suspect recently', 'https://pub.test/5', 'suspect', now() - interval '40 days', now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000c1', 1, 'Draft', 'https://pub.test/6', 'draft', now() - interval '90 days', null);
set local app.skip_audit = 'off';

select is(sweep_stale_jobs(14), 3, 'the sweep moves three jobs: two active ones become suspect and one suspect one expires');
select is((select array_agg(title order by title) from job where status = 'suspect'), array['Never checked and old', 'Stale', 'Suspect recently'], 'unchecked active jobs become suspect');
select is((select status from job where title = 'Suspect a while'), 'expired', 'and a suspect job left unchecked a week longer expires');
select is((select status from job where title = 'Fresh'), 'active', 'a recently checked job is not touched');
select is((select status from job where title = 'Draft'), 'draft', 'and a draft is never touched');

-- ---------------------------------------------------------------------------
-- Partitions
-- ---------------------------------------------------------------------------

select is(ensure_verification_partitions(1), 0, 'the partitions for this month and the next two already exist, so asking for one more month adds none');
select is(ensure_verification_partitions(5), 3, 'asking further ahead adds the missing months');

select * from finish();
rollback;
