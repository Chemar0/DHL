create table if not exists public.website_access_requests (
    user_id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    status text not null default 'pending'
        check (status in ('pending', 'approved', 'denied')),
    requested_at timestamptz not null default now(),
    reviewed_at timestamptz,
    reviewed_by uuid references auth.users(id) on delete set null,
    constraint website_access_review_state check (
        (status = 'pending' and reviewed_at is null and reviewed_by is null)
        or (status in ('approved', 'denied') and reviewed_at is not null)
    )
);

create index if not exists website_access_requests_status_requested_idx
    on public.website_access_requests (status, requested_at desc);

alter table public.website_access_requests enable row level security;
revoke all on table public.website_access_requests from public, anon, authenticated;

create or replace function private.user_has_website_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private, public
as $function$
    select p_user_id is not null and (
        exists (
            select 1 from private.cart_admins as admin
            where admin.user_id = p_user_id
        )
        or exists (
            select 1 from public.website_access_requests as request
            where request.user_id = p_user_id and request.status = 'approved'
        )
    );
$function$;

revoke all on function private.user_has_website_access(uuid) from public, anon, authenticated;

create or replace function public.submit_website_access_request()
returns text
language plpgsql
security definer
set search_path = pg_catalog, auth, private, public
as $function$
declare
    v_email text;
    v_status text;
begin
    if auth.uid() is null then
        raise exception using errcode = '42501', message = 'Verify your email before requesting website access.';
    end if;

    select lower(btrim(users.email)) into v_email
    from auth.users as users
    where users.id = auth.uid() and users.email_confirmed_at is not null;

    if v_email is null then
        raise exception using errcode = '42501', message = 'Verify your email before requesting website access.';
    end if;

    if exists (select 1 from private.cart_admins admin where admin.user_id = auth.uid()) then
        return 'approved';
    end if;

    insert into public.website_access_requests as existing_request
        (user_id, email, status, requested_at, reviewed_at, reviewed_by)
    values (auth.uid(), v_email, 'pending', now(), null, null)
    on conflict (user_id) do update
        set email = excluded.email,
            status = case when existing_request.status = 'approved' then 'approved' else 'pending' end,
            requested_at = case when existing_request.status = 'approved' then existing_request.requested_at else now() end,
            reviewed_at = case when existing_request.status = 'approved' then existing_request.reviewed_at else null end,
            reviewed_by = case when existing_request.status = 'approved' then existing_request.reviewed_by else null end
    returning status into v_status;

    return v_status;
end;
$function$;

create or replace function public.get_website_access_status()
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, auth, private, public
as $function$
declare
    v_status text;
begin
    if auth.uid() is null then return 'signed_out'; end if;

    if not exists (
        select 1 from auth.users as users
        where users.id = auth.uid() and users.email_confirmed_at is not null
    ) then
        return 'unverified';
    end if;

    if exists (select 1 from private.cart_admins admin where admin.user_id = auth.uid()) then
        return 'approved';
    end if;

    select request.status into v_status
    from public.website_access_requests as request
    where request.user_id = auth.uid();

    return coalesce(v_status, 'not_requested');
end;
$function$;

