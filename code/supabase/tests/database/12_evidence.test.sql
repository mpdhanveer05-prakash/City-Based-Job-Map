-- P9-07: field evidence, its review, the publication gates, and the CSV import's evidence rules.
-- Run with `npx supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(50);

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
create function tests.error_of(q text) returns text
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
-- A save followed by the checks COMMIT would run (the gates are deferred).
create function tests.commit_check(q text) returns text
language plpgsql as $$
begin
  execute q;
  set constraints all immediate;
  set constraints all deferred;
  return null;
exception when others then
  return sqlerrm;
end;
$$;
create function tests.ev(p_company uuid, p_office uuid, p_field text, p_date date default date '2026-09-10') returns bigint
language sql as $$
  insert into public.field_evidence (company_id, office_id, field, source_url, verified_at)
  values (p_company, p_office, p_field, 'https://source.test/' || p_field, p_date) returning id;
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
insert into city (id, slug, name, status, centre, default_zoom, boundary) values
  (1, 'bangalore', 'Bengaluru', 'beta', 'SRID=4326;POINT(77.60 12.97)', 11,
   'SRID=4326;MULTIPOLYGON(((77.40 12.80, 77.80 12.80, 77.80 13.15, 77.40 13.15, 77.40 12.80)))');
insert into sector (id, slug, name) values (1, 'fintech', 'Fintech');
insert into source (id, name, kind, permission_note) values (1, 'Fixture', 'manual', 'Test fixture');
insert into company (id, slug, name, domain, website_url, description, status) values
  ('00000000-0000-4000-8000-000000000001', 'acme', 'Acme', 'acme.test', 'https://acme.test', 'Makes things', 'draft'),
  ('00000000-0000-4000-8000-000000000002', 'old-co', 'Old Co', 'old.test', 'https://old.test', null, 'published');
insert into company_type_tag (company_id, type) values ('00000000-0000-4000-8000-000000000001', 'mnc');
insert into office (id, company_id, city_id, address, geom, accuracy, verification, status) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 1, '1 Main Road', 'SRID=4326;POINT(77.6 12.97)', 'building', 'reviewed', 'draft'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000002', 1, '2 Old Road', 'SRID=4326;POINT(77.6 12.97)', 'building', 'reviewed', 'published');
insert into company_founder (id, company_id, full_name, source_url, status) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-000000000001', 'Asha Rao', 'https://acme.test/team', 'draft');
set local app.skip_audit = 'off';
-- Run the setup's deferred checks now, as the migration owner (as its own commit would).
set constraints all immediate;
set constraints all deferred;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

select tests.become(null, 'anon');
select is(tests.sqlstate_of($$ select * from field_evidence $$), '42501', 'anon cannot read evidence');
select is(tests.sqlstate_of($$ select * from publication_approval $$), '42501', 'or approvals');
select is(tests.sqlstate_of($$ select evidence_report('00000000-0000-4000-8000-000000000001') $$), '42501', 'or the evidence report');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e004');
select is((select count(*)::int from field_evidence), 0, 'a signed-in non-admin sees no evidence');
select is(tests.sqlstate_of($$ select tests.ev('00000000-0000-4000-8000-000000000001', null, 'name') $$), '42501', 'and cannot record any');
reset role;

-- ---------------------------------------------------------------------------
-- Recording evidence (as an editor)
-- ---------------------------------------------------------------------------

select tests.become('00000000-0000-0000-0000-00000000e001');
create temp table ids (k text primary key, id bigint);
grant all on ids to authenticated;
insert into ids values ('name', tests.ev('00000000-0000-4000-8000-000000000001', null, 'name', date '2026-09-01'));
select is((select value from field_evidence where id = (select id from ids where k = 'name')), 'Acme', 'evidence is bound to the value it supports');
select is((select recorded_by::text from field_evidence where id = (select id from ids where k = 'name')), '00000000-0000-0000-0000-00000000e001', 'and records who recorded it');
select is((select verified_at from field_evidence where id = (select id from ids where k = 'name')), date '2026-09-01', 'the verified date is the one given, not today');
select is((select reviewed_at from field_evidence where id = (select id from ids where k = 'name')), null, 'and it is a claim until reviewed');
select is(tests.error_of($$ insert into field_evidence (company_id, field, source_url, verified_at, reviewed_at, reviewed_by)
  values ('00000000-0000-4000-8000-000000000001', 'website', 'https://acme.test', date '2026-09-01', now(), '00000000-0000-0000-0000-00000000e001') $$), null,
  'an editor may try to record evidence as reviewed');
select is((select count(*)::int from field_evidence where field = 'website' and reviewed_at is not null), 0, 'but it is stored as a claim');
select is(tests.sqlstate_of($$ select tests.ev('00000000-0000-4000-8000-000000000001', null, 'name', current_date + 1) $$), '23514', 'a verified date in the future is refused');
select is(tests.sqlstate_of($$ select tests.ev('00000000-0000-4000-8000-000000000001', null, 'startup_stage') $$), '23514', 'evidence for an empty field is refused');
select is(tests.sqlstate_of($$ select tests.ev('00000000-0000-4000-8000-000000000001', null, 'address') $$), '23514', 'an office field cannot be recorded on the company');
select is(tests.sqlstate_of($$ insert into field_evidence (company_id, field, source_url, verified_at)
  values ('00000000-0000-4000-8000-000000000001', 'name', 'http://acme.test', date '2026-09-01') $$), '23514', 'the source must be an https link');
select tests.sqlstate_of($$ update field_evidence set source_url = 'https://other.test' where id = (select id from ids where k = 'name') $$);
select is((select source_url from field_evidence where id = (select id from ids where k = 'name')), 'https://source.test/name',
  'an editor cannot change evidence (row-level security leaves the row untouched)');
select is(tests.sqlstate_of($$ select review_evidence(array[(select id from ids where k = 'name')]) $$), '42501', 'or review it');
select is(tests.sqlstate_of($$ delete from field_evidence $$), null, 'a delete runs');
select is((select count(*)::int from field_evidence), 2, 'but removes nothing: evidence is kept');
reset role;

-- ---------------------------------------------------------------------------
-- Reviewing, and evidence going stale
-- ---------------------------------------------------------------------------

select tests.become('00000000-0000-0000-0000-00000000e002');
select is(review_evidence(array[(select id from ids where k = 'name')]), 1, 'a reviewer reviews evidence');
select is((select reviewed_by::text from field_evidence where id = (select id from ids where k = 'name')), '00000000-0000-0000-0000-00000000e002', 'the reviewer is recorded');
select is(tests.sqlstate_of($$ update field_evidence set verified_at = date '2026-01-01' where id = (select id from ids where k = 'name') $$), '23514',
  'not even a reviewer can change the evidence itself');
select is((select state from evidence_report('00000000-0000-4000-8000-000000000001') where field = 'name'), 'reviewed', 'the name is reviewed');
select is((select state from evidence_report('00000000-0000-4000-8000-000000000001') where field = 'website'), 'claimed', 'the website is claimed');
select is((select state from evidence_report('00000000-0000-4000-8000-000000000001') where field = 'description'), 'missing', 'the description has none');
reset role;
set local app.skip_audit = 'on';
update company set name = 'Acme Ltd' where id = '00000000-0000-4000-8000-000000000001';
set local app.skip_audit = 'off';
select tests.become('00000000-0000-0000-0000-00000000e002');
select is((select state from evidence_report('00000000-0000-4000-8000-000000000001') where field = 'name'), 'stale', 'changing the name makes its evidence stale');
reset role;

-- ---------------------------------------------------------------------------
-- The publication gates (as a reviewer)
-- ---------------------------------------------------------------------------

select tests.become('00000000-0000-0000-0000-00000000e002');
select matches(tests.commit_check($$ update company set status = 'published' where id = '00000000-0000-4000-8000-000000000001' $$),
  'the name needs reviewed evidence \(it is stale\).*the website needs reviewed evidence \(it is claimed\).*at least one office.*description needs reviewed evidence for its current value \(it is missing\)',
  'publishing is refused, with every reason');
select is((select status from company where id = '00000000-0000-4000-8000-000000000001'), 'draft', 'and the company stays a draft');

-- Evidence for the new name, the website reviewed, the type, and the description claimed.
insert into ids values ('name2', tests.ev('00000000-0000-4000-8000-000000000001', null, 'name', date '2026-09-05'));
insert into ids values ('desc', tests.ev('00000000-0000-4000-8000-000000000001', null, 'description', date '2026-09-06'));
insert into ids values ('types', tests.ev('00000000-0000-4000-8000-000000000001', null, 'types', date '2026-09-06'));
select review_evidence(array(select id from field_evidence where company_id = '00000000-0000-4000-8000-000000000001' and field in ('name', 'website') and reviewed_at is null));
select matches(array_to_string(publication_problems('00000000-0000-4000-8000-000000000001'), '; '),
  'at least one office.*the description needs reviewed evidence for its current value \(it is claimed\).*the types needs reviewed evidence for its current value \(it is claimed\)',
  'claimed optional facts are not enough: each needs reviewed evidence');
select review_evidence(array[(select id from ids where k = 'desc'), (select id from ids where k = 'types')]);
select is(publication_problems('00000000-0000-4000-8000-000000000001'),
  array['at least one office needs reviewed evidence for its address and location'], 'with the optional facts reviewed, only the office is missing');

select matches(tests.commit_check($$ update office set status = 'published' where id = '00000000-0000-4000-8000-0000000000a1' $$),
  'address and location need reviewed evidence', 'an office cannot be published without reviewed evidence');
insert into ids values ('addr', tests.ev(null, '00000000-0000-4000-8000-0000000000a1', 'address', date '2026-08-20'));
insert into ids values ('loc', tests.ev(null, '00000000-0000-4000-8000-0000000000a1', 'location', date '2026-08-25'));
select is((select value from field_evidence where id = (select id from ids where k = 'loc')), '12.97000,77.60000', 'location evidence is bound to the point');
select matches(tests.commit_check($$ update office set status = 'published' where id = '00000000-0000-4000-8000-0000000000a1' $$),
  'address and location need reviewed evidence', 'claimed office evidence is not enough');
select review_evidence(array[(select id from ids where k = 'addr'), (select id from ids where k = 'loc')]);
select is(tests.commit_check($$ update office set status = 'published' where id = '00000000-0000-4000-8000-0000000000a1' $$), null, 'with reviewed evidence the office publishes');
select is(tests.commit_check($$ update company set status = 'published' where id = '00000000-0000-4000-8000-000000000001' $$), null, 'and so does the company');
reset role;
select is((select last_verified_at::date from company where id = '00000000-0000-4000-8000-000000000001'), date '2026-08-20',
  'its Verified date is the oldest checked date of the reviewed core facts, not today');
select is((select array_agg(action order by action) from publication_approval where company_id = '00000000-0000-4000-8000-000000000001'),
  array['published'], 'the publication is recorded');
select is((select approved_by::text from publication_approval where office_id = '00000000-0000-4000-8000-0000000000a1'),
  '00000000-0000-0000-0000-00000000e002', 'with the reviewer who approved the office');

select tests.become('00000000-0000-0000-0000-00000000e002');
select matches(tests.commit_check($$ update company_founder set status = 'published' where id = '00000000-0000-4000-8000-0000000000f1' $$),
  'founder''s name needs reviewed evidence', 'a founder cannot be published without reviewed evidence');
with x as (insert into field_evidence (founder_id, field, source_url, verified_at)
  values ('00000000-0000-4000-8000-0000000000f1', 'full_name', 'https://acme.test/team', date '2026-09-02') returning id)
insert into ids select 'founder', id from x;
select review_evidence(array[(select id from ids where k = 'founder')]);
select is(tests.commit_check($$ update company_founder set status = 'published' where id = '00000000-0000-4000-8000-0000000000f1' $$), null,
  'with reviewed evidence the founder publishes');
reset role;

-- ---------------------------------------------------------------------------
-- Records published before evidence existed are flagged, not hidden
-- ---------------------------------------------------------------------------

select tests.become('00000000-0000-0000-0000-00000000e001');
select is((select missing from evidence_gaps() where slug = 'old-co'), 4, 'an old published company with no evidence is flagged (name, website, address, location)');
select is((select count(*) from evidence_gaps() where slug = 'acme'), 0::bigint,
  'a company published under the gate has every populated fact reviewed, so it is not listed');
reset role;
select is((select status from company where slug = 'old-co'), 'published', 'flagging does not unpublish it');

-- ---------------------------------------------------------------------------
-- The CSV import's evidence rules
-- ---------------------------------------------------------------------------

create function tests.row_with(extra jsonb, fields text[]) returns jsonb
language sql as $$
  select jsonb_build_object('name', 'Imp Co', 'domain', 'imp.test', 'city', 'bangalore', 'address', '9 Imp Road', 'lat', 12.95, 'lng', 77.62)
         || jsonb_build_object('evidence', (select coalesce(jsonb_agg(jsonb_build_object('field', f, 'source_url', 'https://imp.test/' || f, 'verified_at', '2026-09-03')), '[]')
                                           from unnest(fields) f))
         || extra;
$$;
grant execute on all functions in schema tests to authenticated;
select tests.become('00000000-0000-0000-0000-00000000e001');
create temp table imp on commit drop as select import_commit('e.csv', jsonb_build_array(
  tests.row_with('{"description": "Imports"}', array['name', 'website', 'address', 'location']),
  tests.row_with('{"domain": "imp2.test"}', array['name', 'website', 'address', 'location', 'sectors']),
  tests.row_with('{"domain": "imp3.test"}', array['name', 'website', 'address']),
  tests.row_with('{"domain": "imp4.test", "evidence": [{"field": "name", "source_url": "https://x.test", "verified_at": "2999-01-01"}]}', array[]::text[]),
  tests.row_with('{"domain": "imp5.test", "sectors": ["fintech"]}', array['name', 'website', 'address', 'location', 'sectors'])
)) as r;
reset role;
select is((select r -> 'results' -> 0 ->> 'message' from imp), 'there is no evidence for the description', 'a filled-in field without evidence is an error');
select is((select r -> 'results' -> 1 ->> 'message' from imp), 'there is evidence for a field this row leaves empty: sectors', 'evidence for an empty field is an error');
select is((select r -> 'results' -> 2 ->> 'message' from imp), 'there is no evidence for the location', 'the office location needs its own evidence');
select matches((select r -> 'results' -> 3 ->> 'message' from imp), 'must be a real past date', 'a future verified date is refused');
select is((select r -> 'results' -> 4 ->> 'result' from imp), 'created', 'a row with evidence for every filled-in field imports');
select is((select string_agg(field || ':' || case when company_id is not null then 'company' else 'office' end, ',' order by field)
           from field_evidence e where e.company_id = (select id from company where domain = 'imp5.test')
              or e.office_id in (select id from office where company_id = (select id from company where domain = 'imp5.test'))),
  'address:office,location:office,name:company,sectors:company,website:company', 'each piece of evidence is stored against its own record');
select is((select count(*)::int from field_evidence e join company c on c.id = e.company_id where c.domain = 'imp5.test' and e.reviewed_at is null and e.verified_at = date '2026-09-03'),
  3, 'imported dates are kept as given, as claims');

select * from finish();
rollback;
