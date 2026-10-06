-- The reviewer's actions on employer feeds (ADR-0022 §7, owner decision of 6 Oct 2026): withdraw a feed's approval,
-- and resolve a held change explicitly, with a note. Production feed automation waits on this.
--
--   withdraw_job_feed(feed, note)          a reviewer stops the pipeline reading a feed (approval cleared, reason kept)
--   resolve_feed_event(event, decision, note)
--       'apply'  (a held domain change only) the new application link is recorded as evidence by the reviewer, reviewed by
--                them (a self-review, recorded as such), and only then applied to the job, so the change passes the same
--                "reviewed evidence first" rule as any other change to a public fact
--       'reject' keep the job as it is; the same change is not raised again by later feed runs
-- Every decision is kept on the event: who, when, what, and why.

alter table public.feed_event
  add column decision text check (decision in ('applied', 'rejected')),
  add column decision_note text check (decision_note is null or length(decision_note) <= 500),
  add constraint feed_event_decision_complete check ((decision is null) = (resolved_at is null) and (resolved_at is null) = (resolved_by is null));

alter table public.job_feed add column withdrawn_note text check (withdrawn_note is null or length(withdrawn_note) <= 500);

-- Reviewers resolve events only through resolve_feed_event.
drop policy feed_event_reviewer_resolve on public.feed_event;

create function public.withdraw_job_feed(p_feed integer, p_note text) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not is_admin('reviewer') then
    raise exception 'only a reviewer or admin can withdraw a feed''s approval' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'say why the approval is withdrawn' using errcode = 'check_violation';
  end if;
  perform set_config('app.feed_approval', 'on', true);
  update job_feed set approved_by = null, approved_at = null, withdrawn_note = btrim(p_note) where id = p_feed;
  perform set_config('app.feed_approval', 'off', true);
  if not found then
    raise exception 'no feed %', p_feed using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.withdraw_job_feed(integer, text) from public, anon;
grant execute on function public.withdraw_job_feed(integer, text) to authenticated;

create function public.resolve_feed_event(p_event bigint, p_decision text, p_note text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ev feed_event;
  evid bigint;
begin
  if auth.uid() is null or not is_admin('reviewer') then
    raise exception 'only a reviewer or admin can resolve a held feed change' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'say why' using errcode = 'check_violation';
  end if;
  select * into ev from feed_event where id = p_event for update;
  if not found or ev.kind not like 'held_%' then
    raise exception 'no held feed change %', p_event using errcode = '22023';
  end if;
  if ev.resolved_at is not null then
    raise exception 'this change was already resolved' using errcode = '22023';
  end if;
  if p_decision not in ('apply', 'reject') then
    raise exception 'the decision is apply or reject' using errcode = '22023';
  end if;
  if p_decision = 'apply' then
    if ev.kind <> 'held_domain_change' or ev.job_id is null or ev.new_value is null then
      raise exception 'only a held link change can be applied; an ambiguous feed entry can only be rejected' using errcode = '22023';
    end if;
    if ev.new_value !~ '^https://[^\s]+$' then
      raise exception 'the new link is not an https link' using errcode = 'check_violation';
    end if;
    -- Evidence for the proposed link, recorded and reviewed by this reviewer, then the change.
    insert into field_evidence (job_id, field, value, source_url, verified_at, note)
    values (ev.job_id, 'apply_url', ev.new_value, ev.new_value, current_date, left('held feed change #' || ev.id || ' applied: ' || btrim(p_note), 500))
    returning id into evid;
    update field_evidence set reviewed_at = now(), reviewed_by = auth.uid() where id = evid;
    update job set apply_url = ev.new_value where id = ev.job_id;
    perform record_feed_job_evidence(ev.job_id, ev.feed_id);
  end if;
  update feed_event
     set resolved_at = now(), resolved_by = auth.uid(),
         decision = case when p_decision = 'apply' then 'applied' else 'rejected' end,
         decision_note = btrim(p_note)
   where id = ev.id;
end;
$$;
revoke all on function public.resolve_feed_event(bigint, text, text) from public, anon;
grant execute on function public.resolve_feed_event(bigint, text, text) to authenticated;
