-- P3-01: core schema (docs/data-model.md, plan "Database").
--
-- Differences from the plan's DDL, all recorded in docs/data-model.md:
--   * company.company_type (one value) is replaced by company_type_tag (D-02, ADR-0004).
--   * company.funding_stage is dropped; startup_stage is the one stage field (D-05).
--   * company_founder is new (D-03).
--   * source is created first so company.source_id and job.source_id are real foreign keys.
--   * website, careers, apply, and founder source URLs must be https (CLAUDE.md, security).
--
-- Row-level security is switched on for every table and no policy is added here, so
-- until P3-02 nothing is readable or writable through the API roles. Admin tables
-- (admin_user, audit_log, submission, ...) arrive with P3-02 and later tasks.
--
-- Extensions live in the `extensions` schema, which is on the default search_path.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

-- Launch set. A company can carry several tags (Startup and Product). Extend by migration.
create type public.company_type as enum ('startup', 'mnc', 'product');

-- NULL on a company means unknown. It is never guessed.
create type public.startup_stage as enum (
  'pre_seed', 'seed', 'bootstrapped', 'series_a', 'series_b',
  'series_c', 'series_c_plus', 'public', 'acquired'
);

-- ---------------------------------------------------------------------------
-- Geography
-- ---------------------------------------------------------------------------

