-- The reviewer's feed actions (20261006170000, 20261006190000; ADR-0022 §7): approve_job_feed, withdraw_job_feed and
-- resolve_feed_event. Each case runs as the role that could try it: anon, an aal2 editor, a reviewer without MFA (aal1),
-- an aal2 reviewer, service_role, the pipeline, and the owner as the control. Outcomes reached as roles that cannot see
-- pgTAP are kept in settings and asserted as the owner, as in 16_security_gaps.
-- Run with `node scripts/test-stack.mts test-db` (never against the main local database).
begin;
create extension if not exists pgtap with schema extensions;

select plan(39);

truncate public.city, public.source, public.sector, public.company, public.admin_user restart identity cascade;
grant pipeline to current_user with set true;

create schema tests;
grant usage on schema tests to anon, authenticated, service_role, pipeline;

-- Become a signed-in admin at aal2 (live session, verified factor) or aal1, anon, service_role, pipeline, or the owner (null).
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

-- Runs a statement and the deferred checks a commit would run; returns the SQLSTATE, or 'ok' if it would commit.
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

-- Keeps an outcome under a name, so it can be asserted as the owner.
create function tests.keep(name text, q text) returns void
language sql as $$ select set_config('t.' || name, tests.outcome(q), true) $$;
grant execute on function tests.keep(text, text) to anon, authenticated, service_role, pipeline;

-- Fixture (owner).
set local app.skip_audit = 'on';
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000ed01'), ('00000000-0000-0000-0000-00000000e501'), ('00000000-0000-0000-0000-00000000e502'),
  ('00000000-0000-0000-0000-0000000ad001');
insert into admin_user (user_id, role) values
  ('00000000-0000-0000-0000-00000000ed01', 'editor'),
  ('00000000-0000-0000-0000-00000000e501', 'reviewer'),
  ('00000000-0000-0000-0000-00000000e502', 'reviewer'),
  ('00000000-0000-0000-0000-0000000ad001', 'admin');
insert into city (id, slug, name, status, centre, default_zoom, boundary) values
  (1, 'bangalore', 'Bengaluru', 'beta', 'SRID=4326;POINT(77.60 12.97)', 11, 'SRID=4326;MULTIPOLYGON(((77.40 12.80, 77.80 12.80, 77.80 13.15, 77.40 13.15, 77.40 12.80)))');
insert into source (id, name, kind, permission_note) values (1, 'Fixture', 'ats_feed', 'Test fixture');
insert into company (id, slug, name, domain, website_url, status) values
  ('00000000-0000-4000-8000-0000000000c1', 'public-co', 'Public Co', 'public-co.test', 'https://public-co.test', 'published');
insert into office (id, company_id, city_id, address, geom, accuracy, status) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 1, '1 Listed Road', 'SRID=4326;POINT(77.6 12.97)', 'building', 'published');
insert into field_evidence (company_id, office_id, field, source_url, verified_at, reviewed_at, reviewed_by)
select case when f in ('address', 'location') then null else '00000000-0000-4000-8000-0000000000c1'::uuid end,
       case when f in ('address', 'location') then '00000000-0000-4000-8000-0000000000a1'::uuid end,
       f, 'https://fixture.test/evidence', date '2026-09-01', now(), '00000000-0000-0000-0000-00000000e501'
from unnest(array['name', 'website', 'address', 'location']) f;
-- Feed 1 not yet approved; feed 2 approved, with a listed job and four feed events.
insert into job_feed (id, company_id, source_id, provider, identifier) values
  (1, '00000000-0000-4000-8000-0000000000c1', 1, 'lever', 'public-co');
insert into job_feed (id, company_id, source_id, provider, identifier, approved_by, approved_at, approval_note) values
  (2, '00000000-0000-4000-8000-0000000000c1', 1, 'greenhouse', 'public-co', '00000000-0000-0000-0000-00000000e501', now(), 'fixture');
insert into job (id, company_id, source_id, title, apply_url, status) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c1', 1, 'Engineer', 'https://public-co.test/jobs/1', 'active');
insert into job_city (job_id, city_id) values ('00000000-0000-4000-8000-0000000000b1', 1);
insert into field_evidence (job_id, field, source_url, verified_at, reviewed_at, reviewed_by)
select '00000000-0000-4000-8000-0000000000b1', f, 'https://public-co.test/jobs/1', date '2026-09-01', now(), '00000000-0000-0000-0000-00000000e501'
from unnest(array['title', 'employer', 'location', 'apply_url']) f;
insert into feed_event (feed_id, job_id, kind, field, old_value, new_value) values
  (2, '00000000-0000-4000-8000-0000000000b1', 'held_domain_change', 'apply_url', 'https://public-co.test/jobs/1', 'https://careers.public-co-hr.test/1'),
  (2, '00000000-0000-4000-8000-0000000000b1', 'held_ambiguous', null, null, null),
  (2, '00000000-0000-4000-8000-0000000000b1', 'held_domain_change', 'apply_url', 'https://public-co.test/jobs/1', 'http://insecure.test/1'),
  (2, '00000000-0000-4000-8000-0000000000b1', 'changed', 'title', 'Engineer', 'Engineer II');
