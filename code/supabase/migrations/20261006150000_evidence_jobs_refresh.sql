-- Follow-ups to P9-07 (owner decisions, 6 Oct 2026; ADR-0022):
--
--   1. Jobs need evidence: title, employer, location and work arrangement, and the official application URL. The
--      pipeline records it from the job's own posting when it reads a feed; an admin publishing a job needs it reviewed.
--      job.last_ok_at stays the last successful check; job.closed_at records when a job closed (expired or withdrawn).
--   2. A change to a fact of a public record (published company, office, founder; active or suspect job) made by a
--      signed-in user commits only if the new value already has reviewed evidence. Evidence may therefore be recorded for
--      a PROPOSED value (`value` given explicitly) before the record changes.
--   3. A reviewer may review evidence they recorded; `self_reviewed` shows it. Editors still cannot review.
--   4. Refresh: each field has a check interval; the pipeline checks due evidence against its source and records the
--      outcome (fetch_failed, value_found, value_not_found, reachable). A check never changes verified_at: only a person
--      recording new evidence does.
--   5. The build snapshot says, per company and job, whether its required evidence is complete (`evidence_complete`), so
--      a production build and the launch gate can refuse records published without it.

-- ---------------------------------------------------------------------------
-- Evidence: job fields, proposed values, self-review
-- ---------------------------------------------------------------------------

alter table public.field_evidence drop constraint field_evidence_known_field;
alter table public.field_evidence add constraint field_evidence_known_field check (
  (company_id is not null and field in ('name', 'website', 'description', 'types', 'sectors', 'startup_stage', 'ownership_status'))
  or (office_id is not null and field in ('address', 'location'))
  or (founder_id is not null and field = 'full_name')
  or (job_id is not null and field in ('title', 'employer', 'location', 'apply_url'))
);
-- Old rows used 'title'/'apply_url' only; nothing to migrate.

alter table public.field_evidence
  add column self_reviewed boolean generated always as (reviewed_by is not null and reviewed_by = recorded_by) stored;

create or replace function public.evidence_current_value(p_field text, p_company uuid, p_office uuid, p_founder uuid, p_job uuid)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select case
    when p_company is not null then (
      select case p_field
        when 'name' then c.name
        when 'website' then c.website_url
        when 'description' then nullif(btrim(c.description), '')
        when 'startup_stage' then c.startup_stage::text
        when 'ownership_status' then c.ownership_status::text
        when 'types' then (select string_agg(t.type::text, ',' order by t.type::text) from company_type_tag t where t.company_id = c.id)
        when 'sectors' then (select string_agg(s.slug, ',' order by s.slug) from company_sector cs join sector s on s.id = cs.sector_id where cs.company_id = c.id)
      end
      from company c where c.id = p_company)
    when p_office is not null then (
      select case p_field
        when 'address' then o.address
        when 'location' then round(st_y(o.geom::geometry)::numeric, 5)::text || ',' || round(st_x(o.geom::geometry)::numeric, 5)::text
      end
      from office o where o.id = p_office)
    when p_founder is not null then (
      select case p_field when 'full_name' then f.full_name end from company_founder f where f.id = p_founder)
    when p_job is not null then (
      select case p_field
        when 'title' then j.title
        when 'apply_url' then j.apply_url
        when 'employer' then (select c.name from company c where c.id = j.company_id)
        -- The cities it is listed in, and the work arrangement: "bangalore,chennai|hybrid".
        when 'location' then coalesce((select string_agg(ci.slug, ',' order by ci.slug) from job_city jc join city ci on ci.id = jc.city_id
                                       where jc.job_id = j.id), '') || '|' || coalesce(j.work_mode, 'unstated')
      end
      from job j where j.id = p_job)
  end;
$$;

