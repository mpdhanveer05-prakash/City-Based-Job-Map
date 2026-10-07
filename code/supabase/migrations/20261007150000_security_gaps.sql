-- Closes the gaps found on 7 Oct 2026 (PROJECT_HANDOVER.md §5.6), each demonstrated first on the disposable test stack as
-- the role that could reach it:
--
--   SEC-1  An aal2 editor could UPDATE a public company's type tag or sector, or a public job's city, without reviewed
--          evidence: the change gate fired only on INSERT and DELETE. It now fires on UPDATE too, for the old and new parent.
--   SEC-2  A reviewer could copy an UNDECIDED logo into the public bucket and then reject it, leaving it public. A file may
--          now enter the public bucket only after the logo is approved, and becomes the company's logo only through
--          activate_logo, which checks the public copy matches the reviewed upload.
--   SEC-3  The pipeline role could make a job active with no approved feed and no evidence: the gates applied only to a
--          signed-in user. A job the pipeline lists now needs, at commit, an approved active feed of a published company
--          for its company and source, and evidence (claimed or reviewed) for title, employer, location and link: the
--          ADR-0022 automation, enforced by the database instead of only by the pipeline code.
--   SEC-4  A caller with no signed-in user other than the database owner (in practice service_role, the key the Edge
--          Functions hold) could insert evidence already marked reviewed, publish without evidence, approve a feed, and
--          set any logo_key. Those now need a signed-in admin with the right role; the owner (migrations, seed, pg_cron,
--          the SQL editor) keeps them.
--   Publication loophole: a company could publish when its only reviewed office was a DRAFT (any city). It now needs a
--          PUBLISHED office with reviewed address and location.
--   City listings: a company is listed in a city only through a published office there with reviewed address and location
--          evidence for its current values (synthetic sample records excepted: they carry no evidence, are labelled, and
--          no release build accepts them).

-- ---------------------------------------------------------------------------
-- Who is calling
-- ---------------------------------------------------------------------------

-- The role the request runs as. Inside a SECURITY DEFINER function current_user is the owner, but the `role` setting still
-- names the caller (PostgREST sets it to anon, authenticated or service_role; `set role pipeline` does the same). A session
-- that never set a role is its login role.
create function public.caller_role() returns text
language sql
stable
set search_path = pg_catalog
as $$
  select case when current_setting('role') = 'none' then session_user::text else current_setting('role') end;
$$;

-- The database owner: migrations, the seed, pg_cron, and the dashboard SQL editor.
create function public.caller_is_owner() returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select public.caller_role() in ('postgres', 'supabase_admin');
$$;

-- The pipeline role, or a login that inherits it (each environment's pipeline login, created `in role pipeline`).
create function public.caller_is_pipeline() returns boolean
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  r text := public.caller_role();
begin
  if r = 'pipeline' then
    return true;
  end if;
  if r in ('postgres', 'supabase_admin', 'anon', 'authenticated', 'service_role', 'authenticator')
     or not exists (select 1 from pg_roles where rolname = r) then
    return false;
  end if;
  return pg_has_role(r, 'pipeline', 'USAGE');
end;
$$;
grant execute on function public.caller_role(), public.caller_is_owner(), public.caller_is_pipeline() to public;

-- ---------------------------------------------------------------------------
-- SEC-4 and SEC-3: publishing needs a signed-in reviewer, except the owner, and the pipeline for jobs
-- ---------------------------------------------------------------------------

create or replace function public.require_reviewer_to_publish() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  public_states text[] := case tg_table_name when 'job' then array['active', 'suspect'] else array['published'] end;
  enters boolean := new.status = any (public_states) and (tg_op = 'INSERT' or not (old.status = any (public_states)));
  involves boolean := (tg_op = 'INSERT' and new.status = any (public_states))
                      or (tg_op = 'UPDATE' and new.status is distinct from old.status
                          and (new.status = any (public_states) or old.status = any (public_states)));
begin
  if not involves then
    return new;
  end if;
  if (select auth.uid()) is null then
    if public.caller_is_owner() then
      return new;
    end if;
    -- Jobs: the pipeline lists and closes feed jobs (pipeline_job_gate holds it to the feed rules at commit), and a
    -- service caller may close one (the stale sweep). Nothing else is published or unpublished without a person.
    if tg_table_name = 'job' and (public.caller_is_pipeline() or not enters) then
      return new;
    end if;
    raise exception 'only a signed-in reviewer or admin can publish or unpublish (caller: %)', public.caller_role()
      using errcode = 'insufficient_privilege';
  end if;
  if not public.is_admin('reviewer') then
    if tg_op = 'INSERT' then
      raise exception 'only a reviewer or admin can create a record in its public state' using errcode = 'insufficient_privilege';
    end if;
    raise exception 'only a reviewer or admin can publish or unpublish' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Publication loophole: the reviewed office must be PUBLISHED
-- ---------------------------------------------------------------------------

create or replace function public.publication_problems(p_company uuid) returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(problem order by ord), '{}')
  from (
    select 1 as ord, format('the %s needs reviewed evidence (it is %s)', r.field, r.state) as problem
    from evidence_report(p_company) r
    where r.record_type = 'company' and r.field in ('name', 'website') and r.state <> 'reviewed'
    union all
    select 2, 'at least one published office needs reviewed evidence for its address and location (publish the office first)'
    where not exists (
      select 1 from office o where o.company_id = p_company and o.status = 'published'
        and reviewed_as_of(null, o.id, array['address', 'location']) is not null)
    union all
    select 3, format('the %s needs reviewed evidence for its current value (it is %s); remove it to leave it unknown',
                     replace(r.field, '_', ' '), r.state)
    from evidence_report(p_company) r
    where r.record_type = 'company' and r.field not in ('name', 'website') and r.state <> 'reviewed'
  ) p;
