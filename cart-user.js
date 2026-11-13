(() => {
    const storageKey = 'dhl-cart-user-name';
    const dialog = document.getElementById('cart-user-dialog');
    const form = document.getElementById('cart-user-form');
    const input = document.getElementById('cart-user-input');
    const nameOutput = document.getElementById('cart-user-name');
    const changeButton = document.getElementById('change-cart-user');
    let currentName = '';

    try {
        currentName = (localStorage.getItem(storageKey) || '').trim();
    } catch (error) {
        // Keep the name in memory if browser storage is unavailable.
    }

    function showName() {
        nameOutput.textContent = currentName;
        changeButton.hidden = false;
    }

    function promptForName() {
        input.value = currentName;
        if (!dialog.open) dialog.showModal();
        input.focus();
    }

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const name = input.value.trim().replace(/\s+/g, ' ').slice(0, 80);
        if (!name) {
            input.reportValidity();
            return;
        }

        currentName = name;
        try {
            localStorage.setItem(storageKey, currentName);
        } catch (error) {
            // The current page can still use the name for this session.
        }
        showName();
        dialog.close();
    });

    changeButton.addEventListener('click', promptForName);
    dialog.addEventListener('cancel', (event) => {
        if (!currentName) event.preventDefault();
    });

    if (currentName) showName();
    else promptForName();

    window.CartUser = {
        getName: () => currentName,
        promptForName
    };
})();
