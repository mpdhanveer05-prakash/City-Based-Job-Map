-- P6-01 and P6-03: slug redirects and the outbound click counter, tested as each role.
-- Run with `npx supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

-- The seed is loaded by `db reset`; these tests use their own fixtures, so start from empty tables
-- (TRUNCATE is transactional: the rollback restores the seed).
truncate public.city, public.source, public.sector, public.company, public.admin_user
  restart identity cascade;

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
-- Fixtures: a published company with two jobs (active, expired), a draft company with a job
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000e001'),   -- editor
  ('00000000-0000-0000-0000-00000000e002'),   -- reviewer
  ('00000000-0000-0000-0000-00000000e004');   -- signed in, not an admin
insert into admin_user (user_id, role) values
  ('00000000-0000-0000-0000-00000000e001', 'editor'),
  ('00000000-0000-0000-0000-00000000e002', 'reviewer');

insert into source (id, name, kind, permission_note) values (1, 'Fixture', 'manual', 'Test fixture');
insert into company (id, slug, name, domain, website_url, status, source_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'pub-co', 'Pub Co', 'pub.test', 'https://pub.test', 'published', 1),
  ('00000000-0000-0000-0000-0000000000c2', 'draft-co', 'Draft Co', 'draft.test', 'https://draft.test', 'draft', 1);
insert into job (id, company_id, source_id, title, title_norm, apply_url, dedup_hash, status) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 1, 'Active', 'active', 'https://pub.test/1', '\x01', 'active'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 1, 'Expired', 'expired', 'https://pub.test/2', '\x02', 'expired'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c2', 1, 'Draft co job', 'draft co job', 'https://draft.test/1', '\x03', 'active');

-- ---------------------------------------------------------------------------
-- record_click: who may call it, and what it accepts
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0, 'row-level security is on for every table in public, including the two new ones');

select tests.become(null, 'anon');
select is(tests.sqlstate_of($$ select record_click('website', '00000000-0000-0000-0000-0000000000c1') $$), '42501',
  'anon cannot call record_click');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e004', 'authenticated');
select is(tests.sqlstate_of($$ select record_click('website', '00000000-0000-0000-0000-0000000000c1') $$), '42501',
  'a signed-in user cannot call it either');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e002', 'authenticated');
select is(tests.sqlstate_of($$ select record_click('website', '00000000-0000-0000-0000-0000000000c1') $$), '42501',
  'nor can a reviewer: only the service role (the click Edge Function) can');
reset role;

select tests.become(null, 'service_role');
select lives_ok($$ select record_click('website', '00000000-0000-0000-0000-0000000000c1') $$, 'the service role can count a company website click');
select lives_ok($$ select record_click('website', '00000000-0000-0000-0000-0000000000c1') $$, 'and count it again');
select lives_ok($$ select record_click('apply', '00000000-0000-0000-0000-0000000000d1') $$, 'and an apply click on a listed job');
select is(tests.sqlstate_of($$ select record_click('apply', '00000000-0000-0000-0000-0000000000d2') $$), '22023', 'an expired job is not countable');
select is(tests.sqlstate_of($$ select record_click('apply', '00000000-0000-0000-0000-0000000000d3') $$), '22023', 'nor is a draft company''s job');
select is(tests.sqlstate_of($$ select record_click('website', '00000000-0000-0000-0000-0000000000c2') $$), '22023', 'nor is a draft company''s website');
select is(tests.sqlstate_of($$ select record_click('website', '00000000-0000-0000-0000-0000000000d1') $$), '22023', 'a job id is not a company id for a website click');
select is(tests.sqlstate_of($$ select record_click('apply', '00000000-0000-0000-0000-0000000000c1') $$), '22023', 'and a company id is not a job id for an apply click');
select is(tests.sqlstate_of($$ select record_click('share', '00000000-0000-0000-0000-0000000000c1') $$), '22023', 'an unknown kind is refused');
select is(tests.sqlstate_of($$ select record_click('apply', '00000000-0000-0000-0000-0000000000ff') $$), '22023', 'an id that never existed is refused');
select is(tests.sqlstate_of($$ select record_click(null, null) $$), '22023', 'null arguments are refused');
reset role;

select is((select count from link_click_daily where kind = 'website' and target_id = '00000000-0000-0000-0000-0000000000c1'), 2,
  'two website clicks add up to a count of 2 in one row');
select is((select count(*)::int from link_click_daily), 2, 'only the two accepted targets have rows');
select is((select day from link_click_daily limit 1), (now() at time zone 'utc')::date, 'the day is today in UTC');
select is((select count(*)::int from information_schema.columns where table_name = 'link_click_daily'
           and column_name in ('ip', 'user_agent', 'user_id', 'session', 'created_at', 'at')), 0,
  'the counter holds no address, agent, user, session, or timestamp');

-- ---------------------------------------------------------------------------
-- Reading and writing the counter through the API
-- ---------------------------------------------------------------------------

select tests.become(null, 'anon');
select is(tests.sqlstate_of($$ select * from link_click_daily $$), '42501', 'anon cannot read the counter');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
select is((select count(*)::int from link_click_daily), 0, 'an editor sees no counter rows');
select is(tests.sqlstate_of($$ insert into link_click_daily values (current_date, 'apply', '00000000-0000-0000-0000-0000000000d1', 99) $$), '42501',
  'and cannot write one');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e002', 'authenticated');
select is((select count(*)::int from link_click_daily), 2, 'a reviewer reads the totals');
select is(tests.sqlstate_of($$ update link_click_daily set count = 0 $$), '42501', 'but cannot change them');
reset role;

-- ---------------------------------------------------------------------------
-- Slug redirects
-- ---------------------------------------------------------------------------

insert into slug_redirect (old_slug, company_id) values ('old-pub', '00000000-0000-0000-0000-0000000000c1');
insert into slug_redirect (old_slug, company_id) values ('old-draft', '00000000-0000-0000-0000-0000000000c2');

select tests.become(null, 'anon');
select is((select array_agg(old_slug) from slug_redirect), array['old-pub'], 'anon sees the redirects of published companies only');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
select is((select count(*)::int from slug_redirect), 2, 'an editor sees both');
select is(tests.sqlstate_of($$ insert into slug_redirect (old_slug, company_id) values ('x-new', '00000000-0000-0000-0000-0000000000c1') $$), '42501',
  'but only a reviewer can add one');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e002', 'authenticated');
select lives_ok($$ insert into slug_redirect (old_slug, company_id) values ('older-pub', '00000000-0000-0000-0000-0000000000c1') $$,
  'a reviewer can add a redirect');
select is(tests.rows_affected($$ delete from slug_redirect where old_slug = 'older-pub' $$), 1, 'and delete one');
reset role;

select is(tests.sqlstate_of($$ insert into slug_redirect (old_slug, company_id) values ('pub-co', '00000000-0000-0000-0000-0000000000c1') $$), '23514',
  'a redirect from a slug a company uses today is refused');
select is(tests.sqlstate_of($$ insert into slug_redirect (old_slug, company_id) values ('Bad Slug', '00000000-0000-0000-0000-0000000000c1') $$), '23514',
  'a redirect with a malformed slug is refused');
select is(tests.sqlstate_of($$ update company set slug = 'old-pub' where id = '00000000-0000-0000-0000-0000000000c2' $$), '23514',
  'a company cannot take a slug that redirects elsewhere');

-- (The snapshot's slug_redirects are checked against the seed in 04_seed.test.sql.)

select * from finish();
rollback;
