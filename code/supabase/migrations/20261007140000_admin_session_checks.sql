-- P9-13 follow-up (owner, 7 Oct 2026): MFA must hold beyond the admin page, including after sign-out and factor removal.
--
-- An access token is self-contained: until it expires (an hour by default) it keeps saying `aal2`, even after the user signs
-- out or an administrator removes their factor. So is_admin() now also checks, in Supabase Auth's own tables, that
--   * the token's session still exists, is at aal2, and has not passed its end (signing out deletes the session), and
--   * the user still has a verified second factor (removing it ends their administrator access at once).
-- An expired token never reaches the database: the API refuses it first (tests/admin covers this).
--
-- It also removes grants that were wider than needed. Supabase grants `authenticated` (and some `anon`) EXECUTE on new
-- functions explicitly, so `revoke ... from public` had left these callable. They ran with the caller's rights, so table
-- privileges and RLS already refused the writes, but only the pipeline (and the cron owner, for partitions) should call them.

create or replace function public.is_admin(min_role text default 'editor') returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
     and exists (
       select 1 from admin_user
       where user_id = (select auth.uid())
         and array_position(array['editor', 'reviewer', 'admin'], role)
          >= array_position(array['editor', 'reviewer', 'admin'], min_role)
     )
     and exists (
       select 1 from auth.sessions s
       where s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
         and s.user_id = (select auth.uid())
         and s.aal = 'aal2'
         and (s.not_after is null or s.not_after > now())
     )
     and exists (
       select 1 from auth.mfa_factors f
       where f.user_id = (select auth.uid()) and f.status = 'verified'
     );
$$;

revoke execute on function public.record_heartbeat(text, text) from anon, authenticated;
revoke execute on function public.record_link_check(uuid, boolean, integer, text, text) from anon, authenticated;
revoke execute on function public.missed_heartbeats() from anon, authenticated;
revoke execute on function public.ensure_verification_partitions(integer) from public, anon, authenticated, pipeline;
revoke execute on function public.drop_old_verification_partitions(integer) from public, anon, authenticated, pipeline;
