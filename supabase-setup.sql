-- File purpose: Base database setup for shared cart items, change history, admin tools, and order email history.

-- Shared cart for the GitHub Pages mechanical and electrical parts lists.
-- Anyone who can access the site can view and change this team cart.
-- Display names are supplied by the browser and are not verified identities.

create table if not exists public.shared_cart_items (
    category text not null check (char_length(category) between 1 and 80),
    item_name text not null check (char_length(item_name) between 1 and 100),
    quantity integer not null check (quantity > 0),
    added_by text not null default 'Unknown device',
    last_updated_by text not null default 'Unknown device',
    last_updated_at timestamptz not null default now(),
    primary key (category, item_name)
);

-- Add attribution columns to an existing shared_cart_items table.
alter table public.shared_cart_items
    add column if not exists added_by text not null default 'Unknown device';
alter table public.shared_cart_items
    add column if not exists last_updated_by text not null default 'Unknown device';
alter table public.shared_cart_items
    add column if not exists last_updated_at timestamptz not null default now();

create table if not exists public.shared_cart_activity (
    id bigint generated always as identity primary key,
    action text not null check (action in ('item_added', 'quantity_reduced', 'item_removed', 'cart_cleared')),
    category text,
    item_name text,
    quantity_delta integer,
    quantity_after integer check (quantity_after is null or quantity_after >= 0),
    actor_name text not null check (char_length(actor_name) between 1 and 80),
    created_at timestamptz not null default now()
);

-- Admin access is tied to a verified Supabase Auth user ID, never to a browser label.
-- This private schema is not exposed through the Supabase Data API.
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

-- Keep every name ever chosen by the administrator reserved, so another browser
-- cannot label its own cart changes with the administrator's display name.
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

-- Include admin maintenance events in the same recent activity feed.
alter table public.shared_cart_activity
    drop constraint if exists shared_cart_activity_action_check;
alter table public.shared_cart_activity
    add constraint shared_cart_activity_action_check
    check (action in (
        'item_added', 'quantity_reduced', 'item_removed', 'cart_cleared',
        'activity_cleared'
    ));

alter table public.shared_cart_items enable row level security;
alter table public.shared_cart_activity enable row level security;
revoke all on table public.shared_cart_items from anon, authenticated;
revoke all on table public.shared_cart_activity from anon, authenticated;

-- The return shape changed, so replace the old RPC definition.
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
language sql
security definer
set search_path = public
as $$
    select cart.category, cart.item_name, cart.quantity,
           cart.added_by, cart.last_updated_by, cart.last_updated_at
    from public.shared_cart_items as cart
    order by cart.category, cart.item_name;
$$;

