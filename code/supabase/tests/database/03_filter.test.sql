-- P3-03: the shared filter (company_filter), city_points, search_companies, company_facets.
-- Run with `npx supabase test db`. Semantics are written down in docs/filters.md.
begin;
create extension if not exists pgtap with schema extensions;

select plan(99);

-- ---------------------------------------------------------------------------
-- Helpers (rolled back with the transaction)
-- ---------------------------------------------------------------------------

create schema tests;
grant usage on schema tests to anon, authenticated;

-- Slugs of the companies a filter returns, sorted.
create function tests.slugs(p_city text, f jsonb default '{}') returns text[]
language sql stable as $$
  select coalesce(array_agg(c.slug order by c.slug), '{}')
  from public.company c
  where c.id in (select public.company_filter(p_city, f));
$$;

-- How many facet rows disagree with company_filter. A facet value's count must equal the size of
-- company_filter with that group replaced by the value (see docs/filters.md).
create function tests.facet_mismatches(p_city text, f jsonb) returns int
language plpgsql stable as $$
declare
  bad int := 0;
  r record;
  expected bigint;
begin
  for r in select * from public.company_facets(p_city, f) loop
    expected := case r.facet
      when 'total' then
        (select count(*) from public.company_filter(p_city, f))
      when 'type' then
        (select count(*) from public.company_filter(p_city,
          (f - 'types' - 'stages') || jsonb_build_object('types', jsonb_build_array(r.value))))
      when 'stage' then
        (select count(*) from public.company_filter(p_city,
          (f - 'types' - 'stages')
          || jsonb_build_object('types', jsonb_build_array('startup'), 'stages', jsonb_build_array(r.value))))
      when 'neighbourhood' then
        (select count(*) from public.company_filter(p_city,
          (f - 'neighbourhoods') || jsonb_build_object('neighbourhoods', jsonb_build_array(r.value))))
      when 'tech_park' then
        (select count(*) from public.company_filter(p_city,
          (f - 'tech_parks') || jsonb_build_object('tech_parks', jsonb_build_array(r.value))))
      when 'sector' then
        (select count(*) from public.company_filter(p_city,
          (f - 'sectors') || jsonb_build_object('sectors', jsonb_build_array(r.value))))
    end;
    if expected is distinct from r.company_count then
      bad := bad + 1;
    end if;
  end loop;
  return bad;
end;
$$;

-- How many companies differ between the filter, the points, and the list; plus a facet total
-- that differs from the filter.
create function tests.agreement_mismatches(p_city text, f jsonb) returns int
language sql stable as $$
  with filt as (select public.company_filter(p_city, f) as id),
       pts as (select distinct company_id as id from public.city_points(p_city, f)),
       lst as (select company_id as id from public.search_companies(p_city, f, 100000, 0))
  select
    (select count(*) from (select id from filt except select id from pts) x)::int
  + (select count(*) from (select id from pts except select id from filt) x)::int
  + (select count(*) from (select id from filt except select id from lst) x)::int
  + (select count(*) from (select id from lst except select id from filt) x)::int
  + abs((select company_count from public.company_facets(p_city, f) where facet = 'total')
        - (select count(*)::int from filt))
  + ((select count(*) from filt) - (select count(distinct id) from filt))::int;
$$;

create function tests.become(uid uuid, r text default 'authenticated') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when uid is null then '' else json_build_object('sub', uid, 'role', r)::text end, true);
  perform set_config('role', r, true);
end;
$$;
grant execute on all functions in schema tests to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures: synthetic, for these tests only.
--   city 1 'bangalore' live, city 2 'chennai' live, city 3 'draft-city' draft
-- ---------------------------------------------------------------------------

