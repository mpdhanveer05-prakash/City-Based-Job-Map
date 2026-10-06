-- P9-07 (ADR-0016, owner decisions of 6 Oct 2026): evidence for every populated factual field, and publication gates.
--
--   field_evidence        one row per piece of evidence: the record it belongs to (exactly one of company, office,
--                         founder, job), the field, the VALUE it supports (filled in from the record when the evidence is
--                         recorded, so evidence goes stale by itself when the value later changes), the source URL, and
--                         verified_at = the date a person actually checked the source. Recorded evidence is a claim until a
--                         reviewer reviews it (reviewed_at, reviewed_by). Evidence is never edited: a correction is a new
--                         row. Only admins can read it; anon has no access.
--   publication_approval  who approved each publication and when (and each unpublication). Written only by the gates.
--   evidence_report       every populated factual field of a company, its offices, and its founders, with its state:
--                         missing, stale (evidence exists, none for the current value), claimed, or reviewed.
--   publication_problems  why a company cannot be published yet (empty = it can).
--   review_evidence       a reviewer marks evidence reviewed.
--
-- The gates (deferred, so a save that changes tags and publishes in one transaction is judged on its final state) apply
-- to signed-in users, like the reviewer rule in 20261003100000_rls.sql: the migration owner and the synthetic seed are
-- not affected. Publishing a company needs reviewed evidence for its name and website, at least one office with reviewed
-- address and location evidence, and evidence (claimed or reviewed) for every other populated factual field. Publishing
-- an office needs reviewed address and location evidence; publishing a founder needs reviewed full_name evidence. On a
-- company's publication its public "Verified" date (last_verified_at) becomes the oldest verified_at among the reviewed
-- core evidence; today's date is never used in place of a checked date.

-- ---------------------------------------------------------------------------
-- Evidence
-- ---------------------------------------------------------------------------

create table public.field_evidence (
  id           bigint generated always as identity primary key,
  company_id   uuid references public.company (id) on delete cascade,
  office_id    uuid references public.office (id) on delete cascade,
  founder_id   uuid references public.company_founder (id) on delete cascade,
  job_id       uuid references public.job (id) on delete cascade,
  field        text not null,
  value        text not null,
  source_url   text not null check (source_url ~ '^https://[^\s]+$' and length(source_url) <= 2000),
  source_id    integer references public.source (id),
  verified_at  date not null check (verified_at >= date '2000-01-01'),
  note         text check (note is null or length(note) <= 500),
  recorded_by  uuid,
  recorded_at  timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid,
  constraint field_evidence_one_record check (num_nonnulls(company_id, office_id, founder_id, job_id) = 1),
  constraint field_evidence_known_field check (
    (company_id is not null and field in ('name', 'website', 'description', 'types', 'sectors', 'startup_stage', 'ownership_status'))
    or (office_id is not null and field in ('address', 'location'))
    or (founder_id is not null and field = 'full_name')
    or (job_id is not null and field in ('title', 'apply_url'))
  ),
  constraint field_evidence_review_pair check ((reviewed_at is null) = (reviewed_by is null))
);
create index field_evidence_company on public.field_evidence (company_id, field) where company_id is not null;
create index field_evidence_office on public.field_evidence (office_id, field) where office_id is not null;
create index field_evidence_founder on public.field_evidence (founder_id) where founder_id is not null;
create index field_evidence_job on public.field_evidence (job_id) where job_id is not null;

-- The value a field has now, written the way evidence stores it. NULL means the field is empty (unknown).
create function public.evidence_current_value(p_field text, p_company uuid, p_office uuid, p_founder uuid, p_job uuid)
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
      select case p_field when 'title' then j.title when 'apply_url' then j.apply_url end from job j where j.id = p_job)
  end;
$$;

-- New evidence: binds to the field's current value, checks the date, records who recorded it, and starts as a claim.
-- Later changes may only add or (for a reviewer) set the review; the evidence itself never changes.
create function public.field_evidence_guard() returns trigger
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
    new.value := evidence_current_value(new.field, new.company_id, new.office_id, new.founder_id, new.job_id);
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
create trigger field_evidence_guard before insert or update on public.field_evidence
  for each row execute function public.field_evidence_guard();