create or replace function public.get_shared_cart_activity()
returns table(
    id bigint,
    action text,
    category text,
    item_name text,
    quantity_delta integer,
    quantity_after integer,
    actor_name text,
    created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
    select activity.id, activity.action, activity.category, activity.item_name,
           activity.quantity_delta, activity.quantity_after, activity.actor_name, activity.created_at
    from public.shared_cart_activity as activity
    order by activity.id desc
    limit 12;
$$;

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

    delete from public.shared_cart_activity where true;
    get diagnostics v_deleted = row_count;

    -- Keep a server-authenticated audit event so the history is not silently erased.
    insert into public.shared_cart_activity (action, actor_name)
    values ('activity_cleared', v_actor_name);

    return v_deleted;
end;
$$;

create or replace function public.adjust_shared_cart_item(
    p_category text,
    p_item_name text,
    p_delta integer,
    p_actor_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_name text := btrim(p_actor_name);
    v_previous_quantity integer;
    v_quantity_after integer;
    v_action text;
begin
    if p_category is null or char_length(btrim(p_category)) not between 1 and 80 then
        raise exception 'Category must contain 1 to 80 characters.';
    end if;
    if p_item_name is null or char_length(btrim(p_item_name)) not between 1 and 100 then
        raise exception 'Item name must contain 1 to 100 characters.';
    end if;
    if p_delta is null or p_delta = 0 or p_delta < -1000 or p_delta > 1000 then
        raise exception 'Quantity change must be between -1000 and 1000.';
    end if;
    if v_actor_name is null or char_length(v_actor_name) not between 1 and 80 then
        raise exception 'Name must contain 1 to 80 characters.';
    end if;

    select cart.quantity
    into v_previous_quantity
    from public.shared_cart_items as cart
    where cart.category = btrim(p_category)
      and cart.item_name = btrim(p_item_name)
    for update;

    if p_delta > 0 then
        insert into public.shared_cart_items (
            category, item_name, quantity, added_by, last_updated_by, last_updated_at
        )
        values (
            btrim(p_category), btrim(p_item_name), p_delta, v_actor_name, v_actor_name, now()
        )
        on conflict (category, item_name) do update
            set quantity = public.shared_cart_items.quantity + excluded.quantity,
                last_updated_by = excluded.last_updated_by,
                last_updated_at = now()
        returning quantity into v_quantity_after;
        v_action := 'item_added';
    else
        if v_previous_quantity is null then
            return;
        end if;

        v_quantity_after := v_previous_quantity + p_delta;
        if v_quantity_after <= 0 then
            delete from public.shared_cart_items
            where category = btrim(p_category)
              and item_name = btrim(p_item_name);
            v_quantity_after := 0;
            v_action := 'item_removed';
        else
            update public.shared_cart_items
            set quantity = v_quantity_after,
                last_updated_by = v_actor_name,
                last_updated_at = now()
            where category = btrim(p_category)
              and item_name = btrim(p_item_name);
            v_action := 'quantity_reduced';
        end if;
    end if;

    insert into public.shared_cart_activity (
        action, category, item_name, quantity_delta, quantity_after, actor_name
    )
    values (
        v_action, btrim(p_category), btrim(p_item_name), p_delta, v_quantity_after, v_actor_name
    );
end;
$$;

-- Keep older pages functional during rollout, but attribute their edits as unknown.
drop function if exists public.adjust_shared_cart_item(text, text, integer);
create function public.adjust_shared_cart_item(
    p_category text,
    p_item_name text,
    p_delta integer
)
returns void
language sql
security definer
set search_path = public
as $$
    select public.adjust_shared_cart_item(p_category, p_item_name, p_delta, 'Unknown device');
$$;

create or replace function public.clear_shared_cart(p_actor_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_name text := btrim(p_actor_name);
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

    delete from public.shared_cart_items where true;
    insert into public.shared_cart_activity (action, actor_name)
    values ('cart_cleared', v_actor_name);
end;
$$;

-- Keep older pages functional during rollout, with explicit unknown attribution.
drop function if exists public.clear_shared_cart();
create function public.clear_shared_cart()
returns void
language sql
security definer
set search_path = public
as $$
    select public.clear_shared_cart('Unknown device');
$$;

revoke all on function public.get_shared_cart() from public;
revoke all on function public.get_shared_cart_activity() from public;
revoke all on function public.adjust_shared_cart_item(text, text, integer) from public;
revoke all on function public.adjust_shared_cart_item(text, text, integer, text) from public;
revoke all on function public.clear_shared_cart() from public;
revoke all on function public.clear_shared_cart(text) from public;

grant execute on function public.get_shared_cart() to authenticated;
grant execute on function public.get_shared_cart_activity() to authenticated;
grant execute on function public.adjust_shared_cart_item(text, text, integer) to authenticated;
grant execute on function public.adjust_shared_cart_item(text, text, integer, text) to authenticated;
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
-- Make cart change history administrator-only and add an administrator-managed
-- history of order email drafts requested from the site.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

drop function if exists public.get_shared_cart_activity();
create function public.get_shared_cart_activity()
returns table(
    id bigint,
    action text,
    category text,
    item_name text,
    quantity_delta integer,
    quantity_after integer,
    actor_name text,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $$
begin
    if auth.uid() is null or not exists (
        select 1 from private.cart_admins as admin
        where admin.user_id = auth.uid()
    ) then
        raise exception using errcode = '42501', message = 'Cart administrator access required.';
    end if;

    return query
    select activity.id, activity.action, activity.category, activity.item_name,
           activity.quantity_delta, activity.quantity_after, activity.actor_name, activity.created_at
    from public.shared_cart_activity as activity
    order by activity.id desc
    limit 12;
end;
$$;

create table if not exists private.cart_order_email_log (
    id bigint generated always as identity primary key,
    cart_type text not null check (cart_type in ('mechanical', 'electrical')),
    actor_name text not null check (char_length(btrim(actor_name)) between 1 and 80),
    order_items jsonb not null check (jsonb_typeof(order_items) = 'array'),
    email_subject text not null check (char_length(email_subject) between 1 and 150),
    created_at timestamptz not null default now()
);

create index if not exists cart_order_email_log_created_idx
    on private.cart_order_email_log (id desc);
alter table private.cart_order_email_log enable row level security;
revoke all on table private.cart_order_email_log from public, anon, authenticated;

create or replace function public.log_cart_order_email(
    p_cart_type text,
    p_actor_name text,
    p_order_items jsonb,
    p_email_subject text
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, auth, private
as $$
declare
    v_cart_type text := lower(btrim(p_cart_type));
    v_actor_name text := btrim(p_actor_name);
    v_log_id bigint;
begin
    perform private.require_verified_cart_user();
    if v_cart_type not in ('mechanical', 'electrical') then
        raise exception 'Invalid parts list.';
    end if;
    if v_actor_name is null or char_length(v_actor_name) not between 1 and 80 then
        raise exception 'A display name is required.';
    end if;
    if p_order_items is null or jsonb_typeof(p_order_items) <> 'array'
       or jsonb_array_length(p_order_items) not between 1 and 250
       or octet_length(p_order_items::text) > 65536 then
        raise exception 'The order contents are invalid or too large to log.';
    end if;
    if p_email_subject is null or char_length(p_email_subject) not between 1 and 150 then
        raise exception 'The email subject is invalid.';
    end if;

    if auth.uid() is not null and exists (
        select 1 from private.cart_admins as admin where admin.user_id = auth.uid()
    ) then
        select coalesce(profile.display_name, v_actor_name)
        into v_actor_name
        from private.cart_admin_profiles as profile
        where profile.user_id = auth.uid();
        v_actor_name := coalesce(v_actor_name, btrim(p_actor_name));
    elsif exists (
        select 1 from private.cart_admin_names as reserved
        where reserved.name_key = lower(v_actor_name)
    ) then
        raise exception using errcode = '42501',
            message = 'That display name is reserved for the cart administrator.';
    end if;

    insert into private.cart_order_email_log (cart_type, actor_name, order_items, email_subject)
    values (v_cart_type, v_actor_name, p_order_items, btrim(p_email_subject))
    returning id into v_log_id;

    return v_log_id;
end;
$$;

create or replace function public.get_cart_order_email_log(p_before_id bigint default null)
returns table(
    id bigint,
    cart_type text,
    actor_name text,
    order_items jsonb,
    email_subject text,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, auth, private
as $$
begin
    if auth.uid() is null or not exists (
        select 1 from private.cart_admins as admin where admin.user_id = auth.uid()
    ) then
        raise exception using errcode = '42501', message = 'Cart administrator access required.';
    end if;

    return query
    select entry.id, entry.cart_type, entry.actor_name, entry.order_items,
           entry.email_subject, entry.created_at
    from private.cart_order_email_log as entry
    where p_before_id is null or entry.id < p_before_id
    order by entry.id desc
    limit 50;
end;
$$;

create or replace function public.delete_cart_order_email_log(p_log_id bigint)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, auth, private
as $$
declare
    v_deleted integer;
begin
    if auth.uid() is null or not exists (
        select 1 from private.cart_admins as admin where admin.user_id = auth.uid()
    ) then
        raise exception using errcode = '42501', message = 'Cart administrator access required.';
    end if;

    delete from private.cart_order_email_log where id = p_log_id;
    get diagnostics v_deleted = row_count;
    return v_deleted = 1;
end;
$$;

revoke all on function public.get_shared_cart_activity() from public, anon, authenticated;
grant execute on function public.get_shared_cart_activity() to authenticated;
revoke all on function public.log_cart_order_email(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.log_cart_order_email(text, text, jsonb, text) to authenticated;
revoke all on function public.get_cart_order_email_log(bigint) from public, anon, authenticated;
grant execute on function public.get_cart_order_email_log(bigint) to authenticated;
revoke all on function public.delete_cart_order_email_log(bigint) from public, anon, authenticated;
grant execute on function public.delete_cart_order_email_log(bigint) to authenticated;
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

-- Store the self-entered name for each browser so every cart admin can see
-- the names that have used the shared cart. These are labels, not identities.

create table if not exists private.shared_cart_users (
    device_id uuid primary key,
    display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

alter table private.shared_cart_users enable row level security;
revoke all on table private.shared_cart_users from public, anon, authenticated;

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
begin
    perform private.require_verified_cart_user();
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

    insert into private.shared_cart_users (device_id, display_name, last_seen_at)
    values (p_device_id, v_name, now())
    on conflict (device_id) do update
        set display_name = excluded.display_name,
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

-- An approved, verified visitor can clear the shared cart. The page asks for
-- confirmation, and this RPC records the browser's entered name or admin name.
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
grant execute on function public.register_shared_cart_user(uuid, text, boolean) to authenticated;
revoke all on function public.remove_shared_cart_user(uuid) from public, anon, authenticated;
grant execute on function public.remove_shared_cart_user(uuid) to authenticated;
revoke all on function public.clear_shared_cart(text) from public, anon, authenticated;
revoke all on function public.clear_shared_cart() from public, anon, authenticated;
grant execute on function public.clear_shared_cart(text) to authenticated;
grant execute on function public.clear_shared_cart() to authenticated;

notify pgrst, 'reload schema';

-- Require a confirmed email and administrator approval for shared-cart access, and
-- link each named browser to the verified Auth account that registered it.
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
