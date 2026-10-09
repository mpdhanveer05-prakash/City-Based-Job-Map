-- Adding an employer feed (20261008110000 create_job_feed), as each role that could try it, and the approval rules after it:
-- a new feed is never approved; only approve_job_feed approves it. Outcomes reached as roles that cannot see pgTAP are kept
-- in settings and asserted as the owner, as in 16_security_gaps and 17_feed_review.
-- Run with `node scripts/test-stack.mts test-db` (never against the main local database).
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

truncate public.city, public.source, public.sector, public.company, public.admin_user restart identity cascade;
grant pipeline to current_user with set true;

create schema tests;
grant usage on schema tests to anon, authenticated, service_role, pipeline;

create function tests.become(who text, uid uuid default null, aal text default 'aal2') returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true); -- back to the owner first, so the session and factor rows can be written
  if uid is not null and current_user = 'postgres' then
    insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
    values (uid, uid, 'test', 'totp', 'verified', now(), now()) on conflict do nothing;
    insert into auth.sessions (id, user_id, aal, created_at) values (uid, uid, aal::auth.aal_level, now())
    on conflict (id) do update set aal = excluded.aal;
  end if;
  perform set_config('request.jwt.claims',
    case when uid is null then '' else json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal, 'session_id', uid)::text end, true);
  perform set_config('role', coalesce(who, 'none'), true);
end;
$$;

create function tests.outcome(q text) returns text
language plpgsql as $$
begin
  execute q;
  set constraints all immediate;
  set constraints all deferred;
  return 'ok';
exception when others then
  set constraints all deferred;
  return sqlstate;
end;
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role, pipeline;
create function tests.keep(name text, q text) returns void
language sql as $$ select set_config('t.' || name, tests.outcome(q), true) $$;
grant execute on function tests.keep(text, text) to anon, authenticated, service_role, pipeline;

-- Fixture (owner).
set local app.skip_audit = 'on';
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000ed01'), ('00000000-0000-0000-0000-00000000e501'), ('00000000-0000-0000-0000-0000000ad001');
insert into admin_user (user_id, role) values
  ('00000000-0000-0000-0000-00000000ed01', 'editor'),
  ('00000000-0000-0000-0000-00000000e501', 'reviewer'),
  ('00000000-0000-0000-0000-0000000ad001', 'admin');
insert into city (id, slug, name, status, centre, default_zoom, boundary) values
  (1, 'bangalore', 'Bengaluru', 'beta', 'SRID=4326;POINT(77.60 12.97)', 11, 'SRID=4326;MULTIPOLYGON(((77.40 12.80, 77.80 12.80, 77.80 13.15, 77.40 13.15, 77.40 12.80)))');
insert into source (id, name, kind, permission_note) values
  (1, 'ATS feeds', 'ats_feed', 'Fixture'), (2, 'Careers pages', 'jsonld', 'Fixture'), (3, 'Manual', 'manual', 'Fixture');
insert into company (id, slug, name, domain, website_url, status) values
  ('00000000-0000-4000-8000-0000000000c1', 'acme', 'Acme', 'acme.test', 'https://acme.test', 'draft');
set local app.skip_audit = 'off';

-- Who may add a feed.
select tests.become('anon');
select tests.keep('anon', $$ select create_job_feed('00000000-0000-4000-8000-0000000000c1', 1, 'greenhouse', 'acme') $$);
select tests.become('authenticated', '00000000-0000-0000-0000-00000000ed01');
select tests.keep('editor', $$ select create_job_feed('00000000-0000-4000-8000-0000000000c1', 1, 'greenhouse', 'acme') $$);
-- An editor holds no write policy on job_feed either: a direct insert is refused by row-level security.
select tests.keep('editor_direct', $$ insert into job_feed (company_id, source_id, provider, identifier) values ('00000000-0000-4000-8000-0000000000c1', 1, 'lever', 'acme') $$);
select tests.become('authenticated', '00000000-0000-0000-0000-00000000e501', 'aal1');
select tests.keep('aal1', $$ select create_job_feed('00000000-0000-4000-8000-0000000000c1', 1, 'greenhouse', 'acme') $$);
select tests.become('service_role');
select tests.keep('service', $$ select create_job_feed('00000000-0000-4000-8000-0000000000c1', 1, 'greenhouse', 'acme') $$);
select tests.become('pipeline');
select tests.keep('pipeline', $$ select create_job_feed('00000000-0000-4000-8000-0000000000c1', 1, 'greenhouse', 'acme') $$);

