-- ADR-0022: job evidence and closure, reviewed changes to public facts, self-review, refresh checks, and the
-- evidence-complete flags the build and the launch gate read. Run with `npx supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

truncate public.city, public.source, public.sector, public.company, public.admin_user, public.audit_log restart identity cascade;

create schema tests;
grant pipeline to current_user with set true;
grant usage on schema tests to anon, authenticated, service_role, pipeline;
-- P9-13: an administrator's session needs a live aal2 session row and a verified factor in Supabase Auth's tables. Both are
-- created here for the test users (as the owner; rolled back with the transaction). The session id is the user id.
create function tests.mfa_session(uid uuid, aal text default 'aal2') returns void
language plpgsql as $mfa$
begin
  if uid is null or current_user <> 'postgres' then
    return;
  end if;
  insert into auth.users (id) values (uid) on conflict do nothing;
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  values (uid, uid, 'test', 'totp', 'verified', now(), now()) on conflict do nothing;
  insert into auth.sessions (id, user_id, aal, created_at) values (uid, uid, aal::auth.aal_level, now())
  on conflict (id) do update set aal = excluded.aal;
end;
$mfa$;

create function tests.become(uid uuid, r text default 'authenticated') returns void
language plpgsql as $$
begin
  perform tests.mfa_session(uid);
  perform set_config('request.jwt.claims',
    case when uid is null then '' else json_build_object('sub', uid, 'role', r, 'aal', 'aal2', 'session_id', uid)::text end, true);
  perform set_config('role', r, true);
end;
$$;
-- A statement, then the checks COMMIT would run; returns the error, or null.
create function tests.commit_check(q text) returns text
language plpgsql as $$
begin
  execute q;
  set constraints all immediate;
  set constraints all deferred;
  return null;
exception when others then
  return sqlerrm;
end;
$$;
create function tests.ev(p_company uuid, p_office uuid, p_job uuid, p_field text, p_value text default null) returns bigint
language sql as $$
  insert into public.field_evidence (company_id, office_id, job_id, field, value, source_url, verified_at)
  values (p_company, p_office, p_job, p_field, p_value, 'https://source.test/' || p_field, date '2026-09-10') returning id;
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role, pipeline;

set local app.skip_audit = 'on';
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000e001'), ('00000000-0000-0000-0000-00000000e002'), ('00000000-0000-0000-0000-00000000e003');
insert into admin_user (user_id, role) values
  ('00000000-0000-0000-0000-00000000e001', 'editor'), ('00000000-0000-0000-0000-00000000e002', 'reviewer'), ('00000000-0000-0000-0000-00000000e003', 'reviewer');
insert into city (id, slug, name, status, centre, default_zoom, boundary) values
  (1, 'bangalore', 'Bengaluru', 'beta', 'SRID=4326;POINT(77.60 12.97)', 11,
   'SRID=4326;MULTIPOLYGON(((77.40 12.80, 77.80 12.80, 77.80 13.15, 77.40 13.15, 77.40 12.80)))');
insert into source (id, name, kind, permission_note) values (1, 'Fixture', 'manual', 'Test fixture');
insert into sector (id, slug, name) values (1, 'fintech', 'Fintech'), (2, 'saas', 'SaaS');
-- A company with every required fact reviewed, published, and one with nothing (published before evidence existed).
insert into company (id, slug, name, domain, website_url, status) values
  ('00000000-0000-4000-8000-000000000001', 'acme', 'Acme', 'acme.test', 'https://acme.test', 'published'),
  ('00000000-0000-4000-8000-000000000002', 'legacy', 'Legacy', 'legacy.test', 'https://legacy.test', 'published');
insert into company_sector (company_id, sector_id) values ('00000000-0000-4000-8000-000000000001', 1);
insert into office (id, company_id, city_id, address, geom, accuracy, verification, status) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 1, '1 Main Road', 'SRID=4326;POINT(77.6 12.97)', 'building', 'reviewed', 'published'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000002', 1, '2 Old Road', 'SRID=4326;POINT(77.6 12.97)', 'building', 'reviewed', 'published');
insert into job (id, company_id, source_id, title, apply_url, status, work_mode) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000001', 1, 'Engineer', 'https://acme.test/jobs/1', 'draft', 'hybrid');
insert into job_city (job_id, city_id) values ('00000000-0000-4000-8000-0000000000b1', 1);
insert into field_evidence (company_id, office_id, field, source_url, verified_at, reviewed_at, reviewed_by)
select case when f in ('address', 'location') then null else '00000000-0000-4000-8000-000000000001'::uuid end,
       case when f in ('address', 'location') then '00000000-0000-4000-8000-0000000000a1'::uuid end,
       f, 'https://acme.test/about', date '2026-09-01', now(), '00000000-0000-0000-0000-00000000e003'
from unnest(array['name', 'website', 'sectors', 'address', 'location']) f;
-- Legacy's office has reviewed evidence, so it is listed; its company facts have none, so it is flagged incomplete.
insert into field_evidence (office_id, field, source_url, verified_at, reviewed_at, reviewed_by)
select '00000000-0000-4000-8000-0000000000a2'::uuid, f, 'https://legacy.test/contact', date '2026-09-01', now(), '00000000-0000-0000-0000-00000000e003'
from unnest(array['address', 'location']) f;
set local app.skip_audit = 'off';
set constraints all immediate;
set constraints all deferred;

-- ---------------------------------------------------------------------------
-- The launch flags
-- ---------------------------------------------------------------------------

select tests.become(null, 'anon');
select is(company_evidence_complete('00000000-0000-4000-8000-000000000001'), true, 'anon can ask whether a published company''s evidence is complete: yes');
select is(company_evidence_complete('00000000-0000-4000-8000-000000000002'), false, 'and for one published before evidence existed: no');
select is((select (c ->> 'evidence_complete')::boolean from jsonb_array_elements(city_build_snapshot('bangalore') -> 'companies') c where c ->> 'slug' = 'legacy'),
  false, 'the build snapshot carries the flag');
reset role;

-- ---------------------------------------------------------------------------
-- Jobs: evidence to publish, closure
-- ---------------------------------------------------------------------------

select tests.become('00000000-0000-0000-0000-00000000e002');
select matches(tests.commit_check($$ update job set status = 'active' where id = '00000000-0000-4000-8000-0000000000b1' $$),
  'apply url needs reviewed evidence.*employer.*location.*title', 'a job cannot be published without reviewed evidence for its title, employer, location, and link');
select tests.ev(null, null, '00000000-0000-4000-8000-0000000000b1', f) from unnest(array['title', 'employer', 'location', 'apply_url']) f;
select is((select value from field_evidence where job_id = '00000000-0000-4000-8000-0000000000b1' and field = 'location'), 'bangalore|hybrid',
  'location evidence is the cities and the work arrangement');
select is((select value from field_evidence where job_id = '00000000-0000-4000-8000-0000000000b1' and field = 'employer'), 'Acme', 'employer evidence is the company');
select review_evidence(array(select id from field_evidence where job_id = '00000000-0000-4000-8000-0000000000b1'));
select is((select bool_and(self_reviewed) from field_evidence where job_id = '00000000-0000-4000-8000-0000000000b1'), true,
  'a reviewer may review evidence they recorded, and it is marked as self-reviewed');
select is(tests.commit_check($$ update job set status = 'active' where id = '00000000-0000-4000-8000-0000000000b1' $$), null, 'with it, the job publishes');
select is((select count(*)::int from publication_approval where job_id = '00000000-0000-4000-8000-0000000000b1'), 1, 'and the approval is recorded');
select is(tests.commit_check($$ update job set status = 'expired' where id = '00000000-0000-4000-8000-0000000000b1' $$), null, 'closing a job');
select ok((select closed_at is not null from job where id = '00000000-0000-4000-8000-0000000000b1'), 'records when it closed');
select is(tests.commit_check($$ update job set status = 'active' where id = '00000000-0000-4000-8000-0000000000b1' $$), null, 'reopening it');
select is((select closed_at from job where id = '00000000-0000-4000-8000-0000000000b1'), null, 'clears the closure');
reset role;
select is(company_evidence_complete('00000000-0000-4000-8000-000000000001'), true,
  'the company''s evidence says nothing about whether its jobs are current');
select is(job_evidence_complete('00000000-0000-4000-8000-0000000000b1'), true, 'the job has its own flag');

-- ---------------------------------------------------------------------------
-- Self-review is recorded; another reviewer's is not marked
-- ---------------------------------------------------------------------------

select tests.become('00000000-0000-0000-0000-00000000e001');
create temp table ids (k text primary key, id bigint);
grant all on ids to authenticated;
insert into ids values ('desc-proposed', tests.ev('00000000-0000-4000-8000-000000000001', null, null, 'description', 'Makes anvils'));
select is((select value from field_evidence where id = (select id from ids where k = 'desc-proposed')), 'Makes anvils',
  'evidence can be recorded for a proposed value before the record changes');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e002');
select review_evidence(array[(select id from ids where k = 'desc-proposed')]);
reset role;
select is((select self_reviewed from field_evidence where id = (select id from ids where k = 'desc-proposed')), false,
  'reviewed by someone other than the recorder: not self-reviewed');
select is((select reviewed_by::text from field_evidence where id = (select id from ids where k = 'desc-proposed')), '00000000-0000-0000-0000-00000000e002',
  'the reviewer is recorded');

-- ---------------------------------------------------------------------------
-- Changing a public fact needs reviewed evidence for the new value
-- ---------------------------------------------------------------------------

select tests.become('00000000-0000-0000-0000-00000000e002');
select matches(tests.commit_check($$ update company set name = 'Acme Ltd' where id = '00000000-0000-4000-8000-000000000001' $$),
  'new name must have reviewed evidence before it changes \(it is stale\)', 'renaming a published company without evidence for the new name is refused');
select is((select name from company where id = '00000000-0000-4000-8000-000000000001'), 'Acme', 'and the public name stays');
select is(tests.commit_check($$ update company set description = 'Makes anvils' where id = '00000000-0000-4000-8000-000000000001' $$), null,
  'a change whose new value has reviewed evidence goes through');
insert into ids values ('name-proposed', tests.ev('00000000-0000-4000-8000-000000000001', null, null, 'name', 'Acme Ltd'));
select matches(tests.commit_check($$ update company set name = 'Acme Ltd' where id = '00000000-0000-4000-8000-000000000001' $$),
  'it is claimed', 'claimed evidence for the new value is not enough');
select review_evidence(array[(select id from ids where k = 'name-proposed')]);
select is(tests.commit_check($$ update company set name = 'Acme Ltd' where id = '00000000-0000-4000-8000-000000000001' $$), null, 'reviewed, the rename goes through');
select matches(tests.commit_check($$ insert into company_sector (company_id, sector_id) values ('00000000-0000-4000-8000-000000000001', 2) $$),
  'new sectors must have reviewed evidence', 'adding a sector to a published company needs reviewed evidence too');
select matches(tests.commit_check($$ update office set address = '1 Main Rd' where id = '00000000-0000-4000-8000-0000000000a1' $$),
  'new address must have reviewed evidence', 'so does moving a published office''s address');
select matches(tests.commit_check($$ update job set work_mode = 'remote' where id = '00000000-0000-4000-8000-0000000000b1' $$),
  'new location must have reviewed evidence', 'and changing an open job''s work arrangement');
select is(tests.commit_check($$ update company set name = 'Draft Rename' where id = '00000000-0000-4000-8000-000000000002' and false $$), null,
  'a statement that changes nothing is not checked');
reset role;

-- ---------------------------------------------------------------------------
-- The pipeline: feed evidence and source checks
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '', true);  -- the pipeline has no signed-in user
set local app.skip_audit = 'on';
insert into job (id, company_id, source_id, title, apply_url, status, work_mode, last_ok_at) values
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000000001', 1, 'Designer', 'https://acme.test/jobs/2', 'active', 'onsite', now());
insert into job_city (job_id, city_id) values ('00000000-0000-4000-8000-0000000000b2', 1);
set local app.skip_audit = 'off';
set constraints all immediate;
set constraints all deferred;
-- pgTAP's functions are not visible to the pipeline role: its results go into temporary tables, checked afterwards.
create temp table pipe (k text primary key, n bigint);
grant all on pipe to pipeline;
set local role pipeline;
insert into pipe values ('first', record_feed_job_evidence('00000000-0000-4000-8000-0000000000b2'));
insert into pipe values ('second', record_feed_job_evidence('00000000-0000-4000-8000-0000000000b2'));
insert into pipe select 'due-name', count(*) from evidence_due(1000) where field = 'name';
insert into pipe select 'due-job2', count(*) from evidence_due(1000) where record_type = 'job' and value = 'Designer';
select record_evidence_check((select evidence_id from evidence_due(1000) where field = 'name'), 'value_not_found', 200, 'the page no longer shows the name');
insert into pipe select 'due-name-after', count(*) from evidence_due(1000) where field = 'name';
reset role;
select is((select n from pipe where k = 'first'), 4::bigint, 'the pipeline records evidence for a job it read from the feed');
select is((select n from pipe where k = 'second'), 0::bigint, 'and not again while nothing changed');
select is((select verified_at from field_evidence where job_id = '00000000-0000-4000-8000-0000000000b2' and field = 'title'), current_date,
  'its verified date is the day it read the posting');
select is((select reviewed_at from field_evidence where job_id = '00000000-0000-4000-8000-0000000000b2' and field = 'title'), null, 'a claim, not a review');
select is((select n from pipe where k = 'due-name'), 1::bigint, 'the company name evidence, checked weekly, is due (verified 2026-09-01)');
select is((select n from pipe where k = 'due-job2'), 0::bigint, 'evidence read today is not due');
select is((select verified_at from field_evidence where company_id = '00000000-0000-4000-8000-000000000001' and field = 'name' and value = 'Acme Ltd'),
  date '2026-09-10', 'a check never changes the verified date');
select tests.become('00000000-0000-0000-0000-00000000e001');
select is((select outcome from refresh_problems() where field = 'name'), 'value_not_found', 'a value not found is listed for a person to look at');
reset role;
select is((select n from pipe where k = 'due-name-after'), 0::bigint, 'a checked field is not due again until its interval passes');

select tests.become(null, 'anon');
select throws_ok($$ select * from evidence_due(10) $$, '42501', null, 'anon cannot list due checks');
reset role;

select * from finish();
rollback;
