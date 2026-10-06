-- Unapproved logos must not be public (owner, 7 Oct 2026: logos stay unapproved until reviewed). In 20261007110000 an
-- upload went straight into the public `company-logos` bucket, so anyone who knew (or computed) its key could fetch it
-- before review. Now:
--   * editors upload to a private bucket, `company-logos-pending`, which only editors can read;
--   * approving copies the file into the public bucket: a reviewer may write there only a file whose record is still
--     undecided, and review_logo approves only once the public copy exists;
--   * a rejected upload never reaches the public bucket.
-- Guarded like 20261007110000: a Postgres-only database (CI) has no storage schema.
do $guard$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'logo buckets not changed: this database has no storage schema';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('company-logos-pending', 'company-logos-pending', false, 1048576, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])
  on conflict (id) do nothing;

  drop policy company_logos_upload on storage.objects;
  drop policy company_logos_read on storage.objects;

  create policy company_logos_pending_upload on storage.objects for insert to authenticated
    with check (bucket_id = 'company-logos-pending' and public.is_admin('editor')
                and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}\.(png|jpg|webp|gif|avif)$');
  create policy company_logos_pending_read on storage.objects for select to authenticated
    using (bucket_id = 'company-logos-pending' and public.is_admin('editor'));
  create policy company_logos_pending_delete on storage.objects for delete to authenticated
    using (bucket_id = 'company-logos-pending' and public.is_admin('admin'));

  -- The public bucket: a reviewer copies in only a file whose upload is recorded and not yet decided.
  create policy company_logos_publish on storage.objects for insert to authenticated
    with check (bucket_id = 'company-logos' and public.is_admin('reviewer')
                and exists (select 1 from public.logo_asset a where a.storage_key = name and a.decision is null));
  create policy company_logos_read on storage.objects for select to authenticated
    using (bucket_id = 'company-logos' and public.is_admin('editor'));
end
$guard$;

-- The record's file must be in the pending bucket (where uploads now go).
create or replace function public.logo_asset_file_exists() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  present boolean;
begin
  if to_regclass('storage.objects') is null then
    raise exception 'this database has no file storage, so no logo can be recorded' using errcode = 'check_violation';
  end if;
  execute 'select exists (select 1 from storage.objects o where o.bucket_id = ''company-logos-pending'' and o.name = $1)' into present using new.storage_key;
  if not present then
    raise exception 'the logo file % is not in the company-logos-pending bucket: upload it first', new.storage_key using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Approving needs the public copy (the admin page makes it just before); rejecting needs nothing.
create or replace function public.review_logo(p_id bigint, p_decision text, p_note text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a logo_asset;
  published boolean;
begin
  if not is_admin('reviewer') then
    raise exception 'only a reviewer or admin can approve or reject a logo' using errcode = 'insufficient_privilege';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'the decision is approved or rejected' using errcode = 'invalid_parameter_value';
  end if;
  if length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'write a note saying why' using errcode = 'invalid_parameter_value';
  end if;
  select * into a from logo_asset where id = p_id for update;
  if not found then
    raise exception 'no such logo' using errcode = 'no_data_found';
  end if;
  if a.decision is not null then
    raise exception 'this logo was already %', a.decision using errcode = 'check_violation';
  end if;
  if p_decision = 'approved' then
    execute 'select exists (select 1 from storage.objects o where o.bucket_id = ''company-logos'' and o.name = $1)' into published using a.storage_key;
    if not published then
      raise exception 'copy the file to the public company-logos bucket before approving it' using errcode = 'check_violation';
    end if;
  end if;
  update logo_asset set decision = p_decision, decision_note = btrim(p_note), reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id;
  if p_decision = 'approved' then
    update company set logo_key = a.storage_key where id = a.company_id;
  else
    update company set logo_key = null where id = a.company_id and logo_key = a.storage_key;
  end if;
end;
$$;
