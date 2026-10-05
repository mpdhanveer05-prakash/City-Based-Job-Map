-- P7-02: the database fills in a job's title_norm and dedup_hash when the writer leaves them out.
-- Run with `npx supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

truncate public.city, public.source, public.sector, public.company, public.admin_user restart identity cascade;
set local app.skip_audit = 'on';

insert into source (id, name, kind, permission_note) values (1, 'Fixture', 'manual', 'Test fixture');
insert into company (id, slug, name, domain, website_url, status, source_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'pub-co', 'Pub Co', 'pub.test', 'https://pub.test', 'published', 1);

create schema tests;
create function tests.sqlstate_of(q text) returns text
language plpgsql as $$
begin
  execute q;
  return null;
exception when others then
  return sqlstate;
end;
$$;

insert into job (id, company_id, source_id, title, apply_url, status) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 1, '  Senior Backend Engineer ', 'https://pub.test/careers/1', 'draft');

select is((select title_norm from job where id = '00000000-0000-0000-0000-0000000000d1'), 'senior backend engineer',
  'the normalised title is the title lower-cased and trimmed');
select is((select encode(dedup_hash, 'hex') from job where id = '00000000-0000-0000-0000-0000000000d1'),
  md5('00000000-0000-0000-0000-0000000000c1|senior backend engineer|https://pub.test/careers/1'),
  'the hash is the md5 of company, normalised title, and link');

select is(tests.sqlstate_of($$ insert into job (company_id, source_id, title, apply_url, status)
  values ('00000000-0000-0000-0000-0000000000c1', 1, 'SENIOR backend engineer', 'https://pub.test/careers/1', 'draft') $$), '23505',
  'the same title and link at the same company is the same job: a second insert is a duplicate');
select lives_ok($$ insert into job (company_id, source_id, title, apply_url, status)
  values ('00000000-0000-0000-0000-0000000000c1', 1, 'Senior Backend Engineer', 'https://pub.test/careers/2', 'draft') $$,
  'the same title with another link is another job');

update job set title = 'Staff Backend Engineer' where id = '00000000-0000-0000-0000-0000000000d1';
select is((select title_norm from job where id = '00000000-0000-0000-0000-0000000000d1'), 'staff backend engineer', 'a new title brings a new normalised title');
select is((select encode(dedup_hash, 'hex') from job where id = '00000000-0000-0000-0000-0000000000d1'),
  md5('00000000-0000-0000-0000-0000000000c1|staff backend engineer|https://pub.test/careers/1'), 'and a new hash');

insert into job (id, company_id, source_id, title, title_norm, apply_url, dedup_hash, status) values
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', 1, 'From the feed', 'feed norm', 'https://pub.test/careers/3', '\x0a0b', 'draft');
select is((select encode(dedup_hash, 'hex') from job where id = '00000000-0000-0000-0000-0000000000d3'), '0a0b', 'a hash the pipeline gives is kept');
select is((select title_norm from job where id = '00000000-0000-0000-0000-0000000000d3'), 'feed norm', 'and so is its normalised title');

update job set status = 'withdrawn' where id = '00000000-0000-0000-0000-0000000000d3';
select is((select encode(dedup_hash, 'hex') from job where id = '00000000-0000-0000-0000-0000000000d3'), '0a0b', 'an update that does not touch the title or link leaves the hash alone');

select * from finish();
rollback;
