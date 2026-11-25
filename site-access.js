(() => {
    const config = window.SUPABASE_CONFIG || {};
    const apiKey = config.publishableKey || config.anonKey || '';
    const root = document.createElement('section');
    root.className = 'site-access-overlay';
    root.setAttribute('aria-live', 'polite');
    root.innerHTML = `
        <div class="site-access-card">
            <span class="site-access-mark" aria-hidden="true">D</span>
            <h1 id="site-access-title">Request website access</h1>
            <p class="site-access-copy" id="site-access-copy">Enter your email. We’ll verify it, then an administrator can approve or deny your request.</p>
            <form class="site-access-form" id="site-access-form">
                <label for="site-access-email">Email address</label>
                <input id="site-access-email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com">
                <button type="submit" id="site-access-submit">Send verification link</button>
            </form>
            <p class="site-access-status" id="site-access-status" role="status"></p>
            <button class="site-access-secondary" id="site-access-signout" type="button" hidden>Use a different email</button>
        </div>`;
    document.body.prepend(root);

    const title = root.querySelector('#site-access-title');
    const copy = root.querySelector('#site-access-copy');
    const form = root.querySelector('#site-access-form');
    const emailInput = root.querySelector('#site-access-email');
    const submitButton = root.querySelector('#site-access-submit');
    const status = root.querySelector('#site-access-status');
    const signOutButton = root.querySelector('#site-access-signout');
    const scriptNames = (document.body.dataset.siteAccessScripts || '').split('|').filter(Boolean);
    const needsAdmin = document.body.dataset.siteAccessAdminOnly === 'true';
    const approvedSessionKey = 'dhl-approved-session-user';
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

    function setStatus(message, isError = false) {
        status.textContent = message;
        status.classList.toggle('is-error', isError);
    }

    function setMode(mode, message = '') {
        root.dataset.mode = mode;
        form.hidden = !['signed-out', 'denied'].includes(mode);
        signOutButton.hidden = !currentSession;
        if (mode === 'signed-out') {
            title.textContent = 'Request website access';
            copy.textContent = 'Enter your email. We’ll verify it, then an administrator can approve or deny your request.';
            submitButton.textContent = 'Send verification link';
            emailInput.value = currentSession?.user?.email || emailInput.value;
            setStatus(message || '');
        } else if (mode === 'verifying') {
            title.textContent = 'Checking your email';
            copy.textContent = 'Your verification is being checked securely.';
            setStatus(message || 'Please wait…');
        } else if (mode === 'pending') {
            title.textContent = 'Request sent';
            copy.textContent = 'Your email is verified. An administrator must approve your request before you can enter.';
            setStatus('We’ll check for a decision automatically. You can leave this page open.');
        } else if (mode === 'denied') {
            title.textContent = 'Access not approved';
            copy.textContent = 'An administrator denied this request. You can submit it again if you think this was a mistake.';
            submitButton.textContent = 'Request review again';
            setStatus(message || '');
        } else if (mode === 'error') {
            title.textContent = 'Could not verify access';
            copy.textContent = 'The access service could not be reached. Check your connection and try again.';
            form.hidden = true;
            setStatus(message || 'Please reload the page to retry.', true);
        }
    }

    async function loadAppScripts(authorizedUserId) {
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
        window.setTimeout(() => {
            document.documentElement.classList.remove('site-access-locked');
            root.classList.add('is-leaving');
            window.setTimeout(() => { root.hidden = true; }, 650);
        }, 850);
        if (!pollTimer) pollTimer = window.setInterval(() => { void checkAccess(); }, 30000);
        return true;
    }

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

    function rememberApprovedSession(session) {
        if (!session?.user?.id) return;
        try { sessionStorage.setItem(approvedSessionKey, session.user.id); } catch (error) { /* Storage can be disabled. */ }
    }

    async function resumeApprovedSession(session) {
        if (!hasApprovedSessionHint(session)) return false;
        currentSession = session;
        if (needsAdmin) {
            const { data, error } = await client.rpc('get_cart_admin_profile');
            if (currentSession?.user?.id !== session.user.id) return false;
            if (error || !Array.isArray(data) || !data.length) {
                clearApprovedSessionHint();
                return false;
            }
        }
        form.hidden = true;
        signOutButton.hidden = false;
        root.hidden = true;
        document.documentElement.classList.remove('site-access-locked');
        try {
            const loaded = await loadAppScripts(session.user.id);
            if (!loaded) return false;
            return true;
        } catch (error) {
            pageUnlocked = false;
            root.hidden = false;
            document.documentElement.classList.add('site-access-locked');
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
                title.textContent = 'Administrator access required';
                copy.textContent = 'This page is only available to website administrators.';
                form.hidden = true;
                setStatus('Returning to the landing page…');
                window.setTimeout(() => window.location.replace('index.html'), 1500);
                return;
            }
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
        function isCurrentSession() {
            return checkedSessionVersion === sessionVersion && currentSession?.user?.id === userId;
        }
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
                if (pageUnlocked) {
                    pageUnlocked = false;
                    root.hidden = false;
                    root.classList.remove('is-leaving', 'is-approved');
                    document.documentElement.classList.add('site-access-locked');
                }
                setMode('pending');
                if (!pollTimer) pollTimer = window.setInterval(() => { void checkAccess(); }, 8000);
            } else if (data === 'denied') {
                clearApprovedSessionHint();
                if (pageUnlocked) {
                    pageUnlocked = false;
                    root.hidden = false;
                    root.classList.remove('is-leaving', 'is-approved');
                    document.documentElement.classList.add('site-access-locked');
                }
                if (pollTimer) window.clearInterval(pollTimer);
                pollTimer = null;
                setMode('denied');
            } else if (data === 'not_requested') {
                clearApprovedSessionHint();
                if (pageUnlocked) {
                    pageUnlocked = false;
                    root.hidden = false;
                    root.classList.remove('is-leaving', 'is-approved');
                    document.documentElement.classList.add('site-access-locked');
                }
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
                if (pageUnlocked) {
                    pageUnlocked = false;
                    root.hidden = false;
                    root.classList.remove('is-leaving', 'is-approved');
                    document.documentElement.classList.add('site-access-locked');
                }
                setMode('signed-out', 'Verify your email using the link we sent, then return here.');
            } else if (data === 'signed_out') {
                clearApprovedSessionHint();
                currentSession = null;
                if (pollTimer) window.clearInterval(pollTimer);
                pollTimer = null;
                pageUnlocked = false;
                root.hidden = false;
                root.classList.remove('is-leaving', 'is-approved');
                document.documentElement.classList.add('site-access-locked');
                setMode('signed-out', 'Your sign-in session ended. Enter your email to request a new verification link.');
            } else {
                setMode('error', 'The access service returned an unexpected status. Reload to try again.');
            }
        } catch (error) {
            if (!isCurrentSession()) {
                accessCheckPending = true;
                return;
            }
            if (pageUnlocked) {
                pageUnlocked = false;
                root.hidden = false;
                root.classList.remove('is-leaving', 'is-approved');
                document.documentElement.classList.add('site-access-locked');
            }
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
        setMode('error', 'The Supabase connection is unavailable.');
        return;
    }

    client = window.supabase.createClient(config.url, apiKey, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (currentSession) {
            submitButton.disabled = true;
            setStatus('Submitting your request for administrator review…');
            try {
                const { data, error } = await client.rpc('submit_website_access_request');
                if (error) throw error;
                if (data === 'approved') await grantAccess();
                else {
                    setMode('pending');
                    if (!pollTimer) pollTimer = window.setInterval(() => { void checkAccess(); }, 8000);
                }
            } catch (error) {
                setStatus(error.message || 'Could not submit the request. Try again.', true);
            } finally {
                submitButton.disabled = false;
            }
            return;
        }
        const email = emailInput.value.trim().toLowerCase();
        if (!email) return emailInput.reportValidity();
        submitButton.disabled = true;
        setStatus('Sending a secure verification link…');
        try {
            const { error } = await client.auth.signInWithOtp({
                email,
                options: {
                    shouldCreateUser: true,
                    emailRedirectTo: window.location.href.split('#')[0]
                }
            });
            if (error) throw error;
            copy.textContent = 'Open the verification link in your email on this device. Once verified, your access request will go to the administrators.';
            setStatus('Verification link sent. Check your inbox and junk folder.');
            form.hidden = true;
        } catch (error) {
            const detail = error.code === 'over_email_send_rate_limit'
                ? 'Supabase’s built-in sender has reached its 2-email hourly project limit. Custom SMTP is needed for normal visitor access.'
                : error.code === 'email_address_not_authorized'
                    ? 'Supabase’s built-in sender only delivers to project team addresses. Custom SMTP is needed for visitor verification.'
                    : error.code === 'over_request_rate_limit' || error.status === 429
                        ? 'Too many link requests were made recently. Wait at least 60 seconds, then try again.'
                        : error.code === 'signup_disabled' || error.code === 'signups_disabled'
                            ? 'Visitor registration is disabled in Supabase Auth. An administrator must enable it.'
                    : error.message || 'Could not send the verification link. Try again later.';
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
            if (pollTimer) window.clearInterval(pollTimer);
            pollTimer = null;
            pageUnlocked = false;
            root.hidden = false;
            root.classList.remove('is-leaving', 'is-approved');
            document.documentElement.classList.add('site-access-locked');
            setMode('signed-out');
        } else {
            if (hasApprovedSessionHint(currentSession)) {
                void resumeApprovedSession(currentSession).then(() => { void checkAccess(); });
            } else if (pageUnlocked && previousUserId === currentSession.user?.id) {
                void checkAccess();
            } else {
                pageUnlocked = false;
                root.hidden = false;
                root.classList.remove('is-leaving', 'is-approved');
                document.documentElement.classList.add('site-access-locked');
                setMode('verifying');
                window.setTimeout(() => { void checkAccess(); }, 0);
            }
        }
    });

    client.auth.getSession().then(({ data, error }) => {
        if (authEventSeen) return;
        if (error) {
            setMode('error', error.message);
            return;
        }
        currentSession = data.session || null;
        if (currentSession) {
            if (hasApprovedSessionHint(currentSession)) {
                void resumeApprovedSession(currentSession).then(() => { void checkAccess(); });
            } else {
                setMode('verifying');
                void checkAccess();
            }
        } else {
            setMode('signed-out');
        }
    });
})();