-- As before, plus: an explicit `value` records evidence for a proposed value (checked against nothing: a reviewer reads
-- the source). Without one, the record's current value is used.
create or replace function public.field_evidence_guard() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select auth.uid()) is not null and not is_admin('editor') then
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
    if (select auth.uid()) is not null then
      new.recorded_by := auth.uid();
      new.reviewed_at := null;
      new.reviewed_by := null;
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
  if (select auth.uid()) is not null and (new.reviewed_at, new.reviewed_by) is distinct from (old.reviewed_at, old.reviewed_by) then
    if not is_admin('reviewer') then
      raise exception 'only a reviewer or admin can review evidence' using errcode = 'insufficient_privilege';
    end if;
    if new.reviewed_at is null then
      new.reviewed_by := null;
    else
      new.reviewed_at := now();
      new.reviewed_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refresh checks
-- ---------------------------------------------------------------------------

-- How often each field's evidence is checked against its source, and how (owner's initial schedule: jobs daily, company
-- links weekly, office and funding information monthly). `text` looks for the value on the page; `reachable` only
-- confirms the page answers (a classification cannot be read off a page reliably).
create table public.evidence_refresh_policy (
  record_type  text not null check (record_type in ('company', 'office', 'founder', 'job')),
  field        text not null,
  check_every  interval not null,
  method       text not null check (method in ('text', 'reachable')),
  primary key (record_type, field)
);
insert into public.evidence_refresh_policy (record_type, field, check_every, method) values
  ('job', 'title', interval '1 day', 'text'),
  ('job', 'employer', interval '1 day', 'text'),
  ('job', 'location', interval '1 day', 'reachable'),
  ('job', 'apply_url', interval '1 day', 'reachable'),
  ('company', 'name', interval '7 days', 'text'),
  ('company', 'website', interval '7 days', 'reachable'),
  ('company', 'description', interval '7 days', 'reachable'),
  ('company', 'types', interval '30 days', 'reachable'),
  ('company', 'sectors', interval '30 days', 'reachable'),
  ('company', 'startup_stage', interval '30 days', 'reachable'),
  ('company', 'ownership_status', interval '30 days', 'reachable'),
  ('office', 'address', interval '30 days', 'text'),
  ('office', 'location', interval '30 days', 'reachable'),
  ('founder', 'full_name', interval '30 days', 'text');
alter table public.evidence_refresh_policy enable row level security;
revoke all on public.evidence_refresh_policy from anon;
create policy evidence_refresh_policy_admin_read on public.evidence_refresh_policy for select to authenticated using (public.is_admin('editor'));

create table public.evidence_check (
  id           bigint generated always as identity primary key,
  evidence_id  bigint not null references public.field_evidence (id) on delete cascade,
  checked_at   timestamptz not null default now(),
  -- fetch_failed     the source could not be read (network, HTTP error): nothing is known about the value
  -- value_found      the value is on the source page
  -- value_not_found  the page was read but the value is not on it: a possible change, for a person to confirm
  -- reachable        the page answered; the method does not read the value
  outcome      text not null check (outcome in ('fetch_failed', 'value_found', 'value_not_found', 'reachable')),
  http_status  integer,
  note         text check (note is null or length(note) <= 500)
);
create index evidence_check_latest on public.evidence_check (evidence_id, checked_at desc);
alter table public.evidence_check enable row level security;
revoke all on public.evidence_check from anon;
revoke insert, update, delete, truncate, references, trigger on public.evidence_check from authenticated;
create policy evidence_check_admin_read on public.evidence_check for select to authenticated using (public.is_admin('editor'));

-- ---------------------------------------------------------------------------
-- The state of one field
-- ---------------------------------------------------------------------------

