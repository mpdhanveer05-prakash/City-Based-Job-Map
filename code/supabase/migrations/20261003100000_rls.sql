-- P3-02: admin roles and row-level security (docs/data-model.md, "Authorization rules").
--
--   anon, authenticated (not an admin)  read published companies, their published offices,
--                                       published founders, and active or suspect jobs. Nothing else.
--   editor    full CRUD, but cannot publish or unpublish and cannot delete a published record.
--   reviewer  editor + publish and unpublish.
--   admin     everything, including deleting published records and managing admin_user.
--
-- Reference data (city, neighbourhood, tech_park, sector, source) is writable by `admin` only for
-- now; the matrix does not name it, so the strictest reading is used. Loosen it in the task that
-- needs it (P7).
--
-- The pipeline role and the audit log arrive with the tasks that use them (P8-01, P7-02).
-- service_role bypasses RLS by design; it is never given to the browser (docs/security.md).

-- ---------------------------------------------------------------------------
-- Admin identities
-- ---------------------------------------------------------------------------

create table public.admin_user (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  role     text not null check (role in ('editor', 'reviewer', 'admin'))
);
alter table public.admin_user enable row level security;

-- True when the signed-in user holds `min_role` or higher. SECURITY DEFINER so it can read
-- admin_user, which ordinary users cannot; the search_path is fixed. An unknown `min_role`
-- gives false (the comparison is null), so a typo fails closed.
create function public.is_admin(min_role text default 'editor') returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from admin_user
    where user_id = (select auth.uid())
      and array_position(array['editor', 'reviewer', 'admin'], role)
       >= array_position(array['editor', 'reviewer', 'admin'], min_role)
  );
$$;

-- ---------------------------------------------------------------------------
-- Privileges: RLS is the gate, but anon never needs to write and nobody needs
-- TRUNCATE, REFERENCES, or TRIGGER through the API.
-- ---------------------------------------------------------------------------

revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
-- Tables with no public read are closed to anon outright, not just filtered to nothing.
revoke all on public.admin_user, public.source from anon;
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon;
alter default privileges in schema public
  revoke truncate, references, trigger on tables from authenticated;

-- ---------------------------------------------------------------------------
-- Public reads (anon and signed-in non-admins)
-- ---------------------------------------------------------------------------

-- A city is visible once it is beta or live; draft hides it and everything in it.
create policy city_public_read on public.city for select to anon, authenticated
  using (status in ('beta', 'live'));

create policy neighbourhood_public_read on public.neighbourhood for select to anon, authenticated
  using (exists (select 1 from public.city c where c.id = neighbourhood.city_id and c.status in ('beta', 'live')));

create policy tech_park_public_read on public.tech_park for select to anon, authenticated
  using (exists (select 1 from public.city c where c.id = tech_park.city_id and c.status in ('beta', 'live')));

create policy sector_public_read on public.sector for select to anon, authenticated
  using (true);

create policy company_public_read on public.company for select to anon, authenticated
  using (status = 'published');

create policy company_type_tag_public_read on public.company_type_tag for select to anon, authenticated
  using (exists (select 1 from public.company c where c.id = company_type_tag.company_id and c.status = 'published'));

create policy company_sector_public_read on public.company_sector for select to anon, authenticated
  using (exists (select 1 from public.company c where c.id = company_sector.company_id and c.status = 'published'));

create policy company_founder_public_read on public.company_founder for select to anon, authenticated
  using (
    status = 'published'
    and exists (select 1 from public.company c where c.id = company_founder.company_id and c.status = 'published')
  );

create policy office_public_read on public.office for select to anon, authenticated
  using (
    status = 'published'
    and exists (select 1 from public.company c where c.id = office.company_id and c.status = 'published')
    and exists (select 1 from public.city ci where ci.id = office.city_id and ci.status in ('beta', 'live'))
  );

-- 'suspect' jobs stay visible until a second failed check marks them expired (JOB05).
create policy job_public_read on public.job for select to anon, authenticated
  using (
    status in ('active', 'suspect')
    and exists (select 1 from public.company c where c.id = job.company_id and c.status = 'published')
  );

-- The job subquery is itself filtered by job_public_read, so only visible jobs count.
create policy job_city_public_read on public.job_city for select to anon, authenticated
  using (
    exists (select 1 from public.job j where j.id = job_city.job_id)
    and exists (select 1 from public.city c where c.id = job_city.city_id and c.status in ('beta', 'live'))
  );

