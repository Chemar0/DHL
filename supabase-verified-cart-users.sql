-- Require a confirmed email and approved website access for shared cart use,
-- and link each named browser to the verified Auth account that registered it.
create or replace function private.require_verified_cart_user()
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, auth
as $$
declare
    v_email text;
begin
    if auth.uid() is null then
        raise exception using errcode = '42501', message = 'Verify your email before using the shared cart.';
    end if;

    select users.email::text
    into v_email
    from auth.users as users
    where users.id = auth.uid()
      and users.email_confirmed_at is not null;

    if v_email is null then
        raise exception using errcode = '42501', message = 'Verify your email before using the shared cart.';
    end if;

    if not private.user_has_website_access(auth.uid()) then
        raise exception using errcode = '42501', message = 'Administrator approval is required to access this website.';
    end if;

    return v_email;
end;
$$;
revoke all on function private.require_verified_cart_user() from public, anon, authenticated;

create or replace function private.guard_verified_cart_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
    perform private.require_verified_cart_user();
    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;
revoke all on function private.guard_verified_cart_user() from public, anon, authenticated;

drop trigger if exists require_verified_cart_user_items on public.shared_cart_items;
create trigger require_verified_cart_user_items
before insert or update or delete on public.shared_cart_items
for each row execute function private.guard_verified_cart_user();

drop trigger if exists require_verified_cart_user_activity on public.shared_cart_activity;
create trigger require_verified_cart_user_activity
before insert or update or delete on public.shared_cart_activity
for each row execute function private.guard_verified_cart_user();

alter table private.shared_cart_users
    add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table private.shared_cart_users
    add column if not exists email text;
create index if not exists shared_cart_users_user_id_idx
    on private.shared_cart_users (user_id);

drop function if exists public.get_shared_cart();
create function public.get_shared_cart()
returns table(
    category text,
    item_name text,
    quantity integer,
    added_by text,
    last_updated_by text,
    last_updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
    perform private.require_verified_cart_user();
    return query
    select cart.category, cart.item_name, cart.quantity,
           cart.added_by, cart.last_updated_by, cart.last_updated_at
    from public.shared_cart_items as cart
    order by cart.category, cart.item_name;
end;
$$;

drop function if exists public.register_shared_cart_user(uuid, text, boolean);
drop function if exists public.register_shared_cart_user(uuid, text);
create function public.register_shared_cart_user(
    p_device_id uuid,
    p_display_name text,
    p_name_reentered boolean default false
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, auth, private
as $$
declare
    v_name text := btrim(regexp_replace(coalesce(p_display_name, ''), '\s+', ' ', 'g'));
    v_user_id uuid := auth.uid();
    v_email text := private.require_verified_cart_user();
begin
    if p_device_id is null then
        raise exception 'A browser ID is required.';
    end if;
    if exists (
        select 1 from private.shared_cart_user_reset_required as reset
        where reset.device_id = p_device_id
    ) and not coalesce(p_name_reentered, false) then
        raise exception using errcode = 'P0001', message = 'NAME_RESET_REQUIRED';
    end if;
    if char_length(v_name) not between 1 and 80 then
        raise exception 'Name must contain 1 to 80 characters.';
    end if;
    if exists (
        select 1 from private.cart_admins as admin
        where admin.user_id = v_user_id
    ) then
        raise exception using errcode = '42501', message = 'Administrator browsers are not listed as visitors.';
    end if;
    if exists (
        select 1 from private.cart_admin_names as reserved
        where reserved.name_key = lower(v_name)
    ) then
        raise exception using errcode = '42501', message = 'That display name is reserved for a cart administrator.';
    end if;

    delete from private.shared_cart_user_reset_required where device_id = p_device_id;
    insert into private.shared_cart_users (device_id, display_name, user_id, email, last_seen_at)
    values (p_device_id, v_name, v_user_id, v_email, now())
    on conflict (device_id) do update
        set display_name = excluded.display_name,
            user_id = excluded.user_id,
            email = excluded.email,
            last_seen_at = now();
end;
$$;

drop function if exists public.get_shared_cart_users();
create function public.get_shared_cart_users()
returns table(
    device_id uuid,
    display_name text,
    user_id uuid,
    email text,
    first_seen_at timestamptz,
    last_seen_at timestamptz
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
    select users.device_id, users.display_name, users.user_id, users.email,
           users.first_seen_at, users.last_seen_at
    from private.shared_cart_users as users
    where users.user_id is not null and users.email is not null
    order by users.last_seen_at desc, lower(users.display_name);
end;
$$;

create or replace function public.clear_shared_cart(p_actor_name text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
    v_actor_name text := btrim(regexp_replace(coalesce(p_actor_name, ''), '\s+', ' ', 'g'));
begin
    perform private.require_verified_cart_user();
    if char_length(v_actor_name) not between 1 and 80 then
        v_actor_name := 'Unknown device';
    end if;

    if exists (
        select 1 from private.cart_admins as admin where admin.user_id = auth.uid()
    ) then
        select coalesce(profile.display_name, 'Admin')
        into v_actor_name
        from private.cart_admins as admin
        left join private.cart_admin_profiles as profile on profile.user_id = admin.user_id
        where admin.user_id = auth.uid();
    end if;

    delete from public.shared_cart_items where true;
    insert into public.shared_cart_activity (action, actor_name)
    values ('cart_cleared', v_actor_name);
end;
$$;

create or replace function public.clear_shared_cart()
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
    select public.clear_shared_cart('Unknown device');
$$;

-- Keep the SQL endpoints aligned with the verified, approved access gate.
revoke all on function public.get_shared_cart() from public, anon, authenticated;
grant execute on function public.get_shared_cart() to authenticated;
revoke all on function public.adjust_shared_cart_item(text, text, integer) from public, anon, authenticated;
revoke all on function public.adjust_shared_cart_item(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.adjust_shared_cart_item(text, text, integer) to authenticated;
grant execute on function public.adjust_shared_cart_item(text, text, integer, text) to authenticated;
revoke all on function public.register_shared_cart_user(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.register_shared_cart_user(uuid, text, boolean) to authenticated;
revoke all on function public.get_shared_cart_users() from public, anon, authenticated;
grant execute on function public.get_shared_cart_users() to authenticated;
revoke all on function public.log_cart_order_email(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.log_cart_order_email(text, text, jsonb, text) to authenticated;
revoke all on function public.clear_shared_cart(text) from public, anon, authenticated;
revoke all on function public.clear_shared_cart() from public, anon, authenticated;
grant execute on function public.clear_shared_cart(text) to authenticated;
grant execute on function public.clear_shared_cart() to authenticated;

notify pgrst, 'reload schema';
