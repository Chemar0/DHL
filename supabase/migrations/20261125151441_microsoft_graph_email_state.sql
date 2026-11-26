-- File purpose: Migration adding private storage and admin-only management for Microsoft Graph mail authorization tokens.

-- Private token storage is inaccessible through the public Data API.
create table if not exists private.microsoft_graph_email_state (
    singleton boolean primary key default true check (singleton),
    refresh_token text,
    device_code text,
    device_code_expires_at timestamptz,
    updated_at timestamptz not null default now()
);

alter table private.microsoft_graph_email_state enable row level security;
revoke all on table private.microsoft_graph_email_state from public, anon, authenticated;
grant usage on schema private to service_role;
grant all on table private.microsoft_graph_email_state to service_role;

-- Admin-only RPC reads or updates Microsoft Graph authorization state.
create or replace function public.manage_microsoft_graph_email_state(
    p_action text,
    p_refresh_token text default null,
    p_device_code text default null,
    p_device_code_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_state private.microsoft_graph_email_state%rowtype;
begin
    if p_action is null then
        raise exception 'Email authorization action is required.';
    end if;

    if p_action = 'set_device' then
        if p_device_code is null or p_device_code_expires_at is null then
            raise exception 'Device authorization state is incomplete.';
        end if;

        insert into private.microsoft_graph_email_state (
            singleton, device_code, device_code_expires_at, updated_at
        ) values (
            true, p_device_code, p_device_code_expires_at, now()
        )
        on conflict (singleton) do update
        set device_code = excluded.device_code,
            device_code_expires_at = excluded.device_code_expires_at,
            updated_at = now();
    elsif p_action = 'set_refresh' then
        if p_refresh_token is null then
            raise exception 'Refresh token is required.';
        end if;

        insert into private.microsoft_graph_email_state (
            singleton, refresh_token, updated_at
        ) values (
            true, p_refresh_token, now()
        )
        on conflict (singleton) do update
        set refresh_token = excluded.refresh_token,
            device_code = null,
            device_code_expires_at = null,
            updated_at = now();
    elsif p_action = 'clear_device' then
        update private.microsoft_graph_email_state
        set device_code = null,
            device_code_expires_at = null,
            updated_at = now()
        where singleton = true;
    elsif p_action <> 'get' then
        raise exception 'Unsupported email authorization action.';
    end if;

    select *
    into v_state
    from private.microsoft_graph_email_state
    where singleton = true;

    return jsonb_build_object(
        'refresh_token', v_state.refresh_token,
        'device_code', v_state.device_code,
        'device_code_expires_at', v_state.device_code_expires_at
    );
end;
$$;

revoke all on function public.manage_microsoft_graph_email_state(text, text, text, timestamptz)
    from public, anon, authenticated;
grant execute on function public.manage_microsoft_graph_email_state(text, text, text, timestamptz)
    to service_role;