-- empty (no value), missing, stale (evidence only for another value), claimed, or reviewed, with the best evidence and
-- its latest check.
create function public.field_evidence_state(p_company uuid, p_office uuid, p_founder uuid, p_job uuid, p_field text)
returns table (
  state text, current_value text, evidence_id bigint, source_url text, verified_at date, reviewed_at timestamptz,
  self_reviewed boolean, last_check_at timestamptz, last_check_outcome text
)
language sql
stable
set search_path = public
as $$
  with cur as (select evidence_current_value(p_field, p_company, p_office, p_founder, p_job) as v),
  best as (
    select e.id, e.value, e.source_url, e.verified_at, e.reviewed_at, e.self_reviewed, e.value = (select v from cur) as matches
    from field_evidence e
    where e.field = p_field
      and e.company_id is not distinct from p_company and e.office_id is not distinct from p_office
      and e.founder_id is not distinct from p_founder and e.job_id is not distinct from p_job
    order by (e.value = (select v from cur)) desc, (e.reviewed_at is not null) desc, e.verified_at desc, e.id desc
    limit 1
  )
  select case when (select v from cur) is null then 'empty'
              when b.id is null then 'missing'
              when not b.matches then 'stale'
              when b.reviewed_at is null then 'claimed'
              else 'reviewed' end,
         (select v from cur), b.id, b.source_url, b.verified_at, b.reviewed_at, b.self_reviewed, c.checked_at, c.outcome
  from (select 1) one
  left join best b on true
  left join lateral (select ch.checked_at, ch.outcome from evidence_check ch where ch.evidence_id = b.id order by ch.checked_at desc limit 1) c on true;
$$;
revoke all on function public.field_evidence_state(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.field_evidence_state(uuid, uuid, uuid, uuid, text) to authenticated;

-- The report gains the self-review flag and the latest check (a new result shape, so it is replaced).
drop function public.evidence_gaps(integer);
drop function public.publication_problems(uuid);
drop function public.evidence_report(uuid);

create function public.evidence_report(p_company uuid)
returns table (
  record_type text, record_id uuid, record_label text, field text, current_value text, state text,
  evidence_id bigint, source_url text, verified_at date, reviewed_at timestamptz, self_reviewed boolean,
  last_check_at timestamptz, last_check_outcome text
)
language sql
stable
set search_path = public
as $$
  with fields as (
    select 'company'::text as record_type, c.id as record_id, c.name as record_label, f.field, f.ord,
           c.id as company_id, null::uuid as office_id, null::uuid as founder_id
    from company c
    cross join (values ('name', 1), ('website', 2), ('description', 3), ('types', 4), ('sectors', 5),
                       ('startup_stage', 6), ('ownership_status', 7)) as f(field, ord)
    where c.id = p_company
    union all
    select 'office', o.id, o.address, f.field, 10 + f.ord, null, o.id, null
    from office o cross join (values ('address', 1), ('location', 2)) as f(field, ord)
    where o.company_id = p_company
    union all
    select 'founder', fo.id, fo.full_name, 'full_name', 20, null, null, fo.id
    from company_founder fo where fo.company_id = p_company
  )
  select f.record_type, f.record_id, f.record_label, f.field, s.current_value, s.state, s.evidence_id, s.source_url, s.verified_at,
         s.reviewed_at, s.self_reviewed, s.last_check_at, s.last_check_outcome
  from fields f
  cross join lateral field_evidence_state(f.company_id, f.office_id, f.founder_id, null, f.field) s
  where s.state <> 'empty'
  order by f.record_type <> 'company', f.record_label, f.record_id, f.ord;
$$;
revoke all on function public.evidence_report(uuid) from public, anon;
grant execute on function public.evidence_report(uuid) to authenticated;

create function public.job_evidence_report(p_job uuid)
returns table (
  record_type text, record_id uuid, record_label text, field text, current_value text, state text,
  evidence_id bigint, source_url text, verified_at date, reviewed_at timestamptz, self_reviewed boolean,
  last_check_at timestamptz, last_check_outcome text
)
language sql
stable
set search_path = public
as $$
  select 'job'::text, j.id, j.title, f.field, s.current_value, s.state, s.evidence_id, s.source_url, s.verified_at,
         s.reviewed_at, s.self_reviewed, s.last_check_at, s.last_check_outcome
  from job j
  cross join (values ('title', 1), ('employer', 2), ('location', 3), ('apply_url', 4)) as f(field, ord)
  cross join lateral field_evidence_state(null, null, null, j.id, f.field) s
  where j.id = p_job and s.state <> 'empty'
  order by f.ord;
$$;
revoke all on function public.job_evidence_report(uuid) from public, anon;
grant execute on function public.job_evidence_report(uuid) to authenticated;

create function public.publication_problems(p_company uuid) returns text[]
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
    select 2, 'at least one office needs reviewed evidence for its address and location'
    where not exists (
      select 1 from office o where o.company_id = p_company and o.status <> 'unpublished'
        and reviewed_as_of(null, o.id, array['address', 'location']) is not null)
    union all
    select 3, format('the %s has no evidence for its current value (it is %s)', replace(r.field, '_', ' '), r.state)
    from evidence_report(p_company) r
    where r.record_type = 'company' and r.field not in ('name', 'website') and r.state in ('missing', 'stale')
  ) p;
