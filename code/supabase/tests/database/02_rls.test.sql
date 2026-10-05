-- P3-02: row-level security and admin roles, tested as each role.
-- Run with `npx supabase test db`.
--
-- The test connection is the database owner, which bypasses RLS, so every probe below first
-- switches to the role under test (tests.become) and switches back with `reset role`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(86);

-- `supabase db reset` loads the sample data (seed/01_sample_data.sql). These tests use their own
-- fixtures, so start from empty tables. TRUNCATE is transactional: the rollback below restores
-- the seed.
truncate public.city, public.source, public.sector, public.company, public.admin_user
  restart identity cascade;


-- Helpers (rolled back with the transaction). They run as the caller, so RLS applies.
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.sqlstate_of(q text) returns text
language plpgsql as $$
begin
  execute q;
  return null;
exception when others then
  return sqlstate;
end;
$$;

create function tests.rows_affected(q text) returns int
language plpgsql as $$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Become anon (uid null) or a signed-in user. `reset role` returns to the owner.
create function tests.become(uid uuid, r text default 'authenticated') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when uid is null then '' else json_build_object('sub', uid, 'role', r)::text end, true);
  perform set_config('role', r, true);
end;
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures (as the owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000e001'),   -- editor
  ('00000000-0000-0000-0000-00000000e002'),   -- reviewer
  ('00000000-0000-0000-0000-00000000e003'),   -- admin
  ('00000000-0000-0000-0000-00000000e004');   -- signed in, not an admin
insert into admin_user (user_id, role) values
  ('00000000-0000-0000-0000-00000000e001', 'editor'),
  ('00000000-0000-0000-0000-00000000e002', 'reviewer'),
  ('00000000-0000-0000-0000-00000000e003', 'admin');

-- City 1 is live; city 2 is a draft.
insert into city (id, slug, name, status, centre, default_zoom, boundary) values
  (1, 'bangalore', 'Bengaluru', 'live', 'SRID=4326;POINT(77.60 12.97)', 11,
   'SRID=4326;MULTIPOLYGON(((77.40 12.80, 77.80 12.80, 77.80 13.15, 77.40 13.15, 77.40 12.80)))'),
  (2, 'chennai', 'Chennai', 'draft', 'SRID=4326;POINT(80.27 13.08)', 11,
   'SRID=4326;MULTIPOLYGON(((80.10 12.90, 80.35 12.90, 80.35 13.25, 80.10 13.25, 80.10 12.90)))');
insert into neighbourhood (id, city_id, slug, name) values (1, 1, 'indiranagar', 'Indiranagar'), (2, 2, 'adyar', 'Adyar');
insert into tech_park (id, city_id, slug, name) values (1, 1, 'etv', 'ETV'), (2, 2, 'dlf', 'DLF');
insert into sector (id, slug, name) values (1, 'fintech', 'Fintech');
insert into source (id, name, kind, permission_note) values (1, 'synthetic test source', 'manual', 'test only');

-- P published, D draft, U unpublished. T1 and T2 are throwaway records for delete tests.
insert into company (id, slug, name, domain, website_url, status) values
  ('00000000-0000-0000-0000-0000000000c1', 'pub-co',  'Pub Co',  'pub.test',  'https://pub.test',  'published'),
  ('00000000-0000-0000-0000-0000000000c2', 'draft-co', 'Draft Co', 'draft.test', 'https://draft.test', 'draft'),
  ('00000000-0000-0000-0000-0000000000c3', 'unpub-co', 'Unpub Co', 'unpub.test', 'https://unpub.test', 'unpublished'),
  ('00000000-0000-0000-0000-0000000000c4', 'throwaway-pub', 'Throwaway Pub', 'tpub.test', 'https://tpub.test', 'published'),
  ('00000000-0000-0000-0000-0000000000c5', 'throwaway-pub-2', 'Throwaway Pub 2', 'tpub2.test', 'https://tpub2.test', 'published'),
  ('00000000-0000-0000-0000-0000000000c6', 'throwaway-draft', 'Throwaway Draft', 'tdraft.test', 'https://tdraft.test', 'draft');
insert into company_type_tag (company_id, type) values
  ('00000000-0000-0000-0000-0000000000c1', 'startup'),
  ('00000000-0000-0000-0000-0000000000c1', 'product'),
  ('00000000-0000-0000-0000-0000000000c2', 'mnc');
insert into company_sector (company_id, sector_id) values
  ('00000000-0000-0000-0000-0000000000c1', 1),
  ('00000000-0000-0000-0000-0000000000c2', 1);

-- Offices: o1 visible; o2 draft; o3 published in the draft city; o4 published but company is draft;
-- o5 unpublished.
insert into office (id, company_id, city_id, address, geom, accuracy, status) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 1, 'o1', 'SRID=4326;POINT(77.60 12.97)', 'building', 'published'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c1', 1, 'o2', 'SRID=4326;POINT(77.61 12.97)', 'building', 'draft'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c1', 2, 'o3', 'SRID=4326;POINT(80.27 13.08)', 'building', 'published'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c2', 1, 'o4', 'SRID=4326;POINT(77.62 12.97)', 'building', 'published'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c1', 1, 'o5', 'SRID=4326;POINT(77.63 12.97)', 'building', 'unpublished');

