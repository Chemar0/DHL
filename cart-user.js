(() => {
    const storageKey = 'dhl-cart-user-name';
    const dialog = document.getElementById('cart-user-dialog');
    const form = document.getElementById('cart-user-form');
    const input = document.getElementById('cart-user-input');
    const nameOutput = document.getElementById('cart-user-name');
    const changeButton = document.getElementById('change-cart-user');
    let currentName = '';
    let adminName = '';
    let adminAccess = false;

    try {
        currentName = (localStorage.getItem(storageKey) || '').trim();
    } catch (error) {
        // Keep the name in memory if browser storage is unavailable.
    }

    function showName() {
        nameOutput.textContent = adminAccess && adminName ? adminName : currentName;
        changeButton.hidden = !adminAccess;
    }

    function saveNameLocally(name) {
        currentName = name;
        try {
            localStorage.setItem(storageKey, currentName);
        } catch (error) {
            // The current page can still use the name for this session.
        }
        showName();
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
            try {
                await window.CartAdmin.setName(name);
            } catch (error) {
                window.CartAdmin.setStatus(error.message || 'Could not save the administrator name.', true);
                return;
            }
        } else {
            saveNameLocally(name);
        }

        dialog.close();
    });

    changeButton.addEventListener('click', () => {
        if (window.CartAdmin?.isAdmin()) promptForName();
    });
    dialog.addEventListener('cancel', (event) => {
        if (!currentName) event.preventDefault();
    });

    if (currentName) showName();
    else promptForName();

    window.CartUser = {
        getName: () => adminAccess && adminName ? adminName : currentName,
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
        promptForName
    };
})();
