-- P9-13: an administrator counts only in a session that passed multi-factor authentication (aal2).
-- Run with `npx supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

-- Signed in as uid at an assurance level: 'aal1' is a password-only session, 'aal2' one with a verified second factor,
-- null a token without the claim.
create function tests.become_at(uid uuid, aal text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    (jsonb_build_object('sub', uid, 'role', 'authenticated') || coalesce(jsonb_build_object('aal', aal), '{}'))::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function tests.sqlstate_of(q text) returns text
language plpgsql as $$
begin
  execute q;
  return null;
exception when others then
  return sqlstate;
end;
$$;
grant execute on all functions in schema tests to authenticated;

truncate public.admin_user;
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000a0f01'), ('00000000-0000-0000-0000-0000000a0f02');
insert into admin_user (user_id, role) values
  ('00000000-0000-0000-0000-0000000a0f01', 'admin'),
  ('00000000-0000-0000-0000-0000000a0f02', 'editor');

select tests.become_at('00000000-0000-0000-0000-0000000a0f01', 'aal1');
select is(is_admin('editor'), false, 'a password-only session is no administrator');
select is((select count(*) from admin_user), 1::bigint, 'but it can read its own admin_user row (so the admin page asks for the code)');
select isnt(tests.sqlstate_of('select publish_now()'), null, 'and it cannot publish');
reset role;

select tests.become_at('00000000-0000-0000-0000-0000000a0f01', null);
select is(is_admin('editor'), false, 'a token without an assurance level is no administrator');
reset role;

select tests.become_at('00000000-0000-0000-0000-0000000a0f01', 'aal2');
select is(is_admin('admin'), true, 'after the second factor, the admin is an admin');
select is((select count(*) from admin_user), 2::bigint, 'and sees every administrator');
select is(tests.sqlstate_of('select publish_now()'), null, 'and can publish');
reset role;

select tests.become_at('00000000-0000-0000-0000-0000000a0f02', 'aal2');
select is(is_admin('editor'), true, 'an editor with a second factor is an editor');
select is(is_admin('reviewer'), false, 'and still not a reviewer');
reset role;

select * from finish();
rollback;
