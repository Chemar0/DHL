const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
const inventoryStore = window.FastenerInventory;
const inventory = JSON.parse(JSON.stringify(inventoryStore.defaults));
const minimums = {};

try {
    const savedInventory = JSON.parse(localStorage.getItem(inventoryStore.storageKey) || 'null');
    if (savedInventory && typeof savedInventory === 'object' && !Array.isArray(savedInventory)) {
        tabs.forEach((tab) => {
            const category = tab.textContent.trim();
            if (Array.isArray(savedInventory[category])) {
                inventory[category] = savedInventory[category].filter((item) => typeof item === 'string' && item.trim());
            }
        });
    }
} catch (error) {
    // Use the built-in list if browser storage is unavailable or invalid.
}

try {
    const savedMinimums = JSON.parse(localStorage.getItem(inventoryStore.minimumsKey) || 'null');
    if (savedMinimums && typeof savedMinimums === 'object' && !Array.isArray(savedMinimums)) {
        Object.entries(savedMinimums).forEach(([category, values]) => {
            if (!values || typeof values !== 'object' || Array.isArray(values)) return;
            minimums[category] = {};
            Object.entries(values).forEach(([name, value]) => {
                if (Number.isInteger(value) && value >= 1) minimums[category][name] = value;
            });
        });
    }
} catch (error) {
    // Default each item's minimum order quantity to 1 when storage is unavailable.
}

panels.forEach((panel) => {
    const tab = document.getElementById(panel.getAttribute('aria-labelledby'));
    const category = tab.textContent.trim();
    const itemBox = panel.querySelector('.inner-box');
    itemBox.replaceChildren();
    if (inventory[category].length === 0) {
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = 'No items in this tab yet. Add items from the admin page.';
        itemBox.append(hint);
    } else {
        inventory[category].forEach((name) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'item';
            button.textContent = name;
            itemBox.append(button);
        });
    }
});

document.querySelector('.admin-entry').addEventListener('click', () => {
    window.location.href = 'admin.html';
});

function selectTab(tab, moveFocus = false) {
    const panelId = tab.getAttribute('aria-controls');

    tabs.forEach((item) => {
        const selected = item === tab;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
    });

    panels.forEach((panel) => {
        panel.hidden = panel.id !== panelId;
    });

    if (moveFocus) tab.focus();
}

tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (event) => {
        let nextIndex = index;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;
        else return;

        event.preventDefault();
        selectTab(tabs[nextIndex], true);
    });
});

const cartToggle = document.getElementById('cart-toggle');
const cartPanel = document.getElementById('cart-panel');
const cartBackdrop = document.getElementById('cart-backdrop');
const cartClose = document.getElementById('cart-close');
const cartCount = document.getElementById('cart-count');
const cartItems = document.getElementById('cart-items');
const cartEmpty = document.getElementById('cart-empty');
const emailCart = document.getElementById('email-cart');
const clearCartButton = document.getElementById('clear-cart');
const emailConfirm = document.getElementById('email-confirm');
const emailYes = document.getElementById('email-yes');
const emailNo = document.getElementById('email-no');
const quantityDialog = document.getElementById('quantity-dialog');
const quantityForm = document.getElementById('quantity-form');
const quantityInput = document.getElementById('requested-quantity');
const quantityItemName = document.getElementById('quantity-item-name');
const quantityCancel = document.getElementById('quantity-cancel');
const cart = new Map();
let pendingEmailUrl = '';
let pendingCartItem = null;
const cartStorageKey = 'fastener-list-cart';

// Restore the last saved cart when this page is reopened in the same browser.
try {
    const savedCart = JSON.parse(localStorage.getItem(cartStorageKey) || '[]');
    if (Array.isArray(savedCart)) {
        savedCart.forEach(([category, entries]) => {
            if (typeof category !== 'string' || !Array.isArray(entries)) return;
            const items = new Map(entries.filter(([name, quantity]) =>
                typeof name === 'string' && Number.isInteger(quantity) && quantity > 0));
            if (items.size) cart.set(category, items);
        });
    }
} catch (error) {
    // If browser storage is unavailable or malformed, keep using an in-memory cart.
}

