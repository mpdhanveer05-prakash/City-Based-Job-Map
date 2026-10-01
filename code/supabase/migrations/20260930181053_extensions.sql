-- P1-03: extensions the data model needs (docs/data-model.md).
-- PostGIS for office geometry and city boundaries; pg_trgm for fuzzy search on
-- company, job, and founder names. Supabase convention: extensions live in the
-- `extensions` schema, which is on the default search_path.
create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;
