-- P3-04: sample data for Bengaluru and Chennai, for development and staging.
--
-- ALL OF THE COMPANIES, OFFICES, AND JOBS HERE ARE SYNTHETIC. They are generated, not collected:
--   * every company name ends in "(synthetic)", its domain ends in ".example" (a reserved name that
--     can never be a real site), and its description says so;
--   * every company, office, and job points at the source "Synthetic sample data";
--   * there are no logos, no founders, no verification dates, no posting dates, and no link checks,
--     because none of those happened (CLAUDE.md: "Don't invent data").
-- Real curated data replaces this file (decision D-04). Never load it into production.
--
-- What is real here: the city, neighbourhood, and tech-park NAMES. What is approximate: the city
-- boundaries are rough placeholder polygons (not the official limits), and the anchor coordinates
-- below only place synthetic offices near each named area. None is a surveyed location.
--
-- The whole file is one transaction because the startup-stage rule is checked at commit.

begin;

-- ---------------------------------------------------------------------------
-- Source
-- ---------------------------------------------------------------------------

insert into source (id, name, kind, permission_note) values
  (1, 'Synthetic sample data', 'manual',
   'Generated for development and staging. Not real companies, offices, or jobs. Replace with curated data (D-04). Never load into production.');

-- ---------------------------------------------------------------------------
-- Cities (boundaries are approximate placeholders; beta = visible, not yet launched)
-- ---------------------------------------------------------------------------

insert into city (slug, name, aliases, status, centre, default_zoom, boundary) values
  ('bangalore', 'Bengaluru', array['Bangalore', 'BLR', 'Bengalooru'], 'beta',
   'SRID=4326;POINT(77.5946 12.9716)', 11,
   'SRID=4326;MULTIPOLYGON(((77.45 12.80, 77.80 12.80, 77.80 13.15, 77.45 13.15, 77.45 12.80)))'),
  ('chennai', 'Chennai', array['Madras'], 'beta',
   'SRID=4326;POINT(80.2707 13.0827)', 11,
   'SRID=4326;MULTIPOLYGON(((80.10 12.85, 80.33 12.85, 80.33 13.20, 80.10 13.20, 80.10 12.85)))');

-- ---------------------------------------------------------------------------
-- Named areas and anchor points (approximate centres, used only to place synthetic offices)
-- ---------------------------------------------------------------------------

create temp table seed_anchor (
  city_slug text, kind text, slug text, name text, lng float8, lat float8, rn int
) on commit drop;

insert into seed_anchor (city_slug, kind, slug, name, lng, lat) values
  ('bangalore', 'neighbourhood', 'indiranagar',      'Indiranagar',      77.6408, 12.9784),
  ('bangalore', 'neighbourhood', 'koramangala',      'Koramangala',      77.6245, 12.9352),
  ('bangalore', 'neighbourhood', 'whitefield',       'Whitefield',       77.7500, 12.9698),
  ('bangalore', 'neighbourhood', 'hsr-layout',       'HSR Layout',       77.6389, 12.9116),
  ('bangalore', 'neighbourhood', 'jayanagar',        'Jayanagar',        77.5938, 12.9250),
  ('bangalore', 'neighbourhood', 'electronic-city',  'Electronic City',  77.6602, 12.8452),
  ('bangalore', 'neighbourhood', 'marathahalli',     'Marathahalli',     77.7011, 12.9569),
  ('bangalore', 'neighbourhood', 'hebbal',           'Hebbal',           77.5970, 13.0358),
  ('bangalore', 'neighbourhood', 'malleshwaram',     'Malleshwaram',     77.5643, 13.0035),
  ('bangalore', 'neighbourhood', 'bellandur',        'Bellandur',        77.6784, 12.9304),
  ('bangalore', 'tech_park',     'embassy-tech-village', 'Embassy Tech Village', 77.6804, 12.9279),
  ('bangalore', 'tech_park',     'manyata-tech-park',    'Manyata Tech Park',    77.6207, 13.0455),
  ('bangalore', 'tech_park',     'bagmane-tech-park',    'Bagmane Tech Park',    77.6610, 12.9830),
  ('bangalore', 'tech_park',     'itpl',                 'ITPL',                 77.7365, 12.9852),
  ('bangalore', 'tech_park',     'prestige-tech-park',   'Prestige Tech Park',   77.6965, 12.9378),
  ('chennai', 'neighbourhood', 'adyar',           'Adyar',           80.2575, 13.0067),
  ('chennai', 'neighbourhood', 't-nagar',         'T. Nagar',        80.2341, 13.0418),
  ('chennai', 'neighbourhood', 'guindy',          'Guindy',          80.2206, 13.0067),
  ('chennai', 'neighbourhood', 'velachery',       'Velachery',       80.2180, 12.9815),
  ('chennai', 'neighbourhood', 'anna-nagar',      'Anna Nagar',      80.2101, 13.0850),
  ('chennai', 'neighbourhood', 'nungambakkam',    'Nungambakkam',    80.2425, 13.0569),
  ('chennai', 'neighbourhood', 'sholinganallur',  'Sholinganallur',  80.2279, 12.9010),
  ('chennai', 'neighbourhood', 'perungudi',       'Perungudi',       80.2461, 12.9653),
  ('chennai', 'neighbourhood', 'mylapore',        'Mylapore',        80.2707, 13.0339),
  ('chennai', 'tech_park',     'tidel-park',          'Tidel Park',          80.2420, 13.0108),
  ('chennai', 'tech_park',     'olympia-tech-park',   'Olympia Tech Park',   80.2120, 13.0090),
  ('chennai', 'tech_park',     'dlf-it-park',         'DLF IT Park',         80.1740, 13.0170),
  ('chennai', 'tech_park',     'ascendas-it-park',    'Ascendas IT Park',    80.2460, 13.0000);

