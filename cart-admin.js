// File purpose: Shared cart administration controller: verifies admin access, controls visitor/admin views, and loads or manages order email history.

(() => {
    const status = document.getElementById('cart-admin-status');
    const adminPanel = document.getElementById('admin-tools-panel');
    const adminToolsToggle = document.getElementById('admin-tools-toggle');
    const adminToolsClose = document.getElementById('admin-tools-close');
    const accountManagementLink = document.getElementById('account-management-link');
    const loginForm = document.getElementById('cart-admin-login-form');
    const emailInput = document.getElementById('cart-admin-email');
    const visitorAuthDialog = document.getElementById('cart-visitor-auth-dialog');
    const visitorAuthForm = document.getElementById('cart-visitor-auth-form');
    const visitorAuthEmailInput = document.getElementById('cart-visitor-email');
    const visitorAuthCodeInput = document.getElementById('cart-visitor-access-code');
    const visitorAuthStatus = document.getElementById('cart-visitor-auth-status');
    const visitorAuthSubmit = document.getElementById('cart-visitor-send-link');
    const visitorSignOutButton = document.getElementById('cart-user-sign-out');
    const adminActions = document.getElementById('cart-admin-actions');
    const activityPanel = document.getElementById('cart-activity-panel');
    const orderLogSection = document.getElementById('cart-order-log');
    const orderLogList = document.getElementById('cart-order-email-list');
    const loadOlderOrderLogsButton = document.getElementById('load-older-order-logs');
    const config = window.SUPABASE_CONFIG || {};
    const publicApiKey = config.publishableKey || config.anonKey || '';
    const adminDeviceKey = 'dhl-cart-admin-portal';
    const approvedAdminSessionKey = 'dhl-approved-admin-session-user';
    const adminPortalRequested = new URLSearchParams(window.location.search).get('cartAdmin') === 'signin';
    let hasAdminDeviceMarker = false;
    let resolveAccessReady;
    let accessReadyResolved = false;
    const accessReady = new Promise((resolve) => { resolveAccessReady = resolve; });
    // Session markers and page state support a fast return while server checks remain authoritative.
    function rememberApprovedAdminSession(userId) {
        if (!userId) return;
        try { sessionStorage.setItem(approvedAdminSessionKey, userId); } catch (error) { /* Storage can be disabled. */ }
    }
    function clearApprovedAdminSession() {
        try { sessionStorage.removeItem(approvedAdminSessionKey); } catch (error) { /* Storage can be disabled. */ }
    }
    try {
        hasAdminDeviceMarker = localStorage.getItem(adminDeviceKey) === 'true';
    } catch (error) {
        // A private browser can still use the direct admin sign-in URL.
    }
    const state = {
        client: null,
        session: null,
        isAdmin: false,
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

    // UI state helpers show only the controls allowed by the currently verified account.
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
        if (accountManagementLink) accountManagementLink.hidden = !state.isAdmin;
        if (activityPanel) activityPanel.hidden = !state.isAdmin;
        if (orderLogSection) orderLogSection.hidden = !state.isAdmin;
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
            adminToolsToggle.hidden = state.adminConfigured !== true || !state.isAdmin;
            adminToolsToggle.setAttribute('aria-expanded', String(Boolean(adminPanel && !adminPanel.hidden)));
        }
        window.CartUser?.setAdminAccess(state.isAdmin);
    }

    function setVisitorAuthStatus(message, isError = false) {
        if (!visitorAuthStatus) return;
        visitorAuthStatus.textContent = message;
        visitorAuthStatus.classList.toggle('error', isError);
    }

    async function getFunctionErrorMessage(error, fallback) {
        try {
            const response = error?.context instanceof Response ? error.context.clone() : null;
            const body = response ? await response.json() : null;
            if (typeof body?.error === 'string') return body.error;
        } catch (readError) {
            // Fall back to the function client's message when its response cannot be read.
        }
        return error?.message || fallback;
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

    // Authorization checks: distinguish visitor access, approved users, and allowlisted administrators.
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
        state.isVisitorVerified = Boolean(
            state.session?.user?.email &&
            (state.session.user.email_confirmed_at || state.session.user.confirmed_at)
        );
        updateControls();

        if (!state.session) {
            clearApprovedAdminSession();
            if (wasVisitorVerified) notifyVisitorSignedOut();
            setVisitorAuthStatus('Enter your email and the eight-digit number from an administrator.');
            setStatus('Admin controls require a verified, allowlisted Supabase account.');
            finishAccessCheck();
            return;
        }

        if (!state.isVisitorVerified) {
            clearApprovedAdminSession();
            setVisitorAuthStatus('Enter a current access number issued by an administrator.');
            setStatus('Email verification is required to use the shared cart.');
            finishAccessCheck();
            return;
        }

        setStatus('Checking administrator access…');
        const checkedSession = state.session;
        const { data, error } = await state.client.rpc('get_cart_admin_profile');
        if (state.session !== checkedSession) return;
        if (error) {
            clearApprovedAdminSession();
            setStatus('Admin setup is incomplete. Run the updated Supabase SQL and allowlist the account.', true);
            updateControls();
            notifyVisitorVerified();
            finishAccessCheck();
            return;
        }

        const profile = Array.isArray(data) ? data[0] : null;
        if (!profile) {
            clearApprovedAdminSession();
            state.loginOpen = false;
            state.adminMenuOpen = false;
            setStatus('This verified account is not on the cart administrator allowlist.');
            updateControls();
            notifyVisitorVerified();
            finishAccessCheck();
            return;
        }

        state.isAdmin = true;
        rememberApprovedAdminSession(state.session.user.id);
        window.CartUser?.setVerifiedEmail(state.session.user.email || '');
        hasAdminDeviceMarker = true;
        try {
            localStorage.setItem(adminDeviceKey, 'true');
        } catch (error) {
            // The direct admin sign-in URL remains available if storage is blocked.
        }
        updateControls();
        finishAccessCheck();
        void refreshOrderEmailLog(true);
        void window.refreshSharedCart?.();
        if (profile.display_name) {
            window.CartUser?.setAdminName(profile.display_name);
            setStatus('Administrator access verified.');
            return;
        }
        setStatus('Administrator access verified.');
    }

    async function revalidateAdminAccess() {
        if (!state.isAdmin || !state.session) return;
        const checkedSession = state.session;
        const { data, error } = await state.client.rpc('get_cart_admin_profile');
        if (error || state.session !== checkedSession) return;
        const profile = Array.isArray(data) ? data[0] : null;
        if (profile) return;

        state.isAdmin = false;
        state.loginOpen = false;
        updateControls();
        setStatus('Administrator access was removed for this account.');
        void window.refreshSharedCart?.();
    }

    // Order history: format and paginate the administrator-only record of email drafts.
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
                if (!state.isAdmin) return;
                const confirmed = await window.siteConfirm({
                    title: 'Delete order email entry?',
                    message: 'Delete this saved order email entry? This cannot be undone.',
                    confirmText: 'Delete entry'
                });
                if (!confirmed) return;
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

    // Publish a small API for the account page and wire sign-in, sign-out, and drawer interactions.
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
        const email = visitorAuthEmailInput.value.trim().toLowerCase();
        const code = visitorAuthCodeInput?.value.trim() || '';
        if (!email) {
            visitorAuthEmailInput.reportValidity();
            return;
        }
        if (!/^\d{8}$/.test(code)) {
            visitorAuthCodeInput?.reportValidity();
            return;
        }

        visitorAuthSubmit.disabled = true;
        setVisitorAuthStatus('Checking your access number…');
        try {
            const { data, error } = await state.client.functions.invoke('website-access-codes', {
                body: { action: 'redeem', email, code }
            });
            if (error) throw new Error(await getFunctionErrorMessage(error, 'Could not verify the access number.'));
            if (!data?.session?.access_token || !data?.session?.refresh_token) {
                throw new Error('The access service returned an incomplete sign-in session.');
            }
            const { error: sessionError } = await state.client.auth.setSession(data.session);
            if (sessionError) throw sessionError;
            visitorAuthCodeInput.value = '';
            setVisitorAuthStatus('Access number accepted. Opening the website…');
        } catch (error) {
            setVisitorAuthStatus(error.message || 'Could not verify the access number.', true);
        } finally {
            visitorAuthSubmit.disabled = false;
        }
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
            if (error.code === 'over_email_send_rate_limit') {
                setStatus('Supabase has reached this project’s email sending limit. The built-in mailer allows 2 emails per hour and only sends to project team addresses. Set up custom SMTP in Supabase to send links to other addresses.', true);
            } else if (error.code === 'over_request_rate_limit' || error.status === 429) {
                setStatus('Too many link requests were made recently. Wait at least 60 seconds before trying again, then check your inbox and junk folder.', true);
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
