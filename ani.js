const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
const inventoryStore = window.FastenerInventory;
const inventory = JSON.parse(JSON.stringify(inventoryStore.defaults));
const minimums = {};
const notes = {};

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

try {
    const savedNotes = JSON.parse(localStorage.getItem(inventoryStore.notesKey) || 'null');
    if (savedNotes && typeof savedNotes === 'object' && !Array.isArray(savedNotes)) {
        Object.entries(savedNotes).forEach(([category, values]) => {
            if (!values || typeof values !== 'object' || Array.isArray(values)) return;
            notes[category] = {};
            Object.entries(values).forEach(([name, note]) => {
                if (typeof note === 'string' && note.trim()) notes[category][name] = note.trim();
            });
        });
    }
} catch (error) {
    // Notes are optional when browser storage is unavailable or malformed.
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
const cartActivityList = document.getElementById('cart-activity-list');
const cartEmpty = document.getElementById('cart-empty');
const emailCart = document.getElementById('email-cart');
const clearCartButton = document.getElementById('clear-cart');
const cartSyncStatus = document.getElementById('cart-sync-status');
const emailConfirm = document.getElementById('email-confirm');
const emailYes = document.getElementById('email-yes');
const emailNo = document.getElementById('email-no');
const quantityDialog = document.getElementById('quantity-dialog');
const quantityForm = document.getElementById('quantity-form');
const quantityInput = document.getElementById('requested-quantity');
const quantityItemName = document.getElementById('quantity-item-name');
const quantityCancel = document.getElementById('quantity-cancel');
const cart = new Map();
const cartAttribution = new Map();
let recentCartActivity = [];
let pendingEmailUrl = '';
let pendingCartItem = null;
const cartStorageKey = 'fastener-list-cart';
const cartAttributionStorageKey = cartStorageKey + '-attribution';
const cartActivityStorageKey = cartStorageKey + '-activity';
const supabaseConfig = window.SUPABASE_CONFIG || {};
const publicApiKey = supabaseConfig.publishableKey || supabaseConfig.anonKey || '';
const sharedCartEnabled = Boolean(
    typeof supabaseConfig.url === 'string' && supabaseConfig.url.trim() &&
    typeof publicApiKey === 'string' && publicApiKey.trim()
);

function updateCartSyncStatus(message, isError = false) {
    if (!cartSyncStatus) return;
    cartSyncStatus.textContent = message;
    cartSyncStatus.classList.toggle('error', isError);
}

async function callSharedCartRpc(functionName, payload = {}) {
    if (!sharedCartEnabled) throw new Error('Shared cart is not configured.');
    const baseUrl = supabaseConfig.url.trim().replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/rest/v1/rpc/${functionName}`, {
        method: 'POST',
        headers: {
            apikey: publicApiKey.trim(),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Supabase request failed (${response.status}).`);
    }
    const responseText = await response.text();
    return responseText ? JSON.parse(responseText) : null;
}

function loadLocalCart() {
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

        const savedAttribution = JSON.parse(localStorage.getItem(cartAttributionStorageKey) || '[]');
        if (Array.isArray(savedAttribution)) {
            savedAttribution.forEach(([category, entries]) => {
                if (typeof category !== 'string' || !Array.isArray(entries)) return;
                entries.forEach(([name, details]) => {
                    if (typeof name === 'string' && details && typeof details === 'object') {
                        setCartAttribution(category, name, details);
                    }
                });
            });
        }

        const savedActivity = JSON.parse(localStorage.getItem(cartActivityStorageKey) || '[]');
        if (Array.isArray(savedActivity)) recentCartActivity = savedActivity.slice(0, 12);
    } catch (error) {
        // Keep an in-memory cart if browser storage is unavailable or malformed.
    }
}

