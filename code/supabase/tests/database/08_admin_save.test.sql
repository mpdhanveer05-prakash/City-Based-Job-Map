-- P7-02: the three save functions behind the admin forms, tested as each role.
-- Run with `npx supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

truncate public.city, public.source, public.sector, public.company, public.admin_user, public.audit_log restart identity cascade;

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
create function tests.become(uid uuid, r text default 'authenticated') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when uid is null then '' else json_build_object('sub', uid, 'role', r)::text end, true);
  perform set_config('role', r, true);
end;
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

set local app.skip_audit = 'on';
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000e001'),   -- editor
  ('00000000-0000-0000-0000-00000000e002'),   -- reviewer
  ('00000000-0000-0000-0000-00000000e003'),   -- admin
  ('00000000-0000-0000-0000-00000000e004');   -- signed in, not an admin
insert into admin_user (user_id, role) values
  ('00000000-0000-0000-0000-00000000e001', 'editor'),
  ('00000000-0000-0000-0000-00000000e002', 'reviewer'),
  ('00000000-0000-0000-0000-00000000e003', 'admin');
insert into city (id, slug, name, status, centre, default_zoom, boundary) values
  (1, 'bangalore', 'Bengaluru', 'beta', 'SRID=4326;POINT(77.60 12.97)', 11,
   'SRID=4326;MULTIPOLYGON(((77.40 12.80, 77.80 12.80, 77.80 13.15, 77.40 13.15, 77.40 12.80)))'),
  (2, 'chennai', 'Chennai', 'beta', 'SRID=4326;POINT(80.27 13.08)', 11,
   'SRID=4326;MULTIPOLYGON(((80.10 12.90, 80.35 12.90, 80.35 13.25, 80.10 13.25, 80.10 12.90)))');
insert into sector (id, slug, name) values (1, 'fintech', 'Fintech'), (2, 'saas', 'SaaS');
insert into source (id, name, kind, permission_note) values (1, 'Fixture', 'manual', 'Test fixture');
set local app.skip_audit = 'off';

-- A company, saved, then the deferred rules checked the way COMMIT would check them (each RPC is its own transaction).
create function tests.save_company(p_id uuid, p_company jsonb, p_types text[], p_sectors text[]) returns uuid
language plpgsql as $$
declare v uuid;
begin
  v := public.admin_save_company(p_id, p_company, p_types, p_sectors);
  set constraints all immediate;
  set constraints all deferred;
  return v;
end;
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

create function tests.co(p_name text, p_domain text, extra jsonb default '{}') returns jsonb
language sql as $$
  select jsonb_build_object('name', p_name, 'slug', public.slugify(p_name), 'domain', p_domain, 'website_url', 'https://' || p_domain,
                            'careers_url', '', 'description', '', 'startup_stage', '', 'status', 'draft') || extra;
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Companies
-- ---------------------------------------------------------------------------

select tests.become(null, 'anon');
select is(tests.sqlstate_of($$ select admin_save_company(null, tests.co('X', 'x.test'), array['startup'], array[]::text[]) $$), '42501', 'anon cannot save a company');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e004', 'authenticated');
select is(tests.sqlstate_of($$ select admin_save_company(null, tests.co('X', 'x.test'), array['startup'], array[]::text[]) $$), '42501', 'a signed-in non-admin cannot either');
reset role;

select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
create temp table saved as select tests.save_company(null, tests.co('Acme Pay', 'acme-pay.test', '{"startup_stage": "seed", "description": "Pays things"}'), array['startup', 'product'], array['fintech']) as id;
reset role;

select is((select count(*)::int from company where domain = 'acme-pay.test'), 1, 'an editor creates a company');
select is((select status from company where domain = 'acme-pay.test'), 'draft', 'as a draft');
select is((select startup_stage::text from company where domain = 'acme-pay.test'), 'seed', 'with the stage given');
select is((select array_agg(type::text order by type::text) from company_type_tag where company_id = (select id from saved)), array['product', 'startup'], 'and its types');
select is((select array_agg(s.slug) from company_sector cs join sector s on s.id = cs.sector_id where cs.company_id = (select id from saved)), array['fintech'], 'and its sector');
select is((select count(*)::int from audit_log where table_name = 'company' and action = 'insert'), 1, 'the save is in the audit log');

select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
select lives_ok($$ select tests.save_company((select id from saved), tests.co('Acme Pay Ltd', 'acme-pay.test', '{"startup_stage": "seed"}'), array['startup'], array['fintech', 'saas']) $$,
  'an edit replaces the name, the types, and the sectors');
reset role;
select is((select name from company where domain = 'acme-pay.test'), 'Acme Pay Ltd', 'the new name is saved');
select is((select array_agg(type::text) from company_type_tag where company_id = (select id from saved)), array['startup'], 'the dropped type is gone');
select is((select count(*)::int from company_sector where company_id = (select id from saved)), 2, 'and the second sector is added');

select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
select lives_ok($$ select tests.save_company((select id from saved), tests.co('Acme Pay Ltd', 'acme-pay.test'), array['mnc'], array['fintech']) $$,
  'dropping Startup from the types clears the stage in the same save, so the stage rule holds');
reset role;
select is((select startup_stage from company where domain = 'acme-pay.test'), null, 'the stage is gone');

select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
select is(tests.sqlstate_of($$ select tests.save_company(null, tests.co('Bad Stage', 'bad-stage.test', '{"startup_stage": "seed"}'), array['mnc'], array[]::text[]) $$), '23514',
  'a stage with no Startup type is refused when the transaction ends');
select is(tests.sqlstate_of($$ select admin_save_company(null, tests.co('Bad Sector', 'bad-sector.test'), array['mnc'], array['nonsense']) $$), '22023', 'an unknown sector is refused');
select is(tests.sqlstate_of($$ select admin_save_company(null, tests.co('Dup', 'acme-pay.test'), array['mnc'], array[]::text[]) $$), '23505', 'a domain that is taken is refused');
select is(tests.sqlstate_of($$ select admin_save_company('00000000-0000-0000-0000-0000000000ff', tests.co('Ghost', 'ghost.test'), array['mnc'], array[]::text[]) $$), '22023', 'editing a company that does not exist is refused');
select is(tests.sqlstate_of($$ select admin_save_company(null, tests.co('Public Now', 'public-now.test', '{"status": "published"}'), array['mnc'], array[]::text[]) $$), '42501',
  'an editor cannot create a company that is already published');
reset role;
select is((select count(*)::int from company where domain in ('bad-stage.test', 'bad-sector.test', 'public-now.test')), 0, 'and none of those left a company behind');

select tests.become('00000000-0000-0000-0000-00000000e002', 'authenticated');
select lives_ok($$ select tests.save_company((select id from saved), tests.co('Acme Pay Ltd', 'acme-pay.test', '{"status": "published"}'), array['mnc'], array['fintech']) $$, 'a reviewer can publish');
reset role;
select is((select status from company where domain = 'acme-pay.test'), 'published', 'the company is published');

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------

create temp table job_saved (id uuid);
grant all on job_saved to authenticated;
select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
insert into job_saved select admin_save_job(null, jsonb_build_object('company_id', (select id from saved), 'source_id', 1, 'title', 'Backend Engineer',
  'apply_url', 'https://acme-pay.test/careers/1', 'status', 'draft', 'work_mode', 'hybrid', 'exp_min_years', '2', 'exp_max_years', '5', 'posted_at', '2026-10-01'),
  array[1, 2]::smallint[]);
reset role;

select is((select title from job where id = (select id from job_saved)), 'Backend Engineer', 'an editor creates a job');
select is((select array_agg(city_id::int order by city_id) from job_city where job_id = (select id from job_saved)), array[1, 2], 'listed in two cities');
select is((select title_norm from job where id = (select id from job_saved)), 'backend engineer', 'the database filled in the normalised title');
select ok((select dedup_hash is not null from job where id = (select id from job_saved)), 'and the duplicate hash');

select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
select lives_ok($$ select admin_save_job((select id from job_saved), jsonb_build_object('company_id', (select id from saved), 'source_id', 1, 'title', 'Staff Engineer',
  'apply_url', 'https://acme-pay.test/careers/1', 'status', 'draft'), array[2]::smallint[]) $$, 'an edit changes the title and the cities');
select is(tests.sqlstate_of($$ select admin_save_job(null, jsonb_build_object('company_id', (select id from saved), 'source_id', 1, 'title', 'No cities',
  'apply_url', 'https://acme-pay.test/careers/9'), array[]::smallint[]) $$), '22023', 'a job with no city is refused');
select is(tests.sqlstate_of($$ select admin_save_job(null, jsonb_build_object('company_id', '00000000-0000-0000-0000-0000000000ff', 'source_id', 1, 'title', 'Orphan',
  'apply_url', 'https://acme-pay.test/careers/9'), array[1]::smallint[]) $$), '23503', 'a job for a company that does not exist is refused');
select is(tests.sqlstate_of($$ select admin_save_job(null, jsonb_build_object('company_id', (select id from saved), 'source_id', 1, 'title', 'Live now',
  'apply_url', 'https://acme-pay.test/careers/10', 'status', 'active'), array[1]::smallint[]) $$), '42501', 'an editor cannot make a job active');
reset role;
select is((select title from job where id = (select id from job_saved)), 'Staff Engineer', 'the edit was saved');
select is((select array_agg(city_id::int) from job_city where job_id = (select id from job_saved)), array[2], 'and the city list follows');

-- ---------------------------------------------------------------------------
-- Deleting a company
-- ---------------------------------------------------------------------------

select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
select is(tests.sqlstate_of($$ select admin_delete_company((select id from saved)) $$), '22023', 'an editor cannot delete a published company');
reset role;
select is((select count(*)::int from company where id = (select id from saved)), 1, 'and it is still there');

select tests.become('00000000-0000-0000-0000-00000000e003', 'authenticated');
select lives_ok($$ select admin_delete_company((select id from saved)) $$, 'an admin can');
reset role;
select is((select count(*)::int from company where domain = 'acme-pay.test') + (select count(*)::int from job where id = (select id from job_saved)), 0, 'and its jobs go with it');

select * from finish();
rollback;
