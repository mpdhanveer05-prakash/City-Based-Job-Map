-- Company logos: the bucket, provenance records, review, and the logo_key gate (20261007110000_logo_assets.sql).
-- Run with `npx supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;

-- A Postgres-only database (CI's `supabase db start`) has no storage schema, so the bucket does not exist there: skip.
select to_regclass('storage.objects') is not null and to_regclass('storage.buckets') is not null as has_storage \gset
\if :has_storage
select plan(17);

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;
create function tests.become(uid uuid, aal text default 'aal2') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when uid is null then '' else json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text end, true);
  perform set_config('role', case when uid is null then 'anon' else 'authenticated' end, true);
end;
$$;
create function tests.sqlstate_of(q text) returns text
language plpgsql as $$
begin
  execute q;
  return null;
exception when others then
  return sqlstate;
end;
$$;
grant execute on all functions in schema tests to anon, authenticated;

truncate public.admin_user;
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000109e'), ('00000000-0000-0000-0000-00000000109f');
insert into admin_user (user_id, role) values
  ('00000000-0000-0000-0000-00000000109e', 'editor'),
  ('00000000-0000-0000-0000-00000000109f', 'reviewer');
create temp table t as select id as company from company order by slug limit 1;
grant select on t to anon, authenticated;
create function tests.key(n int) returns text language sql as $$
  select (select company from t)::text || '/' || repeat(n::text, 64) || '.png' $$;
create function tests.record(n int) returns text language sql as $$
  select format($q$insert into logo_asset (company_id, storage_key, content_type, bytes, source_url, permitted_use, permission_url, permission_note, obtained_on)
                values (%L, %L, 'image/png', 1200, 'https://example.test/brand/logo.png', 'company_brand_assets', 'https://example.test/brand',
                        'The brand page offers the logo for press use', date '2026-10-01')$q$, (select company from t), tests.key(n)) $$;

select ok((select public and file_size_limit = 1048576 and not ('image/svg+xml' = any (allowed_mime_types)) from storage.buckets where id = 'company-logos'),
  'the company-logos bucket is public, raster only, at most 1 MB');

-- The file must be uploaded before its record.
select tests.become('00000000-0000-0000-0000-00000000109e');
select is(tests.sqlstate_of(tests.record(1)), '23514', 'a record without its file in the bucket is refused');
reset role;
insert into storage.objects (bucket_id, name) values ('company-logos', tests.key(1)), ('company-logos', tests.key(2));

select tests.become('00000000-0000-0000-0000-00000000109e', 'aal1');
select is(tests.sqlstate_of(tests.record(1)), '42501', 'a password-only session cannot record a logo');
select tests.become('00000000-0000-0000-0000-00000000109e');
select is(tests.sqlstate_of(tests.record(1)), null, 'an editor records the upload with its provenance');
select is(tests.sqlstate_of(format('update company set logo_key = %L where id = %L', tests.key(1), (select company from t))), '23514',
  'an editor cannot make an unreviewed upload the logo');
select is(tests.sqlstate_of(format('select review_logo(%s, %L, %L)', (select max(id) from logo_asset), 'approved', 'ok')), '42501',
  'an editor cannot approve a logo');
select is(tests.sqlstate_of('update logo_asset set permitted_use = ''licensed_provider'''), '42501', 'nobody edits a provenance record directly');
select is(tests.sqlstate_of(format($q$insert into storage.objects (bucket_id, name) values ('company-logos', %L)$q$, (select company from t)::text || '/logo.svg')), '42501',
  'an upload must be a content-addressed raster file under the company''s id');
reset role;

select tests.become(null);
select is(tests.sqlstate_of('select * from logo_asset'), '42501', 'the public cannot read provenance records');
reset role;

select tests.become('00000000-0000-0000-0000-00000000109f');
select is(tests.sqlstate_of(format('select review_logo(%s, %L, %L)', (select max(id) from logo_asset), 'approved', ' ')), '22023',
  'a decision needs a note');
select is(tests.sqlstate_of(format('select review_logo(%s, %L, %L)', (select max(id) from logo_asset), 'approved', 'Brand page checked; current logo')), null,
  'a reviewer approves it');
select is((select logo_key from company where id = (select company from t)), tests.key(1), 'and it becomes the company''s logo');
select is((select self_reviewed from logo_asset order by id desc limit 1), false, 'reviewed by someone other than the uploader');
select is(tests.sqlstate_of(format('select review_logo(%s, %L, %L)', (select max(id) from logo_asset), 'rejected', 'again')), '23514',
  'a decision is final');
select ok(exists (select 1 from audit_log where table_name = 'logo_asset'), 'uploads and decisions are in the audit log');
reset role;

-- A second upload, rejected while another logo is current, leaves the current logo alone.
select tests.become('00000000-0000-0000-0000-00000000109e');
select lives_ok(tests.record(2), 'a second upload is recorded');
reset role;
select tests.become('00000000-0000-0000-0000-00000000109f');
select review_logo((select max(id) from logo_asset), 'rejected', 'Not the current logo');
select is((select logo_key from company where id = (select company from t)), tests.key(1), 'rejecting another upload keeps the approved logo');
reset role;

\else
select plan(1);
select skip('this database has no storage schema (Postgres-only, as in CI); the logo tests run with the full local stack', 1);
\endif

select * from finish();
rollback;
