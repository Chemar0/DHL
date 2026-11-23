-- Supabase requires an explicit WHERE clause on DELETE statements. Keep the
-- existing clear-all behavior while making both cart clear RPCs executable.
begin;

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

    -- Retain an authenticated audit marker after clearing the older entries.
    insert into public.shared_cart_activity (action, actor_name)
    values ('activity_cleared', v_actor_name);

    return v_deleted;
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
set search_path = pg_catalog, public, auth, private
as $$
    select public.clear_shared_cart('Unknown device');
$$;

-- Activity history remains admin-only. Cart clearing remains available to
-- every authenticated, email-verified cart user.
revoke all on function public.clear_shared_cart_activity() from public, anon, authenticated;
grant execute on function public.clear_shared_cart_activity() to authenticated;
revoke all on function public.clear_shared_cart(text) from public, anon, authenticated;
revoke all on function public.clear_shared_cart() from public, anon, authenticated;
grant execute on function public.clear_shared_cart(text) to authenticated;
grant execute on function public.clear_shared_cart() to authenticated;

notify pgrst, 'reload schema';
commit;
