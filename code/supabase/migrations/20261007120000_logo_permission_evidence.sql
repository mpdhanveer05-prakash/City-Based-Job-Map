-- Logo provenance must show the actual permitted use, not only a category (owner, 7 Oct 2026; ADR-0024):
-- * "It is the company's official brand asset" is not permission by itself: record the brand guidelines or the permission
--   that allows this use, with the wording that grants it.
-- * Whatever the category, the terms must allow what we do with the file: store it (our Storage), display it (the site),
--   and resize it into the map's logo atlas. The uploader records each, quoting the terms; the reviewer checks them.
alter table public.logo_asset
  add column terms_quote text,
  add column allows_storage boolean not null default false,
  add column allows_display boolean not null default false,
  add column allows_atlas boolean not null default false;

comment on column public.logo_asset.permission_url is 'The page of the brand guidelines, the permission, or the licence that allows this use';
comment on column public.logo_asset.terms_quote is 'The wording on that page (or in the permission) that grants the use';
comment on column public.logo_asset.allows_atlas is 'The terms allow resizing the logo into the map''s logo atlas (a derived image)';

alter table public.logo_asset
  add constraint logo_asset_permitted_use_evidence check (
    length(btrim(coalesce(terms_quote, ''))) >= 20 and allows_storage and allows_display and allows_atlas
  );