set local app.skip_audit = 'off';
set constraints all immediate;
set constraints all deferred;
create temp table ev on commit drop as select id, kind, new_value from feed_event order by id;
grant select on ev to anon, authenticated, service_role, pipeline;

-- ---------------------------------------------------------------------------
-- approve_job_feed
-- ---------------------------------------------------------------------------

select tests.become('anon');
select tests.keep('approve_anon', $$ select approve_job_feed(1, 'official careers feed') $$);
select tests.become('authenticated', '00000000-0000-0000-0000-00000000ed01');
select tests.keep('approve_editor', $$ select approve_job_feed(1, 'official careers feed') $$);
select tests.become('authenticated', '00000000-0000-0000-0000-00000000e502', 'aal1');
select tests.keep('approve_aal1', $$ select approve_job_feed(1, 'official careers feed') $$);
select tests.become('service_role');
select tests.keep('approve_service', $$ select approve_job_feed(1, 'official careers feed') $$);
select tests.become('pipeline');
select tests.keep('approve_pipeline', $$ select approve_job_feed(1, 'official careers feed') $$);
select tests.become('authenticated', '00000000-0000-0000-0000-00000000e501');
select tests.keep('approve_no_note', $$ select approve_job_feed(1, '   ') $$);
select tests.keep('approve_unknown', $$ select approve_job_feed(999, 'official careers feed') $$);
select tests.keep('approve_direct', $$ update job_feed set approved_by = '00000000-0000-0000-0000-00000000e501', approved_at = now() where id = 1 $$);
select set_config('t.direct_left_alone', (select (approved_at is null)::text from job_feed where id = 1), true);
-- An admin may write job_feed rows (job_feed_admin_write), but not the approval columns: only approve_job_feed sets them.
select tests.become('authenticated', '00000000-0000-0000-0000-0000000ad001');
select tests.keep('approve_admin_direct', $$ update job_feed set approved_by = '00000000-0000-0000-0000-0000000ad001', approved_at = now() where id = 1 $$);
select tests.become('authenticated', '00000000-0000-0000-0000-00000000e501');
select tests.keep('approve_ok', $$ select approve_job_feed(1, '  linked from public-co.test/careers  ') $$);
select tests.become(null);

select is(current_setting('t.approve_anon'), '42501', 'approve: anon cannot call it');
select is(current_setting('t.approve_editor'), '42501', 'approve: an editor (aal2) is refused');
select is(current_setting('t.approve_aal1'), '42501', 'approve: a reviewer without MFA (aal1) is refused');
select is(current_setting('t.approve_service'), '42501', 'approve: service_role has no signed-in reviewer, so it is refused');
select is(current_setting('t.approve_pipeline'), '42501', 'approve: the pipeline cannot approve the feeds it reads');
select is(current_setting('t.approve_no_note'), '23514', 'approve: a reviewer must say why the feed is official');
select is(current_setting('t.approve_unknown'), '22023', 'approve: an unknown feed is an error, not a silent no-op');
select ok(current_setting('t.approve_direct') = 'ok' and current_setting('t.direct_left_alone') = 'true',
  'approve: a reviewer''s direct update of the approval columns changes nothing (no write policy)');
select is(current_setting('t.approve_admin_direct'), '42501', 'approve: an admin cannot set the approval columns directly either');
select is(current_setting('t.approve_ok'), 'ok', 'approve: an aal2 reviewer with a note approves the feed');
select results_eq($$ select approved_by::text, approval_note, approved_at is not null from job_feed where id = 1 $$,
  $$ values ('00000000-0000-0000-0000-00000000e501', 'linked from public-co.test/careers', true) $$,
  'approve: who, when, and the trimmed note are recorded');

-- Pointing an approved feed at another identifier withdraws the approval.
update job_feed set identifier = 'someone-else' where id = 1;
select ok((select approved_by is null and approved_at is null from job_feed where id = 1), 'a feed whose identifier changes needs a new approval');

