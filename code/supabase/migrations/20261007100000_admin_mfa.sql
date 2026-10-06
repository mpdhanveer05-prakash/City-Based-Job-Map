-- P9-13: administrators must use multi-factor authentication (owner decision, 6 Oct 2026).
--
-- Every admin read and write goes through is_admin() (RLS policies, the admin RPCs, the publication gates' callers), so
-- requiring a second factor there covers all of them. A session counts only when its access token says `aal2`: Supabase
-- Auth issues that after the user has verified a TOTP code in this session. A password-only session (`aal1`) is still
-- signed in, and may read its own admin_user row (so the admin page knows to ask for the code), but is no administrator.
--
-- Unaffected: anon (the public site and the build), the pipeline role, the service role, and the migration owner, none
-- of which call is_admin() with a user's token.
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
     );
$$;