insert into city (id, slug, name, status, centre, default_zoom, boundary) values
  (1, 'bangalore', 'Bengaluru', 'live', 'SRID=4326;POINT(77.60 12.97)', 11,
   'SRID=4326;MULTIPOLYGON(((77.40 12.80, 77.80 12.80, 77.80 13.15, 77.40 13.15, 77.40 12.80)))'),
  (2, 'chennai', 'Chennai', 'live', 'SRID=4326;POINT(80.27 13.08)', 11,
   'SRID=4326;MULTIPOLYGON(((80.10 12.90, 80.35 12.90, 80.35 13.25, 80.10 13.25, 80.10 12.90)))'),
  (3, 'draft-city', 'Draft City', 'draft', 'SRID=4326;POINT(72.90 19.00)', 11,
   'SRID=4326;MULTIPOLYGON(((72.80 18.90, 73.00 18.90, 73.00 19.20, 72.80 19.20, 72.80 18.90)))');
insert into neighbourhood (id, city_id, slug, name) values
  (1, 1, 'indiranagar', 'Indiranagar'), (2, 1, 'koramangala', 'Koramangala'), (3, 2, 'adyar', 'Adyar');
insert into tech_park (id, city_id, slug, name) values
  (1, 1, 'etv', 'Embassy Tech Village'), (2, 2, 'dlf', 'DLF IT Park'), (3, 1, 'prestige', 'Prestige Tech Park');
insert into sector (id, slug, name) values (1, 'fintech', 'Fintech'), (2, 'saas', 'SaaS');
insert into source (id, name, kind, permission_note) values (1, 'synthetic test source', 'manual', 'test only');

insert into company (id, slug, name, domain, website_url, status, startup_stage) values
  ('00000000-0000-0000-0000-0000000000a1', 'alpha-labs',      'Alpha Labs',      'alpha.test',   'https://alpha.test',   'published', 'seed'),
  ('00000000-0000-0000-0000-0000000000a2', 'bravo-pay',       'Bravo Pay',       'bravo.test',   'https://bravo.test',   'published', 'series_a'),
  ('00000000-0000-0000-0000-0000000000a3', 'charlie-corp',    'Charlie Corp',    'charlie.test', 'https://charlie.test', 'published', null),
  ('00000000-0000-0000-0000-0000000000a4', 'delta-products',  'Delta Products',  'delta.test',   'https://delta.test',   'published', null),
  ('00000000-0000-0000-0000-0000000000a5', 'echo-seed',       'Echo Seed',       'echo.test',    'https://echo.test',    'published', 'pre_seed'),
  ('00000000-0000-0000-0000-0000000000a6', 'foxtrot-global',  'Foxtrot Global',  'foxtrot.test', 'https://foxtrot.test', 'published', null),
  ('00000000-0000-0000-0000-0000000000a7', 'golf-draft',      'Golf Draft',      'golf.test',    'https://golf.test',    'draft',     null),
  ('00000000-0000-0000-0000-0000000000a8', 'hotel-no-office', 'Hotel No Office', 'hotel.test',   'https://hotel.test',   'published', null),
  ('00000000-0000-0000-0000-0000000000a9', 'india-startup',   'India Startup',   'india.test',   'https://india.test',   'published', null),
  ('00000000-0000-0000-0000-0000000000aa', 'juliet-chennai',  'Juliet Chennai',  'juliet.test',  'https://juliet.test',  'published', 'seed'),
  ('00000000-0000-0000-0000-0000000000ab', 'kilo-multi',      'Kilo Multi',      'kilo.test',    'https://kilo.test',    'published', null),
  ('00000000-0000-0000-0000-0000000000ac', 'lima-draft-city', 'Lima Draft City', 'lima.test',    'https://lima.test',    'published', null);

insert into company_type_tag (company_id, type) values
  ('00000000-0000-0000-0000-0000000000a1', 'startup'), ('00000000-0000-0000-0000-0000000000a1', 'product'),
  ('00000000-0000-0000-0000-0000000000a2', 'startup'),
  ('00000000-0000-0000-0000-0000000000a3', 'mnc'),
  ('00000000-0000-0000-0000-0000000000a4', 'product'),
  ('00000000-0000-0000-0000-0000000000a5', 'startup'),
  ('00000000-0000-0000-0000-0000000000a6', 'mnc'), ('00000000-0000-0000-0000-0000000000a6', 'product'),
  ('00000000-0000-0000-0000-0000000000a7', 'mnc'),
  ('00000000-0000-0000-0000-0000000000a9', 'startup'),
  ('00000000-0000-0000-0000-0000000000aa', 'startup'),
  ('00000000-0000-0000-0000-0000000000ab', 'mnc');

