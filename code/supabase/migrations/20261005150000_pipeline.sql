-- P8-01 to P8-03: what the data pipeline needs from the database (docs/data-model.md, "As built in P8").
--
--   pipeline          a NOLOGIN role with only the grants the Python jobs need. Each environment creates the login
--                     role that uses it by hand (`create role pipeline_login login password '...' in role pipeline`),
--                     so no password is ever in a migration or in git. It is never the service role.
--   job_feed          which company publishes which feed (provider and board name, or a careers page for JSON-LD)
--   verification_check a log of link checks, partitioned by month so old months drop cheaply
--   record_link_check  the two-strike expiry rule (JOB05): a failed check makes a job suspect, a second one expires it
--   heartbeat          when each scheduled job last finished, and how often it should (P8-03)
--   missed_heartbeats  the jobs that are overdue: the monitor workflow fails when this is not empty
--   sweep_stale_jobs   the daily sweep for jobs nobody has checked for too long
--   pg_cron jobs       the sweep and the partition upkeep, where the extension exists

-- ---------------------------------------------------------------------------
-- The role
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pipeline') then
    create role pipeline nologin;
  end if;
end;
$$;
grant usage on schema public to pipeline;

-- The publish-needs-a-reviewer trigger on `job` asks auth.uid() who is writing. It is null for the pipeline (not a signed-in
-- user), and the trigger lets that through. The `auth` schema belongs to Supabase and cannot be granted to another role, so
-- the pipeline cannot call auth.uid() itself: the trigger runs with its owner's rights instead (a fixed search_path, and it
-- only reads the session's identity and the row, so nothing is widened).
alter function public.require_reviewer_to_publish() security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- Feeds
-- ---------------------------------------------------------------------------