$$;
revoke all on function public.publication_problems(uuid) from public, anon;
grant execute on function public.publication_problems(uuid) to authenticated;

create function public.job_publication_problems(p_job uuid) returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(format('the job''s %s needs reviewed evidence (it is %s)', replace(r.field, '_', ' '), r.state)
                            order by r.field), '{}')
  from job_evidence_report(p_job) r
  where r.state <> 'reviewed';
$$;
revoke all on function public.job_publication_problems(uuid) from public, anon;
grant execute on function public.job_publication_problems(uuid) to authenticated;

-- Published companies with a fact that is missing, stale, only claimed, or whose latest source check failed or did not
-- find the value.
create function public.evidence_gaps(p_limit integer default 200)
returns table (company_id uuid, slug text, name text, missing integer, stale integer, claimed integer, check_problems integer)
language sql
stable
set search_path = public
as $$
  select c.id, c.slug, c.name,
         count(*) filter (where r.state = 'missing')::int,
         count(*) filter (where r.state = 'stale')::int,
         count(*) filter (where r.state = 'claimed')::int,
         count(*) filter (where r.last_check_outcome in ('fetch_failed', 'value_not_found'))::int
  from company c
  cross join lateral evidence_report(c.id) r
  where c.status = 'published'
    and (r.state <> 'reviewed' or r.last_check_outcome in ('fetch_failed', 'value_not_found'))
  group by c.id, c.slug, c.name
  order by count(*) filter (where r.state in ('missing', 'stale')) desc, c.name
  limit greatest(p_limit, 0);
