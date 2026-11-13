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
    if v_actor_name is null or char_length(v_actor_name) not between 1 and 80 then
        raise exception 'Name must contain 1 to 80 characters.';
    end if;

    delete from public.shared_cart_items;
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

grant execute on function public.get_shared_cart() to anon, authenticated;
grant execute on function public.get_shared_cart_activity() to anon, authenticated;
grant execute on function public.adjust_shared_cart_item(text, text, integer) to anon, authenticated;
grant execute on function public.adjust_shared_cart_item(text, text, integer, text) to anon, authenticated;
grant execute on function public.clear_shared_cart() to anon, authenticated;
grant execute on function public.clear_shared_cart(text) to anon, authenticated;
