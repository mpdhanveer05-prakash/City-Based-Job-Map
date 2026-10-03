-- P3-04: the sample data (seed/01_sample_data.sql) is complete, labelled synthetic, invents nothing,
-- and works with the filter. Needs the seed, so run it after `npx supabase db reset`
-- (CI does: .github/workflows/ci.yml, "database" job).
begin;
create extension if not exists pgtap with schema extensions;

select plan(44);

create schema tests;
grant usage on schema tests to anon;
create function tests.become_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;
grant execute on function tests.become_anon() to anon;

-- ---------------------------------------------------------------------------
-- Cities and areas
-- ---------------------------------------------------------------------------

select is((select array_agg(slug order by slug) from city), array['bangalore', 'chennai'], 'both launch cities exist');
select is((select array_agg(name order by slug) from city), array['Bengaluru', 'Chennai'], 'with their display names');
select ok((select 'Bangalore' = any (aliases) from city where slug = 'bangalore'), 'Bengaluru has the alias Bangalore');
select ok((select 'Madras' = any (aliases) from city where slug = 'chennai'), 'Chennai has the alias Madras');
select is((select count(*)::int from city where boundary is null or centre is null), 0, 'every city has a boundary and a centre');
select is((select array_agg(status order by slug) from city), array['beta', 'beta'], 'cities are beta: visible, not yet launched');
select is((select count(*)::int from neighbourhood n join city c on c.id = n.city_id where c.slug = 'bangalore'), 10, 'Bengaluru has 10 neighbourhoods');
select is((select count(*)::int from neighbourhood n join city c on c.id = n.city_id where c.slug = 'chennai'), 9, 'Chennai has 9 neighbourhoods');
select is((select count(*)::int from tech_park t join city c on c.id = t.city_id where c.slug = 'bangalore'), 5, 'Bengaluru has 5 tech parks');
select is((select count(*)::int from tech_park t join city c on c.id = t.city_id where c.slug = 'chennai'), 4, 'Chennai has 4 tech parks');
select is((select count(*)::int from sector), 12, 'there are 12 sectors');

-- ---------------------------------------------------------------------------
-- Clearly synthetic, nothing invented (CLAUDE.md: "Don't invent data")
-- ---------------------------------------------------------------------------

select is((select count(*)::int from source), 1, 'there is one source');
select is((select name from source), 'Synthetic sample data', 'and it says the data is synthetic');
select is((select count(*)::int from company), 70, 'there are 70 sample companies');
select is(
  (select count(*)::int from company
   where not (name like '% (synthetic)' and domain like '%.example' and description like 'Synthetic%' and source_id = 1)),
  0, 'every company is marked synthetic in its name, domain, description, and source');
select is((select count(*)::int from company where logo_key is not null), 0, 'no company has a logo (none were invented)');
select is((select count(*)::int from company where last_verified_at is not null), 0, 'no company has a verification date');
select is((select count(*)::int from office where last_verified_at is not null or verification <> 'unverified'), 0,
  'no office claims to be verified');
select is((select count(*)::int from company_founder), 0, 'no founders (no real person is invented)');
select is((select count(*)::int from job where source_id <> 1), 0, 'every job comes from the synthetic source');
select is((select count(*)::int from job where posted_at is not null or last_checked_at is not null or last_ok_at is not null), 0,
  'no job has a posting date or a link check (none happened)');
select is((select count(*)::int from job j join company c on c.id = j.company_id
           where j.apply_url not like 'https://' || c.domain || '/%'), 0,
  'every apply link is https on the company''s own .example domain');

-- ---------------------------------------------------------------------------
-- Shape of the data
-- ---------------------------------------------------------------------------

select is((select count(*)::int from company where status = 'published'), 67, '67 companies are published');
select is((select count(*)::int from company where status = 'draft'), 3, '3 are drafts, to exercise the admin side and RLS');
select is((select count(*)::int from office), 88, 'there are 88 offices');
select is((select count(*)::int from office o join city c on c.id = o.city_id
           where o.status = 'published' and not extensions.st_covers(c.boundary, o.geom)), 0,
  'every published office is inside its city boundary');
select is((select count(*)::int from (select company_id from office group by company_id having count(distinct city_id) > 1) x), 6,
  '6 companies have offices in both cities');
select is((select count(distinct type)::int from company_type_tag), 3, 'all three company types are used');
select cmp_ok((select count(*)::int from (select company_id from company_type_tag where type in ('startup', 'product')
               group by company_id having count(distinct type) = 2) x), '>=', 5,
  'several companies are both Startup and Product (overlapping types)');
select cmp_ok((select count(*)::int from (select company_id from company_type_tag where type in ('mnc', 'product')
               group by company_id having count(distinct type) = 2) x), '>=', 1,
  'and at least one is both MNC and Product');
select is((select count(distinct startup_stage)::int from company), 9, 'every startup stage is used');
select cmp_ok((select count(*)::int from company c where c.startup_stage is null
               and exists (select 1 from company_type_tag t where t.company_id = c.id and t.type = 'startup')), '>=', 1,
  'some startups have an unknown stage (NULL, never guessed)');
select cmp_ok((select max(c)::int from (select count(*) as c from office group by geom::text) x), '>=', 3,
  'several companies share one exact point (the co-location case)');
select cmp_ok((select count(*)::int from (select count(*) from office group by geom::text having count(*) >= 3) x), '>=', 2,
  'at least two such shared points');
select cmp_ok((select count(*)::int from company_sector), '>=', 70, 'every company has a sector');
select is((select count(*)::int from job where status = 'active'), 98, '98 active jobs');
select cmp_ok((select count(distinct status)::int from job), '>=', 3, 'jobs include suspect and expired ones');
select is((select count(*)::int from job_city jc
           where not exists (select 1 from job j join office o on o.company_id = j.company_id and o.city_id = jc.city_id
                             where j.id = jc.job_id)), 0,
  'a job is listed only in cities where its company has an office');

-- ---------------------------------------------------------------------------
-- It works with RLS and the filter
-- ---------------------------------------------------------------------------

select tests.become_anon();
select is((select count(*)::int from company), 67, 'anon sees the 67 published companies, not the 3 drafts');
select is((select count(*)::int from public.company_filter('bangalore')), 48, 'anon: 48 companies in Bengaluru');
select is((select count(*)::int from public.company_filter('chennai')), 24, 'anon: 24 companies in Chennai');
select is((select count(*)::int from public.company_filter('bangalore', '{"q":"synthetic"}')), 48,
  'search finds the synthetic marker in every name');
select is((select count(*) filter (where company_count > 0)::int from public.company_facets('bangalore') where facet = 'stage'), 9,
  'the stage facet has a company at every stage in Bengaluru');
select cmp_ok((select count(*)::int from public.company_filter('bangalore', '{"types":["startup"],"stages":["seed"]}')), '>=', 1,
  'Startup + Seed returns companies');
reset role;

select * from finish();
rollback;
