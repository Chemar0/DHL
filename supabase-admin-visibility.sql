-- File purpose: Public-safe status RPC that reports whether admin features are configured without exposing administrator identities.

-- Expose only whether an administrator is configured so the site can hide
-- the administrator panel from ordinary visitors.
-- Safe public status check reveals setup state without returning admin identity data.
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