create table public.job_feed (
  id          serial primary key,
  company_id  uuid not null references public.company (id) on delete cascade,
  source_id   integer not null references public.source (id),
  provider    text not null check (provider in ('greenhouse', 'lever', 'ashby', 'workable', 'jsonld')),
  -- A board name for an ATS API; for jsonld, the careers page (https, on the company's domain: the pipeline checks it).
  identifier  text not null check (length(identifier) between 1 and 500),
  active      boolean not null default true,
  unique (company_id, provider, identifier)
);
alter table public.job_feed enable row level security;
create policy job_feed_admin_read on public.job_feed for select to authenticated using (public.is_admin('editor'));
create policy job_feed_admin_write on public.job_feed for all to authenticated
  using (public.is_admin('admin')) with check (public.is_admin('admin'));
revoke all on public.job_feed from anon;
create trigger audit_job_feed after insert or update or delete on public.job_feed
  for each row execute function public.audit_row_change('id');

-- ---------------------------------------------------------------------------
-- Link-check log, partitioned by month
-- ---------------------------------------------------------------------------

create table public.verification_check (
  id           bigint generated always as identity,
  job_id       uuid not null references public.job (id) on delete cascade,
  checked_at   timestamptz not null default now(),
  ok           boolean not null,
  http_status  integer,
  final_url    text,
  note         text,
  primary key (id, checked_at)
) partition by range (checked_at);
create table public.verification_check_default partition of public.verification_check default;
-- A partition is a table of its own: the parent's row-level security does not cover a query that names the partition
-- (PostgREST exposes each table in public), and Supabase's default privileges would hand it to anon. Each partition is
-- closed the same way as the parent: RLS on with no policy, and nothing granted to the API roles.
alter table public.verification_check_default enable row level security;
revoke all on public.verification_check_default from anon, authenticated;
create index verification_check_job on public.verification_check (job_id, checked_at desc);
alter table public.verification_check enable row level security;
create policy verification_check_admin_read on public.verification_check for select to authenticated using (public.is_admin('reviewer'));
revoke all on public.verification_check from anon;

-- Makes the monthly partitions for this month and the next `p_months`, so rows land in a small table, not the default one.
create function public.ensure_verification_partitions(p_months integer default 2) returns integer
language plpgsql
as $$
declare
  m       date;
  made    integer := 0;
  pname   text;
begin
  for i in 0..greatest(p_months, 0) loop
    m := (date_trunc('month', now() at time zone 'utc') + make_interval(months => i))::date;
    pname := 'verification_check_' || to_char(m, 'YYYY_MM');
    if to_regclass('public.' || pname) is null then
      execute format('create table public.%I partition of public.verification_check for values from (%L) to (%L)',
                     pname, m::timestamptz, (m + interval '1 month')::timestamptz);
      execute format('alter table public.%I enable row level security', pname);
      execute format('revoke all on public.%I from anon, authenticated', pname);
      made := made + 1;
    end if;
  end loop;
  return made;
end;
$$;

-- Drops monthly partitions that end before the cutoff (the log is evidence for the last few months, not an archive).
create function public.drop_old_verification_partitions(p_keep_months integer default 3) returns integer
language plpgsql
as $$
declare
  cutoff  date := (date_trunc('month', now() at time zone 'utc') - make_interval(months => greatest(p_keep_months, 1)))::date;
  part    record;
  dropped integer := 0;
begin
  for part in
    select c.relname
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent
    where p.relname = 'verification_check' and c.relname ~ '^verification_check_[0-9]{4}_[0-9]{2}$'
  loop
    if to_date(right(part.relname, 7), 'YYYY_MM') < cutoff then
      execute format('drop table public.%I', part.relname);
      dropped := dropped + 1;
    end if;
  end loop;
  return dropped;
end;
$$;

select public.ensure_verification_partitions(2);

-- ---------------------------------------------------------------------------
-- The two-strike rule
-- ---------------------------------------------------------------------------

-- Records one link check and moves the job along (JOB05, ADM05): a good check makes it active and clears its failures; a
-- failed one makes it suspect (still public, but queued), and a second failed check in a row expires it, which removes it
-- from the public data. Two checks stop one flaky response from hiding a live job. A job that is not active or suspect
-- is logged and left alone. SECURITY INVOKER: the pipeline role needs its own grants on `job`, and has them.
create function public.record_link_check(p_job uuid, p_ok boolean, p_http_status integer default null, p_final_url text default null, p_note text default null)
returns text
language plpgsql
as $$
declare
  j public.job;
  next_status text;
  failures    smallint;
begin
  select * into j from job where id = p_job for update;
  if not found then
    raise exception 'unknown job' using errcode = '22023';
  end if;

  insert into verification_check (job_id, ok, http_status, final_url, note)
  values (p_job, p_ok, p_http_status, left(p_final_url, 2000), left(p_note, 500));

  if j.status not in ('active', 'suspect') then
    return j.status;
  end if;

  if p_ok then
    update job set status = 'active', consecutive_failures = 0, last_checked_at = now(), last_ok_at = now() where id = p_job;
    return 'active';
  end if;

  failures := least(j.consecutive_failures + 1, 100)::smallint;
  next_status := case when failures >= 2 then 'expired' else 'suspect' end;
  update job set status = next_status, consecutive_failures = failures, last_checked_at = now() where id = p_job;
  return next_status;
end;
$$;
revoke all on function public.record_link_check(uuid, boolean, integer, text, text) from public, anon;
grant execute on function public.record_link_check(uuid, boolean, integer, text, text) to pipeline, service_role;

-- ---------------------------------------------------------------------------
-- Heartbeats and the missed-run check
-- ---------------------------------------------------------------------------

create table public.heartbeat (
  name            text primary key,
  created_at      timestamptz not null default now(),
  last_ok_at      timestamptz,
  last_detail     text,
  -- How often it should finish, and how much lateness is forgiven before it counts as missed.
  expected_every  interval not null,
  grace           interval not null default interval '30 minutes'
);
alter table public.heartbeat enable row level security;
create policy heartbeat_admin_read on public.heartbeat for select to authenticated using (public.is_admin('editor'));
revoke all on public.heartbeat from anon;

insert into public.heartbeat (name, expected_every, grace) values
  ('feed-sync', interval '6 hours', interval '1 hour'),
  ('link-check', interval '6 hours', interval '1 hour'),
  ('stale-sweep', interval '1 day', interval '2 hours'),
  ('partition-upkeep', interval '35 days', interval '1 day');

-- A scheduled job calls this when it finishes well.
create function public.record_heartbeat(p_name text, p_detail text default null) returns void
language plpgsql
as $$
begin
  update heartbeat set last_ok_at = now(), last_detail = left(p_detail, 500) where name = p_name;
  if not found then
    raise exception 'unknown heartbeat %', p_name using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.record_heartbeat(text, text) from public, anon;
grant execute on function public.record_heartbeat(text, text) to pipeline, service_role;

-- The scheduled jobs that are overdue: they should have finished within expected_every + grace of the last time (or of
-- being created, for one that has never run). Empty means everything is on time. The monitor workflow fails on a row.
create function public.missed_heartbeats() returns table (name text, last_ok_at timestamptz, expected_every interval, overdue interval)
language sql
stable
security definer
set search_path = public
as $$
  select h.name, h.last_ok_at, h.expected_every, now() - (coalesce(h.last_ok_at, h.created_at) + h.expected_every + h.grace) as overdue
  from heartbeat h
  where now() > coalesce(h.last_ok_at, h.created_at) + h.expected_every + h.grace
  order by h.name;
$$;
revoke all on function public.missed_heartbeats() from public, anon;
grant execute on function public.missed_heartbeats() to pipeline, service_role;

-- ---------------------------------------------------------------------------
-- The daily sweep
-- ---------------------------------------------------------------------------

-- A job nobody has checked for `p_stale_days` days is suspect (it may be gone and the feed or the link check did not say);
-- a suspect job that stays unchecked a week longer expires. Returns how many it moved. Runs as the owner (pg_cron) or the
-- service role: SECURITY DEFINER with a fixed search_path, and not callable by the public.
create function public.sweep_stale_jobs(p_stale_days integer default 14) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  moved integer := 0;
  n     integer;
begin
  update job set status = 'expired'
  where status = 'suspect' and coalesce(last_checked_at, first_seen_at) < now() - make_interval(days => p_stale_days + 7);
  get diagnostics n = row_count;
  moved := moved + n;

  update job set status = 'suspect', consecutive_failures = greatest(consecutive_failures, 1)
  where status = 'active' and coalesce(last_checked_at, first_seen_at) < now() - make_interval(days => p_stale_days);
  get diagnostics n = row_count;
  moved := moved + n;

  update heartbeat set last_ok_at = now(), last_detail = moved || ' jobs moved' where name = 'stale-sweep';
  return moved;
end;
$$;
revoke all on function public.sweep_stale_jobs(integer) from public, anon, authenticated;
grant execute on function public.sweep_stale_jobs(integer) to service_role;

-- Partition upkeep, as one call for cron.
create function public.verification_upkeep() returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform ensure_verification_partitions(2);
  perform drop_old_verification_partitions(3);
  update heartbeat set last_ok_at = now(), last_detail = 'partitions ready' where name = 'partition-upkeep';
end;
$$;
revoke all on function public.verification_upkeep() from public, anon, authenticated;
grant execute on function public.verification_upkeep() to service_role;

-- ---------------------------------------------------------------------------
-- The pipeline role's grants. Row-level security applies to it like anyone else, so each table gets a policy.
-- ---------------------------------------------------------------------------

grant select on public.city, public.neighbourhood, public.tech_park, public.company, public.office, public.source, public.job_feed to pipeline;
grant select, insert, update on public.job to pipeline;
grant select, insert, delete on public.job_city to pipeline;
grant update (last_run_at, last_run_status, last_run_detail) on public.source to pipeline;
grant select, insert on public.verification_check to pipeline;
grant select on public.heartbeat to pipeline;
grant select, insert on public.import_batch to pipeline;
grant usage on sequence public.verification_check_id_seq to pipeline;

do $$
declare
  t text;
begin
  foreach t in array array['city', 'neighbourhood', 'tech_park', 'company', 'office', 'source', 'job_feed', 'job', 'job_city', 'verification_check', 'heartbeat', 'import_batch'] loop
    execute format('create policy %I on public.%I for select to pipeline using (true)', t || '_pipeline_read', t);
  end loop;
  foreach t in array array['job', 'job_city', 'verification_check', 'import_batch'] loop
    execute format('create policy %I on public.%I for insert to pipeline with check (true)', t || '_pipeline_insert', t);
  end loop;
  foreach t in array array['job', 'source'] loop
    execute format('create policy %I on public.%I for update to pipeline using (true) with check (true)', t || '_pipeline_update', t);
  end loop;
end;
$$;
create policy job_city_pipeline_delete on public.job_city for delete to pipeline using (true);

-- record_heartbeat writes `heartbeat`; the pipeline needs the grant and policy for it.
grant update (last_ok_at, last_detail) on public.heartbeat to pipeline;
create policy heartbeat_pipeline_update on public.heartbeat for update to pipeline using (true) with check (true);

-- ---------------------------------------------------------------------------
-- pg_cron, where the extension exists (Supabase has it; a plain Postgres may not)
-- ---------------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('stale-sweep', '15 2 * * *', 'select public.sweep_stale_jobs()');
  perform cron.schedule('partition-upkeep', '30 3 1 * *', 'select public.verification_upkeep()');
exception when others then
  raise notice 'pg_cron is not available here (%): the daily sweep and the partition upkeep are not scheduled', sqlerrm;
end;
$$;