$$;

-- ---------------------------------------------------------------------------
-- City listings: a published office with reviewed address and location, in that city
-- ---------------------------------------------------------------------------

-- Whether an office counts for its company's listing in the office's city. SECURITY DEFINER because the build reads the
-- listing as anon, which cannot read evidence; it answers only yes or no.
create function public.listed_office(p_office uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from office o join company c on c.id = o.company_id
    where o.id = p_office and o.status = 'published' and c.status = 'published'
      and (c.is_synthetic or reviewed_as_of(null, o.id, array['address', 'location']) is not null));
$$;
grant execute on function public.listed_office(uuid) to anon, authenticated;

create or replace function public.company_search_fields(p_company uuid, p_city smallint) returns setof text
language sql
stable
as $$
  select lower(c.name) from public.company c where c.id = p_company
  union all
  select lower(j.title)
    from public.job j
    join public.job_city jc on jc.job_id = j.id and jc.city_id = p_city
    where j.company_id = p_company and j.status = 'active'
  union all
  select lower(n.name)
    from public.office o join public.neighbourhood n on n.id = o.neighbourhood_id
    where o.company_id = p_company and o.city_id = p_city and public.listed_office(o.id)
  union all
  select lower(t.name)
    from public.office o join public.tech_park t on t.id = o.tech_park_id
    where o.company_id = p_company and o.city_id = p_city and public.listed_office(o.id)
  union all
  select lower(o.address)
    from public.office o
    where o.company_id = p_company and o.city_id = p_city and public.listed_office(o.id)
  union all
  select lower(f.full_name)
    from public.company_founder f
    where f.company_id = p_company and f.status = 'published';
$$;

create or replace function public.company_filter_parsed(p_city smallint, args public.filter_args)
returns setof uuid
language sql
stable
as $$
  select c.id
  from public.company c
  where c.status = 'published'
    and exists (
      select 1 from public.office o
      where o.company_id = c.id and o.city_id = p_city and public.listed_office(o.id)
    )
    and (
      coalesce(cardinality(args.types), 0) = 0
      or exists (
        select 1 from public.company_type_tag t
        where t.company_id = c.id
          and t.type = any (args.types)
          and (
            t.type <> 'startup'
            or coalesce(cardinality(args.stages), 0) = 0
            or c.startup_stage = any (args.stages)
          )
      )
    )
    and (
      coalesce(cardinality(args.statuses), 0) = 0
      or c.ownership_status = any (args.statuses)
    )
    and (
      coalesce(cardinality(args.neighbourhoods), 0) = 0
      or exists (
        select 1 from public.office o join public.neighbourhood n on n.id = o.neighbourhood_id
        where o.company_id = c.id and o.city_id = p_city and public.listed_office(o.id)
          and n.slug = any (args.neighbourhoods)
      )
    )
    and (
      coalesce(cardinality(args.tech_parks), 0) = 0
      or exists (
        select 1 from public.office o join public.tech_park t on t.id = o.tech_park_id
        where o.company_id = c.id and o.city_id = p_city and public.listed_office(o.id)
          and t.slug = any (args.tech_parks)
      )
    )
    and (
      coalesce(cardinality(args.sectors), 0) = 0
      or exists (
        select 1 from public.company_sector cs join public.sector s on s.id = cs.sector_id
        where cs.company_id = c.id and s.slug = any (args.sectors)
      )
    )
    and not exists (
      select 1 from unnest(args.tokens) tok
      where not exists (
        select 1 from public.company_search_fields(c.id, p_city) f where strpos(f, tok) > 0
      )
    );