-- `source` and `admin_user` have no public read.

-- ---------------------------------------------------------------------------
-- Admin reads: any admin role sees every row of every table.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'city', 'neighbourhood', 'tech_park', 'sector', 'source', 'company', 'company_type_tag',
    'company_sector', 'company_founder', 'office', 'job', 'job_city'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_admin())',
      t || '_admin_read', t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- Editors and above: insert and update on content tables. Who may publish is enforced by the
-- trigger below, because a policy cannot compare the old and new status.
do $$
declare
  t text;
begin
  foreach t in array array[
    'company', 'company_type_tag', 'company_sector', 'company_founder', 'office', 'job', 'job_city'
  ] loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_admin(''editor''))',
      t || '_editor_insert', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_admin(''editor'')) with check (public.is_admin(''editor''))',
      t || '_editor_update', t
    );
  end loop;
end;
$$;

-- Deletes: an editor (or reviewer) may delete anything that is not published; only an admin may
-- delete a published record. Tags and links carry no status of their own, so they follow the
-- editor rule.
create policy company_delete on public.company for delete to authenticated
  using (public.is_admin('admin') or (public.is_admin('editor') and status <> 'published'));

create policy office_delete on public.office for delete to authenticated
  using (public.is_admin('admin') or (public.is_admin('editor') and status <> 'published'));

create policy company_founder_delete on public.company_founder for delete to authenticated
  using (public.is_admin('admin') or (public.is_admin('editor') and status <> 'published'));

create policy job_delete on public.job for delete to authenticated
  using (public.is_admin('admin') or (public.is_admin('editor') and status not in ('active', 'suspect')));

create policy company_type_tag_delete on public.company_type_tag for delete to authenticated
  using (public.is_admin('editor'));

create policy company_sector_delete on public.company_sector for delete to authenticated
  using (public.is_admin('editor'));

create policy job_city_delete on public.job_city for delete to authenticated
  using (public.is_admin('editor'));

-- Reference data and admin identities: admin only. A signed-in user may read their own
-- admin_user row, so the admin pages can learn the role.
do $$
declare
  t text;
begin
  foreach t in array array['city', 'neighbourhood', 'tech_park', 'sector', 'source', 'admin_user'] loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_admin(''admin''))',
      t || '_admin_insert', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_admin(''admin'')) with check (public.is_admin(''admin''))',
      t || '_admin_update', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_admin(''admin''))',
      t || '_admin_delete', t
    );
  end loop;
end;
$$;

create policy admin_user_read on public.admin_user for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin('admin'));

-- ---------------------------------------------------------------------------
-- Publishing needs a reviewer
-- ---------------------------------------------------------------------------

-- A signed-in editor can write content, but moving a record into or out of its public state
-- (company, office, founder: 'published'; job: 'active' or 'suspect') needs a reviewer or admin.
-- Connections with no signed-in user (the migration owner, service_role, the pipeline) are not
-- affected: auth.uid() is null for them, and ordinary users cannot write at all without an
-- admin_user row.
create function public.require_reviewer_to_publish() returns trigger
language plpgsql
as $$
declare
  public_states text[];
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  public_states := case tg_table_name
    when 'job' then array['active', 'suspect']
    else array['published']
  end;

  if tg_op = 'INSERT' then
    if new.status = any (public_states) and not public.is_admin('reviewer') then
      raise exception 'only a reviewer or admin can create a record in its public state'
        using errcode = 'insufficient_privilege';
    end if;
  elsif new.status is distinct from old.status
    and (new.status = any (public_states) or old.status = any (public_states))
    and not public.is_admin('reviewer')
  then
    raise exception 'only a reviewer or admin can publish or unpublish'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger company_require_reviewer_to_publish
  before insert or update on public.company
  for each row execute function public.require_reviewer_to_publish();
create trigger office_require_reviewer_to_publish
  before insert or update on public.office
  for each row execute function public.require_reviewer_to_publish();
create trigger company_founder_require_reviewer_to_publish
  before insert or update on public.company_founder
  for each row execute function public.require_reviewer_to_publish();
create trigger job_require_reviewer_to_publish
  before insert or update on public.job
  for each row execute function public.require_reviewer_to_publish();
