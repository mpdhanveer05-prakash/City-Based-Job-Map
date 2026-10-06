-- P9-06 (ADR-0017, resolves D-05): Public and Acquired are an ownership status, not a startup stage.
--
-- 1. A new enum `ownership_status` (private, public, acquired) and the column `company.ownership_status`
--    (NULL = unknown, never guessed). It does not depend on the company's type tags.
-- 2. Existing data moves without loss: a company whose startup_stage was public or acquired gets that
--    value as its ownership status, and its stage becomes NULL (unknown).
-- 3. `startup_stage` is rebuilt without the two values (PostgreSQL cannot drop an enum value).
-- 4. The filter gains a `statuses` group (OR within, AND with the other groups), the facets a `status`
--    facet, and search_companies, city_build_snapshot, import_commit and admin_save_company the column.
--    lib/filters/ mirrors this; the parity test compares them.

create type public.ownership_status as enum ('private', 'public', 'acquired');

alter table public.company add column ownership_status public.ownership_status;
create index company_ownership_status on public.company (ownership_status) where ownership_status is not null;

update public.company
   set ownership_status = startup_stage::text::public.ownership_status,
       startup_stage = null
 where startup_stage::text in ('public', 'acquired');
-- The update queues the deferred stage check; run it now, because ALTER TABLE refuses a table with pending trigger events.
set constraints all immediate;

-- Rebuild the stage enum without public and acquired.
alter type public.startup_stage rename to startup_stage_v1;
create type public.startup_stage as enum (
  'pre_seed', 'seed', 'bootstrapped', 'series_a', 'series_b', 'series_c', 'series_c_plus'
);
alter type public.filter_args alter attribute stages type public.startup_stage[];
alter type public.filter_args add attribute statuses public.ownership_status[];
-- The stage-needs-startup trigger names the column, so it is dropped for the type change and created again as it was.
drop trigger company_stage_needs_startup_tag on public.company;
drop index public.company_startup_stage;
alter table public.company
  alter column startup_stage type public.startup_stage using startup_stage::text::public.startup_stage;
create index company_startup_stage on public.company (startup_stage) where startup_stage is not null;
create constraint trigger company_stage_needs_startup_tag
  after insert or update of startup_stage on public.company
  deferrable initially deferred
  for each row execute function public.company_check_stage();
drop type public.startup_stage_v1;

-- ---------------------------------------------------------------------------
-- The filter
-- ---------------------------------------------------------------------------

create or replace function public.parse_filters(filters jsonb) returns public.filter_args
language plpgsql
immutable
as $$
declare
  args public.filter_args;
  q text;
  unknown_key text;
  -- White space is spelled out (the Unicode White_Space property), not \s: PostgreSQL's \s follows the
  -- database locale (it includes U+001C to U+001F), JavaScript's has U+FEFF, and the browser filter
  -- must split a search exactly as this does. lib/filters/schema.ts WHITESPACE is the same set.
  ws constant text := '[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]';
begin
  filters := coalesce(filters, '{}'::jsonb);
  if jsonb_typeof(filters) <> 'object' then
    raise exception 'filters must be a JSON object' using errcode = 'invalid_parameter_value';
  end if;

  select k into unknown_key
    from jsonb_object_keys(filters) k
    where k not in ('q', 'types', 'stages', 'neighbourhoods', 'tech_parks', 'sectors', 'statuses')
    limit 1;
  if unknown_key is not null then
    raise exception 'unknown filter key: %', unknown_key using errcode = 'invalid_parameter_value';
  end if;

  args.tokens := '{}';
  if jsonb_exists(filters, 'q') and jsonb_typeof(filters -> 'q') <> 'null' then
    if jsonb_typeof(filters -> 'q') <> 'string' then
      raise exception 'filters.q must be a string' using errcode = 'invalid_parameter_value';
    end if;
    q := lower(regexp_replace(filters ->> 'q', '^' || ws || '+|' || ws || '+$', '', 'g'));
    if q <> '' then
      args.tokens := regexp_split_to_array(q, ws || '+');
    end if;
  end if;

  begin
    args.types := public.filter_text_array(filters, 'types')::public.company_type[];
  exception when invalid_text_representation then
    raise exception 'unknown value in filters.types' using errcode = 'invalid_parameter_value';
  end;
  begin
    args.stages := public.filter_text_array(filters, 'stages')::public.startup_stage[];
  exception when invalid_text_representation then
    raise exception 'unknown value in filters.stages' using errcode = 'invalid_parameter_value';
  end;
  begin
    args.statuses := public.filter_text_array(filters, 'statuses')::public.ownership_status[];
  exception when invalid_text_representation then
    raise exception 'unknown value in filters.statuses' using errcode = 'invalid_parameter_value';
  end;

  args.neighbourhoods := public.filter_text_array(filters, 'neighbourhoods');
  args.tech_parks := public.filter_text_array(filters, 'tech_parks');
  args.sectors := public.filter_text_array(filters, 'sectors');
  return args;
