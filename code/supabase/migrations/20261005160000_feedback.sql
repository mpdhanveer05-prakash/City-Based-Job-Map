-- P8-04: public reports ("this job is gone") and suggestions ("add this company"), and the queue reviewers work.
--
-- The public never writes a table: the `submit-feedback` Edge Function verifies Cloudflare Turnstile and then calls
-- `submit_feedback` with the service role. Nothing a visitor sends is published; a reviewer reads it in the admin Review
-- page and resolves or rejects it. There are no personal fields: no name, email, or address is asked for, and the only
-- trace of the sender is a rate-limit key that is a salted hash which changes every day (the function builds it; the raw
-- address is never stored).

create table public.submission (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  kind             text not null check (kind in ('report', 'suggestion')),
  target_type      text not null check (target_type in ('company', 'job', 'other')),
  -- The company or job a report is about. Not a foreign key: the record can be unpublished or removed later, and the
  -- report is still evidence of what was said.
  target_id        uuid,
  company_name     text check (company_name is null or length(company_name) between 1 and 200),
  message          text not null check (length(message) between 1 and 1000),
  source_url       text check (source_url is null or (source_url ~ '^https://' and length(source_url) <= 1000)),
  status           text not null default 'new' check (status in ('new', 'resolved', 'rejected')),
  resolved_by      uuid,
  resolved_at      timestamptz,
  resolution_note  text check (resolution_note is null or length(resolution_note) <= 500),
  -- A suggestion needs a name and a page that shows the company exists (ENG03: admitted only after review).
  constraint suggestion_has_source check (kind <> 'suggestion' or (source_url is not null and company_name is not null)),
  -- A report about a company or a job names it; every other submission (a suggestion, a general note) names nothing.
  constraint target_matches_type check ((target_type = 'other') = (target_id is null)),
  constraint suggestion_is_general check (kind <> 'suggestion' or target_type = 'other')
);
create index submission_status on public.submission (status, created_at desc);
alter table public.submission enable row level security;

-- Editors read the queue; reviewers decide. Nobody inserts through the API: only submit_feedback does.
create policy submission_editor_read on public.submission for select to authenticated using (public.is_admin('editor'));
create policy submission_reviewer_update on public.submission for update to authenticated
  using (public.is_admin('reviewer')) with check (public.is_admin('reviewer'));
revoke all on public.submission from anon;
revoke insert, delete on public.submission from authenticated;

-- A decision stamps who made it and when; and a decided submission is not reopened by an edit to its text.
create function public.submission_decide() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.kind, new.target_type, new.target_id, new.company_name, new.message, new.source_url, new.created_at)
     is distinct from (old.kind, old.target_type, old.target_id, old.company_name, old.message, old.source_url, old.created_at) then
    raise exception 'what a visitor sent cannot be edited' using errcode = '42501';
  end if;
  if new.status <> 'new' and old.status = 'new' then
    new.resolved_by := auth.uid();
    new.resolved_at := now();
  elsif new.status = 'new' then
    new.resolved_by := null;
    new.resolved_at := null;
  end if;
  return new;
end;
$$;
create trigger submission_decide before update on public.submission for each row execute function public.submission_decide();
create trigger audit_submission after insert or update or delete on public.submission
  for each row execute function public.audit_row_change('id');

-- ---------------------------------------------------------------------------
-- The rate limit
-- ---------------------------------------------------------------------------

-- How many submissions a sender has made this hour. The key is a hash the Edge Function makes from the connection and a
-- secret salt that is combined with the date, so it cannot be traced back to an address and changes every day.
create table public.feedback_rate (
  client_hash  bytea not null,
  hour         timestamptz not null,
  count        integer not null default 0,
  primary key (client_hash, hour)
);
alter table public.feedback_rate enable row level security;
create policy feedback_rate_no_access on public.feedback_rate for all to anon, authenticated using (false) with check (false);
revoke all on public.feedback_rate from anon, authenticated;

-- Records one submission and returns its id (the receipt). Callable by the service role only. Refuses with the message
-- `rate_limited` after p_limit in an hour from one key (the plan's proposal: 5), and checks that a report points at a company
-- or a job that is public. Everything lands as status `new`.
create function public.submit_feedback(
  p_kind text, p_target_type text, p_target_id uuid, p_message text, p_source_url text, p_company_name text,
  p_client_hash bytea, p_limit integer default 5
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  n  integer;
  v_id uuid;
begin
  if p_client_hash is null or length(p_client_hash) < 16 then
    raise exception 'a client key is required' using errcode = '22023';
  end if;

  -- Old rate rows are not needed after a day.
  delete from feedback_rate where hour < now() - interval '1 day';
  insert into feedback_rate (client_hash, hour, count) values (p_client_hash, date_trunc('hour', now()), 1)
  on conflict (client_hash, hour) do update set count = feedback_rate.count + 1
  returning count into n;
  if n > greatest(p_limit, 1) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  if p_kind = 'report' then
    if p_target_type = 'company' and not exists (select 1 from company c where c.id = p_target_id and c.status = 'published') then
      raise exception 'that company is not listed' using errcode = '22023';
    end if;
    if p_target_type = 'job' and not exists (
      select 1 from job j join company c on c.id = j.company_id where j.id = p_target_id and j.status in ('active', 'suspect') and c.status = 'published'
    ) then
      raise exception 'that job is not listed' using errcode = '22023';
    end if;
  end if;

  insert into submission (kind, target_type, target_id, company_name, message, source_url)
  values (p_kind, p_target_type, p_target_id, nullif(btrim(p_company_name), ''), btrim(p_message), nullif(btrim(p_source_url), ''))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_feedback(text, text, uuid, text, text, text, bytea, integer) from public, anon, authenticated;
grant execute on function public.submit_feedback(text, text, uuid, text, text, text, bytea, integer) to service_role;
