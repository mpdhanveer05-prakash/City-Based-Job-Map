-- Adding an employer feed from the admin (ADR-0022 §7). Until now only an admin could, by writing job_feed directly.
--
--   create_job_feed(company, source, provider, identifier)
--     * a signed-in reviewer or admin at aal2 (is_admin); nobody else, and never service_role or the pipeline;
--     * the company and source exist; the source is an ATS feed (greenhouse, lever, ashby, workable) or, for a careers page
--       (jsonld), a jsonld source;
--     * an ATS board name is a plain name; a careers page is an https link on the company's own domain (or a subdomain),
--       as the pipeline also requires when it reads it;
--     * the same feed is not listed twice;
--     * the feed is created UNAPPROVED: the pipeline reads nothing from it until a reviewer approves it, separately and
--       with a note, through approve_job_feed. Who added it, and when, is recorded (and in the audit log).

alter table public.job_feed
  add column created_by uuid,
  add column created_at timestamptz;

create function public.create_job_feed(p_company uuid, p_source integer, p_provider text, p_identifier text) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator    uuid := auth.uid();
  v_identifier text := btrim(coalesce(p_identifier, ''));
  v_domain     text;
  v_kind       text;
  v_host       text;
  v_id         integer;
begin
  if v_creator is null or not is_admin('reviewer') then
    raise exception 'only a reviewer or admin can add an employer feed' using errcode = 'insufficient_privilege';
  end if;
  select domain into v_domain from company where id = p_company;
  if v_domain is null then
    raise exception 'no company %', p_company using errcode = '22023';
  end if;
  select kind into v_kind from source where id = p_source;
  if v_kind is null then
    raise exception 'no source %', p_source using errcode = '22023';
  end if;
  if coalesce(p_provider, '') not in ('greenhouse', 'lever', 'ashby', 'workable', 'jsonld') then
    raise exception 'unknown feed provider "%"', coalesce(p_provider, '') using errcode = '22023';
  end if;
  if (p_provider = 'jsonld' and v_kind <> 'jsonld') or (p_provider <> 'jsonld' and v_kind <> 'ats_feed') then
    raise exception 'a careers-page feed needs a jsonld source, and an ATS feed an ats_feed source (this source is %)', v_kind
      using errcode = 'check_violation';
  end if;
  if p_provider = 'jsonld' then
    if v_identifier !~ '^https://[^\s/?#]+(/[^\s]*)?$' or length(v_identifier) > 500 then
      raise exception 'a careers page is an https link' using errcode = 'check_violation';
    end if;
    v_host := lower(substring(v_identifier from '^https://([^/:?#]+)'));
    if v_host <> v_domain and right(v_host, length(v_domain) + 1) <> '.' || v_domain then
      raise exception 'the careers page must be on the company''s own domain, %', v_domain using errcode = 'check_violation';
    end if;
  elsif v_identifier !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' then
    raise exception 'a % board name is letters, digits, dots, hyphens and underscores', p_provider using errcode = 'check_violation';
  end if;
  if exists (select 1 from job_feed where company_id = p_company and provider = p_provider and identifier = v_identifier) then
    raise exception 'this feed is already listed for %', v_domain using errcode = 'unique_violation';
  end if;
  insert into job_feed (company_id, source_id, provider, identifier, active, created_by, created_at)
  values (p_company, p_source, p_provider, v_identifier, true, v_creator, now())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_job_feed(uuid, integer, text, text) from public, anon;
grant execute on function public.create_job_feed(uuid, integer, text, text) to authenticated;
