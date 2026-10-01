-- P1-03: the extensions migration applied and both extensions work.
-- Run with `npx supabase test db` against the local stack.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

select has_extension('postgis', 'postgis is installed');
select has_extension('pg_trgm', 'pg_trgm is installed');
select ok(extensions.postgis_version() is not null, 'postgis_version() returns a version');
select ok(
  extensions.similarity('bengaluru', 'bangalore') > 0,
  'pg_trgm similarity() works on city spellings'
);

select * from finish();
rollback;
