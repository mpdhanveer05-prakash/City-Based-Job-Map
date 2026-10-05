-- P8-04: submissions and the rate limit, tested as each role.
-- Run with `npx supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

truncate public.city, public.source, public.sector, public.company, public.admin_user, public.submission, public.feedback_rate restart identity cascade;

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
create function tests.message_of(q text) returns text
language plpgsql as $$
begin
  execute q;
  return null;
exception when others then
  return sqlerrm;
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
  ('00000000-0000-0000-0000-00000000e004');   -- signed in, not an admin
insert into admin_user (user_id, role) values
  ('00000000-0000-0000-0000-00000000e001', 'editor'),
  ('00000000-0000-0000-0000-00000000e002', 'reviewer');
insert into source (id, name, kind, permission_note) values (1, 'Fixture', 'manual', 'Test fixture');
insert into company (id, slug, name, domain, website_url, status, source_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'pub-co', 'Pub Co', 'pub.test', 'https://pub.test', 'published', 1),
  ('00000000-0000-0000-0000-0000000000c2', 'draft-co', 'Draft Co', 'draft.test', 'https://draft.test', 'draft', 1);
insert into job (id, company_id, source_id, title, apply_url, status) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 1, 'Live', 'https://pub.test/1', 'active'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 1, 'Gone', 'https://pub.test/2', 'expired');
set local app.skip_audit = 'off';

-- ---------------------------------------------------------------------------
-- Who may submit
-- ---------------------------------------------------------------------------

select tests.become(null, 'anon');
select is(tests.sqlstate_of($$ select submit_feedback('report', 'company', '00000000-0000-0000-0000-0000000000c1', 'x', null, null, '\x00112233445566778899aabbccddeeff') $$), '42501', 'anon cannot submit directly: only the Edge Function can');
select is(tests.sqlstate_of($$ insert into submission (kind, target_type, message) values ('report', 'other', 'x') $$), '42501', 'anon cannot insert into the table either');
select is(tests.sqlstate_of($$ select * from submission $$), '42501', 'or read it');
select is(tests.sqlstate_of($$ select * from feedback_rate $$), '42501', 'or the rate table');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e004', 'authenticated');
select is(tests.sqlstate_of($$ select submit_feedback('report', 'company', '00000000-0000-0000-0000-0000000000c1', 'x', null, null, '\x00112233445566778899aabbccddeeff') $$), '42501', 'a signed-in non-admin cannot either');
reset role;

-- ---------------------------------------------------------------------------
-- What the service role may submit
-- ---------------------------------------------------------------------------

select tests.become(null, 'service_role');
create temp table receipts as select
  submit_feedback('report', 'company', '00000000-0000-0000-0000-0000000000c1', '  The page is wrong.  ', null, null, '\x00112233445566778899aabbccddeeff') as report,
  submit_feedback('report', 'job', '00000000-0000-0000-0000-0000000000d1', 'The link is dead.', null, null, '\xffeeddccbbaa99887766554433221100') as job_report,
  submit_feedback('suggestion', 'other', null, 'They are in Chennai too.', 'https://newco.example/about', '  New Co ', '\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') as suggestion;
reset role;
grant select on receipts to authenticated;
select is((select count(*)::int from submission), 3, 'a report about a company, a report about a job, and a suggestion are stored');
select is((select message from submission where kind = 'report' and target_type = 'company'), 'The page is wrong.', 'the message is trimmed');
select is((select company_name from submission where kind = 'suggestion'), 'New Co', 'and so is the name');
select is((select array_agg(distinct status) from submission), array['new'], 'all of them wait as new');
select ok((select report is not null from receipts), 'the receipt is the submission id');

select tests.become(null, 'service_role');
select is(tests.sqlstate_of($$ select submit_feedback('report', 'company', '00000000-0000-0000-0000-0000000000c2', 'x', null, null, '\xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') $$), '22023', 'a report about an unpublished company is refused');
select is(tests.sqlstate_of($$ select submit_feedback('report', 'job', '00000000-0000-0000-0000-0000000000d2', 'x', null, null, '\xcccccccccccccccccccccccccccccccc') $$), '22023', 'and one about an expired job');
select is(tests.sqlstate_of($$ select submit_feedback('report', 'company', '00000000-0000-0000-0000-0000000000ff', 'x', null, null, '\xdddddddddddddddddddddddddddddddd') $$), '22023', 'or one about an id that never existed');
select is(tests.sqlstate_of($$ select submit_feedback('suggestion', 'other', null, 'x', null, 'No Link Co', '\xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') $$), '23514', 'a suggestion without a source link is refused by the table');
select is(tests.sqlstate_of($$ select submit_feedback('suggestion', 'other', null, 'x', 'http://insecure.example', 'Co', '\xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') $$), '23514', 'and one with an insecure link');
select is(tests.sqlstate_of($$ select submit_feedback('suggestion', 'company', '00000000-0000-0000-0000-0000000000c1', 'x', 'https://a.example', 'Co', '\xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') $$), '23514', 'and a suggestion that points at an existing company');
select is(tests.sqlstate_of($$ select submit_feedback('report', 'other', null, '', null, null, '\xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') $$), '23514', 'an empty message is refused');
select is(tests.sqlstate_of($$ select submit_feedback('report', 'other', null, repeat('x', 1001), null, null, '\xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') $$), '23514', 'and one over 1000 characters');
select is(tests.sqlstate_of($$ select submit_feedback('report', 'other', null, 'x', null, null, '\x00') $$), '22023', 'a client key that is too short is refused');
reset role;

-- ---------------------------------------------------------------------------
-- The rate limit: five an hour from one key
-- ---------------------------------------------------------------------------

select tests.become(null, 'service_role');
select lives_ok($$ select submit_feedback('report', 'other', null, 'n' || g, null, null, '\x11111111111111111111111111111111') from generate_series(1, 5) g $$, 'five submissions from one key in an hour are accepted');
select is(tests.message_of($$ select submit_feedback('report', 'other', null, 'sixth', null, null, '\x11111111111111111111111111111111') $$), 'rate_limited', 'the sixth is refused as rate_limited');
select lives_ok($$ select submit_feedback('report', 'other', null, 'someone else', null, null, '\x22222222222222222222222222222222') $$, 'another key is not affected');
reset role;
select is((select count(*)::int from submission where message = 'sixth'), 0, 'and the sixth was not stored');
-- The refused call rolls its own increment back, so the counter stays at the five that were accepted.
select is((select count from feedback_rate where client_hash = '\x11111111111111111111111111111111'), 5, 'the counter shows the five accepted');
update feedback_rate set hour = now() - interval '2 days';
select tests.become(null, 'service_role');
select lives_ok($$ select submit_feedback('report', 'other', null, 'next day', null, null, '\x11111111111111111111111111111111') $$, 'an old window does not count, and old rows are cleared');
reset role;
select is((select count(*)::int from feedback_rate where hour < now() - interval '1 day'), 0, 'rate rows older than a day are gone');

-- ---------------------------------------------------------------------------
-- The reviewers' queue
-- ---------------------------------------------------------------------------

select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
select cmp_ok((select count(*)::int from submission), '>=', 3, 'an editor reads the queue');
-- Row-level security hides every row from an editor's update: no error, and nothing changes.
update submission set status = 'resolved';
reset role;
select is((select count(*)::int from submission where status <> 'new'), 0, 'but cannot decide on anything');

select tests.become('00000000-0000-0000-0000-00000000e002', 'authenticated');
update submission set status = 'resolved', resolution_note = 'Fixed the page.' where id = (select report from receipts);
reset role;
select is((select resolved_by from submission where id = (select report from receipts)), '00000000-0000-0000-0000-00000000e002'::uuid, 'a reviewer''s decision records who made it');
select ok((select resolved_at is not null from submission where id = (select report from receipts)), 'and when');

select tests.become('00000000-0000-0000-0000-00000000e002', 'authenticated');
select is(tests.sqlstate_of($$ update submission set message = 'rewritten' where id = (select report from receipts) $$), '42501', 'what a visitor sent cannot be edited, even by a reviewer');

select * from finish();
rollback;