-- ---------------------------------------------------------------------------
-- withdraw_job_feed
-- ---------------------------------------------------------------------------

select tests.become('anon');
select tests.keep('withdraw_anon', $$ select withdraw_job_feed(2, 'no longer official') $$);
select tests.become('authenticated', '00000000-0000-0000-0000-00000000ed01');
select tests.keep('withdraw_editor', $$ select withdraw_job_feed(2, 'no longer official') $$);
select tests.become('authenticated', '00000000-0000-0000-0000-00000000e502', 'aal1');
select tests.keep('withdraw_aal1', $$ select withdraw_job_feed(2, 'no longer official') $$);
select tests.become('service_role');
select tests.keep('withdraw_service', $$ select withdraw_job_feed(2, 'no longer official') $$);
select tests.become('authenticated', '00000000-0000-0000-0000-00000000e501');
select tests.keep('withdraw_no_note', $$ select withdraw_job_feed(2, '') $$);
select tests.keep('withdraw_unknown', $$ select withdraw_job_feed(999, 'no longer official') $$);
select tests.become(null);

select is(current_setting('t.withdraw_anon'), '42501', 'withdraw: anon cannot call it');
select is(current_setting('t.withdraw_editor'), '42501', 'withdraw: an editor (aal2) is refused');
select is(current_setting('t.withdraw_aal1'), '42501', 'withdraw: a reviewer without MFA is refused');
select is(current_setting('t.withdraw_service'), '42501', 'withdraw: service_role is refused');
select is(current_setting('t.withdraw_no_note'), '23514', 'withdraw: a reason is required');
select is(current_setting('t.withdraw_unknown'), '22023', 'withdraw: an unknown feed is an error');
select ok((select approved_at is not null from job_feed where id = 2), 'withdraw: none of the refused calls changed the feed');

-- ---------------------------------------------------------------------------
-- resolve_feed_event (before the withdrawal, while feed 2 is approved)
-- ---------------------------------------------------------------------------

select set_config('t.e_link', (select id::text from ev where kind = 'held_domain_change' and new_value like 'https://%'), true);
select set_config('t.e_ambiguous', (select id::text from ev where kind = 'held_ambiguous'), true);
select set_config('t.e_insecure', (select id::text from ev where new_value like 'http://%'), true);
select set_config('t.e_changed', (select id::text from ev where kind = 'changed'), true);

select tests.become('anon');
select tests.keep('resolve_anon', format($$ select resolve_feed_event(%s, 'apply', 'checked') $$, current_setting('t.e_link')));
select tests.become('authenticated', '00000000-0000-0000-0000-00000000ed01');
select tests.keep('resolve_editor', format($$ select resolve_feed_event(%s, 'apply', 'checked') $$, current_setting('t.e_link')));
-- An editor can read held changes but cannot mark one resolved by writing the row (no update policy since 20261006190000).
select tests.keep('resolve_editor_direct', format($$ update feed_event set decision = 'rejected', decision_note = 'x', resolved_at = now(),
  resolved_by = '00000000-0000-0000-0000-00000000ed01' where id = %s $$, current_setting('t.e_ambiguous')));
select set_config('t.editor_left_alone', (select (resolved_at is null)::text from feed_event where id = current_setting('t.e_ambiguous')::bigint), true);
select set_config('t.editor_reads', (select count(*)::text from feed_event), true);
select tests.become('authenticated', '00000000-0000-0000-0000-00000000e502', 'aal1');
select tests.keep('resolve_aal1', format($$ select resolve_feed_event(%s, 'reject', 'checked') $$, current_setting('t.e_link')));
select tests.become('service_role');
select tests.keep('resolve_service', format($$ select resolve_feed_event(%s, 'reject', 'checked') $$, current_setting('t.e_link')));
select tests.become('pipeline');
select tests.keep('resolve_pipeline', format($$ select resolve_feed_event(%s, 'reject', 'checked') $$, current_setting('t.e_link')));
select tests.become('authenticated', '00000000-0000-0000-0000-00000000e501');
select tests.keep('resolve_no_note', format($$ select resolve_feed_event(%s, 'apply', ' ') $$, current_setting('t.e_link')));
select tests.keep('resolve_bad_decision', format($$ select resolve_feed_event(%s, 'maybe', 'checked') $$, current_setting('t.e_link')));
select tests.keep('resolve_not_held', format($$ select resolve_feed_event(%s, 'reject', 'checked') $$, current_setting('t.e_changed')));
select tests.keep('resolve_apply_ambiguous', format($$ select resolve_feed_event(%s, 'apply', 'checked') $$, current_setting('t.e_ambiguous')));
select tests.keep('resolve_apply_insecure', format($$ select resolve_feed_event(%s, 'apply', 'checked') $$, current_setting('t.e_insecure')));
select tests.keep('resolve_apply', format($$ select resolve_feed_event(%s, 'apply', 'the employer moved to a new careers site') $$, current_setting('t.e_link')));
select tests.keep('resolve_again', format($$ select resolve_feed_event(%s, 'reject', 'changed my mind') $$, current_setting('t.e_link')));
select tests.keep('resolve_reject', format($$ select resolve_feed_event(%s, 'reject', 'duplicate entry in the feed') $$, current_setting('t.e_ambiguous')));
select tests.become(null);

