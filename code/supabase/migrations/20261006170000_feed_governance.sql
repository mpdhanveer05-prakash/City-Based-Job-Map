-- ADR-0022, amended 6 Oct 2026 (owner): automatic publication from employer feeds only under stated conditions.
--
--   * Only an APPROVED feed is read: a reviewer confirms it is the employer's official feed or an authorised source
--     (approve_job_feed records who and when). The pipeline loads approved, active feeds only.
--   * Each feed event is recorded in feed_event: a job inserted, a field changed (with old and new value), a job held
--     for review (its application link moved to another domain, or the feed lists one reference twice), a job marked
--     suspect or closed because it left the feed. Together with the evidence the pipeline records, that is the
--     provenance of every feed-sourced job.
--   * A held change is not applied: the job keeps its current, evidenced values until a person decides.
--   * A failed fetch changes no job (unchanged, sync.py); only a job missing from a feed that WAS read can close, and
--     only on the second run (two strikes, plan.py).

alter table public.job_feed
  add column approved_by uuid,
  add column approved_at timestamptz,
  add column approval_note text check (approval_note is null or length(approval_note) <= 500),
  add constraint job_feed_approval_pair check ((approved_by is null) = (approved_at is null));

-- Approval columns change only inside approve_job_feed; editing a feed's provider, identifier, or company withdraws it.
create function public.job_feed_guard() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.feed_approval', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.provider, new.identifier, new.company_id) is distinct from (old.provider, old.identifier, old.company_id) then
    new.approved_by := null;  -- a different feed needs a new approval
    new.approved_at := null;
    new.approval_note := null;
    return new;
  end if;
  if (select auth.uid()) is not null
     and (new.approved_by, new.approved_at) is distinct from
         (case when tg_op = 'UPDATE' then old.approved_by end, case when tg_op = 'UPDATE' then old.approved_at end) then
    raise exception 'a feed is approved only through approve_job_feed' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger job_feed_guard before insert or update on public.job_feed for each row execute function public.job_feed_guard();

-- Approval is a reviewer's act, recorded as the signed-in reviewer with a note saying why the feed is official.
create function public.approve_job_feed(p_feed integer, p_note text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  approver uuid := auth.uid();
begin
  if approver is null or not is_admin('reviewer') then
    raise exception 'only a reviewer or admin can approve a feed' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'say why this is the employer''s official feed or an authorised source' using errcode = 'check_violation';
  end if;
  perform set_config('app.feed_approval', 'on', true);
  update job_feed set approved_by = approver, approved_at = now(), approval_note = btrim(p_note) where id = p_feed;
  perform set_config('app.feed_approval', 'off', true);
  if not found then
    raise exception 'no feed %', p_feed using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.approve_job_feed(integer, text) from public, anon;
grant execute on function public.approve_job_feed(integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Feed events: provenance and held changes
-- ---------------------------------------------------------------------------

create table public.feed_event (
  id         bigint generated always as identity primary key,
  feed_id    integer not null references public.job_feed (id) on delete cascade,
  job_id     uuid references public.job (id) on delete cascade,
  at         timestamptz not null default now(),
  kind       text not null check (kind in ('inserted', 'changed', 'held_domain_change', 'held_ambiguous', 'suspect_missing', 'closed_missing')),
  field      text,
  old_value  text,
  new_value  text,
  external_ref text,
  resolved_at timestamptz,
  resolved_by uuid
);
create index feed_event_open on public.feed_event (at desc) where kind like 'held_%' and resolved_at is null;
alter table public.feed_event enable row level security;
revoke all on public.feed_event from anon;
revoke insert, delete, truncate, references, trigger on public.feed_event from authenticated;
create policy feed_event_admin_read on public.feed_event for select to authenticated using (public.is_admin('editor'));
create policy feed_event_reviewer_resolve on public.feed_event for update to authenticated
  using (public.is_admin('reviewer')) with check (public.is_admin('reviewer'));
grant select, insert on public.feed_event to pipeline;
grant usage on sequence public.feed_event_id_seq to pipeline;
create policy feed_event_pipeline on public.feed_event for all to pipeline using (true) with check (true);

-- The evidence the pipeline records names the feed it came from.
drop function public.record_feed_job_evidence(uuid);
create function public.record_feed_job_evidence(p_job uuid, p_feed integer default null) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  f text;
  n integer := 0;
  url text;
  origin text;
begin
  select apply_url into url from job where id = p_job;
  if url is null then
    return 0;
  end if;
  select format('read from approved feed #%s (%s %s) by the pipeline', jf.id, jf.provider, jf.identifier) into origin
  from job_feed jf where jf.id = p_feed;
  foreach f in array array['title', 'employer', 'location', 'apply_url'] loop
    if (select s.state from field_evidence_state(null, null, null, p_job, f) s) in ('missing', 'stale') then
      insert into field_evidence (job_id, field, source_url, verified_at, note)
      values (p_job, f, url, current_date, coalesce(origin, 'read from the employer''s job feed by the pipeline'));
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.record_feed_job_evidence(uuid, integer) from public, anon, authenticated;
grant execute on function public.record_feed_job_evidence(uuid, integer) to pipeline, service_role;