-- What a reviewer may add.
select tests.become('authenticated', '00000000-0000-0000-0000-00000000e501');
select tests.keep('no_company', $$ select create_job_feed('00000000-0000-4000-8000-00000000dead', 1, 'greenhouse', 'acme') $$);
select tests.keep('no_source', $$ select create_job_feed('00000000-0000-4000-8000-0000000000c1', 99, 'greenhouse', 'acme') $$);
select tests.keep('bad_provider', $$ select create_job_feed('00000000-0000-4000-8000-0000000000c1', 1, 'myspace', 'acme') $$);
select tests.keep('manual_source', $$ select create_job_feed('00000000-0000-4000-8000-0000000000c1', 3, 'greenhouse', 'acme') $$);
select tests.keep('jsonld_on_ats', $$ select create_job_feed('00000000-0000-4000-8000-0000000000c1', 1, 'jsonld', 'https://acme.test/careers') $$);
select tests.keep('bad_board', $$ select create_job_feed('00000000-0000-4000-8000-0000000000c1', 1, 'lever', 'acme jobs/../x') $$);
select tests.keep('http_page', $$ select create_job_feed('00000000-0000-4000-8000-0000000000c1', 2, 'jsonld', 'http://acme.test/careers') $$);
select tests.keep('other_domain', $$ select create_job_feed('00000000-0000-4000-8000-0000000000c1', 2, 'jsonld', 'https://acme.test.evil.example/careers') $$);
select tests.keep('ok_board', $$ select create_job_feed('00000000-0000-4000-8000-0000000000c1', 1, 'greenhouse', '  acme  ') $$);
select tests.keep('duplicate', $$ select create_job_feed('00000000-0000-4000-8000-0000000000c1', 1, 'greenhouse', 'acme') $$);
select tests.keep('ok_page', $$ select create_job_feed('00000000-0000-4000-8000-0000000000c1', 2, 'jsonld', 'https://careers.acme.test/jobs') $$);
-- Approval stays a separate act: setting the approval columns directly is refused even for the reviewer who added it.
select tests.keep('approve_direct', $$ update job_feed set approved_by = '00000000-0000-0000-0000-00000000e501', approved_at = now() where provider = 'greenhouse' $$);
select tests.become('authenticated', '00000000-0000-0000-0000-0000000ad001');
select tests.keep('admin', $$ select create_job_feed('00000000-0000-4000-8000-0000000000c1', 1, 'ashby', 'Acme') $$);
select tests.keep('admin_direct_approve', $$ update job_feed set approved_by = '00000000-0000-0000-0000-0000000ad001', approved_at = now() where provider = 'ashby' $$);
select tests.become(null);

select is(current_setting('t.anon'), '42501', 'anon cannot add a feed');
select is(current_setting('t.editor'), '42501', 'an editor (aal2) cannot add a feed');
select is(current_setting('t.editor_direct'), '42501', 'nor insert one directly (row-level security)');
select is(current_setting('t.aal1'), '42501', 'a reviewer without MFA cannot add a feed');
select is(current_setting('t.service'), '42501', 'service_role cannot add a feed (no signed-in reviewer)');
select is(current_setting('t.pipeline'), '42501', 'the pipeline cannot add the feeds it reads');
select is(current_setting('t.no_company'), '22023', 'an unknown company is refused');
select is(current_setting('t.no_source'), '22023', 'an unknown source is refused');
select is(current_setting('t.bad_provider'), '22023', 'an unknown provider is refused');
select is(current_setting('t.manual_source'), '23514', 'an ATS feed needs an ATS-feed source, not a manual one');
select is(current_setting('t.jsonld_on_ats'), '23514', 'a careers page needs a jsonld source');
select is(current_setting('t.bad_board'), '23514', 'a board name is a plain name');
select is(current_setting('t.http_page'), '23514', 'a careers page is an https link');
select is(current_setting('t.other_domain'), '23514', 'a careers page on another domain is refused, even one that starts like the company''s');
select is(current_setting('t.ok_board'), 'ok', 'an aal2 reviewer adds an ATS feed');
select is(current_setting('t.duplicate'), '23505', 'the same feed cannot be listed twice');
select is(current_setting('t.ok_page'), 'ok', 'a careers page on a subdomain of the company''s domain is accepted');
select is(current_setting('t.admin'), 'ok', 'an admin may add a feed');
select results_eq($$ select identifier, approved_at is null, approved_by is null, created_by::text, created_at is not null from job_feed where provider = 'greenhouse' $$,
  $$ values ('acme', true, true, '00000000-0000-0000-0000-00000000e501', true) $$,
  'a new feed is trimmed, UNAPPROVED, and records who added it and when');
select is((select count(*)::int from job_feed where approved_at is not null), 0, 'no feed is approved by being added');
select is(current_setting('t.approve_direct'), 'ok', 'a reviewer''s direct update of approval columns runs into no write policy');
select is((select count(*)::int from job_feed where approved_at is not null), 0, 'and approves nothing');
select is(current_setting('t.admin_direct_approve'), '42501', 'an admin may write feeds, but cannot set the approval columns directly');
select ok((select count(*) > 0 from audit_log where table_name = 'job_feed' and action = 'insert'), 'adding a feed is in the audit log');

select * from finish();
rollback;
