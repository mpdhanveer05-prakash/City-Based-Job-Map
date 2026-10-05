-- P7-02 to P7-04: what the admin workspace needs from the database (docs/data-model.md, "As built in P7").
--
--   audit_log     before and after snapshots of every change, append-only (ADM06). Written by a trigger, read by
--                 reviewers and above, never written through the API.
--   site_state    one row: when a rebuild was last requested (the debounce for "Publish now").
--   publish_now   a reviewer's release action: bumps every city's data_version (new dataset file URLs) and says whether a
--                 rebuild should be requested now or was already requested in the last ten minutes. The
--                 `request-rebuild` Edge Function calls it as the signed-in user, then dispatches the GitHub workflow.
--   import_batch  one row per CSV import: counts and the row errors (ADM03).
--   import_commit the CSV import, atomic per call and per-row tolerant: valid rows land as drafts, bad rows are reported.
--   review_offices a view of offices that need a human look: low accuracy, unverified, or outside the city boundary (ADM05).

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  -- auth.uid() of the signed-in admin; null for the migration owner, the service role, and the pipeline.
  actor       uuid,
  actor_role  text,
  table_name  text not null,
  row_id      text not null,
  action      text not null check (action in ('insert', 'update', 'delete', 'publish_now', 'import')),
  before      jsonb,
  after       jsonb
);
create index audit_log_at on public.audit_log (at desc);
create index audit_log_row on public.audit_log (table_name, row_id);
alter table public.audit_log enable row level security;

create policy audit_log_reviewer_read on public.audit_log for select to authenticated
  using (public.is_admin('reviewer'));
revoke all on public.audit_log from anon;
revoke insert, update, delete on public.audit_log from authenticated;

-- Append-only: not even the owner changes or removes a row by accident. (TRUNCATE by the owner stays possible, for tests.)
create function public.audit_log_immutable() returns trigger
language plpgsql
as $$
begin
  raise exception 'the audit log is append-only' using errcode = '42501';
end;
$$;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- Records one row per changed row. The primary-key columns come in as the trigger argument (comma separated). Rules:
--   * a no-op update (only updated_at moved) is not recorded;
--   * the big generated `search_doc` column is left out of the snapshots;
--   * the job tables are recorded only for a signed-in admin: the pipeline touches thousands of jobs a day and has its
--     own record (verification_check, P8), so logging it here would fill the free database for nothing;
--   * a session that sets `app.skip_audit = on` (the seed file) is not recorded.
create function public.audit_row_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_row jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - 'search_doc' end;
  new_row jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - 'search_doc' end;
  src     jsonb := coalesce(new_row, old_row);
  rid     text := '';
  col     text;
begin
  if coalesce(current_setting('app.skip_audit', true), '') = 'on' then
    return null;
  end if;
  if tg_table_name in ('job', 'job_city') and auth.uid() is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and (old_row - 'updated_at') = (new_row - 'updated_at') then
    return null;
  end if;
  foreach col in array string_to_array(tg_argv[0], ',') loop
    rid := rid || case when rid = '' then '' else ':' end || coalesce(src ->> col, '');
  end loop;
  insert into audit_log (actor, actor_role, table_name, row_id, action, before, after)
  values (
    auth.uid(),
    (select a.role from admin_user a where a.user_id = auth.uid()),
    tg_table_name, rid, lower(tg_op), old_row, new_row
  );
  return null;
end;
$$;

do $$
declare
  spec text[];