update seed_anchor a set rn = r.rn
from (select slug, row_number() over (partition by city_slug, kind order by slug) as rn from seed_anchor) r
where r.slug = a.slug;

insert into neighbourhood (city_id, slug, name)
select c.id, a.slug, a.name from seed_anchor a join city c on c.slug = a.city_slug where a.kind = 'neighbourhood';

insert into tech_park (city_id, slug, name)
select c.id, a.slug, a.name from seed_anchor a join city c on c.slug = a.city_slug where a.kind = 'tech_park';

insert into sector (slug, name) values
  ('fintech', 'Fintech'), ('saas', 'SaaS'), ('e-commerce', 'E-commerce'), ('healthtech', 'Healthtech'),
  ('edtech', 'Edtech'), ('enterprise-software', 'Enterprise software'), ('semiconductors', 'Semiconductors'),
  ('logistics', 'Logistics'), ('gaming', 'Gaming'), ('cloud-devops', 'Cloud and DevOps'),
  ('ai-data', 'AI and data'), ('mobility', 'Mobility');

-- ---------------------------------------------------------------------------
-- Synthetic companies
--   1..44 Bengaluru, 45..64 Chennai, 65..70 both cities.
--   Types: n%4 = 0,1 startup; 2 mnc; 3 product. Some startups are also product, some MNCs too.
--   Every 23rd company is a draft (to exercise the admin side and RLS).
-- ---------------------------------------------------------------------------

create temp table seed_company on commit drop as
select
  n,
  (array['Amber','Birch','Cobalt','Delta','Ember','Fjord','Garnet','Harbor','Indigo','Juniper','Kestrel','Lumen'])[1 + (n - 1) % 12] as adj,
  (array['Forge','Labs','Works','Systems','Cloud','Loop','Grid','Mint','Nest','Pulse'])[1 + ((n - 1) / 12) % 10] as noun,
  case when n <= 44 then 'bangalore' when n <= 64 then 'chennai' else 'both' end as home,
  (n % 4 in (0, 1)) as is_startup,
  (n % 4 = 2) as is_mnc,
  (n % 4 = 3 or (n % 4 in (0, 1) and n % 3 = 0) or (n % 4 = 2 and n % 6 = 2)) as is_product
from generate_series(1, 70) n;

alter table seed_company add column slug text, add column stage text;
update seed_company set slug = lower(adj) || '-' || lower(noun) || '-synthetic';

-- Stages go to the startups in turn, so every stage in the filter is used; one in twelve is left
-- unknown (NULL), which the product never guesses.
update seed_company s set stage =
  (array['pre_seed','seed','seed','bootstrapped','series_a','series_a','series_b','series_c',
         'series_c_plus','public','acquired', null])[1 + (r.rk - 1) % 12]
from (select n, row_number() over (order by n) as rk from seed_company where is_startup) r
where r.n = s.n;

-- Ids are derived from the slug (md5 as a uuid), so every `db reset` gives the same ids and the
-- committed dataset snapshot (supabase/seed/snapshots) stays byte-stable.
insert into company (id, slug, name, domain, description, size_band, startup_stage, website_url, careers_url, status, source_id, is_synthetic)
select
  md5('company:' || slug)::uuid,
  slug,
  adj || ' ' || noun || ' (synthetic)',
  slug || '.example',
  'Synthetic sample record for development. Not a real company.',
  null,
  stage::startup_stage,
  'https://' || slug || '.example',
  'https://' || slug || '.example/careers',
  case when n % 23 = 0 then 'draft' else 'published' end,
  1,
  true
from seed_company;

insert into company_type_tag (company_id, type)
select c.id, t.type::company_type
from seed_company s
join company c on c.slug = s.slug
cross join lateral (
  select 'startup' as type where s.is_startup
  union all select 'mnc' where s.is_mnc
  union all select 'product' where s.is_product
) t;

