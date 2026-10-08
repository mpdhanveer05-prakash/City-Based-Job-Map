-- approve_job_feed and withdraw_job_feed said nothing when asked about a feed that does not exist.
--
-- Found by tests/database/17_feed_review.test.sql (8 Oct 2026): both functions ran `perform set_config(...)` between the
-- UPDATE and `if not found`, and PERFORM sets FOUND to true, so "no feed" was never raised. Nothing was changed by such a
-- call, but a reviewer (or a script) was told the approval or withdrawal happened. Now the updated rows are counted straight
-- after the UPDATE. The rest of each function is unchanged; CREATE OR REPLACE keeps the grants.

create or replace function public.approve_job_feed(p_feed integer, p_note text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  approver uuid := auth.uid();
  changed integer;
begin
  if approver is null or not is_admin('reviewer') then
    raise exception 'only a reviewer or admin can approve a feed' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'say why this is the employer''s official feed or an authorised source' using errcode = 'check_violation';
  end if;
  perform set_config('app.feed_approval', 'on', true);
  update job_feed set approved_by = approver, approved_at = now(), approval_note = btrim(p_note) where id = p_feed;
  get diagnostics changed = row_count;
  perform set_config('app.feed_approval', 'off', true);
  if changed = 0 then
    raise exception 'no feed %', p_feed using errcode = '22023';
  end if;
end;
$$;

create or replace function public.withdraw_job_feed(p_feed integer, p_note text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  if auth.uid() is null or not is_admin('reviewer') then
    raise exception 'only a reviewer or admin can withdraw a feed''s approval' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'say why the approval is withdrawn' using errcode = 'check_violation';
  end if;
  perform set_config('app.feed_approval', 'on', true);
  update job_feed set approved_by = null, approved_at = null, withdrawn_note = btrim(p_note) where id = p_feed;
  get diagnostics changed = row_count;
  perform set_config('app.feed_approval', 'off', true);
  if changed = 0 then
    raise exception 'no feed %', p_feed using errcode = '22023';
  end if;
end;
$$;
