-- P4-01: everything the build needs for one city, in one call (ADR-0006, docs/data-model.md).
--
-- The build reads this once per city and writes the static dataset the browser filters. The
-- candidates are exactly company_filter(city, '{}'), so the dataset can never hold a company the
-- SQL filter would not return. STABLE and SECURITY INVOKER: an anon caller (the build) gets only
-- what RLS lets anon see, and the function names the published states itself so a signed-in admin
-- gets the same public result.
--
-- Returns null for an unknown city or one the caller cannot see (a draft city, for anon).
--
-- Not included yet: slug redirects (the slug_redirect table arrives with company merging, P7).

create function public.city_build_snapshot(city_slug text) returns jsonb
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
        'data_version', ci.data_version
      ),
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
      -- Active and suspect jobs listed in this city. Search and counts use the active ones only
      -- (docs/filters.md); the company jobs page may show the suspect ones until a second check.
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
          and exists (select 1 from job_city jc where jc.job_id = j.id and jc.city_id = ci.id)), '[]'::jsonb)
    )
  );
end;
$$;