end;
$$;

-- ADR-0017: the statuses group is OR within the group, ANDed with the others, and independent of the type group;
-- a company whose ownership status is unknown (NULL) never matches a status selection.
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
      where o.company_id = c.id and o.city_id = p_city and o.status = 'published'
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
        where o.company_id = c.id and o.city_id = p_city and o.status = 'published'
          and n.slug = any (args.neighbourhoods)
      )
    )
    and (
      coalesce(cardinality(args.tech_parks), 0) = 0
      or exists (
        select 1 from public.office o join public.tech_park t on t.id = o.tech_park_id
        where o.company_id = c.id and o.city_id = p_city and o.status = 'published'
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

-- The list gains the ownership status (a new output column, so the function is dropped and created again).
drop function public.search_companies(text, jsonb, int, int);
create function public.search_companies(
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
      where o.company_id = c.id and o.city_id = ci.id and o.status = 'published'),
    (select count(distinct j.id)::int from public.job j
      join public.job_city jc on jc.job_id = j.id and jc.city_id = ci.id
      where j.company_id = c.id and j.status = 'active')
  from public.company_filter(city_slug, filters) f
  join public.company c on c.id = f
  join public.city ci on ci.slug = city_slug
  order by lower(c.name) collate "C", c.id
  limit greatest(result_limit, 0) offset greatest(result_offset, 0);
$$;

-- As in 20261003110000_filter_functions.sql, plus the status facet: statuses replaced by [v] (ADR-0017).
create or replace function public.company_facets(city_slug text, filters jsonb default '{}')
returns table (facet text, value text, company_count int)
language plpgsql
stable
as $$
declare
  args public.filter_args := public.parse_filters(filters);
  cid smallint;
begin
  select c.id into cid from public.city c where c.slug = city_slug;
  if cid is null then
    return;
  end if;

  return query
  select 'total'::text, ''::text,
         (select count(*)::int from public.company_filter_parsed(cid, args))
  union all
  select 'type', t::text,
         (select count(*)::int from public.company_filter_parsed(cid,
            row(args.tokens, array[t], '{}', args.neighbourhoods, args.tech_parks, args.sectors, args.statuses)::public.filter_args))
    from unnest(enum_range(null::public.company_type)) t
  union all
  select 'stage', s::text,
         (select count(*)::int from public.company_filter_parsed(cid,
            row(args.tokens, array['startup']::public.company_type[], array[s], args.neighbourhoods, args.tech_parks, args.sectors, args.statuses)::public.filter_args))
    from unnest(enum_range(null::public.startup_stage)) s
  union all
  select 'status', st::text,
         (select count(*)::int from public.company_filter_parsed(cid,
            row(args.tokens, args.types, args.stages, args.neighbourhoods, args.tech_parks, args.sectors, array[st])::public.filter_args))
    from unnest(enum_range(null::public.ownership_status)) st
  union all
  select 'neighbourhood', n.slug,
         (select count(*)::int from public.company_filter_parsed(cid,
            row(args.tokens, args.types, args.stages, array[n.slug], args.tech_parks, args.sectors, args.statuses)::public.filter_args))
    from public.neighbourhood n where n.city_id = cid
  union all
  select 'tech_park', p.slug,
         (select count(*)::int from public.company_filter_parsed(cid,
            row(args.tokens, args.types, args.stages, args.neighbourhoods, array[p.slug], args.sectors, args.statuses)::public.filter_args))
    from public.tech_park p where p.city_id = cid
  union all
  select 'sector', s.slug,
         (select count(*)::int from public.company_filter_parsed(cid,
            row(args.tokens, args.types, args.stages, args.neighbourhoods, args.tech_parks, array[s.slug], args.statuses)::public.filter_args))
    from public.sector s;
end;
$$;

-- ---------------------------------------------------------------------------
-- The build snapshot, the CSV import, and the admin save
-- ---------------------------------------------------------------------------

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
        where o.city_id = ci.id and o.status = 'published'), '[]'::jsonb),
      'jobs', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', j.id,
            'company_id', j.company_id,
            'title', j.title,
            'apply_url', j.apply_url,
            'status', j.status,
            'last_checked_at', j.last_checked_at
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

