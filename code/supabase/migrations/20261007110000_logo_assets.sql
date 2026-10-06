-- Company logos (curation guide: "It is this company's current logo, and we may use it"; release checklist row 6).
--
-- * Files live in the public `company-logos` Storage bucket, which lib/data/logo.ts already reads: raster only (security.md
--   refuses SVG), at most 1 MB, under <company id>/<sha-256 of the file>.<ext>, so a key names exactly one file and a file is
--   never replaced in place.
-- * Every upload has a provenance record (logo_asset): where the file came from, on what basis we may use it, the page that
--   shows that basis, a note, the date it was obtained, and who uploaded it.
-- * A reviewer approves or rejects it with a note. A self-review is allowed and recorded, as for evidence (ADR-0022).
-- * company.logo_key may be set by a signed-in administrator only to an approved logo of that company; approving sets it.
--
-- The permitted-use categories are a proposal for the owner to confirm (they are not legal advice):
--   company_brand_assets  the company's own brand, press, or media kit page offers the logo for use
--   written_permission    the company gave written permission (the note says who, and when; the page or a record shows it)
--   licensed_provider     a logo provider whose licence covers this use (the note names the licence)

-- The storage schema exists on a hosted project and in the full local stack, but not in a Postgres-only database (CI's
-- `supabase db start`), so the bucket and its policies are created only where it exists. tests/database/15 skips without it.
do $guard$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'company-logos bucket not created: this database has no storage schema';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('company-logos', 'company-logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])
  on conflict (id) do nothing;
  -- Anyone may read the files of a public bucket by URL. Through the API, only editors list them and upload, nobody replaces
  -- one, and only an admin deletes one.
  create policy company_logos_read on storage.objects for select to authenticated
    using (bucket_id = 'company-logos' and public.is_admin('editor'));
  create policy company_logos_upload on storage.objects for insert to authenticated
    with check (bucket_id = 'company-logos' and public.is_admin('editor')
                and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}\.(png|jpg|webp|gif|avif)$');
  create policy company_logos_delete on storage.objects for delete to authenticated
    using (bucket_id = 'company-logos' and public.is_admin('admin'));
end
$guard$;

create table public.logo_asset (
  id               bigint generated always as identity primary key,
  company_id       uuid not null references public.company (id) on delete cascade,
  storage_key      text not null unique
                   check (storage_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}\.(png|jpg|webp|gif|avif)$'),
  content_type     text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif')),
  bytes            integer not null check (bytes between 1 and 1048576),
  source_url       text not null check (source_url ~ '^https://[^\s]+$'),
  permitted_use    text not null check (permitted_use in ('company_brand_assets', 'written_permission', 'licensed_provider')),
  permission_url   text not null check (permission_url ~ '^https://[^\s]+$'),
  permission_note  text not null check (length(btrim(permission_note)) >= 10),
  obtained_on      date not null check (obtained_on <= current_date),
  uploaded_by      uuid not null default auth.uid() references auth.users (id),
  uploaded_at      timestamptz not null default now(),
  decision         text check (decision in ('approved', 'rejected')),
  decision_note    text,
  reviewed_by      uuid references auth.users (id),
  reviewed_at      timestamptz,
  self_reviewed    boolean generated always as (reviewed_by = uploaded_by) stored,
  check ((decision is null) = (reviewed_by is null) and (decision is null) = (reviewed_at is null)),
  check (decision is null or length(btrim(coalesce(decision_note, ''))) > 0),
  -- The key starts with the company's id.
  check (split_part(storage_key, '/', 1) = company_id::text)
);
create index logo_asset_company on public.logo_asset (company_id);
alter table public.logo_asset enable row level security;
revoke all on public.logo_asset from anon;
revoke update, delete, truncate, references, trigger on public.logo_asset from authenticated;
create policy logo_asset_read on public.logo_asset for select to authenticated using (public.is_admin('editor'));
-- An upload is recorded by the editor who made it, undecided; the file must already be in the bucket.
create policy logo_asset_insert on public.logo_asset for insert to authenticated
  with check (public.is_admin('editor') and uploaded_by = auth.uid() and decision is null);

create function public.logo_asset_file_exists() returns trigger
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
  execute 'select exists (select 1 from storage.objects o where o.bucket_id = ''company-logos'' and o.name = $1)' into present using new.storage_key;
  if not present then
    raise exception 'the logo file % is not in the company-logos bucket: upload it first', new.storage_key using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger logo_asset_file_exists before insert on public.logo_asset
  for each row execute function public.logo_asset_file_exists();

create trigger audit_logo_asset after insert or update or delete on public.logo_asset
  for each row execute function public.audit_row_change('id');

-- A reviewer's decision. Approving makes it the company's logo; rejecting the current logo removes it.
create function public.review_logo(p_id bigint, p_decision text, p_note text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a logo_asset;
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
  update logo_asset set decision = p_decision, decision_note = btrim(p_note), reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id;
  if p_decision = 'approved' then
    update company set logo_key = a.storage_key where id = a.company_id;
  else
    update company set logo_key = null where id = a.company_id and logo_key = a.storage_key;
  end if;
end;
$$;
revoke all on function public.review_logo(bigint, text, text) from public, anon;
grant execute on function public.review_logo(bigint, text, text) to authenticated;

-- A signed-in administrator may point company.logo_key only at an approved logo of that company (or clear it). The seed and
-- the migration owner are not signed in; RELEASE_BUILD and the launch gate check the published data separately.
create function public.logo_key_gate() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or new.logo_key is null or new.logo_key is not distinct from (case when tg_op = 'UPDATE' then old.logo_key end) then
    return new;
  end if;
  if not exists (select 1 from logo_asset a where a.company_id = new.id and a.storage_key = new.logo_key and a.decision = 'approved') then
    raise exception 'the logo must be an approved upload for this company, with its provenance recorded' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger company_logo_key_gate before insert or update of logo_key on public.company
  for each row execute function public.logo_key_gate();
