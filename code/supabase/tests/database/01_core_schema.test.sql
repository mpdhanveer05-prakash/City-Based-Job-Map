-- P3-01: core schema. Run with `npx supabase test db`.
-- The tests run as the database owner, so RLS does not apply here; P3-02 tests the policies.
begin;
create extension if not exists pgtap with schema extensions;

select plan(56);

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------

select has_table('public', t, format('table %s exists', t))
from unnest(array[
  'city', 'neighbourhood', 'tech_park', 'source', 'sector', 'company', 'company_type_tag',
  'company_sector', 'company_founder', 'office', 'job', 'job_city'
]) as t;

select hasnt_column('public', 'company', 'company_type', 'the single company_type column is gone (D-02)');
select hasnt_column('public', 'company', 'funding_stage', 'funding_stage is replaced by startup_stage (D-05)');
select has_column('public', 'company', 'startup_stage', 'company.startup_stage exists');
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
   from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'company_type' and t.typnamespace = 'public'::regnamespace),
  array['startup', 'mnc', 'product'],
  'company_type holds the launch set'
);
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
   from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'startup_stage' and t.typnamespace = 'public'::regnamespace),
  array['pre_seed', 'seed', 'bootstrapped', 'series_a', 'series_b',
        'series_c', 'series_c_plus', 'public', 'acquired'],
  'startup_stage holds the nine stages in the brief'
);

-- RLS is on for every table in public, including ones later tasks add.
select is(
  (select count(*)::int from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0,
  'row-level security is enabled on every table in public'
);

-- ---------------------------------------------------------------------------
-- Fixtures: two cities (squares), one neighbourhood each, one source.
-- ---------------------------------------------------------------------------

insert into city (id, slug, name, centre, default_zoom, boundary) values
  (1, 'bangalore', 'Bengaluru',
   'SRID=4326;POINT(77.60 12.97)', 11,
   'SRID=4326;MULTIPOLYGON(((77.40 12.80, 77.80 12.80, 77.80 13.15, 77.40 13.15, 77.40 12.80)))'),
  (2, 'chennai', 'Chennai',
   'SRID=4326;POINT(80.27 13.08)', 11,
   'SRID=4326;MULTIPOLYGON(((80.10 12.90, 80.35 12.90, 80.35 13.25, 80.10 13.25, 80.10 12.90)))');
insert into neighbourhood (id, city_id, slug, name) values (1, 1, 'indiranagar', 'Indiranagar'), (2, 2, 'adyar', 'Adyar');
insert into tech_park (id, city_id, slug, name) values (1, 1, 'embassy-tech-village', 'Embassy Tech Village');
insert into source (id, name, kind, permission_note) values (1, 'synthetic test source', 'manual', 'test only');

insert into company (id, slug, name, domain, website_url, description) values
  ('00000000-0000-0000-0000-0000000000a1', 'acme-test', 'Acme Test', 'acme.test', 'https://acme.test', 'Builds rockets'),
  ('00000000-0000-0000-0000-0000000000a2', 'globex-test', 'Globex Test', 'globex.test', 'https://globex.test', null);

-- ---------------------------------------------------------------------------
-- Column rules
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into company (slug, name, domain, website_url) values ('x', 'X', 'x.test', 'http://x.test') $$,
  '23514', null, 'a company website must be https'
);
select throws_ok(
  $$ insert into company (slug, name, domain, website_url) values ('x', 'X', 'X.TEST', 'https://x.test') $$,
  '23514', null, 'a company domain must be lower case'
);
select throws_ok(
  $$ insert into company (slug, name, domain, website_url) values ('Not A Slug', 'X', 'x.test', 'https://x.test') $$,
  '23514', null, 'a company slug must be kebab-case'
);
select throws_ok(
  $$ insert into company (slug, name, domain, website_url) values ('x', 'X', 'acme.test', 'https://x.test') $$,
  '23505', null, 'the domain is the duplicate key'
);
select throws_ok(
  $$ insert into company (slug, name, domain, website_url, status) values ('x', 'X', 'x.test', 'https://x.test', 'merged') $$,
  '23514', null, 'a merged company must point at the survivor'
);
select throws_ok(
  $$ insert into job (company_id, source_id, title, title_norm, apply_url, dedup_hash)
     values ('00000000-0000-0000-0000-0000000000a1', 1, 'Dev', 'dev', 'http://acme.test/j/1', '\x01') $$,
  '23514', null, 'a job apply URL must be https'
);
select throws_ok(
  $$ insert into job (company_id, source_id, title, title_norm, apply_url, dedup_hash, exp_min_years, exp_max_years)
     values ('00000000-0000-0000-0000-0000000000a1', 1, 'Dev', 'dev', 'https://acme.test/j/1', '\x01', 5, 3) $$,
  '23514', null, 'minimum experience cannot exceed maximum'
);
select lives_ok(
  $$ insert into job (company_id, source_id, title, title_norm, apply_url, dedup_hash, exp_min_years, exp_max_years)
     values ('00000000-0000-0000-0000-0000000000a1', 1, 'Dev', 'dev', 'https://acme.test/j/1', '\x01', null, 3) $$,
  'an unspecified minimum experience is allowed (NULL = unspecified)'
);
select throws_ok(
  $$ insert into job (company_id, source_id, title, title_norm, apply_url, dedup_hash)
     values ('00000000-0000-0000-0000-0000000000a1', 1, 'Dev again', 'dev', 'https://acme.test/j/1b', '\x01') $$,
  '23505', null, 'the same job (company + dedup hash) cannot be stored twice'
);