async function refreshSharedCart() {
    if (!sharedCartEnabled) return;
    try {
        const rows = await callSharedCartRpc('get_shared_cart');
        const activity = await callSharedCartRpc('get_shared_cart_activity');
        cart.clear();
        cartAttribution.clear();
        if (Array.isArray(rows)) {
            rows.forEach(({ category, item_name: name, quantity, added_by: addedBy, last_updated_by: updatedBy }) => {
                if (typeof category !== 'string' || typeof name !== 'string' ||
                    !Number.isInteger(quantity) || quantity < 1) return;
                if (!cart.has(category)) cart.set(category, new Map());
                cart.get(category).set(name, quantity);
                setCartAttribution(category, name, {
                    added_by: typeof addedBy === 'string' && addedBy.trim() ? addedBy : 'Unknown device',
                    last_updated_by: typeof updatedBy === 'string' && updatedBy.trim() ? updatedBy : 'Unknown device'
                });
            });
        }
        recentCartActivity = Array.isArray(activity) ? activity.slice(0, 12) : [];
        renderCart();
        updateCartSyncStatus('Shared cart is up to date.');
    } catch (error) {
        updateCartSyncStatus('Could not sync the shared cart. Run the updated Supabase setup SQL and check the connection.', true);
    }
}

function applyLocalCartChange(category, name, delta, actorName) {
    if (!cart.has(category)) cart.set(category, new Map());
    const items = cart.get(category);
    const previousQuantity = items.get(name) || 0;
    const nextQuantity = previousQuantity + delta;
    if (nextQuantity <= 0) {
        items.delete(name);
        cartAttribution.get(category)?.delete(name);
    } else {
        items.set(name, nextQuantity);
        const previousDetails = cartAttribution.get(category)?.get(name) || {};
        setCartAttribution(category, name, {
            added_by: previousDetails.added_by || (previousQuantity === 0 ? actorName : 'Unknown device'),
            last_updated_by: actorName
        });
    }
    if (items.size === 0) cart.delete(category);
    return { previousQuantity, nextQuantity: Math.max(0, nextQuantity) };
}

async function updateCartItem(category, name, delta) {
    const actorName = window.CartUser.getName();
    if (!actorName) {
        window.CartUser.promptForName();
        return;
    }
    if (!sharedCartEnabled) {
        const change = applyLocalCartChange(category, name, delta, actorName);
        const action = delta > 0 ? 'item_added' :
            change.nextQuantity === 0 ? 'item_removed' : 'quantity_reduced';
        recordCartActivity(action, category, name, delta, change.nextQuantity, actorName);
        renderCart();
        return;
    }
    updateCartSyncStatus('Saving shared cart…');
    try {
        await callSharedCartRpc('adjust_shared_cart_item', {
            p_category: category,
            p_item_name: name,
            p_delta: delta,
            p_actor_name: actorName
        });
        await refreshSharedCart();
    } catch (error) {
        updateCartSyncStatus('Could not save the change. Run the updated Supabase setup SQL and check the connection.', true);
    }
}

function setCartAttribution(category, name, details) {
    if (!cartAttribution.has(category)) cartAttribution.set(category, new Map());
    cartAttribution.get(category).set(name, details);
}

function recordCartActivity(action, category, itemName, delta, quantityAfter, actorName) {
    recentCartActivity.unshift({
        action,
        category,
        item_name: itemName,
        quantity_delta: delta,
        quantity_after: quantityAfter,
        actor_name: actorName,
        created_at: new Date().toISOString()
    });
    recentCartActivity = recentCartActivity.slice(0, 12);
}

function describeCartActivity(entry) {
    const actor = entry.actor_name || 'Unknown device';
    const item = entry.item_name || 'item';
    const category = entry.category ? ' (' + entry.category + ')' : '';
    const amount = Math.abs(Number(entry.quantity_delta) || 0);
    if (entry.action === 'item_added') return actor + ' added ' + amount + ' × ' + item + category;
    if (entry.action === 'quantity_reduced') return actor + ' reduced ' + item + category + ' by ' + amount;
    if (entry.action === 'item_removed') return actor + ' removed ' + item + category;
    if (entry.action === 'cart_cleared') return actor + ' cleared the cart';
    return actor + ' changed the cart';
}

