-- Regression tests for 20261007150000_security_gaps.sql: SEC-1 to SEC-4, the publication loophole, and city listings.
-- Each case runs as the role that could reach the gap: an aal2 editor or reviewer, the pipeline role, service_role, and
-- the owner as the control. Deferred gates are forced with `set constraints all immediate` inside tests.outcome().
-- Run with `node scripts/test-stack.mts test-db` (never against the main local database).
begin;
create extension if not exists pgtap with schema extensions;

select plan(39);

truncate public.city, public.source, public.sector, public.company, public.admin_user restart identity cascade;
grant pipeline to current_user with set true;

create schema tests;
grant usage on schema tests to anon, authenticated, service_role, pipeline;

-- Become a signed-in admin (aal2, live session, verified factor), anon, service_role, pipeline, or the owner (null).
create function tests.become(who text, uid uuid default null) returns void
language plpgsql as $$
begin
  if uid is not null and current_user = 'postgres' then
    insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
    values (uid, uid, 'test', 'totp', 'verified', now(), now()) on conflict do nothing;
    insert into auth.sessions (id, user_id, aal, created_at) values (uid, uid, 'aal2', now()) on conflict do nothing;
  end if;
  perform set_config('request.jwt.claims',
    case when uid is null then '' else json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2', 'session_id', uid)::text end, true);
  perform set_config('role', coalesce(who, 'none'), true);
end;
$$;

-- Runs a statement and the deferred checks a commit would run; returns the SQLSTATE, or null if it would commit.
create function tests.outcome(q text) returns text
language plpgsql as $$
begin
  execute q;
  set constraints all immediate;
  set constraints all deferred;
  return null;
exception when others then
  set constraints all deferred;
  return sqlstate;
end;
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role, pipeline;

-- Fixture (owner).
set local app.skip_audit = 'on';
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000ed01'), ('00000000-0000-0000-0000-00000000e501');
insert into admin_user (user_id, role) values ('00000000-0000-0000-0000-00000000ed01', 'editor'), ('00000000-0000-0000-0000-00000000e501', 'reviewer');
insert into city (id, slug, name, status, centre, default_zoom, boundary) values
  (1, 'bangalore', 'Bengaluru', 'beta', 'SRID=4326;POINT(77.60 12.97)', 11, 'SRID=4326;MULTIPOLYGON(((77.40 12.80, 77.80 12.80, 77.80 13.15, 77.40 13.15, 77.40 12.80)))'),
  (2, 'chennai', 'Chennai', 'beta', 'SRID=4326;POINT(80.27 13.08)', 11, 'SRID=4326;MULTIPOLYGON(((80.10 12.90, 80.35 12.90, 80.35 13.25, 80.10 13.25, 80.10 12.90)))');
insert into source (id, name, kind, permission_note) values (1, 'Fixture', 'ats_feed', 'Test fixture');
insert into sector (id, slug, name) values (1, 'fintech', 'Fintech'), (2, 'saas', 'SaaS');
insert into company (id, slug, name, domain, website_url, status) values
  ('00000000-0000-4000-8000-0000000000c1', 'public-co', 'Public Co', 'public-co.test', 'https://public-co.test', 'published'),
  ('00000000-0000-4000-8000-0000000000c2', 'draft-co', 'Draft Co', 'draft-co.test', 'https://draft-co.test', 'draft');
insert into company (id, slug, name, domain, website_url, status, is_synthetic) values
  ('00000000-0000-4000-8000-0000000000c3', 'sample-co', 'Sample Co (synthetic)', 'sample-co.test', 'https://sample-co.test', 'published', true);
insert into company_type_tag (company_id, type) values ('00000000-0000-4000-8000-0000000000c1', 'product');
insert into company_sector (company_id, sector_id) values ('00000000-0000-4000-8000-0000000000c1', 1);
insert into office (id, company_id, city_id, address, geom, accuracy, status) values
  -- Public Co: a reviewed office in Bengaluru, and an UNREVIEWED published office in Chennai.
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 1, '1 Listed Road', 'SRID=4326;POINT(77.6 12.97)', 'building', 'published'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000c1', 2, '2 Unreviewed Road', 'SRID=4326;POINT(80.27 13.08)', 'building', 'published'),
  -- Draft Co: a reviewed office that is still a DRAFT.
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000c2', 1, '3 Draft Road', 'SRID=4326;POINT(77.6 12.98)', 'building', 'draft'),
  -- Sample Co (synthetic): no evidence at all.
  ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c3', 1, '4 Sample Road', 'SRID=4326;POINT(77.6 12.99)', 'building', 'published');
insert into field_evidence (company_id, office_id, field, source_url, verified_at, reviewed_at, reviewed_by)
select case when f in ('address', 'location') then null else c end, case when f in ('address', 'location') then o end,
       f, 'https://fixture.test/evidence', date '2026-09-01', now(), '00000000-0000-0000-0000-00000000e501'
from (values ('00000000-0000-4000-8000-0000000000c1'::uuid, '00000000-0000-4000-8000-0000000000a1'::uuid),
             ('00000000-0000-4000-8000-0000000000c2'::uuid, '00000000-0000-4000-8000-0000000000a3'::uuid)) x(c, o),
     unnest(array['name', 'website', 'types', 'sectors', 'address', 'location']) f
where not (c = '00000000-0000-4000-8000-0000000000c2' and f in ('types', 'sectors'));
-- An approved feed for Public Co, and one that is not approved.
insert into job_feed (id, company_id, source_id, provider, identifier, approved_by, approved_at, approval_note) values
  (1, '00000000-0000-4000-8000-0000000000c1', 1, 'greenhouse', 'public-co', '00000000-0000-0000-0000-00000000e501', now(), 'fixture');
insert into job_feed (id, company_id, source_id, provider, identifier) values (2, '00000000-0000-4000-8000-0000000000c2', 1, 'lever', 'draft-co');
set local app.skip_audit = 'off';
set constraints all immediate;
set constraints all deferred;

-- ---------------------------------------------------------------------------
-- SEC-1: updates of tags, sectors and job cities on public records
-- ---------------------------------------------------------------------------

select tests.become('authenticated', '00000000-0000-0000-0000-00000000ed01');
select is(tests.outcome($$ update company_type_tag set type = 'mnc' where company_id = '00000000-0000-4000-8000-0000000000c1' $$), '23514',
  'SEC-1: an editor cannot UPDATE a public company''s type tag without reviewed evidence for the new value');
select is(tests.outcome($$ update company_sector set sector_id = 2 where company_id = '00000000-0000-4000-8000-0000000000c1' $$), '23514',
  'SEC-1: nor its sector');
select is(tests.outcome($$ update company_type_tag set type = 'mnc' where company_id = '00000000-0000-4000-8000-0000000000c2' $$), null,
  'a draft company''s tags change freely');
select tests.become(null);
select is((select string_agg(type::text, ',') from company_type_tag where company_id = '00000000-0000-4000-8000-0000000000c1'), 'product',
  'the public company''s tag is unchanged');
-- With reviewed evidence for the proposed value, the change commits.
insert into field_evidence (company_id, field, value, source_url, verified_at, reviewed_at, reviewed_by)
values ('00000000-0000-4000-8000-0000000000c1', 'types', 'mnc', 'https://fixture.test/about', date '2026-09-02', now(), '00000000-0000-0000-0000-00000000e501');
select tests.become('authenticated', '00000000-0000-0000-0000-00000000ed01');
select is(tests.outcome($$ update company_type_tag set type = 'mnc' where company_id = '00000000-0000-4000-8000-0000000000c1' $$), null,
  'with reviewed evidence for the new value, the update commits');
select tests.become(null);

-- A public job listed in Bengaluru, with reviewed evidence (owner).
insert into job (id, company_id, source_id, title, apply_url, status, work_mode) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c1', 1, 'Engineer', 'https://public-co.test/jobs/1', 'active', 'hybrid');
insert into job_city (job_id, city_id) values ('00000000-0000-4000-8000-0000000000b1', 1);
insert into field_evidence (job_id, field, source_url, verified_at, reviewed_at, reviewed_by)
select '00000000-0000-4000-8000-0000000000b1', f, 'https://public-co.test/jobs/1', date '2026-09-01', now(), '00000000-0000-0000-0000-00000000e501'
from unnest(array['title', 'employer', 'location', 'apply_url']) f;
select tests.become('authenticated', '00000000-0000-0000-0000-00000000e501');
select is(tests.outcome($$ update job_city set city_id = 2 where job_id = '00000000-0000-4000-8000-0000000000b1' $$), '23514',
  'SEC-1: even a reviewer cannot UPDATE a public job''s city without reviewed evidence for the new location');
select tests.become(null);

-- ---------------------------------------------------------------------------
-- SEC-3: the pipeline lists jobs only from approved feeds, with evidence
-- ---------------------------------------------------------------------------

-- The pipeline role cannot see pgTAP, so each outcome is kept in a setting and asserted as the owner.
select tests.become('pipeline');
select set_config('t.no_evidence', coalesce(tests.outcome($$ insert into job (company_id, source_id, title, apply_url, status) values
  ('00000000-0000-4000-8000-0000000000c1', 1, 'No evidence', 'https://public-co.test/jobs/2', 'active') $$), 'committed'), true);
select set_config('t.feed_job', coalesce(tests.outcome($$
  with j as (insert into job (company_id, source_id, title, apply_url, status) values
    ('00000000-0000-4000-8000-0000000000c1', 1, 'Feed job', 'https://public-co.test/jobs/3', 'active') returning id),
  c as (insert into job_city (job_id, city_id) select id, 1 from j returning job_id)
  select record_feed_job_evidence((select job_id from c), 1) $$), 'committed'), true);
select set_config('t.unapproved', coalesce(tests.outcome($$
  with j as (insert into job (company_id, source_id, title, apply_url, status) values
    ('00000000-0000-4000-8000-0000000000c2', 1, 'Unapproved feed job', 'https://draft-co.test/jobs/1', 'active') returning id),
  c as (insert into job_city (job_id, city_id) select id, 1 from j returning job_id)
  select record_feed_job_evidence((select job_id from c), 2) $$), 'committed'), true);
select set_config('t.suspect', coalesce(tests.outcome($$ update job set status = 'suspect' where title = 'Feed job' $$), 'committed'), true);
select set_config('t.rename', coalesce(tests.outcome($$ update job set title = 'Renamed without evidence' where title = 'Feed job' $$), 'committed'), true);
select set_config('t.expire', coalesce(tests.outcome($$ update job set status = 'expired' where title = 'Feed job' $$), 'committed'), true);
select tests.become(null);
select is(current_setting('t.no_evidence'), '23514', 'SEC-3: the pipeline cannot list a job without evidence or an approved feed');
select is(current_setting('t.feed_job'), 'committed', 'ADR-0022 automation preserved: a job from an approved feed with feed evidence is listed');
select is((select count(*)::int from field_evidence e join job j on j.id = e.job_id where j.title = 'Feed job' and e.reviewed_at is null), 4,
  'with claimed (unreviewed) evidence for its four fields');
select is(current_setting('t.unapproved'), '23514', 'SEC-3: not from a feed that is not approved (and not for a draft company)');
select is(current_setting('t.suspect'), 'committed', 'a link check may move a listed job between active and suspect');
select is(current_setting('t.rename'), '23514', 'SEC-3: the pipeline cannot change a listed job''s title without evidence for the new value');
select is(current_setting('t.expire'), 'committed', 'the pipeline may close a job');
select is((select status from job where title = 'Feed job'), 'expired', 'and it is closed');

-- ---------------------------------------------------------------------------
-- SEC-4: service_role (no signed-in user) is not trusted; the owner still is
-- ---------------------------------------------------------------------------

select tests.become('service_role');
select is(tests.outcome($$ insert into field_evidence (company_id, field, source_url, verified_at, reviewed_at, reviewed_by)
  values ('00000000-0000-4000-8000-0000000000c2', 'name', 'https://draft-co.test/x', current_date, now(), '00000000-0000-0000-0000-00000000e501') $$), '42501',
  'SEC-4: service_role cannot insert evidence already marked reviewed');
select is(tests.outcome($$ insert into field_evidence (company_id, field, source_url, verified_at)
  values ('00000000-0000-4000-8000-0000000000c2', 'name', 'https://draft-co.test/claim', current_date) $$), null,
  'it may still record a claim');
select is(tests.outcome($$ update field_evidence set reviewed_at = now(), reviewed_by = '00000000-0000-0000-0000-00000000e501'
  where source_url = 'https://draft-co.test/claim' $$), '42501', 'SEC-4: but not review it');
select is(tests.outcome($$ update company set status = 'published' where id = '00000000-0000-4000-8000-0000000000c2' $$), '42501',
  'SEC-4: service_role cannot publish a company');
select is(tests.outcome($$ update company set status = 'unpublished' where id = '00000000-0000-4000-8000-0000000000c1' $$), '42501',
  'SEC-4: nor unpublish one');
select is(tests.outcome($$ update company set name = 'Renamed by service' where id = '00000000-0000-4000-8000-0000000000c1' $$), '23514',
  'SEC-4: nor change a public fact without reviewed evidence');
select is(tests.outcome($$ update job_feed set approved_by = '00000000-0000-0000-0000-00000000e501', approved_at = now() where id = 2 $$), '42501',
  'SEC-4: nor approve a feed');
select is(tests.outcome($$ update company set logo_key = '00000000-0000-4000-8000-0000000000c1/' || repeat('a', 64) || '.png'
  where id = '00000000-0000-4000-8000-0000000000c1' $$), '23514', 'SEC-4: nor set a logo key without an approved, activated upload');
select is(tests.outcome($$ update job set status = 'expired' where id = '00000000-0000-4000-8000-0000000000b1' $$), null,
  'service_role may still close a job (the stale sweep)');
select tests.become(null);
select is(tests.outcome($$ update company set status = 'unpublished' where id = '00000000-0000-4000-8000-0000000000c3' $$), null,
  'the owner (migrations, seed, pg_cron) is still trusted');
update company set status = 'published' where id = '00000000-0000-4000-8000-0000000000c3';
-- Run the owner's deferred checks now, as the owner (they read the caller when they fire, at commit).
set constraints all immediate;
set constraints all deferred;

-- ---------------------------------------------------------------------------
-- The publication loophole
-- ---------------------------------------------------------------------------

select tests.become('authenticated', '00000000-0000-0000-0000-00000000e501');
select is(tests.outcome($$ update company set status = 'published' where id = '00000000-0000-4000-8000-0000000000c2' $$), '23514',
  'a company whose only reviewed office is a draft cannot be published');
select ok(array_to_string(publication_problems('00000000-0000-4000-8000-0000000000c2'), ';') like '%published office%',
  'and the reason says the office must be published');
select is(tests.outcome($$ update office set status = 'published' where id = '00000000-0000-4000-8000-0000000000a3' $$), null,
  'the reviewer publishes the reviewed office first');
select is(tests.outcome($$ update company set status = 'published' where id = '00000000-0000-4000-8000-0000000000c2' $$), null,
  'then the company can be published');
select tests.become(null);

-- ---------------------------------------------------------------------------
-- City listings: a published, reviewed office in that city
-- ---------------------------------------------------------------------------

select tests.become('anon');
select ok('00000000-0000-4000-8000-0000000000c1'::uuid in (select company_filter('bangalore', '{}')),
  'a company with a published, reviewed office in Bengaluru is listed there');
select ok('00000000-0000-4000-8000-0000000000c1'::uuid not in (select company_filter('chennai', '{}')),
  'but not in Chennai, where its only office has no reviewed evidence');
select is((select count(*)::int from city_points('chennai', '{}') where company_id = '00000000-0000-4000-8000-0000000000c1'), 0,
  'no unreviewed office appears as a point');
select is((select count(*)::int from jsonb_array_elements(city_build_snapshot('chennai') -> 'offices') o
           where o ->> 'id' = '00000000-0000-4000-8000-0000000000a2'), 0, 'nor in the build snapshot');
select is((select count(*)::int from jsonb_array_elements(city_build_snapshot('bangalore') -> 'offices') o
           where o ->> 'id' = '00000000-0000-4000-8000-0000000000a1'), 1, 'the reviewed office is in the snapshot');
select ok(listed_office('00000000-0000-4000-8000-0000000000a1') and not listed_office('00000000-0000-4000-8000-0000000000a2'),
  'anon can ask whether an office is listed, yes or no');
select ok('00000000-0000-4000-8000-0000000000c3'::uuid in (select company_filter('bangalore', '{}')),
  'synthetic sample records are listed without evidence (labelled; no release build accepts them)');
select is(tests.outcome('select * from field_evidence'), '42501', 'anon still cannot read evidence');
select tests.become(null);
-- Evidence that becomes unreviewed takes the office out of the listing at once.
update field_evidence set reviewed_at = null, reviewed_by = null where office_id = '00000000-0000-4000-8000-0000000000a1';
select ok('00000000-0000-4000-8000-0000000000c1'::uuid not in (select company_filter('bangalore', '{}')),
  'when the office''s evidence is no longer reviewed, the company leaves the listing');
select ok(not listed_office('00000000-0000-4000-8000-0000000000a1'), 'and the office is not listed');
select is((select count(*)::int from search_companies('bangalore', '{}') where company_id = '00000000-0000-4000-8000-0000000000c1'), 0,
  'nor in the list view');

select * from finish();
rollback;