$$;

create or replace function public.city_points(city_slug text, filters jsonb default '{}')
returns table (office_id uuid, company_id uuid, lng double precision, lat double precision, accuracy text)
language sql
stable
as $$
  select o.id, o.company_id,
         extensions.st_x(o.geom::extensions.geometry),
         extensions.st_y(o.geom::extensions.geometry),
         o.accuracy
  from public.company_filter(city_slug, filters) f
  join public.city ci on ci.slug = city_slug
  join public.office o on o.company_id = f and o.city_id = ci.id and public.listed_office(o.id)
  order by o.id;
$$;

create or replace function public.search_companies(
  city_slug text,
  filters jsonb default '{}',
  result_limit int default 50,
  result_offset int default 0
)
returns table (
  company_id uuid, slug text, name text, logo_key text,
  types text[], startup_stage text, ownership_status text, office_count int, open_job_count int
)
language sql
stable
as $$
  select
    c.id, c.slug, c.name, c.logo_key,
    coalesce((select array_agg(t.type::text order by t.type)
              from public.company_type_tag t where t.company_id = c.id), '{}'),
    c.startup_stage::text,
    c.ownership_status::text,
    (select count(*)::int from public.office o
      where o.company_id = c.id and o.city_id = ci.id and public.listed_office(o.id)),
    (select count(distinct j.id)::int from public.job j
      join public.job_city jc on jc.job_id = j.id and jc.city_id = ci.id
      where j.company_id = c.id and j.status = 'active')
  from public.company_filter(city_slug, filters) f
  join public.company c on c.id = f
  join public.city ci on ci.slug = city_slug
  order by lower(c.name) collate "C", c.id
  limit greatest(result_limit, 0) offset greatest(result_offset, 0);
$$;

