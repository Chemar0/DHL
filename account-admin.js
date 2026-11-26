(() => {
    const config = window.SUPABASE_CONFIG || {};
    const apiKey = config.publishableKey || config.anonKey || '';
    const status = document.getElementById('account-admin-status');
    const nameForm = document.getElementById('account-admin-name-form');
    const nameInput = document.getElementById('account-admin-name');
    const accessList = document.getElementById('website-access-request-list');
    const refreshAccessButton = document.getElementById('refresh-website-access');
    const inviteForm = document.getElementById('website-access-invite-form');
    const inviteEmailInput = document.getElementById('website-access-invite-email');
    const inviteList = document.getElementById('website-access-invite-list');
    const refreshInvitesButton = document.getElementById('refresh-website-access-invites');
    const ownerActions = document.getElementById('account-admin-owner-actions');
    const addAdminForm = document.getElementById('add-cart-admin-form');
    const addAdminEmailInput = document.getElementById('add-cart-admin-email');
    const accountList = document.getElementById('cart-admin-list');
    const refreshAccountsButton = document.getElementById('refresh-cart-auth-users');
    const cartUserList = document.getElementById('cart-user-list');
    const refreshCartUsersButton = document.getElementById('refresh-cart-users');
    const signOutButton = document.getElementById('account-admin-sign-out');
    let client = null;
    let session = null;
    let isAdmin = false;
    let isOwner = false;
    let loadingInvites = false;

    function setStatus(message, isError = false) {
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('is-error', isError);
    }

    function getFunctionErrorMessage(error, fallback) {
        return (async () => {
            try {
                const response = error?.context instanceof Response ? error.context.clone() : null;
                const body = response ? await response.json() : null;
                if (typeof body?.error === 'string') return body.error;
            } catch (readError) {
                // Use the client message if the function response body is unavailable.
            }
            return error?.message || fallback;
        })();
    }

    function updateOwnerControls() {
        if (ownerActions) ownerActions.hidden = !isOwner;
    }

    async function refreshAccountList() {
        if (!isAdmin || !accountList) return;
        if (refreshAccountsButton) refreshAccountsButton.disabled = true;
        let data;
        let error;
        try {
            ({ data, error } = await client.rpc('get_cart_auth_users'));
        } catch (requestError) {
            error = requestError;
        } finally {
            if (refreshAccountsButton) refreshAccountsButton.disabled = false;
        }
        if (error) {
            setStatus('Could not load accounts. Check the Supabase account-management setup.', true);
            return;
        }

        accountList.replaceChildren();
        const accounts = Array.isArray(data) ? data : [];
        if (!accounts.length) {
            const empty = document.createElement('li');
            empty.className = 'admin-account-empty';
            empty.textContent = 'No Auth accounts found.';
            accountList.append(empty);
        }

        accounts.forEach((account) => {
            const row = document.createElement('li');
            const details = document.createElement('div');
            const email = document.createElement('span');
            const role = document.createElement('span');
            const dates = document.createElement('span');
            details.className = 'admin-account-details';
            email.className = 'admin-account-name';
            role.className = 'admin-owner-label';
            email.textContent = account.email || 'Account without an email address';
            role.textContent = account.is_owner ? 'Owner' : account.is_admin ? 'Admin' : account.email_confirmed_at ? 'Verified account' : 'Email not verified';
            const createdAt = account.created_at ? new Date(account.created_at) : null;
            const lastSignIn = account.last_sign_in_at ? new Date(account.last_sign_in_at) : null;
            const createdLabel = createdAt && !Number.isNaN(createdAt.valueOf())
                ? `Created ${createdAt.toLocaleDateString()}` : 'Creation date unavailable';
            const signInLabel = lastSignIn && !Number.isNaN(lastSignIn.valueOf())
                ? `Last sign-in ${lastSignIn.toLocaleDateString()}` : 'Never signed in';
            dates.className = 'admin-account-dates';
            dates.textContent = `${createdLabel} · ${signInLabel}`;
            details.append(email, role, dates);
            row.append(details);

            if (isOwner && !account.is_owner) {
                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.className = 'delete-auth-account';
                deleteButton.textContent = 'Delete account';
                deleteButton.addEventListener('click', async () => {
                    const label = account.email || 'this account';
                    const warning = `Permanently delete ${label} from Supabase Auth? This cannot be undone. Their session will no longer pass the website access check.`;
                    if (!isOwner) return;
                    const confirmed = await window.siteConfirm({
                        title: 'Delete account?',
                        message: warning,
                        confirmText: 'Delete account'
                    });
                    if (!confirmed) return;
                    deleteButton.disabled = true;
                    setStatus(`Deleting ${label}…`);
                    const { data: deletedEmail, error: deleteError } = await client.rpc('delete_cart_auth_user', {
                        p_user_id: account.user_id
                    });
                    if (deleteError) {
                        deleteButton.disabled = false;
                        setStatus(deleteError.message || 'Could not delete the account.', true);
                        return;
                    }
                    setStatus(`Deleted Supabase account ${deletedEmail || label}.`);
                    await refreshAccountList();
                });
                row.append(deleteButton);
            }
            accountList.append(row);
        });
    }

    async function refreshWebsiteAccessRequests() {
        if (!isAdmin || !accessList) return;
        if (refreshAccessButton) refreshAccessButton.disabled = true;
        let data;
        let error;
        try {
            ({ data, error } = await client.rpc('list_website_access_requests'));
        } catch (requestError) {
            error = requestError;
        } finally {
            if (refreshAccessButton) refreshAccessButton.disabled = false;
        }
        if (error) {
            setStatus('Could not load website access requests. Check the access approval setup.', true);
            return;
        }

        accessList.replaceChildren();
        const requests = Array.isArray(data) ? data : [];
        if (!requests.length) {
            const empty = document.createElement('li');
            empty.className = 'admin-account-empty';
            empty.textContent = 'No access requests yet.';
            accessList.append(empty);
            return;
        }

        requests.forEach((request) => {
            const row = document.createElement('li');
            const details = document.createElement('div');
            const email = document.createElement('span');
            const date = document.createElement('span');
            email.className = 'website-access-request-email';
            email.textContent = request.email || 'Email unavailable';
            date.className = 'website-access-request-meta';
            const timestamp = request.requested_at ? new Date(request.requested_at) : null;
            date.textContent = timestamp && !Number.isNaN(timestamp.valueOf())
                ? `Requested ${timestamp.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
                : 'Request date unavailable';
            details.append(email, date);
            row.append(details);

            if (request.status === 'pending') {
                const actions = document.createElement('div');
                actions.className = 'website-access-request-actions';
                ['approved', 'denied'].forEach((decision) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.dataset.decision = decision;
                    button.textContent = decision === 'approved' ? 'Approve' : 'Deny';
                    button.addEventListener('click', async () => {
                        if (!isAdmin || !request.user_id) return;
                        actions.querySelectorAll('button').forEach((action) => { action.disabled = true; });
                        setStatus(`${decision === 'approved' ? 'Approving' : 'Denying'} ${request.email}…`);
                        const { data: reviewedEmail, error: reviewError } = await client.rpc('review_website_access_request', {
                            p_user_id: request.user_id,
                            p_status: decision
                        });
                        if (reviewError) {
                            actions.querySelectorAll('button').forEach((action) => { action.disabled = false; });
                            setStatus(reviewError.message || 'Could not update the access request.', true);
                            return;
                        }
                        setStatus(`${reviewedEmail || request.email} ${decision}.`);
                        await refreshWebsiteAccessRequests();
                    });
                    actions.append(button);
                });
                row.append(actions);
            } else {
                const badge = document.createElement('span');
                badge.className = 'website-access-request-status';
                badge.textContent = request.status;
                row.append(badge);
            }
            accessList.append(row);
        });
    }

    async function issueWebsiteAccessInvite(email) {
        const { data, error } = await client.functions.invoke('website-access-codes', {
            body: { action: 'issue', email }
        });
        if (error) throw new Error(await getFunctionErrorMessage(error, 'Could not generate the access number.'));
        return data?.invite || null;
    }

    async function refreshWebsiteAccessInvites() {
        if (!isAdmin || !inviteList || loadingInvites) return;
        loadingInvites = true;
        if (refreshInvitesButton) refreshInvitesButton.disabled = true;
        let data;
        let error;
        try {
            ({ data, error } = await client.functions.invoke('website-access-codes', { body: { action: 'list' } }));
        } catch (requestError) {
            error = requestError;
        } finally {
            loadingInvites = false;
            if (refreshInvitesButton) refreshInvitesButton.disabled = false;
        }
        if (error) {
            setStatus(await getFunctionErrorMessage(error, 'Could not load website access numbers.'), true);
            return;
        }

        inviteList.replaceChildren();
        const invites = Array.isArray(data?.invites) ? data.invites : [];
        if (!invites.length) {
            const empty = document.createElement('li');
            empty.className = 'admin-account-empty';
            empty.textContent = 'No active access numbers.';
            inviteList.append(empty);
            return;
        }

        invites.forEach((invite) => {
            const row = document.createElement('li');
            const details = document.createElement('div');
            const email = document.createElement('span');
            const code = document.createElement('span');
            const meta = document.createElement('span');
            details.className = 'admin-account-details';
            email.className = 'admin-account-name';
            email.textContent = invite.email || 'Email unavailable';
            code.className = 'website-access-invite-code';
            code.textContent = invite.code || 'Unavailable';
            code.setAttribute('aria-label', `Access number for ${invite.email || 'invite'}`);
            const createdAt = invite.created_at ? new Date(invite.created_at) : null;
            const createdLabel = createdAt && !Number.isNaN(createdAt.valueOf())
                ? `Created ${createdAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
                : 'Creation date unavailable';
            const failedAttempts = Number(invite.failed_attempts) || 0;
            meta.className = 'website-access-invite-meta';
            meta.textContent = failedAttempts
                ? `${createdLabel} · ${failedAttempts} incorrect attempt${failedAttempts === 1 ? '' : 's'}`
                : createdLabel;
            details.append(email, code, meta);
            row.append(details);

            const actions = document.createElement('div');
            actions.className = 'website-access-invite-actions';
            const copyButton = document.createElement('button');
            copyButton.type = 'button';
            copyButton.textContent = 'Copy number';
            copyButton.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(String(invite.code || ''));
                    setStatus(`Access number copied for ${invite.email}. It was not emailed.`);
                } catch (copyError) {
                    setStatus('Could not copy the number. Select it and copy it manually.', true);
                }
            });

            const reissueButton = document.createElement('button');
            reissueButton.type = 'button';
            reissueButton.textContent = 'Make new number';
            reissueButton.addEventListener('click', async () => {
                if (!isAdmin) return;
                const confirmed = await window.siteConfirm({
                    title: 'Make a new access number?',
                    message: `Make a new number for ${invite.email}? The current number will stop working.`,
                    confirmText: 'Make new number',
                    variant: 'warning'
                });
                if (!confirmed) return;
                reissueButton.disabled = true;
                try {
                    await issueWebsiteAccessInvite(invite.email);
                    setStatus(`New access number generated for ${invite.email}. Supabase did not email it.`);
                    await refreshWebsiteAccessInvites();
                } catch (issueError) {
                    reissueButton.disabled = false;
                    setStatus(issueError.message || 'Could not make a new number.', true);
                }
            });

            const revokeButton = document.createElement('button');
            revokeButton.type = 'button';
            revokeButton.className = 'website-access-invite-remove';
            revokeButton.textContent = 'Revoke';
            revokeButton.addEventListener('click', async () => {
                if (!isAdmin) return;
                revokeButton.disabled = true;
                const { error: revokeError } = await client.functions.invoke('website-access-codes', {
                    body: { action: 'revoke', invite_id: invite.id }
                });
                if (revokeError) {
                    revokeButton.disabled = false;
                    setStatus(await getFunctionErrorMessage(revokeError, 'Could not revoke that number.'), true);
                    return;
                }
                setStatus(`Access number revoked for ${invite.email}.`);
                await refreshWebsiteAccessInvites();
            });
            actions.append(copyButton, reissueButton, revokeButton);
            row.append(actions);
            inviteList.append(row);
        });
    }

    async function refreshCartUsers() {
        if (!isAdmin || !cartUserList) return;
        if (refreshCartUsersButton) refreshCartUsersButton.disabled = true;
        let data;
        let error;
        try {
            ({ data, error } = await client.rpc('get_shared_cart_users'));
        } catch (requestError) {
            error = requestError;
        } finally {
            if (refreshCartUsersButton) refreshCartUsersButton.disabled = false;
        }
        if (error) {
            setStatus(`Could not load cart usernames: ${error.message || 'check the Supabase user registry setup.'}`, true);
            return;
        }

        cartUserList.replaceChildren();
        const users = Array.isArray(data) ? data : [];
        if (!users.length) {
            const empty = document.createElement('li');
            empty.className = 'admin-account-empty';
            empty.textContent = 'No verified browsers have registered yet.';
            cartUserList.append(empty);
            return;
        }

        users.forEach((user) => {
            const row = document.createElement('li');
            const details = document.createElement('div');
            const name = document.createElement('span');
            const email = document.createElement('span');
            const dates = document.createElement('span');
            details.className = 'admin-account-details';
            name.className = 'admin-account-name';
            name.textContent = user.display_name || 'Unnamed browser';
            email.className = 'admin-owner-label';
            email.textContent = user.email ? `Verified email ${user.email}` : 'No verified account linked';
            const firstSeen = user.first_seen_at ? new Date(user.first_seen_at) : null;
            const lastSeen = user.last_seen_at ? new Date(user.last_seen_at) : null;
            const firstLabel = firstSeen && !Number.isNaN(firstSeen.valueOf())
                ? `First seen ${firstSeen.toLocaleDateString()}` : 'First seen date unavailable';
            const lastLabel = lastSeen && !Number.isNaN(lastSeen.valueOf())
                ? `Last active ${lastSeen.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : 'Last active date unavailable';
            dates.className = 'admin-account-dates';
            dates.textContent = `${firstLabel} · ${lastLabel}`;
            details.append(name, email, dates);
            row.append(details);

            if (isOwner) {
                const removeButton = document.createElement('button');
                removeButton.type = 'button';
                removeButton.className = 'delete-auth-account';
                removeButton.textContent = 'Remove browser';
                removeButton.addEventListener('click', async () => {
                    const warning = `Remove ${user.display_name || 'this browser'} from the cart user list? It will need to enter a name again before it can be listed.`;
                    if (!isOwner) return;
                    const confirmed = await window.siteConfirm({
                        title: 'Remove browser?',
                        message: warning,
                        confirmText: 'Remove browser'
                    });
                    if (!confirmed) return;
                    removeButton.disabled = true;
                    const { error: removeError } = await client.rpc('remove_shared_cart_user', {
                        p_device_id: user.device_id
                    });
                    if (removeError) {
                        removeButton.disabled = false;
                        setStatus(`Could not remove this browser: ${removeError.message || 'try again.'}`, true);
                        return;
                    }
                    setStatus('Browser removed. It must enter a name again before it can be listed.');
                    await refreshCartUsers();
                });
                row.append(removeButton);
            }
            cartUserList.append(row);
        });
    }

    async function loadAdmin() {
        if (!client) return;
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError) {
            setStatus('Could not restore the administrator session. Sign in again.', true);
            return;
        }
        session = sessionData.session || null;
        if (!session) {
            isAdmin = false;
            setStatus('Administrator session ended. Sign in from the Admin features panel.', true);
            return;
        }

        const checkedSession = session;
        const { data, error } = await client.rpc('get_cart_admin_profile');
        if (session !== checkedSession) return;
        const profile = !error && Array.isArray(data) ? data[0] : null;
        if (!profile) {
            isAdmin = false;
            isOwner = false;
            updateOwnerControls();
            setStatus('This page is only available to website administrators.', true);
            window.setTimeout(() => window.location.replace('index.html'), 1300);
            return;
        }

        isAdmin = true;
        isOwner = profile.is_owner === true;
        updateOwnerControls();
        nameInput.value = profile.display_name || '';
        setStatus(`Administrator access verified for ${session.user.email || 'your account'}.`);
        void refreshWebsiteAccessRequests();
        void refreshWebsiteAccessInvites();
        void refreshAccountList();
        void refreshCartUsers();
    }

    if (!config.url || !apiKey || !window.supabase?.createClient) {
        setStatus('The Supabase connection is unavailable.', true);
        return;
    }

    client = window.supabase.createClient(config.url, apiKey, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    });

    nameForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAdmin) return;
        const cleaned = nameInput.value.trim().replace(/\s+/g, ' ').slice(0, 80);
        if (!cleaned) return nameInput.reportValidity();
        const { data, error } = await client.rpc('set_cart_admin_name', { p_display_name: cleaned });
        if (error) {
            setStatus(error.message || 'Could not save the administrator display name.', true);
            return;
        }
        const savedName = typeof data === 'string' && data.trim() ? data.trim() : cleaned;
        nameInput.value = savedName;
        setStatus('Administrator display name saved.');
    });

    addAdminForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isOwner || !addAdminEmailInput) return;
        const email = addAdminEmailInput.value.trim();
        if (!email) return addAdminEmailInput.reportValidity();
        const button = addAdminForm.querySelector('button[type="submit"]');
        if (button) button.disabled = true;
        setStatus('Adding the verified account…');
        const { data, error } = await client.rpc('add_cart_admin', { p_email: email });
        if (button) button.disabled = false;
        if (error) {
            setStatus(error.message || 'Could not grant administrator access.', true);
            return;
        }
        addAdminEmailInput.value = '';
        setStatus(`Administrator access granted to ${data || email}.`);
        await refreshAccountList();
    });

    inviteForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAdmin || !inviteEmailInput) return;
        const email = inviteEmailInput.value.trim().toLowerCase();
        if (!email) return inviteEmailInput.reportValidity();
        const button = inviteForm.querySelector('button[type="submit"]');
        if (button) button.disabled = true;
        setStatus(`Generating an access number for ${email}…`);
        try {
            await issueWebsiteAccessInvite(email);
            inviteEmailInput.value = '';
            setStatus(`Access number generated for ${email}. Supabase did not email it; copy it from the list below.`);
            await refreshWebsiteAccessInvites();
        } catch (error) {
            setStatus(error.message || 'Could not generate the access number.', true);
        } finally {
            if (button) button.disabled = false;
        }
    });

    refreshAccessButton?.addEventListener('click', () => { void refreshWebsiteAccessRequests(); });
    refreshInvitesButton?.addEventListener('click', () => { void refreshWebsiteAccessInvites(); });
    refreshAccountsButton?.addEventListener('click', () => { void refreshAccountList(); });
    refreshCartUsersButton?.addEventListener('click', () => { void refreshCartUsers(); });

    signOutButton?.addEventListener('click', async () => {
        const { error } = await client.auth.signOut();
        if (error) {
            setStatus(error.message || 'Could not sign out.', true);
            return;
        }
        window.location.replace('mechanical.html?cartAdmin=signin');
    });

    client.auth.onAuthStateChange((_event, nextSession) => {
        session = nextSession || null;
        if (!session) {
            isAdmin = false;
            isOwner = false;
            updateOwnerControls();
            setStatus('Administrator session ended.');
            window.setTimeout(() => window.location.replace('mechanical.html?cartAdmin=signin'), 800);
        }
    });

    void loadAdmin();
    window.setInterval(() => {
        if (isAdmin) void refreshWebsiteAccessInvites();
    }, 15000);
})();
