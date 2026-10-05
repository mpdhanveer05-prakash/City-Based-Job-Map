-- P7-02 to P7-04: the audit log, Publish now, the CSV import, and the review queue, tested as each role.
-- Run with `npx supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(68);

-- The seed is loaded by `db reset`; these tests use their own fixtures (TRUNCATE is transactional: the rollback restores it).
truncate public.city, public.source, public.sector, public.company, public.admin_user, public.audit_log, public.import_batch
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
-- Fixtures, written with the audit log off so the tests start from an empty log
-- ---------------------------------------------------------------------------

set local app.skip_audit = 'on';

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000e001'),   -- editor
  ('00000000-0000-0000-0000-00000000e002'),   -- reviewer
  ('00000000-0000-0000-0000-00000000e003'),   -- admin
  ('00000000-0000-0000-0000-00000000e004');   -- signed in, not an admin
insert into admin_user (user_id, role) values
  ('00000000-0000-0000-0000-00000000e001', 'editor'),
  ('00000000-0000-0000-0000-00000000e002', 'reviewer'),
  ('00000000-0000-0000-0000-00000000e003', 'admin');

insert into city (id, slug, name, status, centre, default_zoom, boundary) values
  (1, 'bangalore', 'Bengaluru', 'beta', 'SRID=4326;POINT(77.60 12.97)', 11,
   'SRID=4326;MULTIPOLYGON(((77.40 12.80, 77.80 12.80, 77.80 13.15, 77.40 13.15, 77.40 12.80)))'),
  (2, 'chennai', 'Chennai', 'beta', 'SRID=4326;POINT(80.27 13.08)', 11,
   'SRID=4326;MULTIPOLYGON(((80.10 12.90, 80.35 12.90, 80.35 13.25, 80.10 13.25, 80.10 12.90)))');
insert into neighbourhood (id, city_id, slug, name) values (1, 1, 'koramangala', 'Koramangala');
insert into tech_park (id, city_id, slug, name) values (1, 1, 'etv', 'Embassy Tech Village');
insert into sector (id, slug, name) values (1, 'fintech', 'Fintech');
insert into source (id, name, kind, permission_note) values (1, 'Fixture', 'manual', 'Test fixture');
insert into company (id, slug, name, domain, website_url, status, source_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'pub-co', 'Pub Co', 'pub.test', 'https://pub.test', 'published', 1);
insert into office (id, company_id, city_id, address, geom, accuracy, verification, status) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 1, 'Good Office',
   'SRID=4326;POINT(77.60 12.97)', 'building', 'reviewed', 'published');

set local app.skip_audit = 'off';
select is((select count(*)::int from audit_log), 0, 'the fixtures left the audit log empty');

-- ---------------------------------------------------------------------------
-- The audit log
-- ---------------------------------------------------------------------------

select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
update company set description = 'About Pub Co' where id = '00000000-0000-0000-0000-0000000000c1';
reset role;

select is((select count(*)::int from audit_log where table_name = 'company'), 1, 'an editor''s edit is recorded once');
select is((select action from audit_log where table_name = 'company'), 'update', 'as an update');
select is((select actor from audit_log where table_name = 'company'), '00000000-0000-0000-0000-00000000e001'::uuid, 'by the signed-in user');
select is((select actor_role from audit_log where table_name = 'company'), 'editor', 'with their role at the time');
select is((select row_id from audit_log where table_name = 'company'), '00000000-0000-0000-0000-0000000000c1', 'for the row that changed');
select is((select before ->> 'description' from audit_log where table_name = 'company'), null, 'the snapshot before has the old value (none)');
select is((select after ->> 'description' from audit_log where table_name = 'company'), 'About Pub Co', 'and the snapshot after the new one');
select ok((select not (after ? 'search_doc') from audit_log where table_name = 'company'), 'the big generated search_doc column is left out');

select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
update company set name = name where id = '00000000-0000-0000-0000-0000000000c1';
reset role;
select is((select count(*)::int from audit_log), 1, 'an update that changes nothing is not recorded');

select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
insert into company_type_tag (company_id, type) values ('00000000-0000-0000-0000-0000000000c1', 'startup');
reset role;
select is((select row_id from audit_log where table_name = 'company_type_tag'), '00000000-0000-0000-0000-0000000000c1:startup',
  'a link row is named by its whole key');

-- Back to the owner with no signed-in user (`reset role` keeps the JWT claims of the last become()).
select set_config('request.jwt.claims', '', true);
insert into job (id, company_id, source_id, title, title_norm, apply_url, dedup_hash, status) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 1, 'By pipeline', 'by pipeline', 'https://pub.test/1', '\x01', 'active');
select is((select count(*)::int from audit_log where table_name = 'job'), 0,
  'a job written with no signed-in admin (the pipeline, the owner) is not logged: it is thousands of rows a day');
select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
insert into job (id, company_id, source_id, title, title_norm, apply_url, dedup_hash, status) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 1, 'By editor', 'by editor', 'https://pub.test/2', '\x02', 'draft');
reset role;
select is((select count(*)::int from audit_log where table_name = 'job'), 1, 'a job an admin writes is logged');

select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
delete from job where id = '00000000-0000-0000-0000-0000000000d2';
reset role;
select is((select before ->> 'title' from audit_log where table_name = 'job' and action = 'delete'), 'By editor', 'a delete records what was removed');

set local app.skip_audit = 'on';
insert into sector (id, slug, name) values (2, 'saas', 'SaaS');
set local app.skip_audit = 'off';
select is((select count(*)::int from audit_log where table_name = 'sector'), 0, 'a session that turns app.skip_audit on (the seed) is not logged');

select is(tests.sqlstate_of($$ update audit_log set action = 'insert' $$), '42501', 'the audit log cannot be changed, even by the owner');
select is(tests.sqlstate_of($$ delete from audit_log $$), '42501', 'or emptied row by row');

select tests.become(null, 'anon');
select is(tests.sqlstate_of($$ select * from audit_log $$), '42501', 'anon cannot read the audit log');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
select is((select count(*)::int from audit_log), 0, 'an editor sees none of it');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e002', 'authenticated');
select cmp_ok((select count(*)::int from audit_log), '>=', 3, 'a reviewer reads it');
select is(tests.sqlstate_of($$ insert into audit_log (table_name, row_id, action) values ('x', 'y', 'insert') $$), '42501', 'but cannot write to it');
reset role;

-- ---------------------------------------------------------------------------
-- Publish now
-- ---------------------------------------------------------------------------

select tests.become(null, 'anon');
select is(tests.sqlstate_of($$ select publish_now() $$), '42501', 'anon cannot publish');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
select is(tests.sqlstate_of($$ select publish_now() $$), '42501', 'an editor cannot publish');
select is(tests.sqlstate_of($$ select * from site_state $$), '42501', 'and cannot read the rebuild state');
reset role;

select tests.become('00000000-0000-0000-0000-00000000e002', 'authenticated');
create temp table first_publish on commit drop as select publish_now() as r;
reset role;
select is((select (r ->> 'rebuild')::boolean from first_publish), true, 'a reviewer''s first publish asks for a rebuild');
select is((select r -> 'versions' from first_publish), '{"bangalore": 2, "chennai": 2}'::jsonb, 'every city got a new data version');
select is((select data_version::int from city where slug = 'bangalore'), 2, 'in the database');
select ok((select last_rebuild_requested_at is not null from site_state), 'and the request time is kept');
select is((select count(*)::int from audit_log where action = 'publish_now'), 1, 'the publish is in the audit log');

select tests.become('00000000-0000-0000-0000-00000000e002', 'authenticated');
create temp table second_publish on commit drop as select publish_now() as r;
reset role;
select is((select (r ->> 'rebuild')::boolean from second_publish), false, 'a second publish within ten minutes does not ask again');
select ok((select (r ->> 'retry_after_seconds')::int between 1 and 600 from second_publish), 'and says how long to wait, at most ten minutes');
select is((select data_version::int from city where slug = 'bangalore'), 3, 'the versions still moved on');

select tests.become('00000000-0000-0000-0000-00000000e003', 'authenticated');
select is((select (publish_now(interval '0 seconds') ->> 'rebuild')::boolean), true, 'with no debounce a publish always asks for a rebuild');
reset role;

-- ---------------------------------------------------------------------------
-- CSV import
-- ---------------------------------------------------------------------------

create function tests.csv_row(p_name text, p_domain text, p_address text, extra jsonb default '{}') returns jsonb
language sql as $$
  select jsonb_build_object('name', p_name, 'domain', p_domain, 'city', 'bangalore', 'address', p_address, 'lat', 12.95, 'lng', 77.62,
                            'types', jsonb_build_array('startup'), 'sectors', jsonb_build_array('fintech')) || extra;
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

select tests.become(null, 'anon');
select is(tests.sqlstate_of($$ select import_commit('x.csv', '[]') $$), '42501', 'anon cannot import');
reset role;
select tests.become('00000000-0000-0000-0000-00000000e004', 'authenticated');
select is(tests.sqlstate_of($$ select import_commit('x.csv', '[{}]') $$), '42501', 'a signed-in non-admin cannot import');
reset role;

select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
select is(tests.sqlstate_of($$ select import_commit('x.csv', '[]') $$), '22023', 'an empty import is refused');
select is(tests.sqlstate_of($$ select import_commit('x.csv', '{"a": 1}') $$), '22023', 'so is one that is not an array');
select is(tests.sqlstate_of($$ select import_commit('x.csv', (select jsonb_agg('{}'::jsonb) from generate_series(1, 2001))) $$), '22023', 'and one over 2000 rows');

create temp table imported on commit drop as
select import_commit('fixture.csv', jsonb_build_array(
  tests.csv_row('Acme Pay', 'acme-pay.test', '1 First Road', '{"neighbourhood": "koramangala", "accuracy": "building", "description": "Pays things"}'),
  tests.csv_row('Acme Pay', 'acme-pay.test', '2 Second Road'),
  tests.csv_row('Acme Pay', 'acme-pay.test', '2 second road'),
  tests.csv_row('Acme Pay Two', 'acme-pay-two.test', '3 Third Road', '{"slug": "acme-pay"}'),
  tests.csv_row('', 'noname.test', '4 Fourth Road'),
  tests.csv_row('Bad Domain', 'not a domain', '5 Road'),
  tests.csv_row('No City', 'nocity.test', '6 Road', '{"city": "atlantis"}'),
  tests.csv_row('Bad Lat', 'badlat.test', '7 Road', '{"lat": 123}'),
  tests.csv_row('No Lat', 'nolat.test', '8 Road', '{"lat": null}'),
  tests.csv_row('Bad Hood', 'badhood.test', '9 Road', '{"neighbourhood": "nowhere"}'),
  tests.csv_row('Stage No Startup', 'stage.test', '10 Road', '{"types": ["mnc"], "startup_stage": "seed"}'),
  tests.csv_row('Bad Sector', 'badsector.test', '11 Road', '{"sectors": ["nonsense"]}'),
  tests.csv_row('Bad Type', 'badtype.test', '12 Road', '{"types": ["bogus"]}'),
  tests.csv_row('Bad Accuracy', 'badacc.test', '13 Road', '{"accuracy": "exact"}'),
  tests.csv_row('Outside Co', 'outside.test', '14 Road', '{"lat": 20.0, "lng": 70.0}'),
  tests.csv_row('Park Co', 'park.test', '15 Road', '{"tech_park": "etv", "types": ["mnc", "product"], "startup_stage": null}')
)) as r;
reset role;

select is((select (r ->> 'rows')::int from imported), 16, 'sixteen rows were read');
select is((select (r ->> 'created_companies')::int from imported), 4, 'four companies were created (Acme Pay, Acme Pay Two, Outside Co, Park Co)');
select is((select (r ->> 'attached_offices')::int from imported), 1, 'one row added an office to a company that already existed');
select is((select (r ->> 'skipped')::int from imported), 1, 'one repeated an office address, ignoring case, and was skipped');
select is((select (r ->> 'errors')::int from imported), 10, 'ten rows had errors');
select is((select r -> 'results' -> 1 ->> 'result' from imported), 'attached', 'the second Acme Pay row is the attached one');
select is((select r -> 'results' -> 2 ->> 'result' from imported), 'skipped', 'and the third the skipped one');

select is((select count(*)::int from company where domain = 'acme-pay.test'), 1, 'the company exists once');
select is((select status from company where domain = 'acme-pay.test'), 'draft', 'as a draft: nothing is public until a reviewer publishes');
select is((select count(*)::int from office o join company c on c.id = o.company_id where c.domain = 'acme-pay.test' and o.status = 'draft'), 2, 'with its two draft offices');
select is((select slug from company where domain = 'acme-pay-two.test'), 'acme-pay-2', 'a slug that is taken gets a number');
select is((select array_agg(type::text order by type) from company_type_tag t join company c on c.id = t.company_id where c.domain = 'acme-pay.test'),
  array['startup'], 'the types were saved');
select is((select count(*)::int from company_sector s join company c on c.id = s.company_id where c.domain = 'acme-pay.test'), 1, 'and the sector');
select is((select accuracy from office where address = '1 First Road'), 'building', 'the accuracy the file gave is kept');
select is((select accuracy from office where address = '2 Second Road'), 'locality', 'and the lowest accuracy is assumed when it gave none, so the row reaches the review queue');
select is((select count(*)::int from company where domain in ('badsector.test', 'badtype.test', 'badhood.test', 'stage.test')), 0,
  'a row that fails halfway leaves no company behind');
select is((select r -> 'results' -> 11 ->> 'message' from imported), 'unknown sector "nonsense"', 'the error names the problem');
select is((select r -> 'results' -> 10 ->> 'message' from imported), 'a startup stage needs the type startup', 'including the stage rule');
select is((select count(*)::int from office where address = '14 Road' and status = 'draft'), 1, 'a draft office outside the boundary is accepted (the boundary rule is for publishing)');
select ok((select (error_count = 10 and row_count = 16 and created_companies = 4 and filename = 'fixture.csv') from import_batch), 'the batch row holds the counts and the file name');
select is((select jsonb_array_length(errors) from import_batch), 10, 'and the error list');
select is((select count(*)::int from audit_log where table_name = 'company' and action = 'insert'), 4, 'the imported companies are in the audit log');

select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
select is((select count(*)::int from import_batch), 1, 'an editor reads the import batches');
reset role;
select tests.become(null, 'anon');
select is(tests.sqlstate_of($$ select * from import_batch $$), '42501', 'anon does not');
reset role;

-- ---------------------------------------------------------------------------
-- The review queue
-- ---------------------------------------------------------------------------

select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
select is((select count(*)::int from review_offices where id = '00000000-0000-0000-0000-0000000000b1'), 0, 'a verified office at building accuracy inside the city is not queued');
select is((select reason from review_offices where address = '14 Road'), 'outside the city boundary', 'an office outside the boundary is queued with that reason');
select is((select reason from review_offices where address = '2 Second Road'), 'location below building accuracy', 'a street or locality office is queued for its accuracy');
select is((select reason from review_offices where address = '1 First Road'), 'not yet verified', 'an unverified office at building accuracy is queued for that');
reset role;
select set_config('request.jwt.claims', '', true);
update office set outside_reviewed = true where address = '14 Road';
select tests.become('00000000-0000-0000-0000-00000000e001', 'authenticated');
select is((select reason from review_offices where address = '14 Road'), 'location below building accuracy',
  'once the boundary is reviewed the office stays queued only for what is still wrong');
reset role;
select tests.become(null, 'anon');
select is(tests.sqlstate_of($$ select * from review_offices $$), '42501', 'anon cannot read the queue');
reset role;

select * from finish();
rollback;
