-- File purpose: Database setup and functions for owners, admins, account lists, and account removal.

-- Allow the existing sole admin to manage additional verified administrators.
-- The earliest existing allowlisted user becomes the owner if none is marked yet.

alter table private.cart_admins
    add column if not exists is_owner boolean not null default false;

drop index if exists private.cart_admins_one_admin_idx;
update private.cart_admins as admin
set is_owner = true
where admin.user_id = (
    select existing.user_id
    from private.cart_admins as existing
    order by existing.created_at, existing.user_id
    limit 1
)
and not exists (select 1 from private.cart_admins where is_owner);

create unique index if not exists cart_admins_single_owner_idx
    on private.cart_admins ((is_owner)) where is_owner;

drop function if exists public.get_cart_admin_profile();
create function public.get_cart_admin_profile()
returns table(display_name text, is_owner boolean)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
begin
    if auth.uid() is null or not exists (
        select 1 from private.cart_admins as admin
        where admin.user_id = auth.uid()
    ) then
        return;
    end if;

    return query
    select profile.display_name, admin.is_owner
    from private.cart_admins as admin
    left join private.cart_admin_profiles as profile on profile.user_id = admin.user_id
    where admin.user_id = auth.uid();
end;
$$;

create or replace function public.get_cart_admins()
returns table(email text, is_owner boolean)
language plpgsql
security definer
set search_path = pg_catalog, auth, private
as $$
begin
    if auth.uid() is null or not exists (
        select 1 from private.cart_admins as admin
        where admin.user_id = auth.uid() and admin.is_owner
    ) then
        raise exception using errcode = '42501', message = 'Cart owner access required.';
    end if;

    return query
    select users.email::text, admin.is_owner
    from private.cart_admins as admin
    join auth.users as users on users.id = admin.user_id
    order by admin.is_owner desc, lower(users.email);
end;
$$;

