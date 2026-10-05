-- P7-02: the office list and edit form need an office's coordinates and the names around it. PostgREST returns a
-- `geography` column as hex WKB, which a form cannot show, so this view gives the latitude and longitude as numbers.
--
-- security_invoker: the view reads as the caller, so row-level security still applies (an admin sees every office, anon
-- sees nothing here). Writes go to the `office` table itself (the form sends `geom` as EWKT text).

create view public.admin_offices with (security_invoker = true) as
select
  o.id,
  o.company_id,
  c.name as company_name,
  c.slug as company_slug,
  o.city_id,
  ci.slug as city_slug,
  ci.name as city_name,
  o.neighbourhood_id,
  n.name as neighbourhood_name,
  o.tech_park_id,
  t.name as tech_park_name,
  o.address,
  st_y(o.geom::geometry) as lat,
  st_x(o.geom::geometry) as lng,
  o.accuracy,
  o.verification,
  o.outside_reviewed,
  o.status,
  o.last_verified_at,
  st_covers(ci.boundary, o.geom) as inside_city
from public.office o
join public.company c on c.id = o.company_id
join public.city ci on ci.id = o.city_id
left join public.neighbourhood n on n.id = o.neighbourhood_id
left join public.tech_park t on t.id = o.tech_park_id;
revoke all on public.admin_offices from anon;
