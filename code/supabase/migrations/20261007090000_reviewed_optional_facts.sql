-- Restores the agreed publication rule (owner, 6 Oct 2026). 20261006150000 let a company publish when its optional
-- facts (description, types, sectors, startup stage, ownership status) had only claimed evidence. The rule is:
--   * core facts (name, website, and an office's address and location) need reviewed evidence;
--   * every other populated public company fact also needs reviewed evidence for its current value;
--   * an optional fact may stay unknown (empty), and then needs nothing.
-- Employer-feed jobs keep the separate ADR-0022 automation rules (job_evidence_complete is unchanged).

create or replace function public.publication_problems(p_company uuid) returns text[]
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
    select 3, format('the %s needs reviewed evidence for its current value (it is %s); remove it to leave it unknown',
                     replace(r.field, '_', ' '), r.state)
    from evidence_report(p_company) r
    where r.record_type = 'company' and r.field not in ('name', 'website') and r.state <> 'reviewed'
  ) p;
$$;