-- Jobs for P: active, suspect, expired, draft, withdrawn. One active job for the draft company.
insert into job (id, company_id, source_id, title, title_norm, apply_url, dedup_hash, status) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 1, 'Active', 'active', 'https://pub.test/1', '\x01', 'active'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 1, 'Suspect', 'suspect', 'https://pub.test/2', '\x02', 'suspect'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', 1, 'Expired', 'expired', 'https://pub.test/3', '\x03', 'expired'),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000c1', 1, 'Draft', 'draft', 'https://pub.test/4', '\x04', 'draft'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000c1', 1, 'Withdrawn', 'withdrawn', 'https://pub.test/5', '\x05', 'withdrawn'),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000c2', 1, 'Draft co job', 'draft co job', 'https://draft.test/1', '\x06', 'active');
insert into job_city (job_id, city_id) values
  ('00000000-0000-0000-0000-0000000000d1', 1),   -- visible
  ('00000000-0000-0000-0000-0000000000d1', 2),   -- city is a draft
  ('00000000-0000-0000-0000-0000000000d3', 1),   -- job expired
  ('00000000-0000-0000-0000-0000000000d6', 1);   -- company is a draft

-- Founders: published for P, draft for P, published for the draft company.
insert into company_founder (company_id, full_name, source_url, status) values
  ('00000000-0000-0000-0000-0000000000c1', 'Published Founder', 'https://pub.test/about', 'published'),
  ('00000000-0000-0000-0000-0000000000c1', 'Draft Founder', 'https://pub.test/about', 'draft'),
  ('00000000-0000-0000-0000-0000000000c2', 'Hidden Founder', 'https://draft.test/about', 'published');

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0,
  'row-level security is enabled on every table in public'
);
select is(
  (select count(*)::int from pg_class c
   -- A partition has no policy of its own: the parent's apply to queries through the parent, and the partition itself is
   -- closed (row-level security on, nothing granted), which the migration does for each one.
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relispartition
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid)),
  0,
  'every table in public has at least one policy'
);
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public'
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')),
  0,
  'anon holds no write privilege on any table in public'
);
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public'
     and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
  0,
  'authenticated holds no TRUNCATE, REFERENCES, or TRIGGER privilege'
);

-- ---------------------------------------------------------------------------
-- is_admin()
-- ---------------------------------------------------------------------------

select tests.become(null, 'anon');
select is(public.is_admin(), false, 'is_admin() is false for anon');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e004');
select is(public.is_admin(), false, 'is_admin() is false for a signed-in non-admin');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e001');
select is(public.is_admin('editor'), true, 'an editor is an editor');
select is(public.is_admin('reviewer'), false, 'an editor is not a reviewer');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e002');
select is(public.is_admin('reviewer'), true, 'a reviewer is a reviewer');
select is(public.is_admin('admin'), false, 'a reviewer is not an admin');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e003');
select is(public.is_admin('editor') and public.is_admin('reviewer') and public.is_admin('admin'), true,
  'an admin holds every level');
