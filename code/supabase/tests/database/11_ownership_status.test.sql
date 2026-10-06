-- P9-06 (ADR-0017): ownership status is its own field and filter group, separate from the startup stage.
-- Run with `npx supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

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
create function tests.slugs(city text, f jsonb) returns text[]
language sql stable as $$
  select coalesce(array_agg(c.slug order by c.slug), '{}') from public.company_filter(city, f) x join public.company c on c.id = x;
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

set local app.skip_audit = 'on';
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000e001');
insert into admin_user (user_id, role) values ('00000000-0000-0000-0000-00000000e001', 'editor');
insert into city (id, slug, name, status, centre, default_zoom, boundary) values
  (1, 'bangalore', 'Bengaluru', 'beta', 'SRID=4326;POINT(77.60 12.97)', 11,
   'SRID=4326;MULTIPOLYGON(((77.40 12.80, 77.80 12.80, 77.80 13.15, 77.40 13.15, 77.40 12.80)))');
insert into source (id, name, kind, permission_note) values (1, 'Fixture', 'manual', 'Test fixture');

-- Five published companies: an acquired startup, a public MNC, a private product company, a seed startup with an
-- unknown status, and an MNC with an unknown status.
insert into company (id, slug, name, domain, website_url, startup_stage, ownership_status, status) values
  ('00000000-0000-4000-8000-000000000001', 'acq-start', 'Acq Start', 'acq.example', 'https://acq.example', null, 'acquired', 'published'),
  ('00000000-0000-4000-8000-000000000002', 'pub-mnc', 'Pub MNC', 'pub.example', 'https://pub.example', null, 'public', 'published'),
  ('00000000-0000-4000-8000-000000000003', 'priv-prod', 'Priv Prod', 'priv.example', 'https://priv.example', null, 'private', 'published'),
  ('00000000-0000-4000-8000-000000000004', 'seed-start', 'Seed Start', 'seed.example', 'https://seed.example', 'seed', null, 'published'),
  ('00000000-0000-4000-8000-000000000005', 'unk-mnc', 'Unk MNC', 'unk.example', 'https://unk.example', null, null, 'published');
insert into company_type_tag (company_id, type) values
  ('00000000-0000-4000-8000-000000000001', 'startup'),
  ('00000000-0000-4000-8000-000000000002', 'mnc'),
  ('00000000-0000-4000-8000-000000000003', 'product'),
  ('00000000-0000-4000-8000-000000000004', 'startup'),
  ('00000000-0000-4000-8000-000000000005', 'mnc');
insert into office (company_id, city_id, address, geom, accuracy, verification, status)
select id, 1, 'Somewhere road', 'SRID=4326;POINT(77.6 12.97)', 'building', 'reviewed', 'published' from company;
set local app.skip_audit = 'off';
set constraints all immediate;
set constraints all deferred;

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

select has_column('public', 'company', 'ownership_status', 'company.ownership_status exists');
select is(enum_range(null::public.ownership_status)::text[], array['private', 'public', 'acquired'], 'ownership_status values');
select ok(not ('public' = any (enum_range(null::public.startup_stage)::text[]) or 'acquired' = any (enum_range(null::public.startup_stage)::text[])),
  'Public and Acquired are no longer startup stages');

-- ---------------------------------------------------------------------------
-- The filter
-- ---------------------------------------------------------------------------

select is(tests.slugs('bangalore', '{"statuses":["acquired"]}'), array['acq-start'], 'one status');
select is(tests.slugs('bangalore', '{"statuses":["public","private"]}'), array['priv-prod', 'pub-mnc'], 'OR within the group');
select is(tests.slugs('bangalore', '{"statuses":["public"],"types":["mnc"]}'), array['pub-mnc'], 'AND with the type group');
select is(tests.slugs('bangalore', '{"statuses":["acquired"],"types":["mnc"]}'), '{}'::text[], 'AND can empty the result');
select is(tests.slugs('bangalore', '{"statuses":["acquired","public"],"types":["startup"],"stages":["seed"]}'), '{}'::text[],
  'a stage and a status both apply: the seed startup has no known status, the acquired startup has no stage');
select is(tests.slugs('bangalore', '{"statuses":["public"]}'), array['pub-mnc'], 'a status does not need the Startup type');
select is(array_length(tests.slugs('bangalore', '{}'), 1), 5, 'an empty group does not constrain (unknown statuses included)');
select is(tests.sqlstate_of($$select public.company_filter('bangalore', '{"statuses":["listed"]}')$$), '22023', 'an unknown status is an error');
select is(tests.sqlstate_of($$select public.company_filter('bangalore', '{"stages":["acquired"]}')$$), '22023', 'acquired is not a stage any more');
select is(
  (select jsonb_object_agg(value, company_count) from public.company_facets('bangalore', '{"types":["mnc"]}') where facet = 'status'),
  '{"private": 0, "public": 1, "acquired": 0}'::jsonb, 'status facet counts follow the other groups');
select is((select ownership_status from public.search_companies('bangalore', '{"statuses":["private"]}')), 'private', 'the list carries the status');
select is(
  (select c ->> 'ownership_status' from jsonb_array_elements(public.city_build_snapshot('bangalore') -> 'companies') c where c ->> 'slug' = 'acq-start'),
  'acquired', 'the build snapshot carries the status');

-- ---------------------------------------------------------------------------
-- Admin save and import
-- ---------------------------------------------------------------------------

select tests.become('00000000-0000-0000-0000-00000000e001');
select lives_ok($$select public.admin_save_company(null,
  '{"name":"Saved Co","slug":"saved-co","domain":"saved.example","website_url":"https://saved.example","ownership_status":"public"}',
  array['mnc'], array[]::text[])$$, 'an editor saves a company with a status');
select is((select ownership_status::text from company where slug = 'saved-co'), 'public', 'the status is stored');
select is(tests.sqlstate_of($$select public.admin_save_company(null,
  '{"name":"Bad Co","slug":"bad-co","domain":"bad.example","website_url":"https://bad.example","ownership_status":"listed"}',
  array['mnc'], array[]::text[])$$), '22P02', 'an unknown status is refused');

select is((public.import_commit('t.csv', '[
  {"name":"Old File Co","domain":"oldfile.example","types":["startup"],"startup_stage":"Acquired","city":"bangalore","address":"1 Road","lat":12.97,"lng":77.6},
  {"name":"New File Co","domain":"newfile.example","types":["mnc"],"ownership_status":"public","city":"bangalore","address":"2 Road","lat":12.97,"lng":77.6},
  {"name":"Clash Co","domain":"clash.example","types":["startup"],"startup_stage":"public","ownership_status":"private","city":"bangalore","address":"3 Road","lat":12.97,"lng":77.6}
]'::jsonb) ->> 'created_companies')::int, 2, 'the import creates the two consistent rows and rejects the clash');
select is((select ownership_status::text || '/' || coalesce(startup_stage::text, 'none') from company where slug = 'old-file-co'), 'acquired/none',
  'a stage of Acquired in an old file becomes the ownership status');
select is((select ownership_status::text from company where slug = 'new-file-co'), 'public', 'the ownership_status column imports');
select is((select status from company where slug = 'new-file-co'), 'draft', 'imported companies wait for review');

select * from finish();
rollback;
