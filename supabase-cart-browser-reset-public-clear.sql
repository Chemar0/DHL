-- When an owner removes a visitor browser, its old saved name must not be
-- silently registered again. That browser must submit a name again first.
create table if not exists private.shared_cart_user_reset_required (
    device_id uuid primary key,
    removed_at timestamptz not null default now()
);

alter table private.shared_cart_user_reset_required enable row level security;
revoke all on table private.shared_cart_user_reset_required from public, anon, authenticated;

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
    if auth.uid() is not null and exists (
        select 1 from private.cart_admins as admin
        where admin.user_id = auth.uid()
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
    insert into private.shared_cart_users (device_id, display_name, last_seen_at)
    values (p_device_id, v_name, now())
    on conflict (device_id) do update
        set display_name = excluded.display_name,
            last_seen_at = now();
end;
$$;

create or replace function public.remove_shared_cart_user(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, auth, private
as $$
begin
    if auth.uid() is null or not exists (
        select 1 from private.cart_admins as owner
        where owner.user_id = auth.uid() and owner.is_owner
    ) then
        raise exception using errcode = '42501', message = 'Cart owner access required.';
    end if;
    if p_device_id is null then
        raise exception 'A browser ID is required.';
    end if;

    insert into private.shared_cart_user_reset_required (device_id, removed_at)
    values (p_device_id, now())
    on conflict (device_id) do update set removed_at = now();
    delete from private.shared_cart_users where device_id = p_device_id;
end;
$$;

-- Any visitor can clear the shared cart. The page asks for confirmation, and
-- this RPC records the browser's entered name (or the verified admin name).
create or replace function public.clear_shared_cart(p_actor_name text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
declare
    v_actor_name text := btrim(regexp_replace(coalesce(p_actor_name, ''), '\s+', ' ', 'g'));
begin
    if char_length(v_actor_name) not between 1 and 80 then
        v_actor_name := 'Unknown device';
    end if;

    if auth.uid() is not null and exists (
        select 1 from private.cart_admins as admin
        where admin.user_id = auth.uid()
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

revoke all on function public.register_shared_cart_user(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.register_shared_cart_user(uuid, text, boolean) to anon, authenticated;
revoke all on function public.remove_shared_cart_user(uuid) from public, anon, authenticated;
grant execute on function public.remove_shared_cart_user(uuid) to authenticated;
revoke all on function public.clear_shared_cart(text) from public, anon, authenticated;
revoke all on function public.clear_shared_cart() from public, anon, authenticated;
grant execute on function public.clear_shared_cart(text) to anon, authenticated;
grant execute on function public.clear_shared_cart() to anon, authenticated;

notify pgrst, 'reload schema';
