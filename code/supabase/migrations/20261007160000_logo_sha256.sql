-- Logo integrity from the bytes, computed on the server (follow-up to SEC-2, 20261007150000).
--
-- 20261007150000's activate_logo compared the public copy's Storage metadata (size, type, content tag) with the upload.
-- That metadata is written by the uploader's request, so it cannot establish integrity. Now:
--   1. a signed-in reviewer asks to activate an APPROVED upload (request_logo_activation): who and when are recorded;
--   2. the `activate-logo` Edge Function downloads the pending upload and the public copy with the service key and computes
--      the SHA-256 of each file's bytes itself;
--   3. complete_logo_activation (service_role only) accepts it only if both hashes equal the content hash the upload's key
--      names (<company>/<sha256>.<ext>), and only for a request made in the last ten minutes. Only then is it the logo.
-- No hash supplied by a browser is ever compared.

alter table public.logo_asset
  add column activation_requested_by uuid,
  add column activation_requested_at timestamptz,
  add column verified_sha256 text check (verified_sha256 is null or verified_sha256 ~ '^[0-9a-f]{64}$');

-- The content hash the key names: <company id>/<64 hex>.<ext>.
create function public.logo_key_sha256(p_key text) returns text
language sql
immutable
as $$
  select lower(split_part(split_part(p_key, '/', 2), '.', 1));
$$;

drop function public.activate_logo(bigint);

-- Step 1, as the signed-in reviewer. Returns the storage key the function must check.
create function public.request_logo_activation(p_id bigint) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  a logo_asset;
begin
  if not is_admin('reviewer') then
    raise exception 'only a reviewer or admin can make an approved logo the company''s logo' using errcode = 'insufficient_privilege';
  end if;
  select * into a from logo_asset where id = p_id for update;
  if not found then
    raise exception 'no such logo' using errcode = 'no_data_found';
  end if;
  if a.decision is distinct from 'approved' then
    raise exception 'only an approved logo can be activated (this one is %)', coalesce(a.decision, 'undecided') using errcode = 'check_violation';
  end if;
  if a.activated_at is not null then
    raise exception 'this logo is already active' using errcode = 'check_violation';
  end if;
  update logo_asset set activation_requested_by = auth.uid(), activation_requested_at = now() where id = p_id;
  return a.storage_key;
end;
$$;
revoke all on function public.request_logo_activation(bigint) from public, anon;
grant execute on function public.request_logo_activation(bigint) to authenticated;

-- Step 3, by the Edge Function with the service key, with the hashes it computed from the bytes.
create function public.complete_logo_activation(p_id bigint, p_pending_sha256 text, p_public_sha256 text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a logo_asset;
  expected text;
begin
  if public.caller_role() <> 'service_role' and not public.caller_is_owner() then
    raise exception 'only the activate-logo function completes an activation' using errcode = 'insufficient_privilege';
  end if;
  select * into a from logo_asset where id = p_id for update;
  if not found then
    raise exception 'no such logo' using errcode = 'no_data_found';
  end if;
  if a.decision is distinct from 'approved' or a.activated_at is not null then
    raise exception 'this logo is not an approved upload waiting to be activated' using errcode = 'check_violation';
  end if;
  if a.activation_requested_at is null or a.activation_requested_at < now() - interval '10 minutes' then
    raise exception 'no recent activation request by a reviewer' using errcode = 'check_violation';
  end if;
  expected := logo_key_sha256(a.storage_key);
  if expected !~ '^[0-9a-f]{64}$' then
    raise exception 'the upload''s key does not name a SHA-256' using errcode = 'check_violation';
  end if;
  if lower(coalesce(p_pending_sha256, '')) <> expected then
    raise exception 'the reviewed upload''s bytes do not match its recorded hash' using errcode = 'check_violation';
  end if;
  if lower(coalesce(p_public_sha256, '')) <> expected then
    raise exception 'the public copy''s bytes do not match the reviewed upload' using errcode = 'check_violation';
  end if;
  update logo_asset set activated_at = now(), verified_sha256 = expected where id = p_id;
  update company set logo_key = a.storage_key where id = a.company_id;
end;
$$;
revoke all on function public.complete_logo_activation(bigint, text, text) from public, anon, authenticated;
grant execute on function public.complete_logo_activation(bigint, text, text) to service_role;
