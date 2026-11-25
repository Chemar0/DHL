-- Keep cart change history administrator-only and log order email drafts only
-- for verified accounts approved to use the site.

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
