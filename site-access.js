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
    let client = null;
    let currentSession = null;
    let pollTimer = null;
    let checking = false;
    let appStarted = false;
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

    async function loadAppScripts() {
        if (!appStarted) {
            appStarted = true;
            for (const name of scriptNames) {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = name;
                    script.onload = resolve;
                    script.onerror = () => reject(new Error(`Could not load ${name}.`));
                    document.body.append(script);
                });
            }
        }
        pageUnlocked = true;
        document.body.classList.add('site-content-enter');
        window.setTimeout(() => {
            document.documentElement.classList.remove('site-access-locked');
            root.classList.add('is-leaving');
            window.setTimeout(() => { root.hidden = true; }, 650);
        }, 850);
        if (!pollTimer) pollTimer = window.setInterval(() => { void checkAccess(); }, 30000);
    }

    async function grantAccess() {
        if (pageUnlocked) return;
        if (needsAdmin) {
            const { data: adminProfile, error: adminError } = await client.rpc('get_cart_admin_profile');
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
            await loadAppScripts();
        } catch (error) {
            appStarted = false;
            setMode('error', error.message);
        }
    }

    async function checkAccess() {
        if (!client || checking || !currentSession) return;
        checking = true;
        try {
            const { data, error } = await client.rpc('get_website_access_status');
            if (error) throw error;
            if (data === 'approved') {
                if (pollTimer) window.clearInterval(pollTimer);
                pollTimer = null;
                await grantAccess();
                if (pageUnlocked && !pollTimer) pollTimer = window.setInterval(() => { void checkAccess(); }, 30000);
            } else if (data === 'pending') {
                if (pageUnlocked) {
                    pageUnlocked = false;
                    root.hidden = false;
                    root.classList.remove('is-leaving', 'is-approved');
                    document.documentElement.classList.add('site-access-locked');
                }
                setMode('pending');
                if (!pollTimer) pollTimer = window.setInterval(() => { void checkAccess(); }, 8000);
            } else if (data === 'denied') {
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
                if (pageUnlocked) {
                    pageUnlocked = false;
                    root.hidden = false;
                    root.classList.remove('is-leaving', 'is-approved');
                    document.documentElement.classList.add('site-access-locked');
                }
                setMode('verifying', 'Submitting your request for administrator review…');
                const { data: requestStatus, error: requestError } = await client.rpc('submit_website_access_request');
                if (requestError) throw requestError;
                if (requestStatus === 'approved') await grantAccess();
                else {
                    setMode(requestStatus === 'denied' ? 'denied' : 'pending');
                    if (requestStatus === 'pending' && !pollTimer) pollTimer = window.setInterval(() => { void checkAccess(); }, 8000);
                }
            } else if (data === 'unverified') {
                if (pageUnlocked) {
                    pageUnlocked = false;
                    root.hidden = false;
                    root.classList.remove('is-leaving', 'is-approved');
                    document.documentElement.classList.add('site-access-locked');
                }
                setMode('signed-out', 'Verify your email using the link we sent, then return here.');
            } else {
                setMode('error', 'The access service returned an unexpected status. Reload to try again.');
            }
        } catch (error) {
            setMode('error', error.message || 'Could not check your request. Reload to try again.');
        } finally {
            checking = false;
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
        currentSession = session || null;
        if (!currentSession) {
            if (pollTimer) window.clearInterval(pollTimer);
            pollTimer = null;
            pageUnlocked = false;
            root.hidden = false;
            root.classList.remove('is-leaving', 'is-approved');
            document.documentElement.classList.add('site-access-locked');
            setMode('signed-out');
        } else {
            root.hidden = false;
            root.classList.remove('is-leaving');
            document.documentElement.classList.add('site-access-locked');
            setMode('verifying');
            window.setTimeout(() => { void checkAccess(); }, 0);
        }
    });

    client.auth.getSession().then(({ data, error }) => {
        if (error) {
            setMode('error', error.message);
            return;
        }
        currentSession = data.session || null;
        if (currentSession) {
            setMode('verifying');
            void checkAccess();
        } else {
            setMode('signed-out');
        }
    });
})();