-- city_build_snapshot: the same as 20261006150000, with the offices list limited to listed offices.
create or replace function public.city_build_snapshot(city_slug text) returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  ci public.city;
begin
  select * into ci from city where slug = city_slug;
  if not found then
    return null;
  end if;

  return (
    with cand as (
      select c.*
      from company c
      where c.id in (select company_filter(city_slug, '{}'))
    )
    select jsonb_build_object(
      'version', 1,
      'city', jsonb_build_object(
        'slug', ci.slug,
        'name', ci.name,
        'aliases', to_jsonb(ci.aliases),
        'status', ci.status,
        'centre', jsonb_build_array(st_x(ci.centre::geometry), st_y(ci.centre::geometry)),
        'default_zoom', ci.default_zoom,
        'data_version', ci.data_version,
        'boundary', st_asgeojson(st_multi(st_simplifypreservetopology(ci.boundary::geometry, 0.0005)), 5)::jsonb
      ),
      'synthetic_companies', (select count(*) from cand where is_synthetic),
      'neighbourhoods', coalesce((
        select jsonb_agg(jsonb_build_object('slug', n.slug, 'name', n.name) order by n.slug)
        from neighbourhood n where n.city_id = ci.id), '[]'::jsonb),
      'tech_parks', coalesce((
        select jsonb_agg(jsonb_build_object('slug', t.slug, 'name', t.name) order by t.slug)
        from tech_park t where t.city_id = ci.id), '[]'::jsonb),
      'sectors', coalesce((
        select jsonb_agg(jsonb_build_object('slug', s.slug, 'name', s.name) order by s.slug)
        from sector s), '[]'::jsonb),
      'companies', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'slug', c.slug,
            'name', c.name,
            'logo_key', c.logo_key,
            'description', c.description,
            'website_url', c.website_url,
            'careers_url', c.careers_url,
            'startup_stage', c.startup_stage,
            'ownership_status', c.ownership_status,
            -- Whether the company's required evidence is complete (ADR-0022). The build keeps it out of the public files.
            'evidence_complete', coalesce(company_evidence_complete(c.id), false),
            'last_verified_at', c.last_verified_at,
            'types', coalesce((select to_jsonb(array_agg(tt.type::text order by tt.type))
                               from company_type_tag tt where tt.company_id = c.id), '[]'::jsonb),
            'sectors', coalesce((select to_jsonb(array_agg(s.slug order by s.slug))
                                 from company_sector cs join sector s on s.id = cs.sector_id
                                 where cs.company_id = c.id), '[]'::jsonb),
            'founders', coalesce((select to_jsonb(array_agg(f.full_name order by f.full_name, f.id))
                                  from company_founder f
                                  where f.company_id = c.id and f.status = 'published'), '[]'::jsonb)
          )
          order by c.slug)
        from cand c), '[]'::jsonb),
      'offices', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'company_id', o.company_id,
            'lng', st_x(o.geom::geometry),
            'lat', st_y(o.geom::geometry),
            'accuracy', o.accuracy,
            'address', o.address,
            'neighbourhood', n.slug,
            'tech_park', t.slug
          )
          order by o.id)
        from office o
        join cand c on c.id = o.company_id
        left join neighbourhood n on n.id = o.neighbourhood_id
        left join tech_park t on t.id = o.tech_park_id
        where o.city_id = ci.id and public.listed_office(o.id)), '[]'::jsonb),
      'jobs', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', j.id,
            'company_id', j.company_id,
            'title', j.title,
            'apply_url', j.apply_url,
            'status', j.status,
            'last_checked_at', j.last_checked_at,
            -- The last successful check, and whether the job's evidence is complete (ADR-0022).
            'last_ok_at', j.last_ok_at,
            'evidence_complete', coalesce(job_evidence_complete(j.id), false)
          )
          order by j.id)
        from job j
        join cand c on c.id = j.company_id
        where j.status in ('active', 'suspect')
          and exists (select 1 from job_city jc where jc.job_id = j.id and jc.city_id = ci.id)), '[]'::jsonb),
      -- Old slugs of these companies, each pointing at the current slug (the build writes them to _redirects).
      'slug_redirects', coalesce((
        select jsonb_agg(jsonb_build_object('old_slug', r.old_slug, 'new_slug', c.slug) order by r.old_slug)
        from slug_redirect r join cand c on c.id = r.company_id), '[]'::jsonb)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- SEC-1 (and SEC-4): the change gate covers UPDATE on tags, sectors and job cities, and untrusted callers
-- ---------------------------------------------------------------------------

create or replace function public.published_change_gate() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed text[] := '{}';
  pub boolean;
  parent uuid;