insert into company_sector (company_id, sector_id) values
  ('00000000-0000-0000-0000-0000000000a1', 1),
  ('00000000-0000-0000-0000-0000000000a2', 1), ('00000000-0000-0000-0000-0000000000a2', 2);

insert into office (company_id, city_id, neighbourhood_id, tech_park_id, address, geom, accuracy, status) values
  ('00000000-0000-0000-0000-0000000000a1', 1, 1, null, '100 Feet Road',   'SRID=4326;POINT(77.640 12.970)', 'building', 'published'),
  ('00000000-0000-0000-0000-0000000000a1', 1, 1, null, 'Draft Annex',     'SRID=4326;POINT(77.641 12.971)', 'building', 'draft'),
  ('00000000-0000-0000-0000-0000000000a2', 1, 2, null, '80 Feet Road',    'SRID=4326;POINT(77.620 12.930)', 'building', 'published'),
  ('00000000-0000-0000-0000-0000000000a2', 1, null, 1, 'Outer Ring Road', 'SRID=4326;POINT(77.680 12.940)', 'campus',   'published'),
  ('00000000-0000-0000-0000-0000000000a3', 1, null, 1, 'Devarabisanahalli', 'SRID=4326;POINT(77.690 12.930)', 'campus', 'published'),
  ('00000000-0000-0000-0000-0000000000a4', 1, 2, null, 'Hosur Road',      'SRID=4326;POINT(77.630 12.920)', 'building', 'published'),
  ('00000000-0000-0000-0000-0000000000a4', 2, 3, null, 'Adyar Main Road', 'SRID=4326;POINT(80.250 13.000)', 'building', 'published'),
  ('00000000-0000-0000-0000-0000000000a5', 1, null, 3, 'MG Road',      'SRID=4326;POINT(77.600 12.975)', 'street',   'published'),
  ('00000000-0000-0000-0000-0000000000a6', 1, 1, null, 'Old Airport Road', 'SRID=4326;POINT(77.650 12.960)', 'building', 'published'),
  ('00000000-0000-0000-0000-0000000000a7', 1, 1, null, 'Golf Lane',       'SRID=4326;POINT(77.660 12.965)', 'building', 'published'),
  ('00000000-0000-0000-0000-0000000000a8', 1, 1, null, 'Hotel Street',    'SRID=4326;POINT(77.670 12.966)', 'building', 'draft'),
  ('00000000-0000-0000-0000-0000000000a9', 1, 2, null, 'Sarjapur Road',   'SRID=4326;POINT(77.660 12.910)', 'building', 'published'),
  ('00000000-0000-0000-0000-0000000000aa', 2, null, null, 'OMR',          'SRID=4326;POINT(80.230 12.950)', 'building', 'published'),
  ('00000000-0000-0000-0000-0000000000ab', 1, 1, null, 'CMH Block',       'SRID=4326;POINT(77.645 12.975)', 'building', 'published'),
  ('00000000-0000-0000-0000-0000000000ab', 1, 2, null, 'Madiwala',        'SRID=4326;POINT(77.625 12.915)', 'building', 'published'),
  ('00000000-0000-0000-0000-0000000000ac', 3, null, null, 'Fort',         'SRID=4326;POINT(72.900 19.000)', 'building', 'published');

