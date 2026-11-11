const store = window.FastenerInventory;
const inventory = JSON.parse(JSON.stringify(store.defaults));
const minimums = {};
const notes = {};
const categorySelect = document.getElementById('category-select');
const itemList = document.getElementById('item-list');
const addForm = document.getElementById('add-form');
const newItemInput = document.getElementById('new-item');
const status = document.getElementById('admin-status');

Object.keys(inventory).forEach((category) => { minimums[category] = {}; notes[category] = {}; });
try {
    const savedMinimums = JSON.parse(localStorage.getItem(store.minimumsKey) || 'null');
    if (savedMinimums && typeof savedMinimums === 'object' && !Array.isArray(savedMinimums)) {
        Object.keys(inventory).forEach((category) => {
            const values = savedMinimums[category];
            if (!values || typeof values !== 'object' || Array.isArray(values)) return;
            Object.entries(values).forEach(([name, value]) => {
                const quantity = Number(value);
                if (Number.isInteger(quantity) && quantity >= 1) minimums[category][name] = quantity;
            });
        });
    }
} catch (error) {
    status.textContent = 'Could not read saved minimum quantities. Each item defaults to 1.';
}

try {
    const savedNotes = JSON.parse(localStorage.getItem(store.notesKey) || 'null');
    if (savedNotes && typeof savedNotes === 'object' && !Array.isArray(savedNotes)) {
        Object.keys(inventory).forEach((category) => {
            const values = savedNotes[category];
            if (!values || typeof values !== 'object' || Array.isArray(values)) return;
            Object.entries(values).forEach(([name, note]) => {
                if (typeof note === 'string') notes[category][name] = note;
            });
        });
    }
} catch (error) {
    status.textContent = 'Could not read saved item notes.';
}

try {
    const savedInventory = JSON.parse(localStorage.getItem(store.storageKey) || 'null');
    if (savedInventory && typeof savedInventory === 'object' && !Array.isArray(savedInventory)) {
        Object.keys(inventory).forEach((category) => {
            if (Array.isArray(savedInventory[category])) {
                inventory[category] = savedInventory[category].filter((item) => typeof item === 'string' && item.trim());
            }
        });
    }
} catch (error) {
    status.textContent = 'Could not read saved changes. The default item list is shown.';
}

Object.keys(inventory).forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categorySelect.append(option);
});

function saveInventory() {
    try {
        localStorage.setItem(store.storageKey, JSON.stringify(inventory));
        status.textContent = 'Changes saved.';
    } catch (error) {
        status.textContent = 'Could not save changes in this browser.';
    }
}

function saveMinimums() {
    try {
        localStorage.setItem(store.minimumsKey, JSON.stringify(minimums));
        status.textContent = 'Minimum quantity saved.';
    } catch (error) {
        status.textContent = 'Could not save the minimum quantity in this browser.';
    }
}

function saveNotes() {
    try {
        localStorage.setItem(store.notesKey, JSON.stringify(notes));
        status.textContent = 'Item note saved.';
    } catch (error) {
        status.textContent = 'Could not save item notes in this browser.';
    }
}

function renderItems() {
    itemList.replaceChildren();
    const category = categorySelect.value;
    inventory[category].forEach((name, index) => {
        const row = document.createElement('li');
        const itemName = document.createElement('span');
        const details = document.createElement('div');
        const minimumLabel = document.createElement('label');
        const minimumInput = document.createElement('input');
        const noteLabel = document.createElement('label');
        const noteInput = document.createElement('input');
        const removeButton = document.createElement('button');
        itemName.textContent = name;
        details.className = 'item-details';
        minimumLabel.className = 'minimum-field';
        minimumLabel.append(document.createTextNode('Minimum quantity'));
        minimumInput.type = 'number';
        minimumInput.min = '1';
        minimumInput.step = '1';
        minimumInput.value = String(minimums[category][name] || 1);
        minimumInput.setAttribute('aria-label', `Minimum quantity for ${name}`);
        minimumInput.addEventListener('change', () => {
            const quantity = Number(minimumInput.value);
            if (!Number.isInteger(quantity) || quantity < 1) {
                minimumInput.value = String(minimums[category][name] || 1);
                status.textContent = 'Minimum quantity must be a whole number of at least 1.';
                return;
            }
            minimums[category][name] = quantity;
            saveMinimums();
        });
        minimumLabel.append(minimumInput);
        noteLabel.className = 'note-field';
        noteLabel.append(document.createTextNode('Notes'));
        noteInput.type = 'text';
        noteInput.maxLength = 200;
        noteInput.value = notes[category][name] || '';
        noteInput.placeholder = 'Optional note';
        noteInput.setAttribute('aria-label', `Notes for ${name}`);
        noteInput.addEventListener('change', () => {
            const note = noteInput.value.trim();
            if (note) notes[category][name] = note;
            else delete notes[category][name];
            saveNotes();
        });
        noteLabel.append(noteInput);
        removeButton.type = 'button';
        removeButton.className = 'remove-item';
        removeButton.textContent = 'Remove';
        removeButton.setAttribute('aria-label', `Remove ${name} from ${category}`);
        removeButton.addEventListener('click', () => {
            inventory[category].splice(index, 1);
            saveInventory();
            renderItems();
        });
        details.append(itemName, minimumLabel, noteLabel);
        row.append(details, removeButton);
        itemList.append(row);
    });
    if (inventory[category].length === 0) {
        const empty = document.createElement('li');
        empty.textContent = 'There are no items in this tab yet.';
        itemList.append(empty);
    }
}

categorySelect.addEventListener('change', renderItems);
addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = newItemInput.value.trim();
    const category = categorySelect.value;
    if (!name) return;
    if (inventory[category].some((item) => item.toLowerCase() === name.toLowerCase())) {
        status.textContent = 'That item is already in this tab.';
        return;
    }
    inventory[category].push(name);
    saveInventory();
    newItemInput.value = '';
    renderItems();
    newItemInput.focus();
});

renderItems();
