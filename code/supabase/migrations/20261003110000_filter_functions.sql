-- P3-03: the shared filter and the three functions built on it (docs/filters.md).
--
-- company_filter(city_slug, filters) is the reference definition of which companies match.
-- city_points, search_companies, and company_facets all call it (through company_filter_parsed),
-- so points, list, and counts cannot disagree. lib/filters/ mirrors it once in TypeScript (P4-01)
-- and a parity test compares the two.
--
-- Everything here is STABLE and SECURITY INVOKER, so row-level security still applies: an anon
-- caller sees only what RLS lets anon see. The functions also name the published states
-- explicitly, so a signed-in admin gets the public result, not a draft-inclusive one.

-- ---------------------------------------------------------------------------
-- Parsed filter arguments
-- ---------------------------------------------------------------------------

create type public.filter_args as (
  tokens          text[],
  types           public.company_type[],
  stages          public.startup_stage[],
  neighbourhoods  text[],
  tech_parks      text[],
  sectors         text[]
);

-- A jsonb array of strings, lower-cased and trimmed; absent or null is the empty array.
create function public.filter_text_array(filters jsonb, k text) returns text[]
language plpgsql
immutable
as $$
declare
  result text[];
begin
  if not jsonb_exists(filters, k) or jsonb_typeof(filters -> k) = 'null' then
    return '{}';
  end if;
  if jsonb_typeof(filters -> k) <> 'array' then
    raise exception 'filters.% must be an array of strings', k using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from jsonb_array_elements(filters -> k) e where jsonb_typeof(e) <> 'string') then
    raise exception 'filters.% must be an array of strings', k using errcode = 'invalid_parameter_value';
  end if;
  select coalesce(array_agg(lower(btrim(e #>> '{}'))), '{}')
    into result
    from jsonb_array_elements(filters -> k) e;
  return result;
end;
$$;

-- Validates and normalises a filters object. Unknown keys, wrong shapes, and unknown type or
-- stage values are errors (22023), so a typo cannot silently widen a result.
create function public.parse_filters(filters jsonb) returns public.filter_args
language plpgsql
immutable
as $$
declare
  args public.filter_args;
  q text;
  unknown_key text;
begin
  filters := coalesce(filters, '{}'::jsonb);
  if jsonb_typeof(filters) <> 'object' then
    raise exception 'filters must be a JSON object' using errcode = 'invalid_parameter_value';
  end if;

  select k into unknown_key
    from jsonb_object_keys(filters) k
    where k not in ('q', 'types', 'stages', 'neighbourhoods', 'tech_parks', 'sectors')
    limit 1;
  if unknown_key is not null then
    raise exception 'unknown filter key: %', unknown_key using errcode = 'invalid_parameter_value';
  end if;

  args.tokens := '{}';
  if jsonb_exists(filters, 'q') and jsonb_typeof(filters -> 'q') <> 'null' then
    if jsonb_typeof(filters -> 'q') <> 'string' then
      raise exception 'filters.q must be a string' using errcode = 'invalid_parameter_value';
    end if;
    q := lower(regexp_replace(filters ->> 'q', '^\s+|\s+$', '', 'g'));
    if q <> '' then
      args.tokens := regexp_split_to_array(q, '\s+');
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

  args.neighbourhoods := public.filter_text_array(filters, 'neighbourhoods');
  args.tech_parks := public.filter_text_array(filters, 'tech_parks');
  args.sectors := public.filter_text_array(filters, 'sectors');
  return args;
end;
$$;

-- ---------------------------------------------------------------------------
-- The text a search matches against, per company and city (all lower case)
-- ---------------------------------------------------------------------------

-- Company name, titles of its active jobs in the city, neighbourhood and tech-park names and
-- addresses of its published offices in the city, and its published founders.
create function public.company_search_fields(p_company uuid, p_city smallint) returns setof text
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
    where o.company_id = p_company and o.city_id = p_city and o.status = 'published'
  union all
  select lower(t.name)
    from public.office o join public.tech_park t on t.id = o.tech_park_id
    where o.company_id = p_company and o.city_id = p_city and o.status = 'published'
  union all
  select lower(o.address)
    from public.office o
    where o.company_id = p_company and o.city_id = p_city and o.status = 'published'
  union all
  select lower(f.full_name)
    from public.company_founder f
    where f.company_id = p_company and f.status = 'published';
$$;

-- ---------------------------------------------------------------------------
-- The filter
-- ---------------------------------------------------------------------------

-- Companies in a city that match every group. A group with no selection does not constrain.
--   base       published company with at least one published office in the city
--   types      OR within the group. A startup tag counts only if the company's stage is in
--              `stages` (when `stages` is not empty). `stages` is ignored unless `startup`
--              is in `types` (ADR-0004): MNC + Startup + Seed = every MNC company OR the
--              startups at Seed.
--   locations  OR within the group, over the company's published offices in the city
--   sectors    OR within the group
--   tokens     AND across tokens; each token must be a substring of at least one field
create function public.company_filter_parsed(p_city smallint, args public.filter_args)
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

-- The reference definition. An unknown city, or one RLS hides from the caller, gives no rows.
create function public.company_filter(city_slug text, filters jsonb default '{}')
returns setof uuid
language plpgsql
stable
as $$
declare
  args public.filter_args := public.parse_filters(filters);
  city_id smallint;
begin
  select c.id into city_id from public.city c where c.slug = city_slug;
  if city_id is null then
    return;
  end if;
  return query select * from public.company_filter_parsed(city_id, args);
end;
$$;

-- ---------------------------------------------------------------------------
-- Points, list, and facets
-- ---------------------------------------------------------------------------

-- Every published office in the city of every company that passes the filter. The location
-- filters decide which companies appear; they do not hide a matching company's other offices.
create function public.city_points(city_slug text, filters jsonb default '{}')
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
  join public.office o on o.company_id = f and o.city_id = ci.id and o.status = 'published'
  order by o.id;
$$;

-- One row per company, in name order (code-point order on the lower-cased name, then id).
-- open_job_count counts active jobs in the city only (BRD data rules).
create function public.search_companies(
  city_slug text,
  filters jsonb default '{}',
  result_limit int default 50,
  result_offset int default 0
)
returns table (
  company_id uuid, slug text, name text, logo_key text,
  types text[], startup_stage text, office_count int, open_job_count int
)
language sql
stable
as $$
  select
    c.id, c.slug, c.name, c.logo_key,
    coalesce((select array_agg(t.type::text order by t.type)
              from public.company_type_tag t where t.company_id = c.id), '{}'),
    c.startup_stage::text,
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

-- Unique-company counts per facet value, computed as "the result if this group's selection were
-- just this value, with every other group as it is":
--   total      the filter as given
--   type       types = [v], stages cleared (stages belong to the startup type, shown separately)
--   stage      types = [startup], stages = [v]
--   neighbourhood, tech_park, sector   that group replaced by [v]
-- Counts can add up to more than the total because types overlap (ADR-0004). Every value of a
-- facet is returned, including those with a count of 0.
create function public.company_facets(city_slug text, filters jsonb default '{}')
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
            row(args.tokens, array[t], '{}', args.neighbourhoods, args.tech_parks, args.sectors)::public.filter_args))
    from unnest(enum_range(null::public.company_type)) t
  union all
  select 'stage', s::text,
         (select count(*)::int from public.company_filter_parsed(cid,
            row(args.tokens, array['startup']::public.company_type[], array[s], args.neighbourhoods, args.tech_parks, args.sectors)::public.filter_args))
    from unnest(enum_range(null::public.startup_stage)) s
  union all
  select 'neighbourhood', n.slug,
         (select count(*)::int from public.company_filter_parsed(cid,
            row(args.tokens, args.types, args.stages, array[n.slug], args.tech_parks, args.sectors)::public.filter_args))
    from public.neighbourhood n where n.city_id = cid
  union all
  select 'tech_park', p.slug,
         (select count(*)::int from public.company_filter_parsed(cid,
            row(args.tokens, args.types, args.stages, args.neighbourhoods, array[p.slug], args.sectors)::public.filter_args))
    from public.tech_park p where p.city_id = cid
  union all
  select 'sector', s.slug,
         (select count(*)::int from public.company_filter_parsed(cid,
            row(args.tokens, args.types, args.stages, args.neighbourhoods, args.tech_parks, array[s.slug])::public.filter_args))
    from public.sector s;
end;
$$;