insert into job (id, company_id, source_id, title, title_norm, apply_url, dedup_hash, status) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 1, 'Backend Engineer',  'backend engineer',  'https://alpha.test/1',   '\x01', 'active'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 1, 'Payments Engineer', 'payments engineer', 'https://bravo.test/1',   '\x02', 'active'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a2', 1, 'Risk Analyst',      'risk analyst',      'https://bravo.test/2',   '\x03', 'suspect'),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a2', 1, 'Old Role',          'old role',          'https://bravo.test/3',   '\x04', 'expired'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000a3', 1, 'DevOps Engineer',   'devops engineer',   'https://charlie.test/1', '\x05', 'active'),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000a4', 1, 'Chennai Analyst',   'chennai analyst',   'https://delta.test/1',   '\x06', 'active');
insert into job_city (job_id, city_id) values
  ('00000000-0000-0000-0000-0000000000d1', 1), ('00000000-0000-0000-0000-0000000000d2', 1),
  ('00000000-0000-0000-0000-0000000000d3', 1), ('00000000-0000-0000-0000-0000000000d4', 1),
  ('00000000-0000-0000-0000-0000000000d5', 1), ('00000000-0000-0000-0000-0000000000d6', 2);

insert into company_founder (company_id, full_name, source_url, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'Asha Rao', 'https://alpha.test/about', 'published'),
  ('00000000-0000-0000-0000-0000000000a3', 'Hidden Person', 'https://charlie.test/about', 'draft');

insert into auth.users (id) values ('00000000-0000-0000-0000-00000000e001');
insert into admin_user (user_id, role) values ('00000000-0000-0000-0000-00000000e001', 'editor');

-- ---------------------------------------------------------------------------
-- Base set
-- ---------------------------------------------------------------------------

select is(tests.slugs('bangalore'),
  array['alpha-labs', 'bravo-pay', 'charlie-corp', 'delta-products', 'echo-seed', 'foxtrot-global', 'india-startup', 'kilo-multi'],
  'no filter: every published company with a published office in the city; drafts, no-office, and other-city companies are out');
select is(tests.slugs('chennai'), array['delta-products', 'juliet-chennai'], 'a company with offices in two cities appears in both');
select is(tests.slugs('nowhere'), '{}'::text[], 'an unknown city returns no rows');
select is((select count(*)::int from public.company_filter('bangalore', null)), 8, 'null filters mean no filters');
select is((select count(*)::int from public.company_filter('bangalore', '{}')),
          (select count(distinct x)::int from public.company_filter('bangalore', '{}') x),
          'each company appears once, even with several offices (Bravo Pay, Kilo Multi)');

-- ---------------------------------------------------------------------------
-- Types and stages (ADR-0004)
-- ---------------------------------------------------------------------------

select is(tests.slugs('bangalore', '{"types":["startup"]}'),
  array['alpha-labs', 'bravo-pay', 'echo-seed', 'india-startup'], 'type Startup');
select is(tests.slugs('bangalore', '{"types":["startup","mnc"]}'),
  array['alpha-labs', 'bravo-pay', 'charlie-corp', 'echo-seed', 'foxtrot-global', 'india-startup', 'kilo-multi'],
  'types combine with OR');
select is(tests.slugs('bangalore', '{"types":["product"]}'),
  array['alpha-labs', 'delta-products', 'foxtrot-global'],
  'type Product includes companies that are also Startup or MNC');
select is(tests.slugs('bangalore', '{"types":["startup","product"]}'),
  array['alpha-labs', 'bravo-pay', 'delta-products', 'echo-seed', 'foxtrot-global', 'india-startup'],
  'a company tagged both Startup and Product (Alpha Labs) is returned once');
select is(tests.slugs('bangalore', '{"stages":["seed"]}'), tests.slugs('bangalore'),
  'stages with no type are ignored');
select is(tests.slugs('bangalore', '{"types":["startup"],"stages":["seed"]}'), array['alpha-labs'], 'Startup + Seed');
select is(tests.slugs('bangalore', '{"types":["startup"],"stages":["seed","pre_seed"]}'),
  array['alpha-labs', 'echo-seed'], 'stages combine with OR');
select is(tests.slugs('bangalore', '{"types":["startup"],"stages":["acquired"]}'), '{}'::text[], 'a stage nobody has');
select is(tests.slugs('bangalore', '{"types":["mnc","startup"],"stages":["seed"]}'),
  array['alpha-labs', 'charlie-corp', 'foxtrot-global', 'kilo-multi'],
  'MNC + Startup + Seed: every MNC company OR the startups at Seed');