select is(public.is_admin('bogus'), false, 'an unknown role name fails closed, even for an admin');
reset role;

-- ---------------------------------------------------------------------------
-- anon: published data only, no writes
-- ---------------------------------------------------------------------------

select tests.become(null, 'anon');
select is((select count(*)::int from company), 3, 'anon sees the three published companies and no draft or unpublished one');
select is((select count(*)::int from company where status <> 'published'), 0, 'anon sees no company that is not published');
select is((select count(*)::int from office), 1, 'anon sees only the published office of a published company in a visible city');
select is((select count(*)::int from job), 2, 'anon sees active and suspect jobs of a published company');
select is((select count(*)::int from job where status = 'suspect'), 1, 'suspect jobs stay visible (JOB05)');
select is((select count(*)::int from company_founder), 1, 'anon sees only the published founder of a published company');
select is((select count(*)::int from company_type_tag), 2, 'anon sees the published company''s type tags only');
select is((select count(*)::int from company_sector), 1, 'anon sees the published company''s sector link only');
select is((select count(*)::int from city), 1, 'anon sees only the live city (the draft city is hidden)');
select is((select count(*)::int from neighbourhood), 1, 'anon sees neighbourhoods of visible cities only');
select is((select count(*)::int from tech_park), 1, 'anon sees tech parks of visible cities only');
select is((select count(*)::int from sector), 1, 'anon sees sectors');
select is((select count(*)::int from job_city), 1, 'anon sees only job-city rows of visible jobs in visible cities');
select is(tests.sqlstate_of('select * from source'), '42501', 'anon cannot read sources (no privilege)');
select is(tests.sqlstate_of('select * from admin_user'), '42501', 'anon cannot read admin_user (no privilege)');
select is(tests.sqlstate_of($$ insert into company (slug, name, domain, website_url) values ('a', 'A', 'a.test', 'https://a.test') $$),
  '42501', 'anon cannot insert a company');
select is(tests.sqlstate_of($$ update company set name = 'x' $$), '42501', 'anon cannot update a company');
select is(tests.sqlstate_of($$ delete from company $$), '42501', 'anon cannot delete a company');
select is(tests.sqlstate_of($$ insert into job_city (job_id, city_id) values ('00000000-0000-0000-0000-0000000000d2', 1) $$),
  '42501', 'anon cannot insert a job-city row');
reset role;

-- ---------------------------------------------------------------------------
-- A signed-in non-admin gets exactly what anon gets
-- ---------------------------------------------------------------------------

select tests.become('00000000-0000-0000-0000-00000000e004');
select is((select count(*)::int from company), 3, 'a non-admin sees the three published companies');
select is((select count(*)::int from company where status <> 'published'), 0, 'a non-admin sees no company that is not published');
select is((select count(*)::int from office), 1, 'a non-admin sees only the visible office');
select is((select count(*)::int from job), 2, 'a non-admin sees only visible jobs');
select is((select count(*)::int from company_founder), 1, 'a non-admin sees only the published founder');
select is((select count(*)::int from source), 0, 'a non-admin cannot read sources');
select is((select count(*)::int from admin_user), 0, 'a non-admin sees no admin_user rows');
select is(tests.sqlstate_of($$ insert into company (slug, name, domain, website_url) values ('a', 'A', 'a.test', 'https://a.test') $$),
  '42501', 'a non-admin cannot insert a company');
select is(tests.rows_affected($$ update company set name = 'x' where id = '00000000-0000-0000-0000-0000000000c1' $$),
  0, 'a non-admin updates no company row');
select is(tests.rows_affected($$ delete from company where id = '00000000-0000-0000-0000-0000000000c4' $$),
  0, 'a non-admin deletes no company row');
