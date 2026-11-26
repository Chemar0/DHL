-- File purpose: Migration adding encrypted website access invites and admin/redeem management RPCs.

-- Invite storage keeps only a digest for validation and encrypted code material for admin display.
create table if not exists private.website_access_invites (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    code_digest text not null check (code_digest ~ '^[0-9a-f]{64}$'),
    code_ciphertext text not null,
    code_iv text not null,
    created_by uuid not null references private.cart_admins(user_id) on delete cascade,
    created_at timestamptz not null default now(),
    failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
    redeemed_at timestamptz,
    redeemed_user_id uuid references auth.users(id) on delete set null,
    revoked_at timestamptz,
    constraint website_access_invite_terminal_state check (
        not (redeemed_at is not null and revoked_at is not null)
    )
);

create unique index if not exists website_access_invites_one_active_email_idx
    on private.website_access_invites (lower(email))
    where redeemed_at is null and revoked_at is null;

create index if not exists website_access_invites_active_created_idx
    on private.website_access_invites (created_at desc)
    where redeemed_at is null and revoked_at is null;

alter table private.website_access_invites enable row level security;
revoke all on table private.website_access_invites from public, anon, authenticated;

-- Admin management and visitor redemption are routed through one authorization-checked RPC.
create or replace function public.manage_website_access_invites(
    p_action text,
    p_email text default null,
    p_user_id uuid default null,
    p_actor_id uuid default null,
    p_code_digest text default null,
    p_code_ciphertext text default null,
    p_code_iv text default null,
    p_invite_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, auth, private, public
as $function$
declare
    v_invite private.website_access_invites%rowtype;
    v_email text := lower(btrim(coalesce(p_email, '')));
    v_user_email text;
    v_invite_id uuid;
begin
    if p_action = 'issue' then
        if p_actor_id is null or not exists (
            select 1 from private.cart_admins as admin where admin.user_id = p_actor_id
        ) then
            raise exception using errcode = '42501', message = 'Cart administrator access required.';
        end if;
        if p_user_id is null or v_email = '' or coalesce(p_code_digest, '') !~ '^[0-9a-f]{64}$'
            or coalesce(p_code_ciphertext, '') = '' or coalesce(p_code_iv, '') = '' then
            raise exception using errcode = '22023', message = 'The access code details are incomplete.';
        end if;

        select lower(users.email::text) into v_user_email
        from auth.users as users
        where users.id = p_user_id;
        if v_user_email is distinct from v_email then
            raise exception using errcode = '22023', message = 'The access code email does not match its account.';
        end if;

        update private.website_access_invites as invite
        set revoked_at = now()
        where lower(invite.email) = v_email
          and invite.redeemed_at is null
          and invite.revoked_at is null;

        insert into private.website_access_invites (
            email, user_id, code_digest, code_ciphertext, code_iv, created_by
        ) values (
            v_email, p_user_id, p_code_digest, p_code_ciphertext, p_code_iv, p_actor_id
        ) returning id into v_invite_id;

        return jsonb_build_object('id', v_invite_id, 'email', v_email);
    elsif p_action = 'list' then
        if p_actor_id is null or not exists (
            select 1 from private.cart_admins as admin where admin.user_id = p_actor_id
        ) then
            raise exception using errcode = '42501', message = 'Cart administrator access required.';
        end if;

        return coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', invite.id,
                'email', invite.email,
                'user_id', invite.user_id,
                'code_digest', invite.code_digest,
                'code_ciphertext', invite.code_ciphertext,
                'code_iv', invite.code_iv,
                'created_at', invite.created_at,
                'created_by', invite.created_by,
                'failed_attempts', invite.failed_attempts
            ) order by invite.created_at desc)
            from private.website_access_invites as invite
            where invite.redeemed_at is null and invite.revoked_at is null
        ), '[]'::jsonb);
    elsif p_action = 'check' then
        if v_email = '' or coalesce(p_code_digest, '') !~ '^[0-9a-f]{64}$' then
            return jsonb_build_object('valid', false);
        end if;

        select invite.* into v_invite
        from private.website_access_invites as invite
        where lower(invite.email) = v_email
          and invite.redeemed_at is null
          and invite.revoked_at is null
        order by invite.created_at desc
        limit 1
        for update;

        if not found or v_invite.failed_attempts >= 5 then
            return jsonb_build_object('valid', false);
        end if;
        if not exists (
            select 1 from private.cart_admins as admin where admin.user_id = v_invite.created_by
        ) then
            update private.website_access_invites set revoked_at = now() where id = v_invite.id;
            return jsonb_build_object('valid', false);
        end if;
        if v_invite.code_digest is distinct from p_code_digest then
            update private.website_access_invites
            set failed_attempts = failed_attempts + 1
            where id = v_invite.id;
            return jsonb_build_object('valid', false);
        end if;

        return jsonb_build_object('valid', true, 'id', v_invite.id, 'user_id', v_invite.user_id);
    elsif p_action = 'consume' then
        if p_invite_id is null or p_user_id is null or coalesce(p_code_digest, '') !~ '^[0-9a-f]{64}$' then
            return jsonb_build_object('consumed', false);
        end if;

        select invite.* into v_invite
        from private.website_access_invites as invite
        where invite.id = p_invite_id
          and invite.redeemed_at is null
          and invite.revoked_at is null
        for update;
        if not found or v_invite.failed_attempts >= 5
            or v_invite.code_digest is distinct from p_code_digest
            or v_invite.user_id is distinct from p_user_id
            or not exists (
                select 1 from private.cart_admins as admin where admin.user_id = v_invite.created_by
            ) then
            return jsonb_build_object('consumed', false);
        end if;

        select lower(users.email::text) into v_user_email
        from auth.users as users
        where users.id = p_user_id and users.email_confirmed_at is not null;
        if v_user_email is distinct from lower(v_invite.email) then
            return jsonb_build_object('consumed', false);
        end if;

        update private.website_access_invites
        set redeemed_at = now(), redeemed_user_id = p_user_id
        where id = v_invite.id;

        insert into public.website_access_requests as existing_request (
            user_id, email, status, requested_at, reviewed_at, reviewed_by
        ) values (
            p_user_id, v_user_email, 'approved', now(), now(), v_invite.created_by
        ) on conflict (user_id) do update
            set email = excluded.email,
                status = 'approved',
                reviewed_at = now(),
                reviewed_by = v_invite.created_by;

        return jsonb_build_object('consumed', true);
    elsif p_action = 'revoke' then
        if p_actor_id is null or not exists (
            select 1 from private.cart_admins as admin where admin.user_id = p_actor_id
        ) then
            raise exception using errcode = '42501', message = 'Cart administrator access required.';
        end if;

        update private.website_access_invites as invite
        set revoked_at = now()
        where invite.id = p_invite_id
          and invite.redeemed_at is null
          and invite.revoked_at is null;
        return jsonb_build_object('revoked', found);
    end if;

    raise exception using errcode = '22023', message = 'Unsupported access code action.';
end;
$function$;

revoke all on function public.manage_website_access_invites(text, text, uuid, uuid, text, text, text, uuid)
    from public, anon, authenticated;
grant execute on function public.manage_website_access_invites(text, text, uuid, uuid, text, text, text, uuid)
    to service_role;
