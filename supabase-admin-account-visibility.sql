-- File purpose: Database RPC that exposes Auth account listings to authorized cart admins while keeping deletion owner-restricted.

-- Allow every allowlisted cart admin to view Supabase Auth accounts.
-- Account deletion remains restricted to the owner by delete_cart_auth_user.

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

revoke all on function public.get_cart_auth_users() from public, anon, authenticated;
grant execute on function public.get_cart_auth_users() to authenticated;
