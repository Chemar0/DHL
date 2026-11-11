-- Public shared cart for the GitHub Pages electrical parts list.
-- Anyone who can access the site can view and change this single shared cart.

create table if not exists public.shared_cart_items (
    category text not null check (char_length(category) between 1 and 80),
    item_name text not null check (char_length(item_name) between 1 and 100),
    quantity integer not null check (quantity > 0),
    primary key (category, item_name)
);

alter table public.shared_cart_items enable row level security;
revoke all on table public.shared_cart_items from anon, authenticated;

create or replace function public.get_shared_cart()
returns table(category text, item_name text, quantity integer)
language sql
security definer
set search_path = public
as $$
    select cart.category, cart.item_name, cart.quantity
    from public.shared_cart_items as cart
    order by cart.category, cart.item_name;
$$;

create or replace function public.adjust_shared_cart_item(
    p_category text,
    p_item_name text,
    p_delta integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_category is null or char_length(btrim(p_category)) not between 1 and 80 then
        raise exception 'Category must contain 1 to 80 characters.';
    end if;
    if p_item_name is null or char_length(btrim(p_item_name)) not between 1 and 100 then
        raise exception 'Item name must contain 1 to 100 characters.';
    end if;
    if p_delta is null or p_delta = 0 or abs(p_delta) > 1000 then
        raise exception 'Quantity change must be between -1000 and 1000.';
    end if;

    if p_delta > 0 then
        insert into public.shared_cart_items (category, item_name, quantity)
        values (btrim(p_category), btrim(p_item_name), p_delta)
        on conflict (category, item_name) do update
            set quantity = public.shared_cart_items.quantity + excluded.quantity;
    else
        delete from public.shared_cart_items
        where category = btrim(p_category)
          and item_name = btrim(p_item_name)
          and quantity + p_delta <= 0;

        update public.shared_cart_items
        set quantity = quantity + p_delta
        where category = btrim(p_category)
          and item_name = btrim(p_item_name)
          and quantity + p_delta > 0;
    end if;
end;
$$;

create or replace function public.clear_shared_cart()
returns void
language sql
security definer
set search_path = public
as $$
    delete from public.shared_cart_items;
$$;

revoke all on function public.get_shared_cart() from public;
revoke all on function public.adjust_shared_cart_item(text, text, integer) from public;
revoke all on function public.clear_shared_cart() from public;
grant execute on function public.get_shared_cart() to anon, authenticated;
grant execute on function public.adjust_shared_cart_item(text, text, integer) to anon, authenticated;
grant execute on function public.clear_shared_cart() to anon, authenticated;