begin
  if auth.uid() is null then
    -- The owner is trusted; the pipeline is held to the feed rules by pipeline_job_gate. Anyone else (service_role) is
    -- held to the same rule as a signed-in admin.
    if public.caller_is_owner() or public.caller_is_pipeline() then
      return null;
    end if;
  end if;
  if tg_table_name = 'company' then
    select status = 'published' into pub from company where id = new.id;
    if not coalesce(pub, false) or old.status is distinct from 'published' then return null; end if;
    if new.name is distinct from old.name then changed := changed || 'name'::text; end if;
    if new.website_url is distinct from old.website_url then changed := changed || 'website'::text; end if;
    if nullif(btrim(new.description), '') is distinct from nullif(btrim(old.description), '') then changed := changed || 'description'::text; end if;
    if new.startup_stage is distinct from old.startup_stage then changed := changed || 'startup_stage'::text; end if;
    if new.ownership_status is distinct from old.ownership_status then changed := changed || 'ownership_status'::text; end if;
    perform require_reviewed_values(new.id, null, null, null, changed);
  elsif tg_table_name = 'office' then
    select status = 'published' into pub from office where id = new.id;
    if not coalesce(pub, false) or old.status is distinct from 'published' then return null; end if;
    if new.address is distinct from old.address then changed := changed || 'address'::text; end if;
    if not extensions.st_equals(new.geom::extensions.geometry, old.geom::extensions.geometry) then changed := changed || 'location'::text; end if;
    perform require_reviewed_values(null, new.id, null, null, changed);
  elsif tg_table_name = 'company_founder' then
    select status = 'published' into pub from company_founder where id = new.id;
    if not coalesce(pub, false) or old.status is distinct from 'published' then return null; end if;
    if new.full_name is distinct from old.full_name then perform require_reviewed_values(null, null, new.id, null, array['full_name']); end if;
  elsif tg_table_name = 'job' then
    select status in ('active', 'suspect') into pub from job where id = new.id;
    if not coalesce(pub, false) or old.status not in ('active', 'suspect') then return null; end if;
    if new.title is distinct from old.title then changed := changed || 'title'::text; end if;
    if new.apply_url is distinct from old.apply_url then changed := changed || 'apply_url'::text; end if;
    if new.company_id is distinct from old.company_id then changed := changed || 'employer'::text; end if;
    if new.work_mode is distinct from old.work_mode then changed := changed || 'location'::text; end if;
    perform require_reviewed_values(null, null, null, new.id, changed);
  elsif tg_table_name in ('company_type_tag', 'company_sector') then
    -- INSERT, DELETE, and (SEC-1) UPDATE: every company the row belonged to before or after.
    foreach parent in array array_remove(array[new.company_id, case when old.company_id is distinct from new.company_id then old.company_id end], null) loop
      select status = 'published' into pub from company where id = parent;
      if coalesce(pub, false) then
        perform require_reviewed_values(parent, null, null, null,
                                        array[case when tg_table_name = 'company_type_tag' then 'types' else 'sectors' end]);
      end if;
    end loop;
  elsif tg_table_name = 'job_city' then
    foreach parent in array array_remove(array[new.job_id, case when old.job_id is distinct from new.job_id then old.job_id end], null) loop
      select status in ('active', 'suspect') into pub from job where id = parent;
      if coalesce(pub, false) then
        perform require_reviewed_values(null, null, null, parent, array['location']);
      end if;
    end loop;
  end if;
  return null;
end;
$$;

drop trigger company_type_tag_published_change on public.company_type_tag;
drop trigger company_sector_published_change on public.company_sector;
drop trigger job_city_published_change on public.job_city;
create constraint trigger company_type_tag_published_change after insert or update or delete on public.company_type_tag
  deferrable initially deferred for each row execute function public.published_change_gate();
create constraint trigger company_sector_published_change after insert or update or delete on public.company_sector
  deferrable initially deferred for each row execute function public.published_change_gate();
create constraint trigger job_city_published_change after insert or update or delete on public.job_city
  deferrable initially deferred for each row execute function public.published_change_gate();

-- ---------------------------------------------------------------------------
-- SEC-3: the pipeline lists a job only from an approved feed, with evidence (ADR-0022 §7, now in the database)
-- ---------------------------------------------------------------------------

create function public.pipeline_job_problems(p_job uuid) returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(problem order by ord), '{}')
  from (
    select 1 as ord, 'the employer is not a published company' as problem
    from job j where j.id = p_job and not exists (select 1 from company c where c.id = j.company_id and c.status = 'published')
    union all
    select 2, 'it does not come from an approved, active feed of its company and source'
    from job j where j.id = p_job and not exists (
      select 1 from job_feed f where f.company_id = j.company_id and f.source_id = j.source_id and f.active and f.approved_at is not null)
    union all
    select 3, format('its %s has no evidence for its current value (it is %s)', replace(f, '_', ' '), s.state)
    from unnest(array['title', 'employer', 'location', 'apply_url']) f
    cross join lateral field_evidence_state(null, null, null, p_job, f) s
    where s.state not in ('claimed', 'reviewed')
  ) p;
$$;
revoke all on function public.pipeline_job_problems(uuid) from public, anon, authenticated;

create function public.pipeline_job_gate() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jid uuid;
  st text;
  problems text[];