select is(tests.sqlstate_of($$ insert into admin_user (user_id, role) values ('00000000-0000-0000-0000-00000000e004', 'admin') $$),
  '42501', 'a non-admin cannot make themselves an admin');
reset role;

-- ---------------------------------------------------------------------------
-- editor
-- ---------------------------------------------------------------------------

select tests.become('00000000-0000-0000-0000-00000000e001');
select is((select count(*)::int from company), 6, 'an editor sees every company, drafts included');
select is((select count(*)::int from office), 5, 'an editor sees every office');
select is((select count(*)::int from job), 6, 'an editor sees every job');
select is((select count(*)::int from company_founder), 3, 'an editor sees every founder');
select is((select count(*)::int from city), 2, 'an editor sees every city');
select is((select count(*)::int from source), 1, 'an editor reads sources');
select is((select count(*)::int from admin_user), 1, 'an editor sees only their own admin_user row');
select is(tests.sqlstate_of($$ insert into company (slug, name, domain, website_url) values ('ed-draft', 'Ed Draft', 'ed.test', 'https://ed.test') $$),
  null, 'an editor can create a draft company');
select is(tests.sqlstate_of($$ insert into company (slug, name, domain, website_url, status) values ('ed-pub', 'Ed Pub', 'edpub.test', 'https://edpub.test', 'published') $$),
  '42501', 'an editor cannot create a published company');
select is(tests.rows_affected($$ update company set description = 'edited' where id = '00000000-0000-0000-0000-0000000000c1' $$),
  1, 'an editor can edit a published company');
select is(tests.sqlstate_of($$ update company set status = 'unpublished' where id = '00000000-0000-0000-0000-0000000000c1' $$),
  '42501', 'an editor cannot unpublish');
select is(tests.sqlstate_of($$ update company set status = 'published' where id = '00000000-0000-0000-0000-0000000000c2' $$),
  '42501', 'an editor cannot publish');
select is(tests.sqlstate_of($$ update office set status = 'published' where id = '00000000-0000-0000-0000-0000000000b2' $$),
  '42501', 'an editor cannot publish an office');
select is(tests.sqlstate_of($$ update company_founder set status = 'published' where full_name = 'Draft Founder' $$),
  '42501', 'an editor cannot publish a founder');
select is(tests.sqlstate_of($$ update job set status = 'active' where id = '00000000-0000-0000-0000-0000000000d4' $$),
  '42501', 'an editor cannot make a job active');
select is(tests.sqlstate_of($$ insert into job (company_id, source_id, title, title_norm, apply_url, dedup_hash, status)
  values ('00000000-0000-0000-0000-0000000000c1', 1, 'New', 'new', 'https://pub.test/n', '\x10', 'draft') $$),
  null, 'an editor can create a draft job');
select is(tests.sqlstate_of($$ insert into office (company_id, city_id, address, geom, accuracy)
  values ('00000000-0000-0000-0000-0000000000c1', 1, 'new draft office', 'SRID=4326;POINT(77.7 12.9)', 'building') $$),
  null, 'an editor can create a draft office');
select is(tests.sqlstate_of($$ insert into company_type_tag (company_id, type) values ('00000000-0000-0000-0000-0000000000c2', 'product') $$),
  null, 'an editor can add a type tag');
select is(tests.rows_affected($$ delete from company where id = '00000000-0000-0000-0000-0000000000c4' $$),
  0, 'an editor cannot delete a published company');
select is(tests.rows_affected($$ delete from company where id = '00000000-0000-0000-0000-0000000000c6' $$),
  1, 'an editor can delete a draft company');
select is(tests.rows_affected($$ delete from job where id = '00000000-0000-0000-0000-0000000000d1' $$),
  0, 'an editor cannot delete an active job');
select is(tests.rows_affected($$ delete from job where id = '00000000-0000-0000-0000-0000000000d4' $$),
  1, 'an editor can delete a draft job');
