const store = window.FastenerInventory;
const inventory = JSON.parse(JSON.stringify(store.defaults));
const minimums = {};
const manufacturers = {};
const partNumbers = JSON.parse(JSON.stringify(store.partNumbers || {}));
const manufacturersStorageKey = store.manufacturersKey || store.notesKey;
const categorySelect = document.getElementById('category-select');
const itemList = document.getElementById('item-list');
const addForm = document.getElementById('add-form');
const newItemInput = document.getElementById('new-item');
const status = document.getElementById('admin-status');

Object.keys(inventory).forEach((category) => {
    minimums[category] = {};
    manufacturers[category] = {};
    if (!partNumbers[category]) partNumbers[category] = {};
});
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
    const legacyNotes = store.manufacturersKey && store.notesKey ? localStorage.getItem(store.notesKey) : null;
    const savedManufacturers = JSON.parse(localStorage.getItem(manufacturersStorageKey) || legacyNotes || 'null');
    if (savedManufacturers && typeof savedManufacturers === 'object' && !Array.isArray(savedManufacturers)) {
        Object.keys(inventory).forEach((category) => {
            const values = savedManufacturers[category];
            if (!values || typeof values !== 'object' || Array.isArray(values)) return;
            Object.entries(values).forEach(([name, manufacturer]) => {
                if (typeof manufacturer === 'string') manufacturers[category][name] = manufacturer;
            });
        });
    }
} catch (error) {
    status.textContent = 'Could not read saved manufacturer values.';
}

try {
    const savedPartNumbers = JSON.parse(localStorage.getItem(store.partNumbersKey) || 'null');
    if (savedPartNumbers && typeof savedPartNumbers === 'object' && !Array.isArray(savedPartNumbers)) {
        Object.keys(inventory).forEach((category) => {
            const values = savedPartNumbers[category];
            if (!values || typeof values !== 'object' || Array.isArray(values)) return;
            Object.entries(values).forEach(([name, partNumber]) => {
                if (typeof partNumber === 'string') partNumbers[category][name] = partNumber;
            });
        });
    }
} catch (error) {
    status.textContent = 'Could not read saved part numbers.';
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

function saveManufacturers() {
    try {
        localStorage.setItem(manufacturersStorageKey, JSON.stringify(manufacturers));
        status.textContent = store.manufacturersKey ? 'Manufacturer saved.' : 'Item note saved.';
    } catch (error) {
        status.textContent = 'Could not save this value in this browser.';
    }
}

function savePartNumbers() {
    try {
        localStorage.setItem(store.partNumbersKey, JSON.stringify(partNumbers));
        status.textContent = 'Part number saved.';
    } catch (error) {
        status.textContent = 'Could not save the part number in this browser.';
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
        const manufacturerLabel = document.createElement('label');
        const manufacturerInput = document.createElement('input');
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
        manufacturerLabel.className = 'note-field';
        manufacturerLabel.append(document.createTextNode(store.manufacturersKey ? 'Manufacturer' : 'Notes'));
        manufacturerInput.type = 'text';
        manufacturerInput.maxLength = 200;
        manufacturerInput.value = manufacturers[category][name] || '';
        manufacturerInput.placeholder = store.manufacturersKey ? 'Optional manufacturer' : 'Optional note';
        manufacturerInput.setAttribute('aria-label', `${store.manufacturersKey ? 'Manufacturer' : 'Notes'} for ${name}`);
        manufacturerInput.addEventListener('change', () => {
            const manufacturer = manufacturerInput.value.trim();
            if (manufacturer) manufacturers[category][name] = manufacturer;
            else delete manufacturers[category][name];
            saveManufacturers();
        });
        manufacturerLabel.append(manufacturerInput);
        const itemFields = [minimumLabel, manufacturerLabel];
        if (store.partNumbersKey) {
            const partNumberLabel = document.createElement('label');
            const partNumberInput = document.createElement('input');
            partNumberLabel.className = 'note-field';
            partNumberLabel.append(document.createTextNode('Part number'));
            partNumberInput.type = 'text';
            partNumberInput.maxLength = 100;
            partNumberInput.value = partNumbers[category][name] || '';
            partNumberInput.placeholder = 'Optional part number';
            partNumberInput.setAttribute('aria-label', `Part number for ${name}`);
            partNumberInput.addEventListener('change', () => {
                const partNumber = partNumberInput.value.trim();
                if (partNumber) partNumbers[category][name] = partNumber;
                else delete partNumbers[category][name];
                savePartNumbers();
            });
            partNumberLabel.append(partNumberInput);
            itemFields.push(partNumberLabel);
        }
        removeButton.type = 'button';
        removeButton.className = 'remove-item';
        removeButton.textContent = 'Remove';
        removeButton.setAttribute('aria-label', `Remove ${name} from ${category}`);
        removeButton.addEventListener('click', () => {
            inventory[category].splice(index, 1);
            saveInventory();
            renderItems();
        });
        details.append(itemName, ...itemFields);
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
    inventory[category].sort((first, second) => first.localeCompare(second, undefined, {
        numeric: true,
        sensitivity: 'base'
    }));
    saveInventory();
    newItemInput.value = '';
    renderItems();
    newItemInput.focus();
});

renderItems();
