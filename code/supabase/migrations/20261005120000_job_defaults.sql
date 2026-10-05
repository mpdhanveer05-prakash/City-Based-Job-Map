-- P7-02: a job an admin types in has only a title and a link. The columns the database needs to find duplicates
-- (title_norm and dedup_hash) are filled in here, so the admin form and any other writer need not know how.
--
--   title_norm  the title lower-cased with its ends trimmed
--   dedup_hash  md5 of company id, title_norm, and apply URL, joined by "|" (a job with the same title and link at the
--               same company is the same job). The pipeline (P8-01) may set its own hash from the feed's external id; a
--               value that is given is never overwritten.
--
-- It runs BEFORE the NOT NULL checks, so an insert that leaves both out succeeds. When a job's title or link changes and
-- the hash was not changed with it, the hash follows.

create function public.job_defaults() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (new.title, new.apply_url) is distinct from (old.title, old.apply_url) then
    if new.title_norm is not distinct from old.title_norm then
      new.title_norm := lower(btrim(new.title));
    end if;
    if new.dedup_hash is not distinct from old.dedup_hash then
      new.dedup_hash := decode(md5(new.company_id::text || '|' || new.title_norm || '|' || new.apply_url), 'hex');
    end if;
  end if;
  if new.title_norm is null or new.title_norm = '' then
    new.title_norm := lower(btrim(new.title));
  end if;
  if new.dedup_hash is null then
    new.dedup_hash := decode(md5(new.company_id::text || '|' || new.title_norm || '|' || new.apply_url), 'hex');
  end if;
  return new;
end;
$$;

create trigger job_defaults before insert or update on public.job
  for each row execute function public.job_defaults();