create or replace function public.list_website_access_requests()
returns table (
    user_id uuid,
    email text,
    status text,
    requested_at timestamptz,
    reviewed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, auth, private, public
as $function$
begin
    if auth.uid() is null or not exists (
        select 1 from private.cart_admins as admin where admin.user_id = auth.uid()
    ) then
        raise exception using errcode = '42501', message = 'Cart administrator access required.';
    end if;

    return query
    select request.user_id, request.email, request.status, request.requested_at, request.reviewed_at
    from public.website_access_requests as request
    order by case request.status when 'pending' then 0 when 'approved' then 1 else 2 end,
             request.requested_at desc;
end;
$function$;

create or replace function public.review_website_access_request(p_user_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, auth, private, public
as $function$
declare
    v_email text;
begin
    if auth.uid() is null or not exists (
        select 1 from private.cart_admins as admin where admin.user_id = auth.uid()
    ) then
        raise exception using errcode = '42501', message = 'Cart administrator access required.';
    end if;
    if p_status not in ('approved', 'denied') then
        raise exception 'Decision must be approved or denied.';
    end if;

    update public.website_access_requests as request
    set status = p_status,
        reviewed_at = now(),
        reviewed_by = auth.uid()
    where request.user_id = p_user_id and request.status = 'pending'
    returning request.email into v_email;

    if v_email is null then
        raise exception 'No pending access request was found for that account.';
    end if;
    return v_email;
end;
$function$;

revoke all on function public.submit_website_access_request() from public, anon;
revoke all on function public.get_website_access_status() from public, anon;
revoke all on function public.list_website_access_requests() from public, anon;
revoke all on function public.review_website_access_request(uuid, text) from public, anon;
grant execute on function public.submit_website_access_request() to authenticated;
grant execute on function public.get_website_access_status() to authenticated;
grant execute on function public.list_website_access_requests() to authenticated;
grant execute on function public.review_website_access_request(uuid, text) to authenticated;

create or replace function private.require_verified_cart_user()
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, auth, private, public
as $function$
declare
    v_email text;
begin
    if auth.uid() is null then
        raise exception using errcode = '42501', message = 'Verify your email before using the shared cart.';
    end if;

    select users.email::text into v_email
    from auth.users as users
    where users.id = auth.uid() and users.email_confirmed_at is not null;

    if v_email is null then
        raise exception using errcode = '42501', message = 'Verify your email before using the shared cart.';
    end if;

    if not private.user_has_website_access(auth.uid()) then
        raise exception using errcode = '42501', message = 'Administrator approval is required to access this website.';
    end if;
    return v_email;
end;
$function$;

create or replace function public.adjust_shared_cart_item(
    p_category text,
    p_item_name text,
    p_delta integer,
    p_actor_name text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth, private
as $function$
declare
    v_actor_name text := btrim(p_actor_name);
    v_previous_quantity integer;
    v_quantity_after integer;
    v_action text;
begin
    perform private.require_verified_cart_user();
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
        ) values (
            btrim(p_category), btrim(p_item_name), p_delta, v_actor_name, v_actor_name, now()
        )
        on conflict (category, item_name) do update
            set quantity = public.shared_cart_items.quantity + excluded.quantity,
                last_updated_by = excluded.last_updated_by,
                last_updated_at = now()
        returning quantity into v_quantity_after;
        v_action := 'item_added';
    else
        if v_previous_quantity is null then return; end if;
        v_quantity_after := v_previous_quantity + p_delta;
        if v_quantity_after <= 0 then
            delete from public.shared_cart_items
            where category = btrim(p_category) and item_name = btrim(p_item_name);
            v_quantity_after := 0;
            v_action := 'item_removed';
        else
            update public.shared_cart_items
            set quantity = v_quantity_after, last_updated_by = v_actor_name, last_updated_at = now()
            where category = btrim(p_category) and item_name = btrim(p_item_name);
            v_action := 'quantity_reduced';
        end if;
    end if;

    insert into public.shared_cart_activity (
        action, category, item_name, quantity_delta, quantity_after, actor_name
    ) values (
        v_action, btrim(p_category), btrim(p_item_name), p_delta, v_quantity_after, v_actor_name
    );
end;
$function$;

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
as $function$
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

    if exists (select 1 from private.cart_admins admin where admin.user_id = auth.uid()) then
        select coalesce(profile.display_name, v_actor_name) into v_actor_name
        from private.cart_admin_profiles profile where profile.user_id = auth.uid();
        v_actor_name := coalesce(v_actor_name, btrim(p_actor_name));
    elsif exists (
        select 1 from private.cart_admin_names reserved where reserved.name_key = lower(v_actor_name)
    ) then
        raise exception using errcode = '42501', message = 'That display name is reserved for the cart administrator.';
    end if;

    insert into private.cart_order_email_log (cart_type, actor_name, order_items, email_subject)
    values (v_cart_type, v_actor_name, p_order_items, btrim(p_email_subject))
    returning id into v_log_id;
    return v_log_id;
end;
$function$;
