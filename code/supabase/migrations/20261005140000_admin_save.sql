-- P7-02: saving a company or a job from the admin form touches several tables, and the rules between them are checked at
-- the end of a transaction (a startup stage needs the startup tag, ADR-0004). Separate requests from the browser would
-- each be their own transaction and trip those rules half way, so each save is one function call.
--
-- All three are SECURITY INVOKER: every insert, update, and delete runs as the signed-in admin, so row-level security
-- and the publish-needs-a-reviewer trigger apply exactly as they do to a direct write. Nothing here widens access.

-- Creates or updates a company and replaces its type tags and sector links with the given ones. `p_company` holds the
-- columns of the form: name, slug, domain, website_url, careers_url, description, startup_stage, status. Returns the id.
create function public.admin_save_company(p_id uuid, p_company jsonb, p_types text[], p_sectors text[]) returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_id    uuid := p_id;
  v_types public.company_type[] := coalesce(p_types, array[]::text[])::public.company_type[];
begin
  if not is_admin('editor') then
    raise exception 'saving a company needs an admin role' using errcode = '42501';
  end if;

  if v_id is null then
    insert into company (slug, name, domain, website_url, careers_url, description, startup_stage, status)
    values (
      p_company ->> 'slug', p_company ->> 'name', lower(p_company ->> 'domain'), p_company ->> 'website_url',
      nullif(p_company ->> 'careers_url', ''), nullif(p_company ->> 'description', ''),
      nullif(p_company ->> 'startup_stage', '')::public.startup_stage, coalesce(p_company ->> 'status', 'draft')
    )
    returning id into v_id;
  else
    -- Clear the stage first if the new types drop Startup, so the rule is never broken even for an instant.
    if not ('startup' = any (v_types)) then
      update company set startup_stage = null where id = v_id and startup_stage is not null;
    end if;
    update company set
      slug = p_company ->> 'slug',
      name = p_company ->> 'name',
      domain = lower(p_company ->> 'domain'),
      website_url = p_company ->> 'website_url',
      careers_url = nullif(p_company ->> 'careers_url', ''),
      description = nullif(p_company ->> 'description', ''),
      startup_stage = nullif(p_company ->> 'startup_stage', '')::public.startup_stage,
      status = coalesce(p_company ->> 'status', status)
    where id = v_id;
    if not found then
      raise exception 'that company does not exist or is not visible to you' using errcode = '22023';
    end if;
  end if;

  delete from company_type_tag where company_id = v_id and not (type = any (v_types));
  insert into company_type_tag (company_id, type) select v_id, t from unnest(v_types) t on conflict do nothing;

  delete from company_sector where company_id = v_id and sector_id not in (select id from sector where slug = any (coalesce(p_sectors, array[]::text[])));
  insert into company_sector (company_id, sector_id)
  select v_id, s.id from sector s where s.slug = any (coalesce(p_sectors, array[]::text[]))
  on conflict do nothing;
  if (select count(*) from company_sector where company_id = v_id) <> (select count(distinct x) from unnest(coalesce(p_sectors, array[]::text[])) x) then
    raise exception 'one of the sectors does not exist' using errcode = '22023';
  end if;

  return v_id;
end;
$$;
revoke all on function public.admin_save_company(uuid, jsonb, text[], text[]) from public, anon;
grant execute on function public.admin_save_company(uuid, jsonb, text[], text[]) to authenticated;

-- Creates or updates a job and replaces the cities it is listed in. `p_job` holds company_id, source_id, title,
-- apply_url, status, work_mode, exp_min_years, exp_max_years, posted_at. title_norm and dedup_hash are filled in by the
-- job_defaults trigger. Returns the id.
create function public.admin_save_job(p_id uuid, p_job jsonb, p_city_ids smallint[]) returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_id uuid := p_id;
begin
  if not is_admin('editor') then
    raise exception 'saving a job needs an admin role' using errcode = '42501';
  end if;
  if p_city_ids is null or cardinality(p_city_ids) = 0 then
    raise exception 'a job must be listed in at least one city' using errcode = '22023';
  end if;

  if v_id is null then
    insert into job (company_id, source_id, title, apply_url, status, work_mode, exp_min_years, exp_max_years, posted_at)
    values (
      (p_job ->> 'company_id')::uuid, (p_job ->> 'source_id')::int, p_job ->> 'title', p_job ->> 'apply_url',
      coalesce(p_job ->> 'status', 'draft'), nullif(p_job ->> 'work_mode', ''),
      nullif(p_job ->> 'exp_min_years', '')::smallint, nullif(p_job ->> 'exp_max_years', '')::smallint,
      nullif(p_job ->> 'posted_at', '')::date
    )
    returning id into v_id;
  else
    update job set
      company_id = (p_job ->> 'company_id')::uuid,
      source_id = (p_job ->> 'source_id')::int,
      title = p_job ->> 'title',
      apply_url = p_job ->> 'apply_url',
      status = coalesce(p_job ->> 'status', status),
      work_mode = nullif(p_job ->> 'work_mode', ''),
      exp_min_years = nullif(p_job ->> 'exp_min_years', '')::smallint,
      exp_max_years = nullif(p_job ->> 'exp_max_years', '')::smallint,
      posted_at = nullif(p_job ->> 'posted_at', '')::date
    where id = v_id;
    if not found then
      raise exception 'that job does not exist or is not visible to you' using errcode = '22023';
    end if;
  end if;

  delete from job_city where job_id = v_id and not (city_id = any (p_city_ids));
  insert into job_city (job_id, city_id) select v_id, c from unnest(p_city_ids) c on conflict do nothing;
  return v_id;
end;
$$;
revoke all on function public.admin_save_job(uuid, jsonb, smallint[]) from public, anon;
grant execute on function public.admin_save_job(uuid, jsonb, smallint[]) to authenticated;

-- Deletes a company with its offices, jobs, founders, tags, and links. Each delete is checked by row-level security as
-- the caller, so an editor can remove a draft and only an admin a published company; if any step is refused the final
-- delete fails on a foreign key and the whole call rolls back.
create function public.admin_delete_company(p_id uuid) returns void
language plpgsql
set search_path = public
as $$
begin
  if not is_admin('editor') then
    raise exception 'deleting a company needs an admin role' using errcode = '42501';
  end if;
  delete from job where company_id = p_id;
  delete from office where company_id = p_id;
  delete from company_founder where company_id = p_id;
  delete from company where id = p_id;
  if not found then
    raise exception 'that company does not exist, or your role may not delete it' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.admin_delete_company(uuid) from public, anon;
grant execute on function public.admin_delete_company(uuid) to authenticated;