$$;
revoke all on function public.evidence_gaps(integer) from public, anon;
grant execute on function public.evidence_gaps(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Jobs: closure, and the publication gate
-- ---------------------------------------------------------------------------

alter table public.job add column closed_at timestamptz;
create function public.job_track_closure() returns trigger
language plpgsql
as $$
begin
  if new.status in ('expired', 'withdrawn') and (tg_op = 'INSERT' or old.status not in ('expired', 'withdrawn')) then
    new.closed_at := now();
  elsif new.status not in ('expired', 'withdrawn') then
    new.closed_at := null;
  end if;
  return new;
end;
$$;
create trigger job_track_closure before insert or update of status on public.job
  for each row execute function public.job_track_closure();
update public.job set closed_at = coalesce(last_checked_at, first_seen_at) where status in ('expired', 'withdrawn');

alter table public.publication_approval add column job_id uuid references public.job (id) on delete cascade;
alter table public.publication_approval drop constraint publication_approval_one_record;
alter table public.publication_approval add constraint publication_approval_one_record check (num_nonnulls(company_id, office_id, founder_id, job_id) = 1);

create or replace function public.publication_gate() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  is_job    boolean := tg_table_name = 'job';
  became    boolean;
  left_pub  boolean;
  problems  text[];
  as_of     date;
begin
  if is_job then
    became := new.status in ('active', 'suspect') and (tg_op = 'INSERT' or old.status not in ('active', 'suspect'));
    left_pub := tg_op = 'UPDATE' and old.status in ('active', 'suspect') and new.status not in ('active', 'suspect');
  else
    became := new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published');
    left_pub := tg_op = 'UPDATE' and old.status = 'published' and new.status is distinct from 'published';
  end if;
  if uid is null or not (became or left_pub) then
    return null;
  end if;
  -- The row as it is at commit.
  if tg_table_name = 'company' then
    perform 1 from company where id = new.id and status = new.status;
  elsif tg_table_name = 'office' then
    perform 1 from office where id = new.id and status = new.status;
  elsif tg_table_name = 'company_founder' then
    perform 1 from company_founder where id = new.id and status = new.status;
  else
    perform 1 from job where id = new.id and status = new.status;
  end if;
  if not found then
    return null;
  end if;

  if became then
    if tg_table_name = 'company' then
      problems := publication_problems(new.id);
      if cardinality(problems) > 0 then
        raise exception 'publishing needs evidence: %', array_to_string(problems, '; ') using errcode = 'check_violation';
      end if;
      select least(reviewed_as_of(new.id, null, array['name', 'website']),
                   (select max(reviewed_as_of(null, o.id, array['address', 'location'])) from office o where o.company_id = new.id))
        into as_of;
      update company set last_verified_at = as_of::timestamptz where id = new.id;
    elsif tg_table_name = 'office' then
      as_of := reviewed_as_of(null, new.id, array['address', 'location']);
      if as_of is null then
        raise exception 'publishing needs evidence: the office''s address and location need reviewed evidence' using errcode = 'check_violation';
      end if;
      update office set last_verified_at = as_of::timestamptz where id = new.id;
    elsif tg_table_name = 'company_founder' then
      if not exists (select 1 from field_evidence e where e.founder_id = new.id and e.field = 'full_name'
                     and e.reviewed_at is not null and e.value = new.full_name) then
        raise exception 'publishing needs evidence: the founder''s name needs reviewed evidence' using errcode = 'check_violation';
      end if;
    else
      problems := job_publication_problems(new.id);
      if cardinality(problems) > 0 then
        raise exception 'publishing needs evidence: %', array_to_string(problems, '; ') using errcode = 'check_violation';
      end if;
    end if;
  end if;

  insert into publication_approval (company_id, office_id, founder_id, job_id, action, approved_by)
  values (case when tg_table_name = 'company' then new.id end, case when tg_table_name = 'office' then new.id end,
          case when tg_table_name = 'company_founder' then new.id end, case when is_job then new.id end,
          case when became then 'published' else 'unpublished' end, uid);
  return null;
end;
$$;

create constraint trigger job_publication_gate after insert or update of status on public.job
  deferrable initially deferred for each row execute function public.publication_gate();

-- ---------------------------------------------------------------------------
-- A change to a public record's fact needs reviewed evidence for the new value
-- ---------------------------------------------------------------------------

create function public.require_reviewed_values(p_company uuid, p_office uuid, p_founder uuid, p_job uuid, p_fields text[]) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f text;
  st text;
begin
  foreach f in array p_fields loop
    select s.state into st from field_evidence_state(p_company, p_office, p_founder, p_job, f) s;
    if st not in ('reviewed', 'empty') then
      raise exception 'this record is public: the new % must have reviewed evidence before it changes (it is %). Record evidence for the new value, have it reviewed, then save again',
        replace(f, '_', ' '), st using errcode = 'check_violation';
    end if;
  end loop;
end;
$$;
revoke all on function public.require_reviewed_values(uuid, uuid, uuid, uuid, text[]) from public, anon, authenticated;

create function public.published_change_gate() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed text[] := '{}';
  pub boolean;
begin
  if auth.uid() is null then
    return null;
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
    select status = 'published' into pub from company where id = coalesce(new.company_id, old.company_id);
    if coalesce(pub, false) then
      perform require_reviewed_values(coalesce(new.company_id, old.company_id), null, null, null,
                                      array[case when tg_table_name = 'company_type_tag' then 'types' else 'sectors' end]);
    end if;
  elsif tg_table_name = 'job_city' then
    select status in ('active', 'suspect') into pub from job where id = coalesce(new.job_id, old.job_id);
    if coalesce(pub, false) then
      perform require_reviewed_values(null, null, null, coalesce(new.job_id, old.job_id), array['location']);
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger company_published_change after update on public.company
  deferrable initially deferred for each row execute function public.published_change_gate();
create constraint trigger office_published_change after update on public.office
  deferrable initially deferred for each row execute function public.published_change_gate();
create constraint trigger company_founder_published_change after update on public.company_founder
  deferrable initially deferred for each row execute function public.published_change_gate();
create constraint trigger job_published_change after update on public.job
  deferrable initially deferred for each row execute function public.published_change_gate();
create constraint trigger company_type_tag_published_change after insert or delete on public.company_type_tag
  deferrable initially deferred for each row execute function public.published_change_gate();
create constraint trigger company_sector_published_change after insert or delete on public.company_sector
  deferrable initially deferred for each row execute function public.published_change_gate();
create constraint trigger job_city_published_change after insert or delete on public.job_city
  deferrable initially deferred for each row execute function public.published_change_gate();

-- ---------------------------------------------------------------------------
-- The pipeline: evidence from the feed, and the source checks
-- ---------------------------------------------------------------------------

-- Called after the pipeline writes a job it read from the employer's feed: the job's own posting (its apply URL) is the
-- source, and the read is the check, so verified_at is today. Evidence is added only when none supports the current
-- value yet, so a job read every six hours does not pile up rows; the read itself is job.last_ok_at.
create function public.record_feed_job_evidence(p_job uuid) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  f text;
  n integer := 0;
  url text;
begin
  select apply_url into url from job where id = p_job;
  if url is null then
    return 0;
  end if;
  foreach f in array array['title', 'employer', 'location', 'apply_url'] loop
    if (select s.state from field_evidence_state(null, null, null, p_job, f) s) in ('missing', 'stale') then
      insert into field_evidence (job_id, field, source_url, verified_at, note)
      values (p_job, f, url, current_date, 'read from the employer''s job feed by the pipeline');
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.record_feed_job_evidence(uuid) from public, anon, authenticated;
grant execute on function public.record_feed_job_evidence(uuid) to pipeline, service_role;

-- Evidence due a check: the evidence supporting each public record's current value whose last check (or, if never
-- checked, its verified date) is older than the field's interval.
create function public.evidence_due(p_limit integer default 200)
returns table (evidence_id bigint, record_type text, field text, value text, source_url text, method text)
language sql
stable
security definer
set search_path = public
as $$
  with current_ev as (
    select e.id, case when e.company_id is not null then 'company' when e.office_id is not null then 'office'
                      when e.founder_id is not null then 'founder' else 'job' end as record_type,
           e.field, e.value, e.source_url, e.verified_at
    from field_evidence e
    where e.value = evidence_current_value(e.field, e.company_id, e.office_id, e.founder_id, e.job_id)
      and (exists (select 1 from company c where c.id = e.company_id and c.status = 'published')
        or exists (select 1 from office o where o.id = e.office_id and o.status = 'published')
        or exists (select 1 from company_founder f where f.id = e.founder_id and f.status = 'published')
        or exists (select 1 from job j where j.id = e.job_id and j.status in ('active', 'suspect')))
  )
  select ce.id, ce.record_type, ce.field, ce.value, ce.source_url, p.method
  from current_ev ce
  join evidence_refresh_policy p on p.record_type = ce.record_type and p.field = ce.field
  where coalesce((select max(ch.checked_at) from evidence_check ch where ch.evidence_id = ce.id), ce.verified_at::timestamptz)
        < now() - p.check_every
  order by coalesce((select max(ch.checked_at) from evidence_check ch where ch.evidence_id = ce.id), ce.verified_at::timestamptz)
  limit greatest(p_limit, 0);