insert into company_sector (company_id, sector_id)
select c.id, sec.id
from seed_company s
join company c on c.slug = s.slug
cross join lateral (values (1 + s.n % 12), (1 + (s.n * 5 + 3) % 12)) as pick(i)
join (select id, row_number() over (order by slug) as rn from sector) sec on sec.rn = pick.i
where pick.i = 1 + s.n % 12 or s.n % 3 = 0
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Synthetic offices
--   One per company in its home city (two for the "both" companies, one in each city).
--   Every 5th company has a second office. Every 6th company's first office sits at the exact
--   point of a tech park, so several companies share one coordinate (the co-location case).
-- ---------------------------------------------------------------------------

create temp table seed_office on commit drop as
with base as (
  select s.n, h.city_slug, 1 as seq
  from seed_company s
  cross join lateral (
    select unnest(case s.home when 'both' then array['bangalore', 'chennai'] else array[s.home] end) as city_slug
  ) h
  union all
  select s.n, s.home, 2 from seed_company s where s.home <> 'both' and s.n % 5 = 0
)
select b.n, b.city_slug, b.seq,
       case when b.seq = 1 and b.n % 6 = 0 then 'tech_park' else 'neighbourhood' end as kind
from base b;

insert into office (id, company_id, city_id, neighbourhood_id, tech_park_id, address, geom, accuracy, verification, status)
select
  md5('office:' || s.slug || ':' || o.city_slug || ':' || o.seq)::uuid,
  c.id,
  ci.id,
  case when o.kind = 'neighbourhood' then nb.id end,
  case when o.kind = 'tech_park' then tp.id end,
  'Synthetic address ' || o.n || '.' || o.seq || ', ' || a.name,
  ('SRID=4326;POINT(' ||
     (case when o.kind = 'tech_park' then a.lng else a.lng + (((o.n * 37 + o.seq * 11) % 101) - 50) / 8000.0 end) || ' ' ||
     (case when o.kind = 'tech_park' then a.lat else a.lat + (((o.n * 53 + o.seq * 17) % 101) - 50) / 8000.0 end) || ')')::geography,
  case when o.kind = 'tech_park' then 'campus' when o.n % 2 = 0 then 'building' else 'street' end,
  'unverified',
  'published'
from seed_office o
join seed_company s on s.n = o.n
join company c on c.slug = s.slug
join city ci on ci.slug = o.city_slug
join (select city_slug, kind, count(*) as cnt from seed_anchor group by city_slug, kind) k
  on k.city_slug = o.city_slug and k.kind = o.kind
join seed_anchor a
  on a.city_slug = o.city_slug and a.kind = o.kind
 and a.rn = case when o.kind = 'tech_park' then 1 + (o.n / 6) % 2 else 1 + (o.n + o.seq * 3) % k.cnt end
left join neighbourhood nb on nb.city_id = ci.id and nb.slug = a.slug and o.kind = 'neighbourhood'
left join tech_park tp on tp.city_id = ci.id and tp.slug = a.slug and o.kind = 'tech_park';

-- ---------------------------------------------------------------------------
-- Synthetic jobs: 1 to 3 per company (none for every 5th), most active, a few suspect or expired.
-- No posting dates and no link checks: none happened.
-- ---------------------------------------------------------------------------

insert into job (id, company_id, source_id, title, title_norm, apply_url, dedup_hash, exp_min_years, exp_max_years, work_mode, status)
select
  md5('job:' || s.slug || ':' || k)::uuid,
  c.id,
  1,
  t.title,
  lower(t.title),
  'https://' || s.slug || '.example/careers/' || k,
  decode(md5(s.slug || t.title || k), 'hex'),
  (s.n + k) % 6,
  (s.n + k) % 6 + 3,
  (array['onsite', 'hybrid', 'remote'])[1 + (s.n + k) % 3],
  case when (s.n + k) % 17 = 0 then 'suspect' when (s.n + k) % 13 = 0 then 'expired' else 'active' end
from seed_company s
join company c on c.slug = s.slug
cross join lateral generate_series(1, 1 + s.n % 3) k
cross join lateral (
  select (array['Backend Engineer', 'Frontend Engineer', 'Data Scientist', 'DevOps Engineer', 'Product Manager',
                'QA Engineer', 'Mobile Engineer', 'Security Engineer', 'Site Reliability Engineer', 'UX Designer'])[1 + (s.n + k * 3) % 10] as title
) t
where s.n % 5 <> 4;

-- A job is listed in every city where its company has a published office.
insert into job_city (job_id, city_id)
select distinct j.id, o.city_id
from job j
join office o on o.company_id = j.company_id and o.status = 'published'
where j.source_id = 1;

commit;