alter table public.field_evidence enable row level security;
revoke all on public.field_evidence from anon;
revoke truncate, references, trigger on public.field_evidence from authenticated;
create policy field_evidence_admin_read on public.field_evidence for select to authenticated using (public.is_admin('editor'));
create policy field_evidence_editor_insert on public.field_evidence for insert to authenticated with check (public.is_admin('editor'));
create policy field_evidence_reviewer_update on public.field_evidence for update to authenticated
  using (public.is_admin('reviewer')) with check (public.is_admin('reviewer'));
-- No delete policy: evidence is kept; it disappears only with its record (on delete cascade).

create trigger audit_field_evidence after insert or update or delete on public.field_evidence
  for each row execute function public.audit_row_change('id');

-- A reviewer marks evidence reviewed (or takes a review back). SECURITY INVOKER: row-level security and the guard apply.
create function public.review_evidence(p_ids bigint[], p_reviewed boolean default true) returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  if not is_admin('reviewer') then
    raise exception 'only a reviewer or admin can review evidence' using errcode = 'insufficient_privilege';
  end if;
  update field_evidence
     set reviewed_at = case when p_reviewed then now() end,
         reviewed_by = case when p_reviewed then auth.uid() end
   where id = any (p_ids) and (reviewed_at is null) = p_reviewed;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.review_evidence(bigint[], boolean) from public, anon;
