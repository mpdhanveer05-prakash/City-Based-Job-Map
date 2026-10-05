-- P6-01 and P6-03: old company slugs that redirect to the current page, and the daily outbound click counter
-- (docs/data-model.md, docs/security.md "Outbound links and content").
--
-- 1. slug_redirect: when a company is renamed or merged, its old slug keeps working. The build turns each row into a
--    line of public/_redirects (ADR-0006: redirects live in the static assets, not in a server). Rows are written by
--    the merge and rename tooling (P7); the policies below give reviewers and above write access now.
-- 2. link_click_daily + record_click: Apply and Visit website are direct links to the employer; a beacon tells the
--    `click` Edge Function, which calls record_click with the service role. The counter holds a day, a kind, a target
--    id, and a count. No IP address, no user identifier, no timestamp finer than the day.
-- 3. city_build_snapshot also returns `slug_redirects` for the dataset's companies.

-- ---------------------------------------------------------------------------
-- Slug redirects
-- ---------------------------------------------------------------------------

create table public.slug_redirect (
  old_slug    text primary key,
  company_id  uuid not null references public.company (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint slug_redirect_slug_format check (old_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
create index slug_redirect_company on public.slug_redirect (company_id);
alter table public.slug_redirect enable row level security;

-- A redirect from a slug that a company uses today would hide that company's page, and a redirect to the company
-- it already points at is a loop. Checked on every insert and update.
create function public.slug_redirect_check() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from company c where c.slug = new.old_slug) then
    raise exception 'slug % is in use by a company; it cannot also redirect', new.old_slug using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger slug_redirect_check before insert or update on public.slug_redirect
  for each row execute function public.slug_redirect_check();

-- A company cannot take a slug that already redirects elsewhere (the redirect would hide the company).
create function public.company_slug_not_redirected() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from slug_redirect r where r.old_slug = new.slug) then
    raise exception 'slug % is an old slug that redirects; remove the redirect first', new.slug using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger company_slug_not_redirected before insert or update of slug on public.company
  for each row execute function public.company_slug_not_redirected();

-- Anyone may read the redirects of published companies. Reviewers and above manage them.
create policy slug_redirect_public_read on public.slug_redirect for select to anon, authenticated
  using (exists (select 1 from public.company c where c.id = slug_redirect.company_id and c.status = 'published'));
create policy slug_redirect_admin_read on public.slug_redirect for select to authenticated
  using (public.is_admin());
create policy slug_redirect_reviewer_insert on public.slug_redirect for insert to authenticated
  with check (public.is_admin('reviewer'));
create policy slug_redirect_reviewer_update on public.slug_redirect for update to authenticated
  using (public.is_admin('reviewer')) with check (public.is_admin('reviewer'));
create policy slug_redirect_reviewer_delete on public.slug_redirect for delete to authenticated
  using (public.is_admin('reviewer'));

-- ---------------------------------------------------------------------------
-- Outbound clicks
-- ---------------------------------------------------------------------------

create table public.link_click_daily (
  day        date not null,
  kind       text not null check (kind in ('apply', 'website')),
  target_id  uuid not null,
  count      integer not null default 0 check (count >= 0),
  primary key (day, kind, target_id)
);
alter table public.link_click_daily enable row level security;

-- Reviewers and above read the totals. Nobody writes through the API: only record_click does, below.
create policy link_click_daily_reviewer_read on public.link_click_daily for select to authenticated
  using (public.is_admin('reviewer'));
revoke all on public.link_click_daily from anon;
revoke insert, update, delete on public.link_click_daily from authenticated;

-- Adds one to today's count for a job ('apply') or a company ('website'). SECURITY DEFINER with a fixed search_path,
-- and callable only by the service role (the `click` Edge Function holds it as a secret): the browser never calls it.
-- It checks its own arguments: a job must be listed (active or suspect) and its company published; a company must be
-- published. Anything else is an error, so the counter cannot be filled with ids that were never public.
create function public.record_click(p_kind text, p_target_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind = 'apply' then
    if not exists (
      select 1 from job j join company c on c.id = j.company_id
      where j.id = p_target_id and j.status in ('active', 'suspect') and c.status = 'published'
    ) then
      raise exception 'not a listed job' using errcode = '22023';
    end if;
  elsif p_kind = 'website' then
    if not exists (select 1 from company c where c.id = p_target_id and c.status = 'published') then
      raise exception 'not a published company' using errcode = '22023';
    end if;
  else
    raise exception 'unknown click kind' using errcode = '22023';
  end if;

  insert into link_click_daily (day, kind, target_id, count)
  values ((now() at time zone 'utc')::date, p_kind, p_target_id, 1)
  on conflict (day, kind, target_id) do update set count = link_click_daily.count + 1;
end;
$$;
revoke all on function public.record_click(text, uuid) from public, anon, authenticated;
grant execute on function public.record_click(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The snapshot gains the slug redirects of its companies
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
