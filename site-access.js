// File purpose: Shared access gate: restores approved sessions, submits/reviews access requests, verifies account approval, and loads protected page scripts.

(() => {
    // Reusable in-page confirmation dialog replaces browser-native confirm prompts.
    let siteConfirmId = 0;
    let siteConfirmOpen = false;

    window.siteConfirm = (options = {}) => {
        if (siteConfirmOpen) return Promise.resolve(false);
        siteConfirmOpen = true;

        const titleText = options.title || 'Confirm action';
        const messageText = options.message || 'Are you sure you want to continue?';
        const confirmText = options.confirmText || 'Continue';
        const cancelText = options.cancelText || 'Cancel';
        const variant = options.variant === 'warning' ? 'warning' : 'danger';
        const id = ++siteConfirmId;
        const dialog = document.createElement('dialog');
        dialog.className = `site-confirm-dialog site-confirm-dialog--${variant}`;
        dialog.setAttribute('aria-labelledby', `site-confirm-title-${id}`);
        dialog.setAttribute('aria-describedby', `site-confirm-message-${id}`);

        const panel = document.createElement('div');
        panel.className = 'site-confirm-dialog__panel';
        const mark = document.createElement('span');
        mark.className = 'site-confirm-dialog__mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = variant === 'warning' ? '!' : '×';
        const heading = document.createElement('h2');
        heading.className = 'site-confirm-dialog__title';
        heading.id = `site-confirm-title-${id}`;
        heading.textContent = titleText;
        const message = document.createElement('p');
        message.className = 'site-confirm-dialog__message';
        message.id = `site-confirm-message-${id}`;
        message.textContent = messageText;
        const actions = document.createElement('div');
        actions.className = 'site-confirm-dialog__actions';
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'site-confirm-dialog__cancel';
        cancelButton.textContent = cancelText;
        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.className = 'site-confirm-dialog__confirm';
        confirmButton.textContent = confirmText;
        actions.append(cancelButton, confirmButton);
        panel.append(mark, heading, message, actions);
        dialog.append(panel);

        const finish = (confirmed) => {
            if (dialog.open) dialog.close(confirmed ? 'confirm' : 'cancel');
        };
        dialog.addEventListener('close', () => {
            siteConfirmOpen = false;
            dialog.remove();
            resolveConfirmation(dialog.returnValue === 'confirm');
        }, { once: true });
        dialog.addEventListener('cancel', () => { dialog.returnValue = 'cancel'; });
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) finish(false);
        });
        cancelButton.addEventListener('click', () => finish(false));
        confirmButton.addEventListener('click', () => finish(true));

        let resolveConfirmation;
        const result = new Promise((resolve) => { resolveConfirmation = resolve; });
        document.body.append(dialog);
        try {
            dialog.showModal();
            cancelButton.focus();
        } catch (error) {
            siteConfirmOpen = false;
            dialog.remove();
            resolveConfirmation(false);
        }
        return result;
    };

    const config = window.SUPABASE_CONFIG || {};
    const apiKey = config.publishableKey || config.anonKey || '';
    let preflightResume = document.documentElement.classList.contains('site-access-resuming');
    const root = document.createElement('section');
    root.className = 'site-access-overlay';
    root.setAttribute('aria-live', 'polite');
    root.hidden = preflightResume;
    root.innerHTML = `
        <div class="site-access-card">
            <span class="site-access-mark" aria-hidden="true">D</span>
            <h1 id="site-access-title">Request website access</h1>
            <p class="site-access-copy" id="site-access-copy">Ask an administrator for an eight-digit access number. They will enter your email here and relay the number to you; Supabase will not email it.</p>
            <form class="site-access-form" id="site-access-form">
                <label for="site-access-email">Email address</label>
                <input id="site-access-email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com">
                <label for="site-access-code">Eight-digit access number</label>
                <input id="site-access-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" maxlength="8" required placeholder="00000000">
                <button type="submit" id="site-access-submit">Enter access number</button>
            </form>
            <p class="site-access-status" id="site-access-status" role="status"></p>
            <button class="site-access-secondary" id="site-access-signout" type="button" hidden>Use a different email</button>
        </div>`;
    document.body.prepend(root);

    const title = root.querySelector('#site-access-title');
    const copy = root.querySelector('#site-access-copy');
    const form = root.querySelector('#site-access-form');
    const emailInput = root.querySelector('#site-access-email');
    const codeInput = root.querySelector('#site-access-code');
    const submitButton = root.querySelector('#site-access-submit');
    const status = root.querySelector('#site-access-status');
    const signOutButton = root.querySelector('#site-access-signout');
    // Access overlay setup and script loading keep protected page logic dormant until access is checked.
    const scriptNames = (document.documentElement.dataset.siteAccessScripts || '').split('|').filter(Boolean);
    const needsAdmin = document.documentElement.dataset.siteAccessAdminOnly === 'true';
    const approvedSessionKey = 'dhl-approved-session-user';
    const approvedAdminSessionKey = 'dhl-approved-admin-session-user';
    let client = null;
    let currentSession = null;
    let pollTimer = null;
    let checking = false;
    let accessCheckPending = false;
    let authEventSeen = false;
    let sessionVersion = 0;
    let appLoadPromise = null;
    const loadedAppScripts = new Set();
    let pageUnlocked = false;

    // Access-screen state helpers control messages, modes, and visibility during transitions.
    function setStatus(message, isError = false) {
        status.textContent = message;
        status.classList.toggle('is-error', isError);
    }

    function setMode(mode, message = '') {
        root.dataset.mode = mode;
        form.hidden = !['signed-out', 'denied', 'pending'].includes(mode);
        signOutButton.hidden = !currentSession;
        if (mode === 'signed-out') {
            title.textContent = 'Enter your access number';
            copy.textContent = 'An administrator must add your email and give you an eight-digit number. Supabase will not email this number.';
            submitButton.textContent = 'Enter access number';
            emailInput.value = currentSession?.user?.email || emailInput.value;
            setStatus(message || '');
        } else if (mode === 'verifying') {
            title.textContent = 'Verifying your access number';
            copy.textContent = 'Your number is being checked securely.';
            setStatus(message || 'Please wait…');
        } else if (mode === 'pending') {
            title.textContent = 'Waiting for access';
            copy.textContent = 'An administrator must approve this account. If they have given you an access number, enter it below.';
            submitButton.textContent = 'Enter access number';
            setStatus(message || 'We’ll check for an administrator decision automatically.');
        } else if (mode === 'denied') {
            title.textContent = 'Access not approved';
            copy.textContent = 'If an administrator has issued you a new access number, enter it below. Otherwise, contact an administrator.';
            submitButton.textContent = 'Enter access number';
            setStatus(message || '');
        } else if (mode === 'error') {
            title.textContent = 'Could not verify access';
            copy.textContent = 'The access service could not be reached. Check your connection and try again.';
            form.hidden = true;
            setStatus(message || 'Please reload the page to retry.', true);
        }
    }

    async function loadAppScripts(authorizedUserId, fastResume = false) {
        if (!appLoadPromise) {
            appLoadPromise = (async () => {
                for (const name of scriptNames) {
                    if (loadedAppScripts.has(name)) continue;
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = name;
                        script.onload = resolve;
                        script.onerror = () => {
                            script.remove();
                            reject(new Error(`Could not load ${name}.`));
                        };
                        document.body.append(script);
                    });
                    loadedAppScripts.add(name);
                }
            })().catch((error) => {
                appLoadPromise = null;
                throw error;
            });
        }
        await appLoadPromise;
        if (currentSession?.user?.id !== authorizedUserId) return false;
        if (pageUnlocked) return true;
        pageUnlocked = true;
        document.body.classList.add('site-content-enter');
        if (fastResume) {
            document.documentElement.classList.remove('site-access-locked');
            root.hidden = true;
        } else {
            window.setTimeout(() => {
                document.documentElement.classList.remove('site-access-locked');
                root.classList.add('is-leaving');
                window.setTimeout(() => { root.hidden = true; }, 650);
            }, 850);
        }
        document.documentElement.classList.remove('site-access-resuming');
        preflightResume = false;
        if (!pollTimer) pollTimer = window.setInterval(() => { void checkAccess(); }, 30000);
        return true;
    }

    function lockPage() {
        pageUnlocked = false;
        preflightResume = false;
        root.hidden = false;
        root.classList.remove('is-leaving', 'is-approved');
        document.documentElement.classList.remove('site-access-resuming');
        document.documentElement.classList.add('site-access-locked');
    }

    // Session hints accelerate refreshes, but every resumed session is revalidated with Supabase.
    function hasApprovedSessionHint(session) {
        if (!session?.user?.id) return false;
        try {
            return sessionStorage.getItem(approvedSessionKey) === session.user.id;
        } catch (error) {
            return false;
        }
    }

    function clearApprovedSessionHint() {
        try { sessionStorage.removeItem(approvedSessionKey); } catch (error) { /* Storage can be disabled. */ }
    }

    function clearApprovedAdminSessionHint() {
        try { sessionStorage.removeItem(approvedAdminSessionKey); } catch (error) { /* Storage can be disabled. */ }
    }

    function rememberApprovedSession(session) {
        if (!session?.user?.id) return;
        try { sessionStorage.setItem(approvedSessionKey, session.user.id); } catch (error) { /* Storage can be disabled. */ }
    }

    function rememberApprovedAdminSession(session) {
        if (!session?.user?.id) return;
        try { sessionStorage.setItem(approvedAdminSessionKey, session.user.id); } catch (error) { /* Storage can be disabled. */ }
    }

    // Approval flow verifies website permission before unlocking the page and loading its scripts.
    async function resumeApprovedSession(session) {
        if (!hasApprovedSessionHint(session)) {
            if (preflightResume) lockPage();
            return false;
        }
        currentSession = session;
        try {
            const { data: accessStatus, error: accessError } = await client.rpc('get_website_access_status');
            if (currentSession?.user?.id !== session.user.id) return false;
            if (accessError) throw accessError;
            if (accessStatus !== 'approved') {
                clearApprovedSessionHint();
                clearApprovedAdminSessionHint();
                lockPage();
                return false;
            }
            rememberApprovedSession(session);
            if (needsAdmin) {
                const { data, error } = await client.rpc('get_cart_admin_profile');
                if (currentSession?.user?.id !== session.user.id) return false;
                if (error || !Array.isArray(data) || !data.length) {
                    clearApprovedAdminSessionHint();
                    lockPage();
                    return false;
                }
                rememberApprovedAdminSession(session);
            }
        } catch (error) {
            lockPage();
            setMode('error', error.message || 'Could not check your request. Reload to try again.');
            return true;
        }
        form.hidden = true;
        signOutButton.hidden = false;
        root.hidden = true;
        try {
            const loaded = await loadAppScripts(session.user.id, true);
            if (!loaded) return false;
            return true;
        } catch (error) {
            lockPage();
            setMode('error', error.message);
            return true;
        }
    }

    async function grantAccess(approvedUserId = currentSession?.user?.id) {
        if (pageUnlocked) return;
        if (needsAdmin) {
            const { data: adminProfile, error: adminError } = await client.rpc('get_cart_admin_profile');
            if (currentSession?.user?.id !== approvedUserId) return;
            if (adminError || !Array.isArray(adminProfile) || !adminProfile.length) {
                clearApprovedAdminSessionHint();
                title.textContent = 'Administrator access required';
                copy.textContent = 'This page is only available to website administrators.';
                form.hidden = true;
                setStatus('Returning to the landing page…');
                window.setTimeout(() => window.location.replace('index.html'), 1500);
                return;
            }
            rememberApprovedAdminSession(currentSession);
        }
        title.textContent = 'You’ve been approved';
        copy.textContent = 'Welcome. Opening the website now…';
        form.hidden = true;
        signOutButton.hidden = true;
        setStatus('');
        root.dataset.mode = 'approved';
        root.classList.add('is-approved');
        try {
            await loadAppScripts(approvedUserId);
        } catch (error) {
            setMode('error', error.message);
        }
    }

    // Startup/auth lifecycle: request access when needed and respond to sign-in, sign-out, and token changes.
    async function checkAccess() {
        if (!client || !currentSession) return;
        if (checking) {
            accessCheckPending = true;
            return;
        }
        checking = true;
        accessCheckPending = false;
        const userId = currentSession.user?.id;
        const checkedSessionVersion = sessionVersion;
        const isCurrentSession = () => checkedSessionVersion === sessionVersion && currentSession?.user?.id === userId;
        try {
            const { data, error } = await client.rpc('get_website_access_status');
            if (!isCurrentSession()) {
                accessCheckPending = true;
                return;
            }
            if (error) throw error;
            if (data === 'approved') {
                rememberApprovedSession(currentSession);
                if (pollTimer) window.clearInterval(pollTimer);
                pollTimer = null;
                await grantAccess(userId);
                if (pageUnlocked && !pollTimer) pollTimer = window.setInterval(() => { void checkAccess(); }, 30000);
            } else if (data === 'pending') {
                clearApprovedSessionHint();
                clearApprovedAdminSessionHint();
                if (pageUnlocked || preflightResume) lockPage();
                setMode('pending');
                if (!pollTimer) pollTimer = window.setInterval(() => { void checkAccess(); }, 8000);
            } else if (data === 'denied') {
                clearApprovedSessionHint();
                clearApprovedAdminSessionHint();
                if (pageUnlocked || preflightResume) lockPage();
                if (pollTimer) window.clearInterval(pollTimer);
                pollTimer = null;
                setMode('denied');
            } else if (data === 'not_requested') {
                clearApprovedSessionHint();
                clearApprovedAdminSessionHint();
                if (pageUnlocked || preflightResume) lockPage();
                setMode('verifying', 'Submitting your request for administrator review…');
                const { data: requestStatus, error: requestError } = await client.rpc('submit_website_access_request');
                if (!isCurrentSession()) {
                    accessCheckPending = true;
                    return;
                }
                if (requestError) throw requestError;
                if (requestStatus === 'approved') await grantAccess(userId);
                else {
                    setMode(requestStatus === 'denied' ? 'denied' : 'pending');
                    if (requestStatus === 'pending' && !pollTimer) pollTimer = window.setInterval(() => { void checkAccess(); }, 8000);
                }
            } else if (data === 'unverified') {
                clearApprovedSessionHint();
                clearApprovedAdminSessionHint();
                if (pageUnlocked || preflightResume) lockPage();
                setMode('signed-out', 'This account needs a current administrator-issued number to verify and enter.');
            } else if (data === 'signed_out') {
                clearApprovedSessionHint();
                clearApprovedAdminSessionHint();
                currentSession = null;
                if (pollTimer) window.clearInterval(pollTimer);
                pollTimer = null;
                lockPage();
                setMode('signed-out', 'Your sign-in session ended. Enter your email and the number from an administrator.');
            } else {
                if (pageUnlocked || preflightResume) lockPage();
                setMode('error', 'The access service returned an unexpected status. Reload to try again.');
            }
        } catch (error) {
            if (!isCurrentSession()) {
                accessCheckPending = true;
                return;
            }
            if (pageUnlocked || preflightResume) lockPage();
            setMode('error', error.message || 'Could not check your request. Reload to try again.');
        } finally {
            checking = false;
            if (accessCheckPending && currentSession) {
                accessCheckPending = false;
                window.setTimeout(() => { void checkAccess(); }, 0);
            }
        }
    }

    if (!config.url || !apiKey || !window.supabase?.createClient) {
        lockPage();
        setMode('error', 'The Supabase connection is unavailable.');
        return;
    }

    client = window.supabase.createClient(config.url, apiKey, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = emailInput.value.trim().toLowerCase();
        const code = codeInput.value.trim();
        if (!email) return emailInput.reportValidity();
        if (!/^\d{8}$/.test(code)) return codeInput.reportValidity();
        submitButton.disabled = true;
        setMode('verifying', 'Checking your access number…');
        try {
            const { data, error } = await client.functions.invoke('website-access-codes', {
                body: { action: 'redeem', email, code }
            });
            if (error) throw error;
            if (!data?.session?.access_token || !data?.session?.refresh_token) {
                throw new Error('The access service returned an incomplete sign-in session.');
            }
            const { error: sessionError } = await client.auth.setSession(data.session);
            if (sessionError) throw sessionError;
            codeInput.value = '';
            setMode('verifying', 'Access number accepted. Opening the website…');
        } catch (error) {
            let detail = error.message || 'Could not verify this access number.';
            try {
                const response = error.context instanceof Response ? error.context.clone() : null;
                const body = response ? await response.json() : null;
                if (typeof body?.error === 'string') detail = body.error;
            } catch (readError) {
                // Use the general function error if its response body is unavailable.
            }
            if (currentSession) setMode('pending', detail);
            else setMode('signed-out', detail);
            setStatus(detail, true);
        } finally {
            submitButton.disabled = false;
        }
    });

    signOutButton.addEventListener('click', async () => {
        const { error } = await client.auth.signOut();
        if (error) setStatus('Could not sign out. Reload the page and try again.', true);
    });

    client.auth.onAuthStateChange((_event, session) => {
        authEventSeen = true;
        sessionVersion += 1;
        const previousUserId = currentSession?.user?.id;
        currentSession = session || null;
        if (!currentSession) {
            accessCheckPending = false;
            clearApprovedSessionHint();
            clearApprovedAdminSessionHint();
            if (pollTimer) window.clearInterval(pollTimer);
            pollTimer = null;
            lockPage();
            setMode('signed-out');
        } else {
            if (hasApprovedSessionHint(currentSession)) {
                void resumeApprovedSession(currentSession).then((resumed) => { if (!resumed) void checkAccess(); });
            } else if (pageUnlocked && previousUserId === currentSession.user?.id) {
                void checkAccess();
            } else {
                lockPage();
                setMode('verifying');
                window.setTimeout(() => { void checkAccess(); }, 0);
            }
        }
    });

    client.auth.getSession().then(({ data, error }) => {
        if (authEventSeen) return;
        if (error) {
            lockPage();
            setMode('error', error.message);
            return;
        }
        currentSession = data.session || null;
        if (currentSession) {
            if (hasApprovedSessionHint(currentSession)) {
                void resumeApprovedSession(currentSession).then((resumed) => { if (!resumed) void checkAccess(); });
            } else {
                lockPage();
                setMode('verifying');
                void checkAccess();
            }
        } else {
            lockPage();
            setMode('signed-out');
        }
    });
})();