begin
  if (select auth.uid()) is not null or not public.caller_is_pipeline() then
    return null;
  end if;
  if tg_table_name = 'job_city' then
    jid := coalesce(new.job_id, old.job_id);
  else
    jid := new.id;
    -- A link check moving a job between active and suspect changes no fact: nothing to prove.
    if tg_op = 'UPDATE' and old.status in ('active', 'suspect')
       and (new.title, new.apply_url, new.company_id, new.source_id, new.work_mode)
           is not distinct from (old.title, old.apply_url, old.company_id, old.source_id, old.work_mode) then
      return null;
    end if;
  end if;
  select status into st from job where id = jid;
  if st is null or st not in ('active', 'suspect') then
    return null;
  end if;
  problems := pipeline_job_problems(jid);
  if cardinality(problems) > 0 then
    raise exception 'the pipeline may list a job only from an approved feed, with evidence: %', array_to_string(problems, '; ')
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger job_pipeline_gate after insert or update on public.job
  deferrable initially deferred for each row execute function public.pipeline_job_gate();
create constraint trigger job_city_pipeline_gate after insert or update or delete on public.job_city
  deferrable initially deferred for each row execute function public.pipeline_job_gate();

-- ---------------------------------------------------------------------------
-- SEC-4: evidence, feed approval and logo keys from callers with no signed-in user
-- ---------------------------------------------------------------------------

create or replace function public.field_evidence_guard() returns trigger
language plpgsql
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is not null and not is_admin('editor') then
    raise exception 'only an admin can record or review evidence' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    if new.verified_at > current_date then
      raise exception 'the verified date % is in the future: it must be the day someone checked the source', new.verified_at
        using errcode = 'check_violation';
    end if;
    new.value := coalesce(nullif(btrim(new.value), ''), evidence_current_value(new.field, new.company_id, new.office_id, new.founder_id, new.job_id));
    if new.value is null then
      raise exception 'the field % is empty, so there is nothing for this evidence to support', new.field
        using errcode = 'check_violation';
    end if;
    new.recorded_at := now();
    if uid is not null then
      new.recorded_by := uid;
      new.reviewed_at := null;
      new.reviewed_by := null;
    elsif (new.reviewed_at is not null or new.reviewed_by is not null) and not public.caller_is_owner() then
      -- SEC-4: only a signed-in reviewer reviews; a service or pipeline caller records claims only.
      raise exception 'evidence is marked reviewed only by a signed-in reviewer (caller: %)', public.caller_role()
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if (new.company_id, new.office_id, new.founder_id, new.job_id, new.field, new.value, new.source_url, new.source_id,
      new.verified_at, new.note, new.recorded_by, new.recorded_at)
     is distinct from
     (old.company_id, old.office_id, old.founder_id, old.job_id, old.field, old.value, old.source_url, old.source_id,
      old.verified_at, old.note, old.recorded_by, old.recorded_at) then
    raise exception 'evidence cannot be changed; record new evidence instead' using errcode = 'check_violation';
  end if;
  if (new.reviewed_at, new.reviewed_by) is distinct from (old.reviewed_at, old.reviewed_by) then
    if uid is null then
      if not public.caller_is_owner() then
        raise exception 'evidence is reviewed only by a signed-in reviewer (caller: %)', public.caller_role()
          using errcode = 'insufficient_privilege';
      end if;
    elsif not is_admin('reviewer') then
      raise exception 'only a reviewer or admin can review evidence' using errcode = 'insufficient_privilege';
    elsif new.reviewed_at is null then
      new.reviewed_by := null;
    else
      new.reviewed_at := now();
      new.reviewed_by := uid;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.job_feed_guard() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.feed_approval', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.provider, new.identifier, new.company_id) is distinct from (old.provider, old.identifier, old.company_id) then
    new.approved_by := null;  -- a different feed needs a new approval
    new.approved_at := null;
    new.approval_note := null;
    return new;
  end if;
  if (new.approved_by, new.approved_at) is distinct from
     (case when tg_op = 'UPDATE' then old.approved_by end, case when tg_op = 'UPDATE' then old.approved_at end)
     and ((select auth.uid()) is not null or not public.caller_is_owner()) then
    raise exception 'a feed is approved only through approve_job_feed' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create or replace function public.logo_key_gate() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.logo_key is null or new.logo_key is not distinct from (case when tg_op = 'UPDATE' then old.logo_key end) then
    return new;
  end if;
  if auth.uid() is null and public.caller_is_owner() then
    return new;  -- the seed and the migration owner; RELEASE_BUILD and the launch gate check the published data separately
  end if;
  if not exists (select 1 from logo_asset a where a.company_id = new.id and a.storage_key = new.logo_key
                 and a.decision = 'approved' and a.activated_at is not null) then
    raise exception 'the logo must be an approved, activated upload for this company, with its provenance recorded'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- SEC-2: approve, then copy, then activate