create or replace function public.import_commit(p_filename text, p_rows jsonb) returns jsonb
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
  v_ownership   text;
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
      v_stage := nullif(lower(trim(r ->> 'startup_stage')), '');
      v_ownership := nullif(lower(trim(r ->> 'ownership_status')), '');
      -- A file written before ADR-0017 may still carry Public or Acquired as a stage: it is an ownership status now.
      if v_stage in ('public', 'acquired') then
        if v_ownership is not null and v_ownership <> v_stage then
          raise exception 'the stage "%" and the ownership status "%" disagree', v_stage, v_ownership;
        end if;
        v_ownership := v_stage;
        v_stage := null;
      end if;
      if v_ownership is not null and v_ownership not in ('private', 'public', 'acquired') then
        raise exception 'unknown ownership status "%"', v_ownership;
      end if;
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

      insert into company (slug, name, domain, description, startup_stage, ownership_status, website_url, careers_url, status)
      values (v_slug, v_name, v_domain, nullif(trim(r ->> 'description'), ''), v_stage::startup_stage, v_ownership::ownership_status,
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

create or replace function public.admin_save_company(p_id uuid, p_company jsonb, p_types text[], p_sectors text[]) returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_id    uuid := p_id;
  v_types public.company_type[] := coalesce(p_types, array[]::text[])::public.company_type[];
begin
  if not is_admin('editor') then
    raise exception 'saving a company needs an admin role' using errcode = '42501';
  end if;

  if v_id is null then
    insert into company (slug, name, domain, website_url, careers_url, description, startup_stage, ownership_status, status)
    values (
      p_company ->> 'slug', p_company ->> 'name', lower(p_company ->> 'domain'), p_company ->> 'website_url',
      nullif(p_company ->> 'careers_url', ''), nullif(p_company ->> 'description', ''),
      nullif(p_company ->> 'startup_stage', '')::public.startup_stage,
      nullif(p_company ->> 'ownership_status', '')::public.ownership_status, coalesce(p_company ->> 'status', 'draft')
    )
    returning id into v_id;
  else
    -- Clear the stage first if the new types drop Startup, so the rule is never broken even for an instant.
    if not ('startup' = any (v_types)) then
      update company set startup_stage = null where id = v_id and startup_stage is not null;
    end if;
    update company set
      slug = p_company ->> 'slug',
      name = p_company ->> 'name',
      domain = lower(p_company ->> 'domain'),
      website_url = p_company ->> 'website_url',
      careers_url = nullif(p_company ->> 'careers_url', ''),
      description = nullif(p_company ->> 'description', ''),
      startup_stage = nullif(p_company ->> 'startup_stage', '')::public.startup_stage,
      ownership_status = nullif(p_company ->> 'ownership_status', '')::public.ownership_status,
      status = coalesce(p_company ->> 'status', status)
    where id = v_id;
    if not found then
      raise exception 'that company does not exist or is not visible to you' using errcode = '22023';
    end if;
  end if;

  delete from company_type_tag where company_id = v_id and not (type = any (v_types));
  insert into company_type_tag (company_id, type) select v_id, t from unnest(v_types) t on conflict do nothing;

  delete from company_sector where company_id = v_id and sector_id not in (select id from sector where slug = any (coalesce(p_sectors, array[]::text[])));
  insert into company_sector (company_id, sector_id)
  select v_id, s.id from sector s where s.slug = any (coalesce(p_sectors, array[]::text[]))
  on conflict do nothing;
  if (select count(*) from company_sector where company_id = v_id) <> (select count(distinct x) from unnest(coalesce(p_sectors, array[]::text[])) x) then
    raise exception 'one of the sectors does not exist' using errcode = '22023';
  end if;

  return v_id;
end;
$$;
