-- File purpose: Private registry and RPCs for recording visitor-selected cart names and allowing admins to review or remove browser entries.

-- Store the self-entered name for each browser so every cart admin can see
-- the names that have used the shared cart. These are labels, not identities.

-- Private browser registry schema, cleanup rules, and legacy-name seeding.
create table if not exists private.shared_cart_users (
    device_id uuid primary key,
    display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

alter table private.shared_cart_users enable row level security;
revoke all on table private.shared_cart_users from public, anon, authenticated;
alter table private.shared_cart_users
    add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table private.shared_cart_users
    add column if not exists email text;
create index if not exists shared_cart_users_user_id_idx
    on private.shared_cart_users (user_id);

-- Seed legacy names from existing cart attribution and activity rows. Earlier
-- records did not include a browser ID, so use a stable per-name legacy ID.
with legacy_names as (
    select activity.actor_name as display_name, activity.created_at as seen_at
    from public.shared_cart_activity as activity
    where activity.action <> 'activity_cleared'
    union all
    select cart.added_by, cart.last_updated_at
    from public.shared_cart_items as cart
    union all
    select cart.last_updated_by, cart.last_updated_at
    from public.shared_cart_items as cart
), grouped_names as (
    select lower(btrim(display_name)) as name_key,
           (array_agg(btrim(display_name) order by seen_at desc))[1] as display_name,
           min(seen_at) as first_seen_at,
           max(seen_at) as last_seen_at
    from legacy_names
    where display_name is not null and char_length(btrim(display_name)) between 1 and 80
    group by lower(btrim(display_name))
)
insert into private.shared_cart_users (device_id, display_name, first_seen_at, last_seen_at)
select md5('legacy-cart-user:' || names.name_key)::uuid,
       names.display_name,
       names.first_seen_at,
       names.last_seen_at
from grouped_names as names
where names.name_key not in ('unknown device', 'unknown')
  and not exists (
      select 1 from private.cart_admin_names as reserved
      where reserved.name_key = names.name_key
  )
on conflict (device_id) do nothing;

-- Registry RPCs let approved visitors register and admins review/remove browser labels.
create or replace function public.register_shared_cart_user(
    p_device_id uuid,
    p_display_name text
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

    insert into private.shared_cart_users (device_id, display_name, user_id, email, last_seen_at)
    values (p_device_id, v_name, v_user_id, v_email, now())
    on conflict (device_id) do update
        set display_name = excluded.display_name,
            user_id = excluded.user_id,
            email = excluded.email,
            last_seen_at = now();
end;
$$;

create or replace function public.get_shared_cart_users()
returns table(
    device_id uuid,
    display_name text,
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
    select users.device_id, users.display_name, users.first_seen_at, users.last_seen_at
    from private.shared_cart_users as users
    order by users.last_seen_at desc, lower(users.display_name);
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

    delete from private.shared_cart_users where device_id = p_device_id;
end;
$$;

revoke all on function public.register_shared_cart_user(uuid, text) from public, anon, authenticated;
grant execute on function public.register_shared_cart_user(uuid, text) to authenticated;
revoke all on function public.get_shared_cart_users() from public, anon, authenticated;
grant execute on function public.get_shared_cart_users() to authenticated;
revoke all on function public.remove_shared_cart_user(uuid) from public, anon, authenticated;
grant execute on function public.remove_shared_cart_user(uuid) to authenticated;
