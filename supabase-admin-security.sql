-- Secure the existing shared cart without deleting cart items or activity.
-- Run in the Supabase SQL editor after supabase-setup.sql.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.cart_admins (
    user_id uuid primary key references auth.users(id) on delete cascade,
    is_owner boolean not null default false,
    created_at timestamptz not null default now()
);
alter table private.cart_admins add column if not exists is_owner boolean not null default false;
drop index if exists private.cart_admins_one_admin_idx;
create unique index if not exists cart_admins_single_owner_idx
    on private.cart_admins ((is_owner)) where is_owner;

create table if not exists private.cart_admin_profiles (
    user_id uuid primary key references private.cart_admins(user_id) on delete cascade,
    display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
    updated_at timestamptz not null default now()
);

create table if not exists private.cart_admin_names (
    name_key text primary key,
    display_name text not null,
    user_id uuid references private.cart_admins(user_id) on delete cascade
);

insert into private.cart_admin_names (name_key, display_name)
values ('admin', 'Admin'), ('administrator', 'Administrator')
on conflict (name_key) do nothing;

revoke all on table private.cart_admins from public, anon, authenticated;
revoke all on table private.cart_admin_profiles from public, anon, authenticated;
revoke all on table private.cart_admin_names from public, anon, authenticated;

alter table public.shared_cart_activity
    drop constraint if exists shared_cart_activity_action_check;
alter table public.shared_cart_activity
    add constraint shared_cart_activity_action_check
    check (action in (
        'item_added', 'quantity_reduced', 'item_removed', 'cart_cleared',
        'activity_cleared'
    ));

drop function if exists public.get_cart_admin_profile();
create or replace function public.get_cart_admin_profile()
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

create or replace function private.guard_admin_display_name()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
begin
    if exists (
        select 1 from private.cart_admins as admin
        where admin.user_id = auth.uid()
    ) then
        return new;
    end if;

    if exists (
        select 1 from private.cart_admin_names as reserved
        where reserved.name_key = lower(btrim(new.actor_name))
    ) then
        raise exception using errcode = '42501',
            message = 'That display name is reserved for the cart administrator.';
    end if;

    return new;
end;
$$;

drop trigger if exists guard_admin_display_name on public.shared_cart_activity;
create trigger guard_admin_display_name
before insert on public.shared_cart_activity
for each row execute function private.guard_admin_display_name();

create or replace function public.set_cart_admin_name(p_display_name text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
    v_name text := btrim(p_display_name);
    v_rows integer;
begin
    if auth.uid() is null or not exists (
        select 1 from private.cart_admins as admin
        where admin.user_id = auth.uid()
    ) then
        raise exception using errcode = '42501', message = 'Cart administrator access required.';
    end if;
    if v_name is null or char_length(v_name) not between 1 and 80 then
        raise exception 'Name must contain 1 to 80 characters.';
    end if;

    insert into private.cart_admin_names as reserved_name (name_key, display_name, user_id)
    values (lower(v_name), v_name, auth.uid())
    on conflict (name_key) do update
        set display_name = excluded.display_name,
            user_id = excluded.user_id
        where reserved_name.user_id is null or reserved_name.user_id = auth.uid();
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
        raise exception 'That name is already reserved for the cart administrator.';
    end if;

    insert into private.cart_admin_profiles (user_id, display_name, updated_at)
    values (auth.uid(), v_name, now())
    on conflict (user_id) do update
        set display_name = excluded.display_name,
            updated_at = now();

    return v_name;
end;
$$;

create or replace function public.clear_shared_cart_activity()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
    v_deleted integer;
    v_actor_name text;
begin
    if auth.uid() is null or not exists (
        select 1 from private.cart_admins as admin
        where admin.user_id = auth.uid()
    ) then
        raise exception using errcode = '42501', message = 'Cart administrator access required.';
    end if;

    select coalesce(profile.display_name, 'Admin')
    into v_actor_name
    from private.cart_admins as admin
    left join private.cart_admin_profiles as profile on profile.user_id = admin.user_id
    where admin.user_id = auth.uid();

    delete from public.shared_cart_activity;
    get diagnostics v_deleted = row_count;

    -- Keep a server-authenticated audit event so the history is not silently erased.
    insert into public.shared_cart_activity (action, actor_name)
    values ('activity_cleared', v_actor_name);

    return v_deleted;
end;
$$;

create or replace function public.clear_shared_cart(p_actor_name text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
    v_actor_name text;
begin
    if auth.uid() is null or not exists (
        select 1 from private.cart_admins as admin
        where admin.user_id = auth.uid()
    ) then
        raise exception using errcode = '42501', message = 'Cart administrator access required.';
    end if;

    select coalesce(profile.display_name, 'Admin')
    into v_actor_name
    from private.cart_admins as admin
    left join private.cart_admin_profiles as profile on profile.user_id = admin.user_id
    where admin.user_id = auth.uid();

    delete from public.shared_cart_items;
    insert into public.shared_cart_activity (action, actor_name)
    values ('cart_cleared', v_actor_name);
end;
$$;

create or replace function public.clear_shared_cart()
returns void
language sql
security definer
set search_path = pg_catalog, public, auth, private
as $$
    select public.clear_shared_cart('Unknown device');
$$;

revoke all on function public.clear_shared_cart() from public, anon, authenticated;
revoke all on function public.clear_shared_cart(text) from public, anon, authenticated;
grant execute on function public.clear_shared_cart() to authenticated;
grant execute on function public.clear_shared_cart(text) to authenticated;

revoke all on function public.get_cart_admin_profile() from public, anon, authenticated;
revoke all on function public.set_cart_admin_name(text) from public, anon, authenticated;
revoke all on function public.clear_shared_cart_activity() from public, anon, authenticated;
revoke all on function private.guard_admin_display_name() from public, anon, authenticated;
grant execute on function public.get_cart_admin_profile() to authenticated;
grant execute on function public.set_cart_admin_name(text) to authenticated;
grant execute on function public.clear_shared_cart_activity() to authenticated;

-- Let the cart hide its administrator panel from visitors without disclosing
-- the administrator's email address or user ID.
create or replace function public.cart_admin_is_configured()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
    select exists (select 1 from private.cart_admins);
$$;

revoke all on function public.cart_admin_is_configured() from public, anon, authenticated;
grant execute on function public.cart_admin_is_configured() to anon, authenticated;

-- The current owner may add other already-verified Auth users as ordinary admins.
update private.cart_admins as admin
set is_owner = true
where admin.user_id = (
    select existing.user_id
    from private.cart_admins as existing
    order by existing.created_at, existing.user_id
    limit 1
)
and not exists (select 1 from private.cart_admins where is_owner);

create or replace function public.get_cart_admins()
returns table(email text, is_owner boolean)
language plpgsql
security definer
set search_path = pg_catalog, auth, private
as $$
begin
    if auth.uid() is null or not exists (
        select 1 from private.cart_admins
        where private.cart_admins.user_id = auth.uid() and private.cart_admins.is_owner
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
        select 1 from private.cart_admins
        where private.cart_admins.user_id = auth.uid() and private.cart_admins.is_owner
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

revoke all on function public.get_cart_admins() from public, anon, authenticated;
revoke all on function public.add_cart_admin(text) from public, anon, authenticated;
grant execute on function public.get_cart_admins() to authenticated;
grant execute on function public.add_cart_admin(text) to authenticated;