select is(tests.slugs('bangalore', '{"types":["mnc"],"stages":["seed"]}'),
  array['charlie-corp', 'foxtrot-global', 'kilo-multi'], 'stages are ignored without Startup in the types');
select is(tests.slugs('bangalore', '{"types":["startup","product"],"stages":["seed"]}'),
  array['alpha-labs', 'delta-products', 'foxtrot-global'],
  'Startup + Product + Seed: Product companies OR startups at Seed');
select is(tests.slugs('bangalore', '{"types":["startup"],"stages":["series_a"]}'), array['bravo-pay'],
  'a startup with no recorded stage (India Startup) matches no stage');

-- ---------------------------------------------------------------------------
-- Location and sector groups; AND across groups
-- ---------------------------------------------------------------------------

select is(tests.slugs('bangalore', '{"neighbourhoods":["indiranagar"]}'), array['alpha-labs', 'foxtrot-global', 'kilo-multi'], 'neighbourhood');
select is(tests.slugs('bangalore', '{"neighbourhoods":["koramangala"]}'),
  array['bravo-pay', 'delta-products', 'india-startup', 'kilo-multi'], 'another neighbourhood');
select is(tests.slugs('bangalore', '{"neighbourhoods":["indiranagar","koramangala"]}'),
  array['alpha-labs', 'bravo-pay', 'delta-products', 'foxtrot-global', 'india-startup', 'kilo-multi'], 'neighbourhoods combine with OR');
select is(tests.slugs('bangalore', '{"tech_parks":["etv"]}'), array['bravo-pay', 'charlie-corp'], 'tech park');
select is(tests.slugs('bangalore', '{"types":["startup"],"tech_parks":["etv"]}'), array['bravo-pay'], 'type AND tech park');
select is(tests.slugs('bangalore', '{"tech_parks":["prestige"]}'), array['echo-seed'], 'a second tech park selects only its own companies');
select is(tests.slugs('bangalore', '{"tech_parks":["etv","prestige"]}'), array['bravo-pay', 'charlie-corp', 'echo-seed'], 'tech parks combine with OR');
select is(tests.slugs('bangalore', '{"sectors":["fintech"]}'), array['alpha-labs', 'bravo-pay'], 'sector');
select is(tests.slugs('bangalore', '{"sectors":["fintech","saas"]}'), array['alpha-labs', 'bravo-pay'], 'sectors combine with OR');
select is(tests.slugs('bangalore', '{"neighbourhoods":["indiranagar"],"sectors":["fintech"]}'), array['alpha-labs'], 'neighbourhood AND sector');
select is(tests.slugs('chennai', '{"neighbourhoods":["indiranagar"]}'), '{}'::text[], 'a neighbourhood of another city matches nothing');
select is(tests.slugs('bangalore', '{"types":["MNC "]}'), array['charlie-corp', 'foxtrot-global', 'kilo-multi'],
  'values are trimmed and lower-cased');

-- ---------------------------------------------------------------------------
-- Search: company name, job title, location, founder
-- ---------------------------------------------------------------------------

