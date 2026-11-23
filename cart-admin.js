(() => {
    const status = document.getElementById('cart-admin-status');
    const adminPanel = document.getElementById('admin-tools-panel');
    const adminToolsToggle = document.getElementById('admin-tools-toggle');
    const adminToolsClose = document.getElementById('admin-tools-close');
    const loginForm = document.getElementById('cart-admin-login-form');
    const emailInput = document.getElementById('cart-admin-email');
    const visitorAuthDialog = document.getElementById('cart-visitor-auth-dialog');
    const visitorAuthForm = document.getElementById('cart-visitor-auth-form');
    const visitorAuthEmailInput = document.getElementById('cart-visitor-email');
    const visitorAuthStatus = document.getElementById('cart-visitor-auth-status');
    const visitorAuthSubmit = document.getElementById('cart-visitor-send-link');
    const visitorSignOutButton = document.getElementById('cart-user-sign-out');
    const adminActions = document.getElementById('cart-admin-actions');
    const nameForm = document.getElementById('cart-admin-name-form');
    const nameInput = document.getElementById('cart-admin-name');
    const adminManagement = document.getElementById('cart-admin-management');
    const ownerActions = document.getElementById('cart-admin-owner-actions');
    const addAdminForm = document.getElementById('add-cart-admin-form');
    const addAdminEmailInput = document.getElementById('add-cart-admin-email');
    const adminList = document.getElementById('cart-admin-list');
    const refreshAccountsButton = document.getElementById('refresh-cart-auth-users');
    const cartUserList = document.getElementById('cart-user-list');
    const cartUserSection = document.getElementById('cart-user-management');
    const refreshCartUsersButton = document.getElementById('refresh-cart-users');
    const clearHistoryButton = document.getElementById('clear-recent-changes');
    const activityPanel = document.getElementById('cart-activity-panel');
    const orderLogSection = document.getElementById('cart-order-log');
    const orderLogList = document.getElementById('cart-order-email-list');
    const loadOlderOrderLogsButton = document.getElementById('load-older-order-logs');
    const signOutButton = document.getElementById('cart-admin-sign-out');
    const config = window.SUPABASE_CONFIG || {};
    const publicApiKey = config.publishableKey || config.anonKey || '';
    const adminDeviceKey = 'dhl-cart-admin-portal';
    const adminPortalRequested = new URLSearchParams(window.location.search).get('cartAdmin') === 'signin';
    let hasAdminDeviceMarker = false;
    let resolveAccessReady;
    let accessReadyResolved = false;
    const accessReady = new Promise((resolve) => { resolveAccessReady = resolve; });
    try {
        hasAdminDeviceMarker = localStorage.getItem(adminDeviceKey) === 'true';
    } catch (error) {
        // A private browser can still use the direct admin sign-in URL.
    }
    const state = {
        client: null,
        session: null,
        isAdmin: false,
        isOwner: false,
        isVisitorVerified: false,
        adminConfigured: null,
        loginOpen: adminPortalRequested,
        adminMenuOpen: adminPortalRequested,
        orderEmailEntries: [],
        orderEmailCursor: null,
        hasMoreOrderEmails: false,
        loadingOrderEmails: false
    };

    visitorAuthDialog?.addEventListener('cancel', (event) => {
        if (!state.isVisitorVerified) event.preventDefault();
    });

    function finishAccessCheck() {
        if (accessReadyResolved) return;
        accessReadyResolved = true;
        resolveAccessReady();
    }

    function setStatus(message, isError = false) {
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('error', isError);
    }

    function updateControls() {
        const hasSession = Boolean(state.session);
        if (loginForm) loginForm.hidden = hasSession;
        if (adminActions) adminActions.hidden = !state.isAdmin;
        if (adminManagement) adminManagement.hidden = !state.isAdmin;
        if (cartUserSection) cartUserSection.hidden = !state.isAdmin;
        if (ownerActions) ownerActions.hidden = !state.isOwner;
        if (activityPanel) activityPanel.hidden = !state.isAdmin;
        if (orderLogSection) orderLogSection.hidden = !state.isAdmin;
        if (signOutButton) signOutButton.hidden = !hasSession;
        if (visitorSignOutButton) visitorSignOutButton.hidden = !state.isVisitorVerified || state.isAdmin;
        if (visitorAuthDialog) {
            if (state.isVisitorVerified && visitorAuthDialog.open) visitorAuthDialog.close();
            else if (!state.isVisitorVerified && !visitorAuthDialog.open) visitorAuthDialog.showModal();
        }
        if (state.isAdmin) state.loginOpen = false;
        if (adminPanel) {
            adminPanel.hidden = !state.adminMenuOpen && !state.loginOpen && state.adminConfigured !== false;
        }
        if (adminToolsToggle) {
            adminToolsToggle.hidden = state.adminConfigured !== true || (!state.isAdmin && !hasAdminDeviceMarker);
            adminToolsToggle.setAttribute('aria-expanded', String(Boolean(adminPanel && !adminPanel.hidden)));
        }
        window.CartUser?.setAdminAccess(state.isAdmin);
    }

    function setVisitorAuthStatus(message, isError = false) {
        if (!visitorAuthStatus) return;
        visitorAuthStatus.textContent = message;
        visitorAuthStatus.classList.toggle('error', isError);
    }

    function notifyVisitorVerified() {
        if (!state.isVisitorVerified || state.isAdmin) return;
        const email = state.session?.user?.email || '';
        window.CartUser?.setVerifiedEmail(email);
        document.dispatchEvent(new CustomEvent('cart-user-auth-ready', { detail: { email } }));
        void window.refreshSharedCart?.();
    }

    function notifyVisitorSignedOut() {
        window.CartUser?.setVerifiedEmail('');
        document.dispatchEvent(new Event('cart-user-auth-signed-out'));
    }

    async function refreshAdminSetupStatus() {
        const { data, error } = await state.client.rpc('cart_admin_is_configured');
        // Fail closed: never display admin controls publicly if the status endpoint is unavailable.
        state.adminConfigured = error ? true : data === true;
        updateControls();
    }

    async function refreshAdminAccess(session = state.session) {
        const wasVisitorVerified = state.isVisitorVerified && !state.isAdmin;
        state.session = session || null;
        state.isAdmin = false;
        state.isOwner = false;
        state.isVisitorVerified = Boolean(
            state.session?.user?.email &&
            (state.session.user.email_confirmed_at || state.session.user.confirmed_at)
        );
        updateControls();

        if (!state.session) {
            if (wasVisitorVerified) notifyVisitorSignedOut();
            setVisitorAuthStatus('Enter your email to receive a verification link.');
            setStatus('Admin controls require a verified, allowlisted Supabase account.');
            finishAccessCheck();
            return;
        }

        if (!state.isVisitorVerified) {
            setVisitorAuthStatus('Open the verification link in your email to continue.');
            setStatus('Email verification is required to use the shared cart.');
            finishAccessCheck();
            return;
        }

        setStatus('Checking administrator access…');
        const { data, error } = await state.client.rpc('get_cart_admin_profile');
        if (error) {
            setStatus('Admin setup is incomplete. Run the updated Supabase SQL and allowlist the account.', true);
            updateControls();
            notifyVisitorVerified();
            finishAccessCheck();
            return;
        }

        const profile = Array.isArray(data) ? data[0] : null;
        if (!profile) {
            state.loginOpen = false;
            state.adminMenuOpen = false;
            setStatus('This verified account is not on the cart administrator allowlist.');
            updateControls();
            notifyVisitorVerified();
            finishAccessCheck();
            return;
        }

        state.isAdmin = true;
        state.isOwner = profile.is_owner === true;
        window.CartUser?.setVerifiedEmail(state.session.user.email || '');
        hasAdminDeviceMarker = true;
        try {
            localStorage.setItem(adminDeviceKey, 'true');
        } catch (error) {
            // The direct admin sign-in URL remains available if storage is blocked.
        }
        updateControls();
        finishAccessCheck();
        void refreshAccountList();
        void refreshCartUsers();
        void refreshOrderEmailLog(true);
        void window.refreshSharedCart?.();
        if (profile.display_name) {
            nameInput.value = profile.display_name;
            window.CartUser?.setAdminName(profile.display_name);
            setStatus('Administrator access verified.');
            return;
        }

        nameInput.value = window.CartUser?.getName() || '';
        setStatus('Administrator access verified. Set your administrator display name.');
    }

    async function setName(name) {
        if (!state.isAdmin || !state.client) throw new Error('Administrator access is required.');
        const cleaned = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
        if (!cleaned) throw new Error('Enter a name from 1 to 80 characters.');

        const { data, error } = await state.client.rpc('set_cart_admin_name', {
            p_display_name: cleaned
        });
        if (error) throw error;

        const savedName = typeof data === 'string' && data.trim() ? data.trim() : cleaned;
        nameInput.value = savedName;
        window.CartUser?.setAdminName(savedName);
        setStatus('Administrator name saved.');
        return savedName;
    }

    async function refreshAccountList() {
        if (!state.isAdmin || !adminList) return;
        if (refreshAccountsButton) refreshAccountsButton.disabled = true;
        let data;
        let error;
        try {
            ({ data, error } = await state.client.rpc('get_cart_auth_users'));
        } catch (requestError) {
            error = requestError;
        } finally {
            if (refreshAccountsButton) refreshAccountsButton.disabled = false;
        }
        if (error) {
            setStatus('Could not load accounts. Check the admin account management SQL setup.', true);
            return;
        }

        adminList.replaceChildren();
        const accounts = Array.isArray(data) ? data : [];
        if (accounts.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'admin-account-empty';
            empty.textContent = 'No Auth accounts found.';
            adminList.append(empty);
        }

        accounts.forEach((account) => {
            const row = document.createElement('li');
            const details = document.createElement('div');
            const name = document.createElement('span');
            const role = document.createElement('span');
            const dates = document.createElement('span');
            details.className = 'admin-account-details';
            name.className = 'admin-account-name';
            role.className = 'admin-owner-label';
            name.textContent = account.email || 'Account without an email address';
            role.textContent = account.is_owner ? 'Owner' : account.is_admin ? 'Admin' : account.email_confirmed_at ? 'Verified account' : 'Email not verified';
            const createdAt = account.created_at ? new Date(account.created_at) : null;
            const lastSignIn = account.last_sign_in_at ? new Date(account.last_sign_in_at) : null;
            const createdLabel = createdAt && !Number.isNaN(createdAt.valueOf())
                ? `Created ${createdAt.toLocaleDateString()}` : 'Creation date unavailable';
            const signInLabel = lastSignIn && !Number.isNaN(lastSignIn.valueOf())
                ? `Last sign-in ${lastSignIn.toLocaleDateString()}` : 'Never signed in';
            dates.className = 'admin-account-dates';
            dates.textContent = `${createdLabel} · ${signInLabel}`;
            details.append(name, role, dates);
            row.append(details);

            if (!account.is_owner && state.isOwner) {
                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.className = 'delete-auth-account';
                deleteButton.textContent = 'Delete account';
                deleteButton.addEventListener('click', async () => {
                    const accountLabel = account.email || 'this account';
                    const warning = `Permanently delete ${accountLabel} from Supabase Auth? This cannot be undone. Their current session may remain on screen, but it will no longer pass the verified account check for shared cart access.`;
                    if (!state.isOwner || !window.confirm(warning)) return;
                    deleteButton.disabled = true;
                    setStatus(`Deleting ${accountLabel}…`);
                    const { data: deletedEmail, error: deleteError } = await state.client.rpc('delete_cart_auth_user', {
                        p_user_id: account.user_id
                    });
                    if (deleteError) {
                        deleteButton.disabled = false;
                        setStatus(deleteError.message || 'Could not delete the account.', true);
                        return;
                    }
                    setStatus(`Deleted Supabase account ${deletedEmail || accountLabel}.`);
                    await refreshAccountList();
                });
                row.append(deleteButton);
            }
            adminList.append(row);
        });
    }

    async function refreshCartUsers() {
        if (!state.isAdmin || !cartUserList) return;
        if (refreshCartUsersButton) refreshCartUsersButton.disabled = true;
        let data;
        let error;
        try {
            ({ data, error } = await state.client.rpc('get_shared_cart_users'));
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
        if (users.length === 0) {
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
            const verifiedEmail = document.createElement('span');
            const dates = document.createElement('span');
            details.className = 'admin-account-details';
            name.className = 'admin-account-name';
            name.textContent = user.display_name || 'Unnamed browser';
            verifiedEmail.className = 'admin-owner-label';
            verifiedEmail.textContent = user.email ? `Verified email ${user.email}` : 'No verified account linked';
            const firstSeen = user.first_seen_at ? new Date(user.first_seen_at) : null;
            const lastSeen = user.last_seen_at ? new Date(user.last_seen_at) : null;
            const firstLabel = firstSeen && !Number.isNaN(firstSeen.valueOf())
                ? `First seen ${firstSeen.toLocaleDateString()}` : 'First seen date unavailable';
            const lastLabel = lastSeen && !Number.isNaN(lastSeen.valueOf())
                ? `Last active ${lastSeen.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : 'Last active date unavailable';
            dates.className = 'admin-account-dates';
            dates.textContent = `${firstLabel} · ${lastLabel}`;
            details.append(name, verifiedEmail, dates);
            row.append(details);

            if (state.isOwner) {
                const removeButton = document.createElement('button');
                removeButton.type = 'button';
                removeButton.className = 'delete-auth-account';
                removeButton.textContent = 'Remove browser';
                removeButton.addEventListener('click', async () => {
                    if (!state.isOwner || !window.confirm(`Remove ${user.display_name || 'this browser'} from the cart user list? This browser will need to enter a name again before it can be listed.`)) return;
                    removeButton.disabled = true;
                    let removeError;
                    try {
                        ({ error: removeError } = await state.client.rpc('remove_shared_cart_user', {
                            p_device_id: user.device_id
                        }));
                    } catch (requestError) {
                        removeError = requestError;
                    }
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

    async function revalidateAdminAccess() {
        if (!state.isAdmin || !state.session) return;
        const checkedSession = state.session;
        const { data, error } = await state.client.rpc('get_cart_admin_profile');
        if (error || state.session !== checkedSession) return;
        const profile = Array.isArray(data) ? data[0] : null;
        if (profile) return;

        state.isAdmin = false;
        state.isOwner = false;
        state.loginOpen = false;
        updateControls();
        setStatus('Administrator access was removed for this account.');
        void window.refreshSharedCart?.();
    }

    function renderOrderEmailLog() {
        if (!orderLogList || !state.isAdmin) return;
        orderLogList.replaceChildren();

        if (state.orderEmailEntries.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'order-log-empty';
            empty.textContent = 'No order email requests logged yet.';
            orderLogList.append(empty);
        }

        state.orderEmailEntries.forEach((entry) => {
            const row = document.createElement('li');
            row.className = 'order-log-entry';
            const details = document.createElement('details');
            const summary = document.createElement('summary');
            const title = document.createElement('span');
            const time = document.createElement('time');
            title.className = 'order-log-title';
            title.textContent = `${entry.cart_type === 'electrical' ? 'Electrical' : 'Mechanical'} · ${entry.actor_name || 'Unknown user'}`;
            const timestamp = new Date(entry.created_at);
            if (!Number.isNaN(timestamp.valueOf())) {
                time.dateTime = timestamp.toISOString();
                time.textContent = timestamp.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
            }
            summary.append(title, time);

            const items = document.createElement('ul');
            (Array.isArray(entry.order_items) ? entry.order_items : []).forEach((item) => {
                const listItem = document.createElement('li');
                const prefix = item.category ? `${item.category} · ` : '';
                const metadata = [
                    item.part_number ? `Part number: ${item.part_number}` : '',
                    item.manufacturer ? `Manufacturer: ${item.manufacturer}` : ''
                ].filter(Boolean).join('; ');
                listItem.textContent = `${prefix}${item.item_name || 'Part'} — quantity: ${item.quantity || 0}${metadata ? ` (${metadata})` : ''}`;
                items.append(listItem);
            });

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'delete-order-log';
            deleteButton.textContent = 'Delete this entry';
            deleteButton.addEventListener('click', async () => {
                if (!state.isAdmin || !window.confirm('Delete this order email entry? This cannot be undone.')) return;
                deleteButton.disabled = true;
                const { error } = await state.client.rpc('delete_cart_order_email_log', { p_log_id: entry.id });
                if (error) {
                    deleteButton.disabled = false;
                    setStatus(error.message || 'Could not delete the order entry.', true);
                    return;
                }
                state.orderEmailEntries = state.orderEmailEntries.filter((candidate) => String(candidate.id) !== String(entry.id));
                renderOrderEmailLog();
                setStatus('Order email entry deleted.');
            });

            details.append(summary, items, deleteButton);
            row.append(details);
            orderLogList.append(row);
        });

        if (loadOlderOrderLogsButton) {
            loadOlderOrderLogsButton.hidden = !state.hasMoreOrderEmails;
            loadOlderOrderLogsButton.disabled = state.loadingOrderEmails;
        }
    }

    async function refreshOrderEmailLog(reset = false) {
        if (!state.isAdmin || !state.client || !orderLogList || state.loadingOrderEmails) return;
        if (reset) {
            state.orderEmailEntries = [];
            state.orderEmailCursor = null;
            state.hasMoreOrderEmails = false;
            renderOrderEmailLog();
        }

        state.loadingOrderEmails = true;
        renderOrderEmailLog();
        const { data, error } = await state.client.rpc('get_cart_order_email_log', {
            p_before_id: state.orderEmailCursor
        });
        state.loadingOrderEmails = false;
        if (error) {
            setStatus('Could not load the order email history. Check the admin order log SQL setup.', true);
            renderOrderEmailLog();
            return;
        }

        const entries = Array.isArray(data) ? data : [];
        state.orderEmailEntries = [...state.orderEmailEntries, ...entries];
        state.orderEmailCursor = entries.length ? entries[entries.length - 1].id : state.orderEmailCursor;
        state.hasMoreOrderEmails = entries.length === 50;
        renderOrderEmailLog();
    }

    loadOlderOrderLogsButton?.addEventListener('click', () => { void refreshOrderEmailLog(false); });
    refreshAccountsButton?.addEventListener('click', () => { void refreshAccountList(); });
    refreshCartUsersButton?.addEventListener('click', () => { void refreshCartUsers(); });

    if (!config.url || !publicApiKey || !window.supabase?.createClient) {
        setStatus('Admin sign-in is unavailable because the Supabase connection did not load.', true);
        setVisitorAuthStatus('Email verification is unavailable because the Supabase connection did not load.', true);
        if (visitorAuthDialog && !visitorAuthDialog.open) visitorAuthDialog.showModal();
        if (adminPanel) adminPanel.hidden = false;
        if (adminToolsToggle) adminToolsToggle.hidden = true;
        if (loginForm) loginForm.addEventListener('submit', (event) => event.preventDefault());
        window.CartAdmin = {
            isAdmin: () => false,
            isVisitorVerified: () => false,
            whenAccessChecked: () => Promise.resolve(),
            getAccessToken: () => '',
            refreshOrderEmailLog: () => Promise.resolve(),
            setName,
            setStatus
        };
        return;
    }

    state.client = window.supabase.createClient(config.url, publicApiKey, {
        auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true
        }
    });

    window.CartAdmin = {
        isAdmin: () => state.isAdmin,
        isVisitorVerified: () => state.isVisitorVerified,
        whenAccessChecked: () => accessReady,
        getAccessToken: () => state.session?.access_token || '',
        refreshOrderEmailLog,
        setName,
        setStatus
    };

    adminToolsToggle?.addEventListener('click', () => {
        state.adminMenuOpen = !state.adminMenuOpen;
        updateControls();
        if (state.adminMenuOpen && !state.isAdmin) emailInput?.focus();
    });

    adminToolsClose?.addEventListener('click', () => {
        state.adminMenuOpen = false;
        state.loginOpen = false;
        updateControls();
        adminToolsToggle?.focus();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !adminPanel || adminPanel.hidden) return;
        state.adminMenuOpen = false;
        state.loginOpen = false;
        updateControls();
    });

    void refreshAdminSetupStatus();

    visitorAuthForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = visitorAuthEmailInput.value.trim();
        if (!email) {
            visitorAuthEmailInput.reportValidity();
            return;
        }

        visitorAuthSubmit.disabled = true;
        setVisitorAuthStatus('Sending your verification link…');
        let error;
        try {
            ({ error } = await state.client.auth.signInWithOtp({
                email,
                options: {
                    shouldCreateUser: true,
                    emailRedirectTo: `${window.location.origin}${window.location.pathname}`
                }
            }));
        } catch (requestError) {
            error = requestError;
        } finally {
            visitorAuthSubmit.disabled = false;
        }
        if (error) {
            if (error.status === 429 || error.code === 'over_email_send_rate_limit' ||
                error.code === 'over_request_rate_limit') {
                setVisitorAuthStatus('Please wait before requesting another link, and check your inbox and junk folder.', true);
            } else if (error.code === 'email_address_not_authorized') {
                setVisitorAuthStatus('Supabase email delivery is not configured for this address. Configure custom SMTP in Authentication → Emails → SMTP Settings.', true);
            } else if (error.code === 'otp_disabled') {
                setVisitorAuthStatus('Email verification links are disabled in Supabase. Enable Email OTP under Authentication → Sign In / Providers.', true);
            } else if (error.code === 'signup_disabled' || error.code === 'signups_disabled') {
                setVisitorAuthStatus('Visitor registration is disabled in Supabase Auth settings.', true);
            } else {
                setVisitorAuthStatus(error.message || 'Could not send the verification link. Check Supabase Auth email settings.', true);
            }
            return;
        }

        setVisitorAuthStatus('Verification link sent. Open it from your email to return to the cart.');
    });

    visitorSignOutButton?.addEventListener('click', async () => {
        const { error } = await state.client.auth.signOut();
        if (error) setVisitorAuthStatus('Could not sign out. Reload the page and try again.', true);
    });

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = emailInput.value.trim();
        if (!email) {
            emailInput.reportValidity();
            return;
        }

        setStatus('Sending a secure sign-in link…');
        const { error } = await state.client.auth.signInWithOtp({
            email,
            options: {
                shouldCreateUser: false,
                emailRedirectTo: `${window.location.origin}${window.location.pathname}`
            }
        });
        if (error) {
            if (error.status === 429 || error.code === 'over_email_send_rate_limit' ||
                error.code === 'over_request_rate_limit') {
                setStatus('Supabase is rate limiting sign-in requests. Wait at least 60 seconds before trying again, and check your inbox and junk folder for the previous link.', true);
            } else if (error.code === 'email_address_not_authorized') {
                setStatus('Supabase’s built-in email service only sends to project team members. Configure custom SMTP in Authentication → Emails → SMTP Settings.', true);
            } else if (error.code === 'otp_disabled') {
                setStatus('Email sign-in links are disabled in this Supabase project. Enable email OTP under Authentication → Sign In / Providers.', true);
            } else {
                setStatus(`Could not send the link${error.message ? `: ${error.message}` : '. Check the Auth account and Supabase email settings.'}`, true);
            }
            return;
        }
        setStatus('If that email is registered in Supabase Auth, a sign-in link has been sent.');
    });

    nameForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            await setName(nameInput.value);
        } catch (error) {
            setStatus(error.message || 'Could not save the administrator name.', true);
        }
    });

    addAdminForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!state.isOwner) return;
        const email = addAdminEmailInput.value.trim();
        if (!email) {
            addAdminEmailInput.reportValidity();
            return;
        }

        const submitButton = addAdminForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        setStatus('Adding the verified account…');
        const { data, error } = await state.client.rpc('add_cart_admin', { p_email: email });
        submitButton.disabled = false;
        if (error) {
            setStatus(error.message || 'Could not grant administrator access.', true);
            return;
        }

        addAdminEmailInput.value = '';
        setStatus(`Administrator access granted to ${data || email}.`);
        await refreshAccountList();
    });

    clearHistoryButton.addEventListener('click', async () => {
        if (!state.isAdmin || !window.confirm('Clear the existing recent changes? One entry recording this clear action will remain in the history.')) return;

        clearHistoryButton.disabled = true;
        setStatus('Clearing recent changes…');
        try {
            const { data, error } = await state.client.rpc('clear_shared_cart_activity');
            if (error) throw error;
            const historyRefreshed = await window.refreshSharedCart?.();
            if (historyRefreshed === false) {
                setStatus(`Cleared ${Number.isInteger(data) ? data : 'the existing'} recent changes, but could not reload the log. Reload the page to confirm.`, true);
                return;
            }
            setStatus(`Cleared ${Number.isInteger(data) ? data : 'the existing'} recent changes. The clear action remains in the log.`);
        } catch (error) {
            setStatus(`Could not clear recent changes: ${error.message || 'check the connection and try again.'}`, true);
        } finally {
            clearHistoryButton.disabled = false;
        }
    });

    signOutButton.addEventListener('click', async () => {
        const { error } = await state.client.auth.signOut();
        if (error) setStatus('Could not sign out. Reload the page and try again.', true);
        else window.CartUser?.setVerifiedEmail('');
    });

    state.client.auth.onAuthStateChange((_event, session) => {
        // Leave the auth callback quickly; the RPC can run after Supabase finishes updating the session.
        setTimeout(() => { void refreshAdminAccess(session); }, 0);
    });

    state.client.auth.getSession().then(({ data, error }) => {
        if (error) {
            setStatus('Could not restore the administrator session. Sign in again.', true);
            finishAccessCheck();
            return;
        }
        void refreshAdminAccess(data.session);
    });

    window.setInterval(() => { void revalidateAdminAccess(); }, 30000);
})();