create or replace function public.add_cart_admin(p_email text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, auth, private
as $$
declare
    v_user_id uuid;
    v_email text;
begin
    if auth.uid() is null or not exists (
        select 1 from private.cart_admins as admin
        where admin.user_id = auth.uid() and admin.is_owner
    ) then
        raise exception using errcode = '42501', message = 'Cart owner access required.';
    end if;

    select users.id, users.email::text
    into v_user_id, v_email
    from auth.users as users
    where lower(users.email) = lower(btrim(p_email))
      and users.email_confirmed_at is not null;

    if v_user_id is null then
        raise exception 'No verified Supabase Auth account found for that email.';
    end if;

    insert into private.cart_admins (user_id, is_owner)
    values (v_user_id, false)
    on conflict (user_id) do nothing;

    return v_email;
end;
$$;

revoke all on function public.get_cart_admin_profile() from public, anon, authenticated;
revoke all on function public.get_cart_admins() from public, anon, authenticated;
revoke all on function public.add_cart_admin(text) from public, anon, authenticated;
grant execute on function public.get_cart_admin_profile() to authenticated;
grant execute on function public.get_cart_admins() to authenticated;
grant execute on function public.add_cart_admin(text) to authenticated;
-- Let every cart admin view Supabase Auth accounts. Only the owner can
-- delete selected non-owner accounts; the owner account is never deletable here.

create or replace function public.get_cart_auth_users()
returns table(
    user_id uuid,
    email text,
    email_confirmed_at timestamptz,
    created_at timestamptz,
    last_sign_in_at timestamptz,
    is_admin boolean,
    is_owner boolean
)
language plpgsql
security definer
set search_path = pg_catalog, auth, private
as $$
begin
    if auth.uid() is null or not exists (
        select 1 from private.cart_admins as admin
        where admin.user_id = auth.uid()
    ) then
        raise exception using errcode = '42501', message = 'Cart administrator access required.';
    end if;

    return query
    select users.id,
           users.email::text,
           users.email_confirmed_at,
           users.created_at,
           users.last_sign_in_at,
           (admins.user_id is not null),
           coalesce(admins.is_owner, false)
    from auth.users as users
    left join private.cart_admins as admins on admins.user_id = users.id
    order by coalesce(admins.is_owner, false) desc,
             (admins.user_id is not null) desc,
             users.created_at desc,
             lower(coalesce(users.email, ''));
end;
$$;

create or replace function public.delete_cart_auth_user(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, auth, private
as $$
declare
    v_email text;
    v_is_owner boolean;
begin
    if auth.uid() is null or not exists (
        select 1 from private.cart_admins as owner
        where owner.user_id = auth.uid() and owner.is_owner
    ) then
        raise exception using errcode = '42501', message = 'Cart owner access required.';
    end if;

    select users.email::text, coalesce(admins.is_owner, false)
    into v_email, v_is_owner
    from auth.users as users
    left join private.cart_admins as admins on admins.user_id = users.id
    where users.id = p_user_id;

    if not found then
        raise exception 'Auth account not found.';
    end if;
    if p_user_id = auth.uid() or v_is_owner then
        raise exception using errcode = '42501', message = 'The owner account cannot be deleted here.';
    end if;

    -- Deleting the Auth row cascades the selected account's sessions and any
    -- allowlisted admin profile. It does not delete cart activity history.
    delete from auth.users as users where users.id = p_user_id;
    return v_email;
end;
$$;

revoke all on function public.get_cart_auth_users() from public, anon, authenticated;
grant execute on function public.get_cart_auth_users() to authenticated;
revoke all on function public.delete_cart_auth_user(uuid) from public, anon, authenticated;
grant execute on function public.delete_cart_auth_user(uuid) to authenticated;
-- Let every cart admin view Supabase Auth accounts. Only the owner can
-- delete selected non-owner accounts; the owner account is never deletable here.

create or replace function public.get_cart_auth_users()
returns table(
    user_id uuid,
    email text,
    email_confirmed_at timestamptz,
    created_at timestamptz,
    last_sign_in_at timestamptz,
    is_admin boolean,
    is_owner boolean
)
language plpgsql
security definer
set search_path = pg_catalog, auth, private
as $$
begin
    if auth.uid() is null or not exists (
        select 1 from private.cart_admins as admin
        where admin.user_id = auth.uid()
    ) then
        raise exception using errcode = '42501', message = 'Cart administrator access required.';
    end if;

    return query
    select users.id,
           users.email::text,
           users.email_confirmed_at,
           users.created_at,
           users.last_sign_in_at,
           (admins.user_id is not null),
           coalesce(admins.is_owner, false)
    from auth.users as users
    left join private.cart_admins as admins on admins.user_id = users.id
    order by coalesce(admins.is_owner, false) desc,
             (admins.user_id is not null) desc,
             users.created_at desc,
             lower(coalesce(users.email, ''));
end;
$$;

create or replace function public.delete_cart_auth_user(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, auth, private
as $$
declare
    v_email text;
    v_is_owner boolean;
begin
    if auth.uid() is null or not exists (
        select 1 from private.cart_admins as owner
        where owner.user_id = auth.uid() and owner.is_owner
    ) then
        raise exception using errcode = '42501', message = 'Cart owner access required.';
    end if;

    select users.email::text, coalesce(admins.is_owner, false)
    into v_email, v_is_owner
    from auth.users as users
    left join private.cart_admins as admins on admins.user_id = users.id
    where users.id = p_user_id;

    if not found then
        raise exception 'Auth account not found.';
    end if;
    if p_user_id = auth.uid() or v_is_owner then
        raise exception using errcode = '42501', message = 'The owner account cannot be deleted here.';
    end if;

    -- Deleting the Auth row cascades the selected account's sessions and any
    -- allowlisted admin profile. It does not delete cart activity history.
    delete from auth.users as users where users.id = p_user_id;
    return v_email;
end;
$$;

revoke all on function public.get_cart_auth_users() from public, anon, authenticated;
grant execute on function public.get_cart_auth_users() to authenticated;
revoke all on function public.delete_cart_auth_user(uuid) from public, anon, authenticated;
grant execute on function public.delete_cart_auth_user(uuid) to authenticated;