select is(tests.slugs('bangalore', '{"q":"alpha"}'), array['alpha-labs'], 'search: company name');
select is(tests.slugs('bangalore', '{"q":"ALPHA"}'), array['alpha-labs'], 'search is case-insensitive');
select is(tests.slugs('bangalore', '{"q":"lab"}'), array['alpha-labs'], 'search matches a substring');
select is(tests.slugs('bangalore', '{"q":"backend"}'), array['alpha-labs'], 'search: job title');
select is(tests.slugs('bangalore', '{"q":"devops"}'), array['charlie-corp'], 'search: another job title');
select is(tests.slugs('bangalore', '{"q":"risk"}'), '{}'::text[], 'a suspect job does not match search (active jobs only)');
select is(tests.slugs('bangalore', '{"q":"old role"}'), '{}'::text[], 'an expired job does not match search');
select is(tests.slugs('bangalore', '{"q":"analyst"}'), '{}'::text[], 'a job listed only in another city does not match here');
select is(tests.slugs('chennai', '{"q":"analyst"}'), array['delta-products'], 'a job matches in the city it is listed in');
select is(tests.slugs('bangalore', '{"q":"indiranagar"}'), array['alpha-labs', 'foxtrot-global', 'kilo-multi'], 'search: neighbourhood name');
select is(tests.slugs('bangalore', '{"q":"embassy"}'), array['bravo-pay', 'charlie-corp'], 'search: tech park name');
select is(tests.slugs('bangalore', '{"q":"mg road"}'), array['echo-seed'], 'search: office address, and every word must match');
select is(tests.slugs('bangalore', '{"q":"asha"}'), array['alpha-labs'], 'search: founder name');
select is(tests.slugs('bangalore', '{"q":"hidden"}'), '{}'::text[], 'a draft founder is not searchable');
select is(tests.slugs('bangalore', '{"q":"bravo engineer"}'), array['bravo-pay'], 'words may match different fields of one company');
select is(tests.slugs('bangalore', '{"q":"alpha engineer"}'), array['alpha-labs'], 'name word + job-title word');
select is(tests.slugs('bangalore', '{"q":"alpha payments"}'), '{}'::text[], 'every word must match the same company');
select is(tests.slugs('bangalore', '{"q":"  Backend   Engineer "}'), array['alpha-labs'], 'extra spaces are ignored');
select is(tests.slugs('bangalore', '{"q":"   "}'), tests.slugs('bangalore'), 'a blank search does not constrain');
select is(tests.slugs('bangalore', '{"q":"%"}'), '{}'::text[], 'a percent sign is literal text, not a wildcard');
select is(tests.slugs('bangalore', '{"q":"_"}'), '{}'::text[], 'an underscore is literal text, not a wildcard');
select is(tests.slugs('bangalore', '{"q":"engineer","types":["startup"]}'), array['alpha-labs', 'bravo-pay'], 'search AND type');
select is(tests.slugs('bangalore', '{"q":"lima"}'), '{}'::text[], 'a company in another city is not found by name');

-- ---------------------------------------------------------------------------
-- Bad input
-- ---------------------------------------------------------------------------

select throws_ok($$ select * from public.company_filter('bangalore', '{"foo":1}') $$, '22023', null, 'an unknown filter key is an error');
select throws_ok($$ select * from public.company_filter('bangalore', '{"types":["bogus"]}') $$, '22023', null, 'an unknown type is an error');
select throws_ok($$ select * from public.company_filter('bangalore', '{"stages":["bogus"]}') $$, '22023', null, 'an unknown stage is an error');
select throws_ok($$ select * from public.company_filter('bangalore', '{"types":"startup"}') $$, '22023', null, 'types must be an array');
select throws_ok($$ select * from public.company_filter('bangalore', '{"types":[1]}') $$, '22023', null, 'types must hold strings');
select throws_ok($$ select * from public.company_filter('bangalore', '{"q":5}') $$, '22023', null, 'q must be a string');
select throws_ok($$ select * from public.company_filter('bangalore', '[]') $$, '22023', null, 'filters must be an object');
select throws_ok($$ select * from public.company_facets('bangalore', '{"foo":1}') $$, '22023', null, 'facets reject an unknown key too');
select throws_ok($$ select * from public.city_points('bangalore', '{"foo":1}') $$, '22023', null, 'points reject an unknown key too');
select throws_ok($$ select * from public.search_companies('bangalore', '{"foo":1}') $$, '22023', null, 'the list rejects an unknown key too');

-- ---------------------------------------------------------------------------
-- city_points
-- ---------------------------------------------------------------------------

select is((select count(*)::int from public.city_points('bangalore')), 10,
  'points: every published office of every matching company (draft office, draft company, other cities excluded)');