select is(tests.sqlstate_of($$ update city set name = 'x' where id = 1 $$), null, 'an editor''s city update runs');
select is(tests.rows_affected($$ update city set name = 'x' where id = 1 $$), 0, 'an editor changes no city row');
select is(tests.sqlstate_of($$ insert into sector (slug, name) values ('x', 'X') $$), '42501', 'an editor cannot add a sector');
select is(tests.rows_affected($$ update source set name = 'x' $$), 0, 'an editor changes no source row');
select is(tests.sqlstate_of($$ insert into admin_user (user_id, role) values ('00000000-0000-0000-0000-00000000e004', 'editor') $$),
  '42501', 'an editor cannot grant admin roles');
reset role;

-- ---------------------------------------------------------------------------
-- reviewer
-- ---------------------------------------------------------------------------

select tests.become('00000000-0000-0000-0000-00000000e002');
select is(tests.rows_affected($$ update company set status = 'published' where id = '00000000-0000-0000-0000-0000000000c2' $$),
  1, 'a reviewer can publish a company');
select is(tests.rows_affected($$ update company set status = 'unpublished' where id = '00000000-0000-0000-0000-0000000000c5' $$),
  1, 'a reviewer can unpublish a company');
select is(tests.rows_affected($$ update office set status = 'published' where id = '00000000-0000-0000-0000-0000000000b2' $$),
  1, 'a reviewer can publish an office');
select is(tests.rows_affected($$ update job set status = 'active' where id = '00000000-0000-0000-0000-0000000000d5' $$),
  1, 'a reviewer can activate a job');
select is(tests.sqlstate_of($$ insert into company (slug, name, domain, website_url, status) values ('rv-pub', 'Rv Pub', 'rvpub.test', 'https://rvpub.test', 'published') $$),
  null, 'a reviewer can create a published company');
select is(tests.rows_affected($$ delete from company where id = '00000000-0000-0000-0000-0000000000c4' $$),
  0, 'a reviewer cannot delete a published company');
select is(tests.sqlstate_of($$ insert into admin_user (user_id, role) values ('00000000-0000-0000-0000-00000000e004', 'editor') $$),
  '42501', 'a reviewer cannot grant admin roles');
select is(tests.rows_affected($$ update city set name = 'x' where id = 1 $$), 0, 'a reviewer changes no city row');
reset role;

-- ---------------------------------------------------------------------------
-- admin
-- ---------------------------------------------------------------------------

select tests.become('00000000-0000-0000-0000-00000000e003');
select is((select count(*)::int from admin_user), 3, 'an admin sees every admin_user row');
select is(tests.rows_affected($$ delete from company where id = '00000000-0000-0000-0000-0000000000c4' $$),
  1, 'an admin can delete a published company');
select is(tests.rows_affected($$ update city set name = 'Bengaluru City' where id = 1 $$), 1, 'an admin can update a city');
select is(tests.rows_affected($$ update source set name = 'renamed source' where id = 1 $$), 1, 'an admin can update a source');
select is(tests.sqlstate_of($$ insert into sector (slug, name) values ('saas', 'SaaS') $$), null, 'an admin can add a sector');
select is(tests.sqlstate_of($$ insert into admin_user (user_id, role) values ('00000000-0000-0000-0000-00000000e004', 'editor') $$),
  null, 'an admin can grant an admin role');
reset role;

-- The new editor can now act as one.
select tests.become('00000000-0000-0000-0000-00000000e004');
select is(public.is_admin('editor'), true, 'a newly granted editor is recognised');
reset role;

-- ---------------------------------------------------------------------------
-- service_role and the migration owner (no signed-in user) are not stopped by the publish rule
-- ---------------------------------------------------------------------------

select tests.become(null, 'service_role');
select is((select count(*)::int from company where status = 'draft'), 1, 'service_role bypasses RLS and sees draft companies');
select is(tests.sqlstate_of($$ insert into company (slug, name, domain, website_url, status) values ('svc-pub', 'Svc Pub', 'svc.test', 'https://svc.test', 'published') $$),
  null, 'service_role can create a published company (the pipeline path)');
reset role;

select * from finish();
rollback;