begin
  foreach spec slice 1 in array array[
    array['company', 'id'], array['office', 'id'], array['job', 'id'], array['company_founder', 'id'],
    array['company_type_tag', 'company_id,type'], array['company_sector', 'company_id,sector_id'],
    array['job_city', 'job_id,city_id'], array['slug_redirect', 'old_slug'],
    array['city', 'id'], array['neighbourhood', 'id'], array['tech_park', 'id'], array['sector', 'id'],
    array['source', 'id'], array['admin_user', 'user_id']
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change(%L)',
      'audit_' || spec[1], spec[1], spec[2]
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Publish now
-- ---------------------------------------------------------------------------

create table public.site_state (
  id                         boolean primary key default true check (id),
  last_rebuild_requested_at  timestamptz
);
insert into public.site_state (id) values (true);
alter table public.site_state enable row level security;
revoke all on public.site_state from anon, authenticated;
-- Nobody reads or writes it through the API; only publish_now (SECURITY DEFINER) does. The explicit deny keeps every table
-- in public with a policy, which a test in 02_rls checks.
create policy site_state_no_access on public.site_state for all to anon, authenticated using (false) with check (false);

-- A reviewer's "Publish now". Every city gets a new data_version, so the next build writes dataset files under new URLs.
-- `rebuild` is true when the caller should request a build now, and false when one was requested within `p_debounce`
-- (the ten-minute debounce of ADR-0006): that earlier build has not read these changes yet, but the next one will.
-- SECURITY DEFINER because only an admin may change `city`; the role check is the first thing it does.
create function public.publish_now(p_debounce interval default interval '10 minutes') returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requested boolean;
  versions  jsonb;
  waited    interval;
begin
  if not is_admin('reviewer') then
    raise exception 'publishing needs a reviewer' using errcode = '42501';
  end if;

  -- `where true`: PostgREST's safe-update guard refuses an UPDATE with no WHERE, even inside a function it calls.
  update city set data_version = data_version + 1 where true;
  select jsonb_object_agg(slug, data_version) into versions from city;

  update site_state set last_rebuild_requested_at = now()
  where last_rebuild_requested_at is null or last_rebuild_requested_at <= now() - p_debounce
  returning true into requested;
  requested := coalesce(requested, false);

  select now() - last_rebuild_requested_at into waited from site_state;
  insert into audit_log (actor, actor_role, table_name, row_id, action, after)
  values (
    auth.uid(), (select a.role from admin_user a where a.user_id = auth.uid()),
    'site_state', 'publish_now', 'publish_now',
    jsonb_build_object('versions', versions, 'rebuild_requested', requested)
  );

  return jsonb_build_object(
    'versions', coalesce(versions, '{}'::jsonb),
    'rebuild', requested,
    'retry_after_seconds', case when requested then 0 else greatest(0, ceil(extract(epoch from (p_debounce - waited))))::int end
  );
end;
$$;
revoke all on function public.publish_now(interval) from public, anon;
grant execute on function public.publish_now(interval) to authenticated;

-- ---------------------------------------------------------------------------
-- CSV import
-- ---------------------------------------------------------------------------

create table public.import_batch (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid(),
  kind               text not null default 'csv' check (kind in ('csv', 'pipeline')),
  filename           text not null,
  row_count          integer not null,
  created_companies  integer not null default 0,
  attached_offices   integer not null default 0,
  skipped            integer not null default 0,
  error_count        integer not null default 0,
  errors             jsonb not null default '[]'::jsonb
);
alter table public.import_batch enable row level security;
create policy import_batch_editor_read on public.import_batch for select to authenticated
  using (public.is_admin('editor'));
create policy import_batch_editor_insert on public.import_batch for insert to authenticated
  with check (public.is_admin('editor'));
revoke all on public.import_batch from anon;
revoke update, delete on public.import_batch from authenticated;

-- A company name as a slug: lower case, letters and digits, single hyphens.
create function public.slugify(p_text text) returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'));
$$;

-- Imports companies and their first office from rows of this shape (the CSV columns, after the browser has parsed and
-- checked them):
--   name, domain, website_url, careers_url, description, types[], startup_stage, sectors[] (slugs),
--   city (slug), address, lat, lng, accuracy, neighbourhood (slug), tech_park (slug)
-- Everything lands as a DRAFT: nothing is public until a reviewer publishes it. A row whose domain is already a company
-- adds its office to that company (unless the same address is already there); a new domain creates the company. Each row
-- runs in its own sub-transaction, so one bad row is reported and the others still go in. SECURITY INVOKER: every insert
-- is checked by row-level security as the caller, so only an editor or above gets anywhere.
create function public.import_commit(p_filename text, p_rows jsonb) returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  r             jsonb;
  i             integer := 0;
  results       jsonb := '[]'::jsonb;
  errors        jsonb := '[]'::jsonb;
  n_created     integer := 0;
  n_attached    integer := 0;
  n_skipped     integer := 0;
  n_errors      integer := 0;
  v_name        text;
  v_domain      text;
  v_city_id     smallint;
  v_hood_id     integer;
  v_park_id     integer;
  v_company_id  uuid;
  v_slug        text;
  v_base        text;
  v_n           integer;
  v_types       text[];
  v_stage       text;
  v_lat         double precision;
  v_lng         double precision;
  v_accuracy    text;
  v_address     text;
  v_batch_id    uuid;
  v_sector      text;
begin
  if not is_admin('editor') then
    raise exception 'importing needs an admin role' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'there are no rows to import' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'an import is limited to 2000 rows' using errcode = '22023';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      v_name := trim(coalesce(r ->> 'name', ''));
      v_domain := lower(trim(coalesce(r ->> 'domain', '')));
      v_address := trim(coalesce(r ->> 'address', ''));
      if v_name = '' or length(v_name) > 200 then raise exception 'the company name is missing or too long'; end if;
      if v_address = '' then raise exception 'the address is missing'; end if;
      if v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
        raise exception 'the domain "%" is not a valid host name', v_domain;
      end if;

      select id into v_city_id from city where slug = r ->> 'city';
      if v_city_id is null then raise exception 'unknown city "%"', coalesce(r ->> 'city', ''); end if;
      v_lat := (r ->> 'lat')::double precision;
      v_lng := (r ->> 'lng')::double precision;
      if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
        raise exception 'the latitude or longitude is missing or out of range';
      end if;
      v_accuracy := coalesce(nullif(trim(r ->> 'accuracy'), ''), 'locality');
      if v_accuracy not in ('rooftop', 'building', 'campus', 'street', 'locality') then
        raise exception 'unknown accuracy "%"', v_accuracy;
      end if;

      v_hood_id := null;
      if nullif(trim(r ->> 'neighbourhood'), '') is not null then
        select id into v_hood_id from neighbourhood where city_id = v_city_id and slug = trim(r ->> 'neighbourhood');
        if v_hood_id is null then raise exception 'unknown neighbourhood "%" in this city', r ->> 'neighbourhood'; end if;
      end if;
      v_park_id := null;
      if nullif(trim(r ->> 'tech_park'), '') is not null then
        select id into v_park_id from tech_park where city_id = v_city_id and slug = trim(r ->> 'tech_park');
        if v_park_id is null then raise exception 'unknown tech park "%" in this city', r ->> 'tech_park'; end if;
      end if;

      select id into v_company_id from company where domain = v_domain;

      if v_company_id is not null then
        -- Known company: add the office unless the same address is already there.
        if exists (select 1 from office o where o.company_id = v_company_id and o.city_id = v_city_id and lower(o.address) = lower(v_address)) then
          n_skipped := n_skipped + 1;
          results := results || jsonb_build_object('row', i, 'result', 'skipped', 'message', 'this office is already listed for ' || v_domain);
          continue;
        end if;
        insert into office (company_id, city_id, neighbourhood_id, tech_park_id, address, geom, accuracy, verification, status)
        values (v_company_id, v_city_id, v_hood_id, v_park_id, v_address,
                st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography, v_accuracy, 'unverified', 'draft');
        n_attached := n_attached + 1;
        results := results || jsonb_build_object('row', i, 'result', 'attached', 'message', 'office added to the existing company ' || v_domain);
        continue;
      end if;

      -- New company.
      v_types := coalesce(array(select jsonb_array_elements_text(coalesce(r -> 'types', '[]'::jsonb))), array[]::text[]);
      v_stage := nullif(trim(r ->> 'startup_stage'), '');
      if v_stage is not null and not ('startup' = any (v_types)) then
        raise exception 'a startup stage needs the type startup';
      end if;
      v_base := slugify(coalesce(nullif(trim(r ->> 'slug'), ''), v_name));
      if v_base = '' then raise exception 'the name has no letters or digits for a slug'; end if;
      v_slug := v_base;
      v_n := 1;
      while exists (select 1 from company where slug = v_slug) or exists (select 1 from slug_redirect where old_slug = v_slug) loop
        v_n := v_n + 1;
        v_slug := v_base || '-' || v_n;
      end loop;

      insert into company (slug, name, domain, description, startup_stage, website_url, careers_url, status)
      values (v_slug, v_name, v_domain, nullif(trim(r ->> 'description'), ''), v_stage::startup_stage,
              coalesce(nullif(trim(r ->> 'website_url'), ''), 'https://' || v_domain),
              nullif(trim(r ->> 'careers_url'), ''), 'draft')
      returning id into v_company_id;

      insert into company_type_tag (company_id, type) select v_company_id, t::company_type from unnest(v_types) t;
      for v_sector in select jsonb_array_elements_text(coalesce(r -> 'sectors', '[]'::jsonb)) loop
        insert into company_sector (company_id, sector_id)
        select v_company_id, s.id from sector s where s.slug = v_sector;
        if not found then raise exception 'unknown sector "%"', v_sector; end if;
      end loop;

      insert into office (company_id, city_id, neighbourhood_id, tech_park_id, address, geom, accuracy, verification, status)
      values (v_company_id, v_city_id, v_hood_id, v_park_id, v_address,
              st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography, v_accuracy, 'unverified', 'draft');
      n_created := n_created + 1;
      results := results || jsonb_build_object('row', i, 'result', 'created', 'message', 'company ' || v_slug || ' created as a draft');
    exception when others then
      n_errors := n_errors + 1;
      errors := errors || jsonb_build_object('row', i, 'message', sqlerrm);
      results := results || jsonb_build_object('row', i, 'result', 'error', 'message', sqlerrm);
    end;
  end loop;

  insert into import_batch (kind, filename, row_count, created_companies, attached_offices, skipped, error_count, errors)
  values ('csv', left(coalesce(nullif(trim(p_filename), ''), 'import.csv'), 200), i, n_created, n_attached, n_skipped, n_errors, errors)
  returning id into v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id, 'rows', i, 'created_companies', n_created, 'attached_offices', n_attached,
    'skipped', n_skipped, 'errors', n_errors, 'results', results
  );