select is((select count(*)::int from public.city_points('chennai')), 2, 'points: Chennai');
select is((select count(*)::int from public.city_points('bangalore', '{"types":["startup"]}')), 5, 'points follow the filter (Bravo Pay has two offices)');
select is((select count(*)::int from public.city_points('bangalore', '{"neighbourhoods":["indiranagar"]}')), 4,
  'a location filter selects companies; a matching company keeps all its offices in the city (Kilo Multi: 2)');
select is((select round(lng::numeric, 3) || ',' || round(lat::numeric, 3) from public.city_points('bangalore', '{"q":"alpha"}')),
  '77.640,12.970', 'a point carries its longitude and latitude');
select is((select accuracy from public.city_points('bangalore', '{"q":"alpha"}')), 'building', 'a point carries its accuracy');
select is((select count(*)::int from public.city_points('nowhere')), 0, 'points: unknown city');

-- ---------------------------------------------------------------------------
-- search_companies
-- ---------------------------------------------------------------------------

select is(array(select slug from public.search_companies('bangalore')),
  array['alpha-labs', 'bravo-pay', 'charlie-corp', 'delta-products', 'echo-seed', 'foxtrot-global', 'india-startup', 'kilo-multi'],
  'the list is in name order');
select is(array(select slug from public.search_companies('bangalore', '{}', 3, 2)),
  array['charlie-corp', 'delta-products', 'echo-seed'], 'the list pages with limit and offset');
select is((select count(*)::int from public.search_companies('bangalore', '{}', 0, 0)), 0, 'a limit of 0 returns nothing');
select is((select count(*)::int from public.search_companies('bangalore', '{}', -5, -5)), 0, 'a negative limit returns nothing');
select is((select office_count || '/' || open_job_count from public.search_companies('bangalore', '{"q":"bravo"}')), '2/1',
  'office_count counts offices in the city; open_job_count counts active jobs only (the suspect and expired ones are not counted)');
select is((select open_job_count from public.search_companies('bangalore', '{"q":"delta"}')), 0, 'a job in another city is not counted');
select is((select open_job_count from public.search_companies('chennai', '{"q":"delta"}')), 1, 'a job is counted in its own city');
select is((select office_count from public.search_companies('chennai', '{"q":"delta"}')), 1, 'office_count is per city');
select is((select types from public.search_companies('bangalore', '{"q":"alpha"}')), array['startup', 'product'], 'types are listed in enum order');
select is((select startup_stage from public.search_companies('bangalore', '{"q":"alpha"}')), 'seed', 'the stage is listed');
select is((select startup_stage from public.search_companies('bangalore', '{"q":"india"}')), null, 'an unknown stage stays null');

-- ---------------------------------------------------------------------------
-- company_facets
-- ---------------------------------------------------------------------------

select is((select count(*)::int from public.company_facets('bangalore')), 19,
  'facets: total, 3 types, 9 stages, 2 neighbourhoods, 2 tech parks, 2 sectors, every value listed');
select is(
  (select jsonb_object_agg(facet || ':' || value, company_count) from public.company_facets('bangalore')),
  jsonb_build_object(
    'total:', 8,
    'type:startup', 4, 'type:mnc', 3, 'type:product', 3,
    'stage:pre_seed', 1, 'stage:seed', 1, 'stage:bootstrapped', 0, 'stage:series_a', 1, 'stage:series_b', 0,
    'stage:series_c', 0, 'stage:series_c_plus', 0, 'stage:public', 0, 'stage:acquired', 0,
    'neighbourhood:indiranagar', 3, 'neighbourhood:koramangala', 4,
    'tech_park:etv', 2, 'tech_park:prestige', 1,
    'sector:fintech', 2, 'sector:saas', 1),
  'facet counts with no filter');
select is((select company_count from public.company_facets('bangalore', '{"types":["startup"]}') where facet = 'type' and value = 'mnc'), 3,
  'selecting Startup does not zero the MNC count (a group''s own selection is replaced, so MNC can be added)');
select is((select company_count from public.company_facets('bangalore', '{"types":["startup"]}') where facet = 'total'), 4,
  'the total follows the filter');
select is((select company_count from public.company_facets('bangalore', '{"types":["startup"],"stages":["seed"]}') where facet = 'stage' and value = 'series_a'), 1,
  'a stage''s count ignores the other selected stages');
