-- File purpose: Database RPCs for listing Auth accounts to cart admins and deleting non-owner accounts under owner-only authorization.

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