function renderCart() {
    cartItems.replaceChildren();
    let total = 0;

    cart.forEach((items, category) => {
        const heading = document.createElement('li');
        heading.className = 'cart-category';
        heading.textContent = category;
        cartItems.append(heading);

        items.forEach((quantity, name) => {
            total += quantity;
            const row = document.createElement('li');
            const itemName = document.createElement('span');
            const itemQuantity = document.createElement('span');
            const controls = document.createElement('div');
            const decrease = document.createElement('button');
            const increase = document.createElement('button');
            itemName.className = 'cart-item-name';
            itemName.textContent = name;
            itemQuantity.className = 'cart-item-quantity';
            itemQuantity.textContent = String(quantity);
            itemQuantity.setAttribute('aria-label', `Quantity: ${quantity}`);
            controls.className = 'quantity-controls';
            decrease.type = 'button';
            decrease.className = 'quantity-button';
            decrease.textContent = '−';
            decrease.setAttribute('aria-label', `Remove one ${name}`);
            increase.type = 'button';
            increase.className = 'quantity-button';
            increase.textContent = '+';
            increase.setAttribute('aria-label', `Add one ${name}`);
            decrease.addEventListener('click', () => {
                const nextQuantity = (items.get(name) || 0) - 1;
                if (nextQuantity <= 0) items.delete(name);
                else items.set(name, nextQuantity);
                if (items.size === 0) cart.delete(category);
                renderCart();
            });
            increase.addEventListener('click', () => {
                items.set(name, (items.get(name) || 0) + 1);
                renderCart();
            });
            controls.append(decrease, itemQuantity, increase);
            row.append(itemName, controls);
            cartItems.append(row);
        });
    });

    cartCount.textContent = String(total);
    cartEmpty.hidden = total > 0;
    emailCart.disabled = total === 0;
    try {
        localStorage.setItem(cartStorageKey, JSON.stringify(
            Array.from(cart, ([category, items]) => [category, Array.from(items)])
        ));
    } catch (error) {
        // The cart still works for this page session if browser storage is unavailable.
    }
}

clearCartButton.addEventListener('click', () => {
    cart.clear();
    renderCart();
});

// Opens a new draft in the visitor's configured email app; it does not send automatically.
emailCart.addEventListener('click', () => {
    if (cart.size === 0) return;

    const lines = [];
    cart.forEach((items, category) => {
        lines.push(`${category}:`);
        items.forEach((quantity, name) => {
            const minimumQuantity = minimums[category]?.[name] || 1;
            const orderQuantity = minimumQuantity * quantity;
            lines.push(`  ${name} — quantity: ${orderQuantity}`);
        });
        lines.push('');
    });
    const subject = 'Fastener parts request';
    const body = `Hello,\n\nPlease could I have the following parts:\n\n${lines.join('\n')}\nThank you.`;
    pendingEmailUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    emailConfirm.showModal();
});

emailYes.addEventListener('click', () => {
    emailConfirm.close();
    if (!pendingEmailUrl) return;
    window.location.href = pendingEmailUrl;
    pendingEmailUrl = '';
});

emailNo.addEventListener('click', () => {
    pendingEmailUrl = '';
    emailConfirm.close();
});

// Delegation also supports .item buttons added to a tab after this script loads.
document.querySelector('.box').addEventListener('click', (event) => {
    const button = event.target.closest('button.item');
    if (!button) return;

    const panel = button.closest('[role="tabpanel"]');
    const categoryTab = panel && document.getElementById(panel.getAttribute('aria-labelledby'));
    const category = categoryTab ? categoryTab.textContent.trim() : 'Other parts';
    const name = button.textContent.trim();
    pendingCartItem = { category, name };
    quantityItemName.textContent = `${category} — ${name}`;
    quantityInput.value = '1';
    quantityDialog.showModal();
    quantityInput.focus();
});

quantityForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const quantity = Number(quantityInput.value);
    if (!pendingCartItem || !Number.isInteger(quantity) || quantity < 1) {
        quantityInput.reportValidity();
        return;
    }

    const { category, name } = pendingCartItem;
    if (!cart.has(category)) cart.set(category, new Map());
    const items = cart.get(category);
    items.set(name, (items.get(name) || 0) + quantity);
    pendingCartItem = null;
    quantityDialog.close();
    renderCart();
});

quantityCancel.addEventListener('click', () => {
    pendingCartItem = null;
    quantityDialog.close();
});

quantityDialog.addEventListener('close', () => {
    pendingCartItem = null;
});

function setCartOpen(open) {
    cartPanel.classList.toggle('open', open);
    cartPanel.setAttribute('aria-hidden', String(!open));
    cartPanel.inert = !open;
    cartToggle.setAttribute('aria-expanded', String(open));
    cartBackdrop.hidden = !open;
    document.body.classList.toggle('cart-open', open);
    if (open) cartClose.focus();
    else cartToggle.focus();
}

cartToggle.addEventListener('click', () => setCartOpen(true));
cartClose.addEventListener('click', () => setCartOpen(false));
cartBackdrop.addEventListener('click', () => setCartOpen(false));
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !cartPanel.inert) setCartOpen(false);
});

renderCart();
