-- File purpose: A safe database check that says whether admin tools are set up without showing admin details.

-- Expose only whether an administrator is configured so the site can hide
-- the administrator panel from ordinary visitors.
-- Let the page check whether admin tools are set up without showing admin names or emails.
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