grant execute on function public.review_evidence(bigint[], boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- What is supported, and what is missing
-- ---------------------------------------------------------------------------

-- Every populated factual field of the company, its offices, and its founders, with its evidence state:
--   reviewed  reviewed evidence for the current value       claimed  only unreviewed evidence for the current value
--   stale     evidence exists, but none for the current value  missing  no evidence at all
create function public.evidence_report(p_company uuid)
returns table (
  record_type text, record_id uuid, record_label text, field text, current_value text, state text,
  evidence_id bigint, source_url text, verified_at date, reviewed_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with fields as (
    select 'company'::text as record_type, c.id as record_id, c.name as record_label, f.field,
           evidence_current_value(f.field, c.id, null, null, null) as current_value, f.ord
    from company c
    cross join (values ('name', 1), ('website', 2), ('description', 3), ('types', 4), ('sectors', 5),
                       ('startup_stage', 6), ('ownership_status', 7)) as f(field, ord)
    where c.id = p_company
    union all
    select 'office', o.id, o.address, f.field, evidence_current_value(f.field, null, o.id, null, null), 10 + f.ord
    from office o cross join (values ('address', 1), ('location', 2)) as f(field, ord)
    where o.company_id = p_company
    union all
    select 'founder', fo.id, fo.full_name, 'full_name', fo.full_name, 20
    from company_founder fo where fo.company_id = p_company
  ),
  ev as (
    select fl.*, e.id as evidence_id, e.source_url, e.verified_at, e.reviewed_at, e.value = fl.current_value as matches
    from fields fl
    left join field_evidence e
      on e.field = fl.field
     and ((fl.record_type = 'company' and e.company_id = fl.record_id)
       or (fl.record_type = 'office' and e.office_id = fl.record_id)
       or (fl.record_type = 'founder' and e.founder_id = fl.record_id))
    where fl.current_value is not null
  ),
  ranked as (
    -- The best evidence per field: matching and reviewed, then matching, then the most recent.
    select ev.*, row_number() over (
      partition by record_type, record_id, field
      order by matches desc nulls last, (reviewed_at is not null) desc, verified_at desc nulls last, evidence_id desc) as rn
    from ev
  )
  select record_type, record_id, record_label, field, current_value,
         case when evidence_id is null then 'missing'
              when not matches then 'stale'
              when reviewed_at is null then 'claimed'
              else 'reviewed' end,
         evidence_id, source_url, verified_at, reviewed_at
  from ranked where rn = 1
  order by record_type <> 'company', record_label, record_id, field;
$$;
revoke all on function public.evidence_report(uuid) from public, anon;
grant execute on function public.evidence_report(uuid) to authenticated;

-- The oldest verified_at among the reviewed evidence for a record's given fields, or null if any of them is not reviewed.
create function public.reviewed_as_of(p_company uuid, p_office uuid, p_fields text[]) returns date
language sql
stable
set search_path = public
as $$
  select case when count(*) = cardinality(p_fields) then min(d) end
  from (
    select f, (select max(e.verified_at) from field_evidence e
               where e.field = f and e.reviewed_at is not null
                 and e.company_id is not distinct from p_company and e.office_id is not distinct from p_office
                 and e.value = evidence_current_value(f, p_company, p_office, null, null)) as d
    from unnest(p_fields) f
  ) x
  where d is not null;
$$;

-- Why the company cannot be published yet; empty when it can.
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

-- ---------------------------------------------------------------------------
-- Publication approval and the gates
-- ---------------------------------------------------------------------------

create table public.publication_approval (
  id           bigint generated always as identity primary key,
  company_id   uuid references public.company (id) on delete cascade,
  office_id    uuid references public.office (id) on delete cascade,
  founder_id   uuid references public.company_founder (id) on delete cascade,
  action       text not null check (action in ('published', 'unpublished')),
  approved_by  uuid not null,
  approved_at  timestamptz not null default now(),
  constraint publication_approval_one_record check (num_nonnulls(company_id, office_id, founder_id) = 1)
);
alter table public.publication_approval enable row level security;
revoke all on public.publication_approval from anon;
revoke insert, update, delete, truncate, references, trigger on public.publication_approval from authenticated;
create policy publication_approval_admin_read on public.publication_approval for select to authenticated using (public.is_admin('editor'));

-- Runs at commit. SECURITY DEFINER only to write publication_approval (which nobody can write through the API) and the
-- company's verified date; every check reads the same rows the caller could.
create function public.publication_gate() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  became    boolean := new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published');
  left_pub  boolean := tg_op = 'UPDATE' and old.status = 'published' and new.status is distinct from 'published';
  problems  text[];
  as_of     date;
begin
  if uid is null or not (became or left_pub) then
    return null;
  end if;
  -- The row as it is at commit (a later statement in the transaction may have changed it again).
  if tg_table_name = 'company' then
    perform 1 from company where id = new.id and status = new.status;
  elsif tg_table_name = 'office' then
    perform 1 from office where id = new.id and status = new.status;
  else
    perform 1 from company_founder where id = new.id and status = new.status;
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
      -- The public "Verified" date: the oldest checked date among the reviewed core facts.
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
    else
      if not exists (select 1 from field_evidence e where e.founder_id = new.id and e.field = 'full_name'
                     and e.reviewed_at is not null and e.value = new.full_name) then
        raise exception 'publishing needs evidence: the founder''s name needs reviewed evidence' using errcode = 'check_violation';
      end if;
    end if;
  end if;

  insert into publication_approval (company_id, office_id, founder_id, action, approved_by)
  values (case when tg_table_name = 'company' then new.id end, case when tg_table_name = 'office' then new.id end,
          case when tg_table_name = 'company_founder' then new.id end,
          case when became then 'published' else 'unpublished' end, uid);
  return null;
end;
$$;

create constraint trigger company_publication_gate after insert or update of status on public.company
  deferrable initially deferred for each row execute function public.publication_gate();
create constraint trigger office_publication_gate after insert or update of status on public.office
  deferrable initially deferred for each row execute function public.publication_gate();
create constraint trigger company_founder_publication_gate after insert or update of status on public.company_founder
  deferrable initially deferred for each row execute function public.publication_gate();

-- ---------------------------------------------------------------------------
-- Records already published without evidence: flagged for review, not hidden
-- ---------------------------------------------------------------------------

-- Every published company with at least one populated field that is missing evidence, stale, or only claimed.
create function public.evidence_gaps(p_limit integer default 200)
returns table (company_id uuid, slug text, name text, missing integer, stale integer, claimed integer)
language sql
stable
set search_path = public
as $$
  select c.id, c.slug, c.name,
         count(*) filter (where r.state = 'missing')::int,
         count(*) filter (where r.state = 'stale')::int,
         count(*) filter (where r.state = 'claimed')::int
  from company c
  cross join lateral evidence_report(c.id) r
  where c.status = 'published' and r.state <> 'reviewed'
  group by c.id, c.slug, c.name
  order by count(*) filter (where r.state in ('missing', 'stale')) desc, c.name
  limit greatest(p_limit, 0);
$$;
revoke all on function public.evidence_gaps(integer) from public, anon;
grant execute on function public.evidence_gaps(integer) to authenticated;