-- ---------------------------------------------------------------------------
-- City-boundary trigger
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into office (company_id, city_id, address, geom, accuracy, status)
     values ('00000000-0000-0000-0000-0000000000a1', 1, 'MG Road', 'SRID=4326;POINT(77.60 12.97)', 'building', 'published') $$,
  'a published office inside the city boundary is accepted'
);
select throws_ok(
  $$ insert into office (company_id, city_id, address, geom, accuracy, status)
     values ('00000000-0000-0000-0000-0000000000a1', 1, 'Chennai address', 'SRID=4326;POINT(80.27 13.08)', 'building', 'published') $$,
  '23514', null, 'a published office outside the city boundary is rejected'
);
select lives_ok(
  $$ insert into office (company_id, city_id, address, geom, accuracy, status, outside_reviewed)
     values ('00000000-0000-0000-0000-0000000000a1', 1, 'Reviewed outlier', 'SRID=4326;POINT(80.27 13.08)', 'building', 'published', true) $$,
  'an outside office is accepted once an admin has reviewed it'
);
select lives_ok(
  $$ insert into office (company_id, city_id, address, geom, accuracy, status)
     values ('00000000-0000-0000-0000-0000000000a1', 1, 'Draft outlier', 'SRID=4326;POINT(80.27 13.08)', 'building', 'draft') $$,
  'a draft office outside the boundary is allowed; the rule applies at publish'
);
select throws_ok(
  $$ update office set status = 'published' where address = 'Draft outlier' $$,
  '23514', null, 'publishing an outside draft office is rejected'
);
select throws_ok(
  $$ update office set geom = 'SRID=4326;POINT(80.27 13.08)' where address = 'MG Road' $$,
  '23514', null, 'moving a published office outside the boundary is rejected'
);
select lives_ok(
  $$ update office set status = 'unpublished' where address = 'Draft outlier' $$,
  'an unpublished outside office stays allowed'
);
select throws_ok(
  $$ insert into office (company_id, city_id, neighbourhood_id, address, geom, accuracy)
     values ('00000000-0000-0000-0000-0000000000a1', 1, 2, 'Wrong area', 'SRID=4326;POINT(77.60 12.97)', 'building') $$,
  '23514', null, 'an office cannot use a neighbourhood from another city'
);
select throws_ok(
  $$ insert into office (company_id, city_id, tech_park_id, address, geom, accuracy)
     values ('00000000-0000-0000-0000-0000000000a1', 2, 1, 'Wrong park', 'SRID=4326;POINT(80.27 13.08)', 'building') $$,
  '23514', null, 'an office cannot use a tech park from another city'
);
select lives_ok(
  $$ insert into office (company_id, city_id, neighbourhood_id, tech_park_id, address, geom, accuracy)
     values ('00000000-0000-0000-0000-0000000000a1', 1, 1, 1, 'In a park', 'SRID=4326;POINT(77.65 12.95)', 'campus') $$,
  'an office in its own city''s neighbourhood and tech park is accepted'
);

-- ---------------------------------------------------------------------------
-- Overlapping types and the startup stage (ADR-0004)
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into company_type_tag (company_id, type) values
       ('00000000-0000-0000-0000-0000000000a1', 'startup'),
       ('00000000-0000-0000-0000-0000000000a1', 'product') $$,
  'one company can be both a Startup and a Product company'
);
select throws_ok(
  $$ insert into company_type_tag (company_id, type) values ('00000000-0000-0000-0000-0000000000a1', 'startup') $$,
  '23505', null, 'the same tag cannot be added twice'
);
select is(
  (select count(*)::int from company_type_tag where company_id = '00000000-0000-0000-0000-0000000000a1'),
  2,
  'the company carries both tags'
);