create table public.city (
  id            smallserial primary key,
  slug          text unique not null,
  name          text not null,
  aliases       text[] not null default '{}',
  status        text not null default 'draft' check (status in ('draft', 'beta', 'live')),
  centre        geography(Point, 4326) not null,
  default_zoom  real not null,
  boundary      geography(MultiPolygon, 4326) not null,
  data_version  bigint not null default 1,
  constraint city_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create table public.neighbourhood (
  id        serial primary key,
  city_id   smallint not null references public.city (id),
  slug      text not null,
  name      text not null,
  boundary  geography(MultiPolygon, 4326),
  unique (city_id, slug)
);

create table public.tech_park (
  id         serial primary key,
  city_id    smallint not null references public.city (id),
  slug       text not null,
  name       text not null,
  footprint  geography(Polygon, 4326),
  unique (city_id, slug)
);

-- ---------------------------------------------------------------------------
-- Sources
-- ---------------------------------------------------------------------------

-- Nothing is ingested without a source row (plan, "Data sourcing").
create table public.source (
  id               serial primary key,
  name             text unique not null,
  kind             text not null
                   check (kind in ('ats_feed', 'jsonld', 'csv_import', 'suggestion', 'manual')),
  base_url         text,
  permission_note  text not null,
  schedule         text,
  last_run_at      timestamptz,
  last_run_status  text check (last_run_status in ('ok', 'partial', 'failed')),
  last_run_detail  text,
  constraint source_base_url_https check (base_url is null or base_url ~ '^https://')
);

-- ---------------------------------------------------------------------------
-- Companies
-- ---------------------------------------------------------------------------

create table public.sector (
  id    smallserial primary key,
  slug  text unique not null,
  name  text not null
);

create table public.company (
  id                uuid primary key default gen_random_uuid(),
  slug              text unique not null,
  name              text not null,
  domain            text unique not null,
  logo_key          text,
  description       text,
  size_band         text,
  startup_stage     public.startup_stage,
  website_url       text not null,
  careers_url       text,
  status            text not null default 'draft'
                    check (status in ('draft', 'published', 'unpublished', 'merged')),
  merged_into       uuid references public.company (id),
  source_id         int references public.source (id),
  last_verified_at  timestamptz,
  search_doc        tsvector,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint company_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint company_domain_lower check (domain = lower(domain) and domain <> ''),
  constraint company_website_https check (website_url ~ '^https://'),
  constraint company_careers_https check (careers_url is null or careers_url ~ '^https://'),
  constraint company_merged_target check ((status = 'merged') = (merged_into is not null)),
  constraint company_not_merged_into_self check (merged_into is distinct from id)
);
create index company_search_gin on public.company using gin (search_doc);
create index company_name_trgm on public.company using gin (name extensions.gin_trgm_ops);
create index company_startup_stage on public.company (startup_stage) where startup_stage is not null;

create table public.company_type_tag (
  company_id  uuid not null references public.company (id) on delete cascade,
  type        public.company_type not null,
  primary key (company_id, type)
);
create index company_type_tag_type on public.company_type_tag (type, company_id);

create table public.company_sector (
  company_id  uuid not null references public.company (id) on delete cascade,
  sector_id   smallint not null references public.sector (id),
  primary key (company_id, sector_id)
);

-- Only founders the company itself publishes, and only after admin review (D-03).
create table public.company_founder (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.company (id) on delete cascade,
  full_name   text not null check (btrim(full_name) <> ''),
  source_url  text not null check (source_url ~ '^https://'),
  status      text not null default 'draft' check (status in ('draft', 'published')),
  created_at  timestamptz not null default now()
);
create index company_founder_company on public.company_founder (company_id);
create index company_founder_name_trgm
  on public.company_founder using gin (full_name extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Offices
-- ---------------------------------------------------------------------------

create table public.office (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.company (id),
  city_id           smallint not null references public.city (id),
  neighbourhood_id  int references public.neighbourhood (id),
  tech_park_id      int references public.tech_park (id),
  address           text not null,
  geom              geography(Point, 4326) not null,
  accuracy          text not null
                    check (accuracy in ('rooftop', 'building', 'campus', 'street', 'locality')),
  verification      text not null default 'unverified'
                    check (verification in ('unverified', 'auto', 'reviewed')),
  outside_reviewed  boolean not null default false,
  status            text not null default 'draft'
                    check (status in ('draft', 'published', 'unpublished')),
  last_verified_at  timestamptz
);
create index office_geom_gist on public.office using gist (geom);
create index office_city_pub on public.office (city_id) where status = 'published';
create index office_company on public.office (company_id);

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------

create table public.job (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.company (id),
  source_id             int not null references public.source (id),
  external_ref          text,
  title                 text not null,
  title_norm            text not null,
  role_family           text,
  apply_url             text not null,
  dedup_hash            bytea not null,
  exp_min_years         smallint,
  exp_max_years         smallint,
  work_mode             text check (work_mode in ('onsite', 'hybrid', 'remote')),
  posted_at             date,
  status                text not null default 'active'
                        check (status in ('active', 'suspect', 'expired', 'withdrawn', 'draft')),
  first_seen_at         timestamptz not null default now(),
  last_checked_at       timestamptz,
  last_ok_at            timestamptz,
  consecutive_failures  smallint not null default 0,
  unique (company_id, dedup_hash),
  constraint job_apply_url_https check (apply_url ~ '^https://'),
  constraint job_experience_range
    check (exp_min_years is null or exp_max_years is null or exp_min_years <= exp_max_years)
);
create index job_company_active on public.job (company_id) where status in ('active', 'suspect');
create index job_title_trgm on public.job using gin (title_norm extensions.gin_trgm_ops);

create table public.job_city (
  job_id     uuid not null references public.job (id) on delete cascade,
  city_id    smallint not null references public.city (id),
  office_id  uuid references public.office (id),
  primary key (job_id, city_id)
);
create index job_city_city on public.job_city (city_id);

-- ---------------------------------------------------------------------------
-- Rules enforced in the database
-- ---------------------------------------------------------------------------

-- Updated timestamp.
create function public.touch_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger company_touch_updated_at
  before update on public.company
  for each row execute function public.touch_updated_at();

-- The city-boundary rule: a published office must lie inside its city's boundary
-- unless an admin accepted it (outside_reviewed). It also keeps an office's
-- neighbourhood and tech park in the same city as the office.
create function public.office_check_location() returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  city_boundary geography;
begin
  if new.neighbourhood_id is not null and not exists (
    select 1 from neighbourhood n where n.id = new.neighbourhood_id and n.city_id = new.city_id
  ) then
    raise exception 'office neighbourhood % is not in city %', new.neighbourhood_id, new.city_id
      using errcode = 'check_violation';
  end if;

  if new.tech_park_id is not null and not exists (
    select 1 from tech_park t where t.id = new.tech_park_id and t.city_id = new.city_id
  ) then
    raise exception 'office tech park % is not in city %', new.tech_park_id, new.city_id
      using errcode = 'check_violation';
  end if;

  if new.status = 'published' and not new.outside_reviewed then
    select c.boundary into city_boundary from city c where c.id = new.city_id;
    if not st_covers(city_boundary, new.geom) then
      raise exception 'published office is outside the boundary of city % (set outside_reviewed after review)', new.city_id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger office_check_location
  before insert or update on public.office
  for each row execute function public.office_check_location();

-- startup_stage is allowed only on a company tagged 'startup'. The check is deferred
-- to the end of the transaction so a company and its tags can be written in any order.
create function public.company_check_stage() returns trigger
language plpgsql
as $$
declare
  target uuid;
begin
  if tg_table_name = 'company' then
    target := new.id;
  else
    target := old.company_id;
  end if;
  if exists (
    select 1 from company c where c.id = target and c.startup_stage is not null
  ) and not exists (
    select 1 from company_type_tag t where t.company_id = target and t.type = 'startup'
  ) then
    raise exception 'company % has a startup stage but is not tagged startup', target
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger company_stage_needs_startup_tag
  after insert or update of startup_stage on public.company
  deferrable initially deferred
  for each row execute function public.company_check_stage();

create constraint trigger company_type_tag_keeps_stage_valid
  after delete or update of type, company_id on public.company_type_tag
  deferrable initially deferred
  for each row execute function public.company_check_stage();

-- Search document: name (A), description (B), published founders (C). The 'simple'
-- configuration is used so company and founder names are not stemmed. The function
-- takes the name and description as arguments so it also works in a BEFORE INSERT
-- trigger, where the company row does not exist yet.
create function public.company_search_doc(target uuid, doc_name text, doc_description text)
returns tsvector
language sql
stable
set search_path = public, extensions
as $$
  select
    setweight(to_tsvector('simple', coalesce(doc_name, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(doc_description, '')), 'B')
    || setweight(to_tsvector('simple', coalesce((
         select string_agg(f.full_name, ' ')
         from company_founder f
         where f.company_id = target and f.status = 'published'
       ), '')), 'C');
$$;

create function public.company_set_search_doc() returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.search_doc := company_search_doc(new.id, new.name, new.description);
  return new;
end;
$$;

create trigger company_set_search_doc
  before insert or update of name, description on public.company
  for each row execute function public.company_set_search_doc();

create function public.company_founder_refresh_search_doc() returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update company c set search_doc = company_search_doc(c.id, c.name, c.description)
    where c.id = old.company_id;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.company_id is distinct from old.company_id) then
    update company c set search_doc = company_search_doc(c.id, c.name, c.description)
    where c.id = new.company_id;
  end if;
  return null;
end;
$$;

create trigger company_founder_refresh_search_doc
  after insert or update or delete on public.company_founder
  for each row execute function public.company_founder_refresh_search_doc();

-- ---------------------------------------------------------------------------
-- Row-level security: on for every table, no policies until P3-02 (deny by default).
-- ---------------------------------------------------------------------------

alter table public.city enable row level security;
alter table public.neighbourhood enable row level security;
alter table public.tech_park enable row level security;
alter table public.source enable row level security;
alter table public.sector enable row level security;
alter table public.company enable row level security;
alter table public.company_type_tag enable row level security;
alter table public.company_sector enable row level security;
alter table public.company_founder enable row level security;
alter table public.office enable row level security;
alter table public.job enable row level security;
alter table public.job_city enable row level security;