select is((select company_count from public.company_facets('bangalore', '{"types":["startup"],"stages":["seed"]}') where facet = 'type' and value = 'startup'), 4,
  'the Startup count ignores the stage selection (stages have their own counts)');
select is((select company_count from public.company_facets('bangalore', '{"neighbourhoods":["indiranagar"]}') where facet = 'tech_park' and value = 'etv'), 0,
  'other groups still constrain a facet');
select is((select count(*)::int from public.company_facets('nowhere')), 0, 'facets: unknown city');

-- ---------------------------------------------------------------------------
-- Agreement across a filter matrix: points, list, and facets all follow company_filter
-- ---------------------------------------------------------------------------

create temp table matrix (f jsonb);
insert into matrix values
  ('{}'),
  ('{"types":["startup"]}'),
  ('{"types":["mnc"]}'),
  ('{"types":["product"]}'),
  ('{"types":["startup","mnc"]}'),
  ('{"types":["startup","product"]}'),
  ('{"types":["startup"],"stages":["seed"]}'),
  ('{"types":["startup"],"stages":["seed","pre_seed","series_a"]}'),
  ('{"types":["mnc","startup"],"stages":["seed"]}'),
  ('{"types":["mnc"],"stages":["seed"]}'),
  ('{"stages":["seed"]}'),
  ('{"neighbourhoods":["indiranagar"]}'),
  ('{"neighbourhoods":["indiranagar","koramangala"],"types":["startup"]}'),
  ('{"tech_parks":["etv"]}'),
  ('{"tech_parks":["etv"],"types":["mnc","startup"]}'),
  ('{"sectors":["fintech"]}'),
  ('{"sectors":["fintech","saas"],"types":["startup"],"stages":["series_a"]}'),
  ('{"q":"engineer"}'),
  ('{"q":"engineer","types":["startup"]}'),
  ('{"q":"road","neighbourhoods":["koramangala"]}'),
  ('{"q":"asha"}'),
  ('{"q":"zzz"}'),
  ('{"types":["startup"],"stages":["acquired"]}');

select is((select count(*)::int from matrix), 23, 'the filter matrix has 23 filters');
select is(
  (select coalesce(sum(tests.agreement_mismatches(c, m.f)), 0)::int
   from matrix m cross join unnest(array['bangalore', 'chennai']) c),
  0, 'points, list, and facet total return the same unique companies as company_filter, over the matrix and both cities');
select is(
  (select coalesce(sum(tests.facet_mismatches(c, m.f)), 0)::int
   from matrix m cross join unnest(array['bangalore', 'chennai']) c),
  0, 'every facet count equals the company_filter result for that value, over the matrix and both cities');
select ok(
  (select count(distinct tests.slugs('bangalore', m.f)) from matrix m) >= 15,
  'the matrix produces at least 15 different result sets (it is not vacuous)');

-- ---------------------------------------------------------------------------
-- Who is calling
-- ---------------------------------------------------------------------------

select tests.become(null, 'anon');
select is((select count(*)::int from public.company_filter('bangalore')), 8, 'anon gets the full public result');
select is((select count(*)::int from public.city_points('bangalore')), 10, 'anon can call city_points');
select is((select count(*)::int from public.search_companies('bangalore')), 8, 'anon can call search_companies');
select is((select company_count from public.company_facets('bangalore') where facet = 'total'), 8, 'anon can call company_facets');
select is((select count(*)::int from public.company_filter('draft-city')), 0, 'a draft city is hidden from anon, so it returns nothing');
reset role;
select is(tests.slugs('draft-city'), array['lima-draft-city'], 'the owner (RLS bypassed) can see the draft city, which proves the anon result above is RLS');

select tests.become('00000000-0000-0000-0000-00000000e001');
select is((select count(*)::int from public.company_filter('bangalore')), 8,
  'a signed-in editor, who can read drafts, still gets the public result (published states are named in the function)');
reset role;

select * from finish();
rollback;
