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
