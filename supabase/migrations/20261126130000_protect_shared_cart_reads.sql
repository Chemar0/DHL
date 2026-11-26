-- Cart reads must enforce the same approved-account gate as cart writes.
-- A valid Supabase session alone is not sufficient for website access.

create or replace function public.get_shared_cart()
returns table (
    category text,
    item_name text,
    quantity integer,
    added_by text,
    last_updated_by text,
    last_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
    perform private.require_verified_cart_user();

    return query
    select cart.category, cart.item_name, cart.quantity,
           cart.added_by, cart.last_updated_by, cart.last_updated_at
    from public.shared_cart_items as cart
    order by cart.category, cart.item_name;
end;
$function$;

create or replace function public.get_shared_cart_activity()
returns table (
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
stable
security definer
set search_path = ''
as $function$
begin
    perform private.require_verified_cart_user();

    return query
    select activity.id, activity.action, activity.category, activity.item_name,
           activity.quantity_delta, activity.quantity_after,
           activity.actor_name, activity.created_at
    from public.shared_cart_activity as activity
    order by activity.id desc
    limit 12;
end;
$function$;

-- Private helpers are only callable by trusted SECURITY DEFINER functions.
revoke all on function private.require_verified_cart_user()
    from public, anon, authenticated;

revoke all on function public.get_shared_cart()
    from public, anon, authenticated;
revoke all on function public.get_shared_cart_activity()
    from public, anon, authenticated;
grant execute on function public.get_shared_cart() to authenticated;
grant execute on function public.get_shared_cart_activity() to authenticated;
