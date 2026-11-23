(() => {
    const status = document.getElementById('cart-admin-status');
    const adminPanel = document.getElementById('cart-admin');
    const adminEntryButton = document.getElementById('cart-admin-entry');
    const loginForm = document.getElementById('cart-admin-login-form');
    const emailInput = document.getElementById('cart-admin-email');
    const adminActions = document.getElementById('cart-admin-actions');
    const nameForm = document.getElementById('cart-admin-name-form');
    const nameInput = document.getElementById('cart-admin-name');
    const adminManagement = document.getElementById('cart-admin-management');
    const addAdminForm = document.getElementById('add-cart-admin-form');
    const addAdminEmailInput = document.getElementById('add-cart-admin-email');
    const adminList = document.getElementById('cart-admin-list');
    const clearHistoryButton = document.getElementById('clear-recent-changes');
    const clearCartButton = document.getElementById('clear-cart');
    const signOutButton = document.getElementById('cart-admin-sign-out');
    const config = window.SUPABASE_CONFIG || {};
    const publicApiKey = config.publishableKey || config.anonKey || '';
    const adminDeviceKey = 'dhl-cart-admin-portal';
    const adminPortalRequested = new URLSearchParams(window.location.search).get('cartAdmin') === 'signin';
    let hasAdminDeviceMarker = false;
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
        adminConfigured: null,
        loginOpen: adminPortalRequested
    };

    function setStatus(message, isError = false) {
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('error', isError);
    }

    function updateControls() {
        const hasSession = Boolean(state.session);
        if (loginForm) loginForm.hidden = hasSession;
        if (adminActions) adminActions.hidden = !state.isAdmin;
        if (adminManagement) adminManagement.hidden = !state.isOwner;
        if (signOutButton) signOutButton.hidden = !hasSession;
        const config = window.SUPABASE_CONFIG || {};
        const sharedCartConfigured = Boolean(config.url && (config.publishableKey || config.anonKey));
        if (clearCartButton) clearCartButton.hidden = sharedCartConfigured && !state.isAdmin;
        if (state.isAdmin) state.loginOpen = false;
        if (adminPanel) {
            adminPanel.hidden = !state.isAdmin && state.adminConfigured !== false && !state.loginOpen;
        }
        if (adminEntryButton) {
            adminEntryButton.hidden = state.adminConfigured !== true || state.isAdmin || state.loginOpen || !hasAdminDeviceMarker;
        }
        window.CartUser?.setAdminAccess(state.isAdmin);
    }

    async function refreshAdminSetupStatus() {
        const { data, error } = await state.client.rpc('cart_admin_is_configured');
        // Fail closed: never display admin controls publicly if the status endpoint is unavailable.
        state.adminConfigured = error ? true : data === true;
        updateControls();
    }

    async function refreshAdminAccess(session = state.session) {
        state.session = session || null;
        state.isAdmin = false;
        state.isOwner = false;
        updateControls();

        if (!state.session) {
            setStatus('Admin controls require a verified, allowlisted Supabase account.');
            return;
        }

        setStatus('Checking administrator access…');
        const { data, error } = await state.client.rpc('get_cart_admin_profile');
        if (error) {
            setStatus('Admin setup is incomplete. Run the updated Supabase SQL and allowlist the account.', true);
            updateControls();
            return;
        }

        const profile = Array.isArray(data) ? data[0] : null;
        if (!profile) {
            state.loginOpen = false;
            setStatus('This verified account is not on the cart administrator allowlist.');
            updateControls();
            return;
        }

        state.isAdmin = true;
        state.isOwner = profile.is_owner === true;
        hasAdminDeviceMarker = true;
        try {
            localStorage.setItem(adminDeviceKey, 'true');
        } catch (error) {
            // The direct admin sign-in URL remains available if storage is blocked.
        }
        updateControls();
        if (state.isOwner) void refreshAdminList();
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

    async function refreshAdminList() {
        if (!state.isOwner || !adminList) return;
        const { data, error } = await state.client.rpc('get_cart_admins');
        if (error) {
            setStatus('Could not load administrators. Check the admin management SQL setup.', true);
            return;
        }

        adminList.replaceChildren();
        (Array.isArray(data) ? data : []).forEach((administrator) => {
            const row = document.createElement('li');
            const name = document.createElement('span');
            name.textContent = administrator.email || 'Verified account';
            row.append(name);
            if (administrator.is_owner) {
                const owner = document.createElement('span');
                owner.className = 'admin-owner-label';
                owner.textContent = 'Owner';
                row.append(owner);
            }
            adminList.append(row);
        });
    }

    if (!config.url || !publicApiKey || !window.supabase?.createClient) {
        setStatus('Admin sign-in is unavailable because the Supabase connection did not load.', true);
        if (adminPanel) adminPanel.hidden = false;
        if (adminEntryButton) adminEntryButton.hidden = true;
        if (clearCartButton) clearCartButton.hidden = false;
        if (loginForm) loginForm.addEventListener('submit', (event) => event.preventDefault());
        window.CartAdmin = {
            isAdmin: () => false,
            getAccessToken: () => '',
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
        getAccessToken: () => state.session?.access_token || '',
        setName,
        setStatus
    };

    adminEntryButton?.addEventListener('click', () => {
        state.loginOpen = true;
        updateControls();
        emailInput?.focus();
    });

    void refreshAdminSetupStatus();

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
        await refreshAdminList();
    });

    clearHistoryButton.addEventListener('click', async () => {
        if (!state.isAdmin || !window.confirm('Clear the recent changes list? A record of this clear action will remain.')) return;

        clearHistoryButton.disabled = true;
        setStatus('Clearing recent changes…');
        const { error } = await state.client.rpc('clear_shared_cart_activity');
        clearHistoryButton.disabled = false;
        if (error) {
            setStatus('Could not clear recent changes. Check the Supabase SQL setup.', true);
            return;
        }

        setStatus('Recent changes cleared.');
        await window.refreshSharedCart?.();
    });

    signOutButton.addEventListener('click', async () => {
        const { error } = await state.client.auth.signOut();
        if (error) setStatus('Could not sign out. Reload the page and try again.', true);
    });

    state.client.auth.onAuthStateChange((_event, session) => {
        // Leave the auth callback quickly; the RPC can run after Supabase finishes updating the session.
        setTimeout(() => { void refreshAdminAccess(session); }, 0);
    });

    state.client.auth.getSession().then(({ data, error }) => {
        if (error) {
            setStatus('Could not restore the administrator session. Sign in again.', true);
            return;
        }
        void refreshAdminAccess(data.session);
    });
})();