function renderCartActivity() {
    cartActivityList.replaceChildren();
    if (recentCartActivity.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'activity-empty';
        empty.textContent = 'No cart changes yet.';
        cartActivityList.append(empty);
        return;
    }

    recentCartActivity.slice(0, 12).forEach((entry) => {
        const row = document.createElement('li');
        const message = document.createElement('span');
        const time = document.createElement('time');
        const timestamp = new Date(entry.created_at);
        message.textContent = describeCartActivity(entry);
        if (!Number.isNaN(timestamp.valueOf())) {
            time.dateTime = timestamp.toISOString();
            time.textContent = timestamp.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
        }
        row.append(message, time);
        cartActivityList.append(row);
    });
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
            const itemDetails = document.createElement('div');
            const itemName = document.createElement('span');
            const attribution = document.createElement('span');
            const itemQuantity = document.createElement('span');
            const controls = document.createElement('div');
            const decrease = document.createElement('button');
            const increase = document.createElement('button');
            itemDetails.className = 'cart-item-details';
            itemName.className = 'cart-item-name';
            itemName.textContent = name;
            attribution.className = 'cart-item-attribution';
            const details = cartAttribution.get(category)?.get(name);
            if (!details) attribution.textContent = 'Attribution unavailable';
            else if (details.added_by === details.last_updated_by) {
                attribution.textContent = 'Added by ' + details.added_by;
            } else {
                attribution.textContent = 'Added by ' + details.added_by + ' · last changed by ' + details.last_updated_by;
            }
            itemDetails.append(itemName, attribution);
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
            decrease.addEventListener('click', () => updateCartItem(category, name, -1));
            increase.addEventListener('click', () => updateCartItem(category, name, 1));
            controls.append(decrease, itemQuantity, increase);
            row.append(itemDetails, controls);
            cartItems.append(row);
        });
    });

    cartCount.textContent = String(total);
    cartEmpty.hidden = total > 0;
    emailCart.disabled = total === 0;
    if (!sharedCartEnabled) {
        try {
            localStorage.setItem(cartStorageKey, JSON.stringify(
                Array.from(cart, ([category, items]) => [category, Array.from(items)])
            ));
            localStorage.setItem(cartAttributionStorageKey, JSON.stringify(
                Array.from(cartAttribution, ([category, items]) => [category, Array.from(items)])
            ));
            localStorage.setItem(cartActivityStorageKey, JSON.stringify(recentCartActivity));
        } catch (error) {
            // The cart still works for this page session if browser storage is unavailable.
        }
    }
    renderCartActivity();
}

async function clearSharedCart() {
    try {
        await callSharedCartRpc('clear_shared_cart', { p_actor_name: window.CartUser.getName() });
    } catch (clearError) {
        // Older Supabase deployments may not have the clear RPC in their schema cache.
        const rows = await callSharedCartRpc('get_shared_cart');
        if (!Array.isArray(rows)) throw clearError;
        for (const row of rows) {
            if (typeof row.category !== 'string' || typeof row.item_name !== 'string' ||
                !Number.isInteger(row.quantity) || row.quantity < 1) continue;
            await callSharedCartRpc('adjust_shared_cart_item', {
                p_category: row.category,
                p_item_name: row.item_name,
                p_delta: -row.quantity,
                p_actor_name: window.CartUser.getName()
            });
        }
    }
    await refreshSharedCart();
}

clearCartButton.addEventListener('click', async () => {
    if (!sharedCartEnabled) {
        if (cart.size > 0) recordCartActivity('cart_cleared', '', '', 0, 0, window.CartUser.getName());
        cart.clear();
        cartAttribution.clear();
        renderCart();
        return;
    }
    updateCartSyncStatus('Clearing shared cart…');
    try {
        await clearSharedCart();
    } catch (error) {
        console.error('Could not clear the shared cart:', error);
        updateCartSyncStatus('Could not clear the shared cart. Check the Supabase setup and connection.', true);
    }
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
            const note = notes[category]?.[name];
            lines.push(`  ${name}${note ? ` (${note})` : ''} — quantity: ${orderQuantity}`);
        });
        lines.push('');
    });
    const subject = 'Fastener parts request';
    const body = `Hello,\\n\\nPlease, could I have the following parts:\\n\\n${lines.join('\\n')}\\nThank you.`;
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
    pendingCartItem = null;
    quantityDialog.close();
    updateCartItem(category, name, quantity);
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

if (sharedCartEnabled) {
    updateCartSyncStatus('Connecting to shared cart…');
    refreshSharedCart();
    window.setInterval(() => {
        if (document.visibilityState === 'visible') refreshSharedCart();
    }, 4000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshSharedCart();
    });
} else {
    loadLocalCart();
    renderCart();
    updateCartSyncStatus('Cart is saved only on this device until Supabase is configured.');
}