$$;
revoke all on function public.evidence_due(integer) from public, anon, authenticated;
grant execute on function public.evidence_due(integer) to pipeline, service_role;

-- Records one check. It never changes the evidence or its verified_at.
create function public.record_evidence_check(p_evidence bigint, p_outcome text, p_http_status integer default null, p_note text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into evidence_check (evidence_id, outcome, http_status, note) values (p_evidence, p_outcome, p_http_status, left(p_note, 500));
$$;
revoke all on function public.record_evidence_check(bigint, text, integer, text) from public, anon, authenticated;
grant execute on function public.record_evidence_check(bigint, text, integer, text) to pipeline, service_role;

-- Evidence whose latest check failed or did not find the value, for the Review page.
create function public.refresh_problems(p_limit integer default 200)
returns table (evidence_id bigint, record_type text, record_id uuid, company_id uuid, label text, field text, source_url text,
               outcome text, checked_at timestamptz, http_status integer)
language sql
stable
set search_path = public
as $$
  select e.id,
         case when e.company_id is not null then 'company' when e.office_id is not null then 'office'
              when e.founder_id is not null then 'founder' else 'job' end,
         coalesce(e.company_id, e.office_id, e.founder_id, e.job_id),
         coalesce(e.company_id, o.company_id, f.company_id, j.company_id),
         coalesce(c.name, o.address, f.full_name, j.title),
         e.field, e.source_url, ch.outcome, ch.checked_at, ch.http_status
  from field_evidence e
  join lateral (select * from evidence_check x where x.evidence_id = e.id order by x.checked_at desc limit 1) ch on true
  left join company c on c.id = e.company_id
  left join office o on o.id = e.office_id
  left join company_founder f on f.id = e.founder_id
  left join job j on j.id = e.job_id
  where ch.outcome in ('fetch_failed', 'value_not_found')
  order by ch.outcome = 'value_not_found' desc, ch.checked_at desc
  limit greatest(p_limit, 0);
$$;
revoke all on function public.refresh_problems(integer) from public, anon;
grant execute on function public.refresh_problems(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Is the required evidence complete? (for the build and the launch gate)
-- ---------------------------------------------------------------------------

-- A published company: nothing blocks publication, and every published office and founder has its reviewed evidence.
-- SECURITY DEFINER so the build (anon key) can ask; it answers only yes or no, and only for a published company.
create function public.company_evidence_complete(p_company uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when not exists (select 1 from company c where c.id = p_company and c.status = 'published') then null
    else cardinality(publication_problems(p_company)) = 0
     and not exists (select 1 from office o where o.company_id = p_company and o.status = 'published'
                     and reviewed_as_of(null, o.id, array['address', 'location']) is null)
     and not exists (select 1 from company_founder f where f.company_id = p_company and f.status = 'published'
                     and (select s.state from field_evidence_state(null, null, f.id, null, 'full_name') s) <> 'reviewed')
  end;
$$;
grant execute on function public.company_evidence_complete(uuid) to anon, authenticated;

-- An active or suspect job: every required field has evidence for its current value (from the feed or reviewed).
create function public.job_evidence_complete(p_job uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when not exists (select 1 from job j where j.id = p_job and j.status in ('active', 'suspect')) then null
    else not exists (select 1 from unnest(array['title', 'employer', 'location', 'apply_url']) f
                     where (select s.state from field_evidence_state(null, null, null, p_job, f) s) not in ('claimed', 'reviewed'))
  end;
$$;
grant execute on function public.job_evidence_complete(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The build snapshot
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
        where o.city_id = ci.id and o.status = 'published'), '[]'::jsonb),
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
