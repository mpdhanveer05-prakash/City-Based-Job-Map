-- P9-07: the CSV import requires evidence (owner decision, 6 Oct 2026). Each row carries a list of evidence entries, one
-- per field; a field the row fills in (name, website, and the office's address and location always; description, types,
-- sectors, stage, and ownership status when given) must have one, and evidence for a field the row leaves empty is an
-- error. Company facts are recorded against the new company, the address and location against the new office. A row
-- that adds an office to a company already listed records only the office's evidence. Everything stays a draft, and the
-- verified dates stay claims until a reviewer reviews them (20261006120000_field_evidence.sql).

create or replace function public.import_commit(p_filename text, p_rows jsonb) returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  r             jsonb;
  i             integer := 0;
  results       jsonb := '[]'::jsonb;
  errors        jsonb := '[]'::jsonb;
  n_created     integer := 0;
  n_attached    integer := 0;
  n_skipped     integer := 0;
  n_errors      integer := 0;
  v_name        text;
  v_domain      text;
  v_city_id     smallint;
  v_hood_id     integer;
  v_park_id     integer;
  v_company_id  uuid;
  v_slug        text;
  v_base        text;
  v_n           integer;
  v_types       text[];
  v_stage       text;
  v_ownership   text;
  v_lat         double precision;
  v_lng         double precision;
  v_accuracy    text;
  v_address     text;
  v_batch_id    uuid;
  v_sector      text;
  v_office_id   uuid;
  v_evidence    jsonb;
  v_ev          jsonb;
  v_ev_field    text;
  v_ev_date     date;
  v_needed      text[];