-- The stage check is deferred, so tags and stage can be written in either order.
select lives_ok(
  $$ update company set startup_stage = 'seed' where id = '00000000-0000-0000-0000-0000000000a1';
     set constraints all immediate;
     set constraints all deferred $$,
  'a startup-tagged company can have a stage'
);
select throws_ok(
  $$ update company set startup_stage = 'series_a' where id = '00000000-0000-0000-0000-0000000000a2';
     set constraints all immediate $$,
  '23514', null, 'a company without the startup tag cannot have a stage'
);
select throws_ok(
  $$ delete from company_type_tag
     where company_id = '00000000-0000-0000-0000-0000000000a1' and type = 'startup';
     set constraints all immediate $$,
  '23514', null, 'removing the startup tag from a company that has a stage is rejected'
);
select lives_ok(
  $$ update company set startup_stage = null where id = '00000000-0000-0000-0000-0000000000a1';
     delete from company_type_tag
     where company_id = '00000000-0000-0000-0000-0000000000a1' and type = 'startup';
     set constraints all immediate;
     set constraints all deferred $$,
  'clearing the stage first lets the startup tag go'
);
select lives_ok(
  $$ insert into company (slug, name, domain, website_url, startup_stage)
       values ('order-test', 'Order Test', 'order.test', 'https://order.test', 'pre_seed');
     insert into company_type_tag (company_id, type)
       select id, 'startup' from company where slug = 'order-test';
     set constraints all immediate;
     set constraints all deferred $$,
  'a company can be inserted with its stage before its tag in the same transaction'
);

-- ---------------------------------------------------------------------------
-- Search document
-- ---------------------------------------------------------------------------

select ok(
  (select search_doc @@ to_tsquery('simple', 'acme') from company where slug = 'acme-test'),
  'the search document contains the company name'
);
select ok(
  (select search_doc @@ to_tsquery('simple', 'rockets') from company where slug = 'acme-test'),
  'the search document contains the description'
);
insert into company_founder (id, company_id, full_name, source_url)
  values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'Priya Raman', 'https://acme.test/about');
select ok(
  not (select search_doc @@ to_tsquery('simple', 'raman') from company where slug = 'acme-test'),
  'a draft founder is not searchable'
);
update company_founder set status = 'published' where id = '00000000-0000-0000-0000-0000000000f1';
select ok(
  (select search_doc @@ to_tsquery('simple', 'raman') from company where slug = 'acme-test'),
  'publishing a founder makes the name searchable'
);
update company set description = 'Builds boats' where slug = 'acme-test';
select ok(
  (select search_doc @@ to_tsquery('simple', 'raman') and search_doc @@ to_tsquery('simple', 'boats')
   from company where slug = 'acme-test'),
  'editing the description keeps the founder name and picks up the new text'
);
update company_founder set status = 'draft' where id = '00000000-0000-0000-0000-0000000000f1';
select ok(
  not (select search_doc @@ to_tsquery('simple', 'raman') from company where slug = 'acme-test'),
  'unpublishing a founder removes the name from search'
);
update company_founder set status = 'published' where id = '00000000-0000-0000-0000-0000000000f1';
delete from company_founder where id = '00000000-0000-0000-0000-0000000000f1';
select ok(
  not (select search_doc @@ to_tsquery('simple', 'raman') from company where slug = 'acme-test'),
  'deleting a founder removes the name from search'
);
select throws_ok(
  $$ insert into company_founder (company_id, full_name, source_url)
     values ('00000000-0000-0000-0000-0000000000a1', 'No Source', 'http://acme.test/about') $$,
  '23514', null, 'a founder source URL must be https'
);
select ok(
  (select extensions.similarity(full_name, 'Priya Ramen') > 0.3 from (values ('Priya Raman')) as v(full_name)),
  'pg_trgm similarity is available for founder-name matching'
);

-- ---------------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------------

-- now() is fixed inside a transaction, so push created_at into the past first.
update company set created_at = now() - interval '1 day' where slug = 'acme-test';
select ok(
  (select updated_at > created_at from company where slug = 'acme-test'),
  'updated_at is set to the current time when a company changes'
);
select is(
  (select count(*)::int from company_founder where company_id = '00000000-0000-0000-0000-0000000000a1'),
  0,
  'the founder deleted above is gone'
);

select * from finish();
rollback;