-- ---------------------------------------------------------------------------

alter table public.logo_asset add column activated_at timestamptz;
-- Logos approved before this migration had their public copy made first and became the logo at once.
update public.logo_asset a set activated_at = a.reviewed_at
where a.decision = 'approved' and exists (select 1 from public.company c where c.id = a.company_id and c.logo_key = a.storage_key);

-- Approving no longer needs (or allows) a public copy beforehand, and does not change the company's logo: activate_logo does.
create or replace function public.review_logo(p_id bigint, p_decision text, p_note text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a logo_asset;
begin
  if not is_admin('reviewer') then
    raise exception 'only a reviewer or admin can approve or reject a logo' using errcode = 'insufficient_privilege';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'the decision is approved or rejected' using errcode = 'invalid_parameter_value';
  end if;
  if length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'write a note saying why' using errcode = 'invalid_parameter_value';
  end if;
  select * into a from logo_asset where id = p_id for update;
  if not found then
    raise exception 'no such logo' using errcode = 'no_data_found';
  end if;
  if a.decision is not null then
    raise exception 'this logo was already %', a.decision using errcode = 'check_violation';
  end if;
  update logo_asset set decision = p_decision, decision_note = btrim(p_note), reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id;
  if p_decision = 'rejected' then
    update company set logo_key = null where id = a.company_id and logo_key = a.storage_key;
  end if;
end;
$$;

-- After approval the admin page copies the file into the public bucket (the policy below allows nothing earlier), then
-- calls this: the public copy must match the reviewed upload (size, type and content tag), and only then is it the logo.
create function public.activate_logo(p_id bigint) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a logo_asset;
  pending jsonb;
  copied jsonb;
begin
  if not is_admin('reviewer') then
    raise exception 'only a reviewer or admin can make an approved logo the company''s logo' using errcode = 'insufficient_privilege';
  end if;
  select * into a from logo_asset where id = p_id for update;
  if not found then
    raise exception 'no such logo' using errcode = 'no_data_found';
  end if;
  if a.decision is distinct from 'approved' then
    raise exception 'only an approved logo can be activated (this one is %)', coalesce(a.decision, 'undecided') using errcode = 'check_violation';
  end if;
  if to_regclass('storage.objects') is null then
    raise exception 'this database has no file storage' using errcode = 'check_violation';
  end if;
  execute 'select metadata from storage.objects where bucket_id = ''company-logos-pending'' and name = $1' into pending using a.storage_key;
  execute 'select metadata from storage.objects where bucket_id = ''company-logos'' and name = $1' into copied using a.storage_key;
  if copied is null then
    raise exception 'copy the approved file to the public company-logos bucket first' using errcode = 'check_violation';
  end if;
  if pending is null
     or (copied ->> 'size') is distinct from (pending ->> 'size')
     or (copied ->> 'mimetype') is distinct from (pending ->> 'mimetype')
     or (copied ->> 'mimetype') is distinct from a.content_type
     or ((copied ? 'eTag') and (pending ? 'eTag') and (copied ->> 'eTag') is distinct from (pending ->> 'eTag')) then
    raise exception 'the public copy does not match the reviewed upload' using errcode = 'check_violation';
  end if;
  update logo_asset set activated_at = now() where id = p_id;
  update company set logo_key = a.storage_key where id = a.company_id;
end;
$$;
revoke all on function public.activate_logo(bigint) from public, anon;
grant execute on function public.activate_logo(bigint) to authenticated;

do $guard$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'logo bucket policy not changed: this database has no storage schema';
    return;
  end if;
  drop policy company_logos_publish on storage.objects;
  -- SEC-2: only an APPROVED, not yet activated logo may be copied into the public bucket.
  create policy company_logos_publish on storage.objects for insert to authenticated
    with check (bucket_id = 'company-logos' and public.is_admin('reviewer')
                and exists (select 1 from public.logo_asset a where a.storage_key = name and a.decision = 'approved' and a.activated_at is null));
end
$guard$;