begin
  if not is_admin('editor') then
    raise exception 'importing needs an admin role' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'there are no rows to import' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'an import is limited to 2000 rows' using errcode = '22023';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      v_name := trim(coalesce(r ->> 'name', ''));
      v_domain := lower(trim(coalesce(r ->> 'domain', '')));
      v_address := trim(coalesce(r ->> 'address', ''));
      if v_name = '' or length(v_name) > 200 then raise exception 'the company name is missing or too long'; end if;
      if v_address = '' then raise exception 'the address is missing'; end if;
      if v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
        raise exception 'the domain "%" is not a valid host name', v_domain;
      end if;

      select id into v_city_id from city where slug = r ->> 'city';
      if v_city_id is null then raise exception 'unknown city "%"', coalesce(r ->> 'city', ''); end if;
      v_lat := (r ->> 'lat')::double precision;
      v_lng := (r ->> 'lng')::double precision;
      if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
        raise exception 'the latitude or longitude is missing or out of range';
      end if;
      v_accuracy := coalesce(nullif(trim(r ->> 'accuracy'), ''), 'locality');
      if v_accuracy not in ('rooftop', 'building', 'campus', 'street', 'locality') then
        raise exception 'unknown accuracy "%"', v_accuracy;
      end if;

      v_hood_id := null;
      if nullif(trim(r ->> 'neighbourhood'), '') is not null then
        select id into v_hood_id from neighbourhood where city_id = v_city_id and slug = trim(r ->> 'neighbourhood');
        if v_hood_id is null then raise exception 'unknown neighbourhood "%" in this city', r ->> 'neighbourhood'; end if;
      end if;
      v_park_id := null;
      if nullif(trim(r ->> 'tech_park'), '') is not null then
        select id into v_park_id from tech_park where city_id = v_city_id and slug = trim(r ->> 'tech_park');
        if v_park_id is null then raise exception 'unknown tech park "%" in this city', r ->> 'tech_park'; end if;
      end if;

      -- Evidence (P9-07): a list of {field, source_url, verified_at}. Each entry is evidence for one field only; a row's
      -- source is not evidence for every field. The office's address and location always need it.
      v_evidence := coalesce(r -> 'evidence', '[]'::jsonb);
      if jsonb_typeof(v_evidence) <> 'array' then raise exception 'the evidence must be a list'; end if;
      for v_ev in select value from jsonb_array_elements(v_evidence) loop
        v_ev_field := v_ev ->> 'field';
        if v_ev_field is null or v_ev_field not in ('name', 'website', 'description', 'types', 'sectors', 'startup_stage', 'ownership_status', 'address', 'location') then
          raise exception 'unknown evidence field "%"', coalesce(v_ev_field, '');
        end if;
        if coalesce(v_ev ->> 'source_url', '') !~ '^https://[^\s]+$' or length(v_ev ->> 'source_url') > 2000 then
          raise exception 'the source for the % must be an https link', replace(v_ev_field, '_', ' ');
        end if;
        begin
          v_ev_date := (v_ev ->> 'verified_at')::date;
        exception when others then
          raise exception 'the verified date for the % is not a date', replace(v_ev_field, '_', ' ');
        end;
        if v_ev_date is null or v_ev_date > current_date or v_ev_date < date '2000-01-01' then
          raise exception 'the verified date for the % must be a real past date (the day someone checked the source)', replace(v_ev_field, '_', ' ');
        end if;
      end loop;
      v_needed := array['address', 'location'];

      select id into v_company_id from company where domain = v_domain;

      if v_company_id is not null then
        -- Known company: add the office unless the same address is already there.
        if exists (select 1 from office o where o.company_id = v_company_id and o.city_id = v_city_id and lower(o.address) = lower(v_address)) then
          n_skipped := n_skipped + 1;
          results := results || jsonb_build_object('row', i, 'result', 'skipped', 'message', 'this office is already listed for ' || v_domain);
          continue;
        end if;
        foreach v_ev_field in array v_needed loop
          if not exists (select 1 from jsonb_array_elements(v_evidence) x where x ->> 'field' = v_ev_field) then
            raise exception 'there is no evidence for the %', v_ev_field;
          end if;
        end loop;
        insert into office (company_id, city_id, neighbourhood_id, tech_park_id, address, geom, accuracy, verification, status)
        values (v_company_id, v_city_id, v_hood_id, v_park_id, v_address,
                st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography, v_accuracy, 'unverified', 'draft')
        returning id into v_office_id;
        insert into field_evidence (office_id, field, source_url, verified_at)
        select v_office_id, x ->> 'field', x ->> 'source_url', (x ->> 'verified_at')::date
        from jsonb_array_elements(v_evidence) x where x ->> 'field' in ('address', 'location');
        n_attached := n_attached + 1;
        results := results || jsonb_build_object('row', i, 'result', 'attached', 'message', 'office added to the existing company ' || v_domain);
        continue;
      end if;

      -- New company.
      v_types := coalesce(array(select jsonb_array_elements_text(coalesce(r -> 'types', '[]'::jsonb))), array[]::text[]);
      v_stage := nullif(lower(trim(r ->> 'startup_stage')), '');
      v_ownership := nullif(lower(trim(r ->> 'ownership_status')), '');
      -- A file written before ADR-0017 may still carry Public or Acquired as a stage: it is an ownership status now.
      if v_stage in ('public', 'acquired') then
        if v_ownership is not null and v_ownership <> v_stage then
          raise exception 'the stage "%" and the ownership status "%" disagree', v_stage, v_ownership;
        end if;
        v_ownership := v_stage;
        v_stage := null;
        -- Evidence given for that "stage" is evidence for the ownership status.
        v_evidence := coalesce((select jsonb_agg(case when x ->> 'field' = 'startup_stage'
                                                      then jsonb_set(x, '{field}', '"ownership_status"') else x end)
                                from jsonb_array_elements(v_evidence) x), '[]'::jsonb);
      end if;
      if v_ownership is not null and v_ownership not in ('private', 'public', 'acquired') then
        raise exception 'unknown ownership status "%"', v_ownership;
      end if;
      if v_stage is not null and not ('startup' = any (v_types)) then
        raise exception 'a startup stage needs the type startup';
      end if;
      v_base := slugify(coalesce(nullif(trim(r ->> 'slug'), ''), v_name));
      if v_base = '' then raise exception 'the name has no letters or digits for a slug'; end if;
      v_slug := v_base;
      v_n := 1;
      while exists (select 1 from company where slug = v_slug) or exists (select 1 from slug_redirect where old_slug = v_slug) loop
        v_n := v_n + 1;
        v_slug := v_base || '-' || v_n;
      end loop;

      v_needed := v_needed || array['name', 'website'];
      if nullif(trim(r ->> 'description'), '') is not null then v_needed := array_append(v_needed, 'description'); end if;
      if cardinality(v_types) > 0 then v_needed := array_append(v_needed, 'types'); end if;
      if jsonb_array_length(coalesce(r -> 'sectors', '[]'::jsonb)) > 0 then v_needed := array_append(v_needed, 'sectors'); end if;
      if v_stage is not null then v_needed := array_append(v_needed, 'startup_stage'); end if;
      if v_ownership is not null then v_needed := array_append(v_needed, 'ownership_status'); end if;
      foreach v_ev_field in array v_needed loop
        if not exists (select 1 from jsonb_array_elements(v_evidence) x where x ->> 'field' = v_ev_field) then
          raise exception 'there is no evidence for the %', replace(v_ev_field, '_', ' ');
        end if;
      end loop;
      if exists (select 1 from jsonb_array_elements(v_evidence) x where x ->> 'field' <> all (v_needed)) then
        raise exception 'there is evidence for a field this row leaves empty: %',
          (select string_agg(distinct x ->> 'field', ', ') from jsonb_array_elements(v_evidence) x where x ->> 'field' <> all (v_needed));
      end if;

      insert into company (slug, name, domain, description, startup_stage, ownership_status, website_url, careers_url, status)
      values (v_slug, v_name, v_domain, nullif(trim(r ->> 'description'), ''), v_stage::startup_stage, v_ownership::ownership_status,
              coalesce(nullif(trim(r ->> 'website_url'), ''), 'https://' || v_domain),
              nullif(trim(r ->> 'careers_url'), ''), 'draft')
      returning id into v_company_id;

      insert into company_type_tag (company_id, type) select v_company_id, t::company_type from unnest(v_types) t;
      for v_sector in select jsonb_array_elements_text(coalesce(r -> 'sectors', '[]'::jsonb)) loop
        insert into company_sector (company_id, sector_id)
        select v_company_id, s.id from sector s where s.slug = v_sector;
        if not found then raise exception 'unknown sector "%"', v_sector; end if;
      end loop;

      insert into office (company_id, city_id, neighbourhood_id, tech_park_id, address, geom, accuracy, verification, status)
      values (v_company_id, v_city_id, v_hood_id, v_park_id, v_address,
              st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography, v_accuracy, 'unverified', 'draft')
      returning id into v_office_id;
      -- Each entry against its own record: company facts on the company, address and location on the office.
      insert into field_evidence (company_id, office_id, field, source_url, verified_at)
      select case when x ->> 'field' in ('address', 'location') then null else v_company_id end,
             case when x ->> 'field' in ('address', 'location') then v_office_id end,
             x ->> 'field', x ->> 'source_url', (x ->> 'verified_at')::date
      from jsonb_array_elements(v_evidence) x;
      n_created := n_created + 1;
      results := results || jsonb_build_object('row', i, 'result', 'created', 'message', 'company ' || v_slug || ' created as a draft');
    exception when others then
      n_errors := n_errors + 1;
      errors := errors || jsonb_build_object('row', i, 'message', sqlerrm);
      results := results || jsonb_build_object('row', i, 'result', 'error', 'message', sqlerrm);
    end;
  end loop;

  insert into import_batch (kind, filename, row_count, created_companies, attached_offices, skipped, error_count, errors)
  values ('csv', left(coalesce(nullif(trim(p_filename), ''), 'import.csv'), 200), i, n_created, n_attached, n_skipped, n_errors, errors)
  returning id into v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id, 'rows', i, 'created_companies', n_created, 'attached_offices', n_attached,
    'skipped', n_skipped, 'errors', n_errors, 'results', results
  );
end;
$$;
