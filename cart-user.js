// File purpose: Collects and remembers a visitor-provided cart display name and browser ID, then notifies cart scripts when identity state changes.

(() => {
    const storageKey = 'dhl-cart-user-name';
    const deviceStorageKey = 'dhl-cart-device-id';
    const dialog = document.getElementById('cart-user-dialog');
    const form = document.getElementById('cart-user-form');
    const input = document.getElementById('cart-user-input');
    const nameOutput = document.getElementById('cart-user-name');
    const emailOutput = document.getElementById('cart-user-email');
    const changeButton = document.getElementById('change-cart-user');
    let currentName = '';
    let adminName = '';
    let adminAccess = false;
    let deviceId = '';

    // Browser identity and display-name state: maintain an anonymous device key plus a user-editable label.
    function createDeviceId() {
        if (window.crypto?.randomUUID) return window.crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
            const random = Math.random() * 16 | 0;
            return (character === 'x' ? random : (random & 0x3 | 0x8)).toString(16);
        });
    }

    try {
        currentName = (localStorage.getItem(storageKey) || '').trim();
        deviceId = localStorage.getItem(deviceStorageKey) || '';
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) {
            deviceId = createDeviceId();
            localStorage.setItem(deviceStorageKey, deviceId);
        }
    } catch (error) {
        // Keep this browser session working if browser storage is unavailable.
        if (!deviceId) deviceId = createDeviceId();
    }

    // Name prompt and validation: request a label when needed and let authorized admins manage it.
    function showName() {
        nameOutput.textContent = adminAccess && adminName ? adminName : currentName;
        changeButton.hidden = !adminAccess;
        if (adminAccess) changeButton.textContent = 'Manage account';
    }

    function saveNameLocally(name, nameReentered = false) {
        currentName = name;
        try {
            localStorage.setItem(storageKey, currentName);
        } catch (error) {
            // The current page can still use the name for this session.
        }
        showName();
        document.dispatchEvent(new CustomEvent('cart-user-name-changed', {
            detail: { nameReentered }
        }));
    }

    function promptForName() {
        input.value = adminAccess && adminName ? adminName : currentName;
        if (!dialog.open) dialog.showModal();
        input.focus();
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = input.value.trim().replace(/\s+/g, ' ').slice(0, 80);
        if (!name) {
            input.reportValidity();
            return;
        }

        if (currentName && !window.CartAdmin?.isAdmin()) {
            window.CartAdmin?.setStatus('Only the verified administrator can change the saved name.');
            return;
        }

        if (window.CartAdmin?.isAdmin()) {
            window.location.href = 'accounts-admin.html';
            return;
        }
        saveNameLocally(name, true);

        dialog.close();
    });

    changeButton.addEventListener('click', () => {
        if (window.CartAdmin?.isAdmin()) window.location.href = 'accounts-admin.html';
    });
    dialog.addEventListener('cancel', (event) => {
        if (!currentName) event.preventDefault();
    });

    if (currentName) showName();

    // Cross-script events and public API let the cart controller react to auth and name changes.
    document.addEventListener('cart-user-auth-ready', (event) => {
        emailOutput.textContent = event.detail?.email || '';
        if (!currentName && !adminAccess) promptForName();
    });
    document.addEventListener('cart-user-auth-signed-out', () => {
        emailOutput.textContent = '';
    });

    window.CartUser = {
        getName: () => adminAccess && adminName ? adminName : currentName,
        getDeviceId: () => deviceId,
        setAdminAccess(enabled) {
            adminAccess = Boolean(enabled);
            if (!adminAccess) adminName = '';
            showName();
        },
        setAdminName(name) {
            const cleaned = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
            if (cleaned) {
                adminName = cleaned;
                showName();
            }
        },
        setVerifiedEmail(email) {
            emailOutput.textContent = String(email || '');
        },
        promptForName,
        requireNameAgain() {
            currentName = '';
            try {
                localStorage.removeItem(storageKey);
            } catch (error) {
                // The current page still requires a fresh name for this session.
            }
            showName();
            promptForName();
        }
    };
})();