select is(current_setting('t.resolve_anon'), '42501', 'resolve: anon cannot call it');
select is(current_setting('t.resolve_editor'), '42501', 'resolve: an editor (aal2) is refused');
select ok(current_setting('t.resolve_editor_direct') = 'ok' and current_setting('t.editor_left_alone') = 'true',
  'resolve: an editor''s direct update changes no row (no update policy)');
select ok(current_setting('t.editor_reads')::int = 4, 'resolve: an editor can read the held changes');
select is(current_setting('t.resolve_aal1'), '42501', 'resolve: a reviewer without MFA is refused');
select is(current_setting('t.resolve_service'), '42501', 'resolve: service_role is refused');
select is(current_setting('t.resolve_pipeline'), '42501', 'resolve: the pipeline cannot decide its own held changes');
select is(current_setting('t.resolve_no_note'), '23514', 'resolve: a reason is required');
select is(current_setting('t.resolve_bad_decision'), '22023', 'resolve: the decision is apply or reject');
select is(current_setting('t.resolve_not_held'), '22023', 'resolve: only a held change can be resolved');
select is(current_setting('t.resolve_apply_ambiguous'), '22023', 'resolve: an ambiguous entry can only be rejected');
select is(current_setting('t.resolve_apply_insecure'), '23514', 'resolve: a non-https link is never applied');
select is(current_setting('t.resolve_apply'), 'ok', 'resolve: an aal2 reviewer applies a held link change');
select results_eq(format($$ select j.apply_url, e.decision, e.resolved_by::text, e.decision_note from feed_event e join job j on j.id = e.job_id where e.id = %s $$, current_setting('t.e_link')),
  $$ values ('https://careers.public-co-hr.test/1', 'applied', '00000000-0000-0000-0000-00000000e501', 'the employer moved to a new careers site') $$,
  'resolve: the job takes the new link, and who, what and why are kept on the event');
select ok((select reviewed_at is not null and self_reviewed from field_evidence
  where job_id = '00000000-0000-4000-8000-0000000000b1' and field = 'apply_url' and value = 'https://careers.public-co-hr.test/1'),
  'resolve: the new link has evidence, reviewed before the change and recorded as a self-review');
select is(current_setting('t.resolve_again'), '22023', 'resolve: a decided change cannot be decided again');
select is(current_setting('t.resolve_reject'), 'ok', 'resolve: a reviewer rejects an ambiguous entry, and the job is unchanged');

-- ---------------------------------------------------------------------------
-- After a withdrawal, the pipeline no longer lists jobs from that feed
-- ---------------------------------------------------------------------------

select tests.become('authenticated', '00000000-0000-0000-0000-00000000e501');
select tests.keep('withdraw_ok', $$ select withdraw_job_feed(2, '  the employer asked us to stop  ') $$);
select tests.become('pipeline');
select tests.keep('pipeline_after_withdrawal', $$
  with j as (insert into job (company_id, source_id, title, apply_url, status) values
    ('00000000-0000-4000-8000-0000000000c1', 1, 'After withdrawal', 'https://public-co.test/jobs/9', 'active') returning id),
  c as (insert into job_city (job_id, city_id) select id, 1 from j returning job_id)
  select record_feed_job_evidence((select job_id from c), 2) $$);
select tests.become(null);

select is(current_setting('t.withdraw_ok'), 'ok', 'withdraw: an aal2 reviewer with a reason withdraws the approval');
select results_eq($$ select approved_at is null, withdrawn_note from job_feed where id = 2 $$, $$ values (true, 'the employer asked us to stop') $$,
  'withdraw: the approval is cleared and the trimmed reason kept');
select is(current_setting('t.pipeline_after_withdrawal'), '23514', 'withdraw: the pipeline can no longer list a job from that feed (SEC-3 rule)');

select * from finish();
rollback;