end;
$$;
revoke all on function public.import_commit(text, jsonb) from public, anon;
grant execute on function public.import_commit(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Review queue: offices that need a person to look (ADM05)
-- ---------------------------------------------------------------------------

-- security_invoker: the view reads as the caller, so row-level security still applies (an editor sees what an editor can).
create view public.review_offices with (security_invoker = true) as
select
  o.id,
  o.company_id,
  c.name as company_name,
  c.slug as company_slug,
  ci.slug as city_slug,
  ci.name as city_name,
  o.address,
  o.accuracy,
  o.verification,
  o.status,
  o.outside_reviewed,
  st_covers(ci.boundary, o.geom) as inside_city,
  st_y(o.geom::geometry) as lat,
  st_x(o.geom::geometry) as lng,
  case
    when not st_covers(ci.boundary, o.geom) and not o.outside_reviewed then 'outside the city boundary'
    when o.accuracy in ('street', 'locality') then 'location below building accuracy'
    when o.verification = 'unverified' then 'not yet verified'
  end as reason
from public.office o
join public.company c on c.id = o.company_id
join public.city ci on ci.id = o.city_id
where o.status <> 'unpublished'
  and (
    (not st_covers(ci.boundary, o.geom) and not o.outside_reviewed)
    or o.accuracy in ('street', 'locality')
    or o.verification = 'unverified'
  );
revoke all on public.review_offices from anon;
