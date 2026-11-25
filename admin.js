const store = window.FastenerInventory;
const isElectricalInventory = typeof store.loadData === 'function';
function readSavedObject(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || 'null');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (error) {
        return {};
    }
}

function cleanRecord(value, isAllowed) {
    const cleaned = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return cleaned;
    Object.entries(value).forEach(([key, entry]) => {
        if (typeof key === 'string' && isAllowed(entry)) cleaned[key] = entry;
    });
    return cleaned;
}

function loadMechanicalData() {
    const inventory = JSON.parse(JSON.stringify(store.defaults));
    const savedInventory = readSavedObject(store.storageKey);
    Object.keys(inventory).forEach((category) => {
        if (Array.isArray(savedInventory[category])) {
            inventory[category] = savedInventory[category].filter((item) => typeof item === 'string' && item.trim());
        }
    });
    return {
        inventory,
        minimums: readSavedObject(store.minimumsKey),
        manufacturers: readSavedObject(store.notesKey),
        partNumbers: {},
        groups: Object.fromEntries(Object.keys(inventory).map((category) => [category, []])),
        itemGroups: Object.fromEntries(Object.keys(inventory).map((category) => [category, {}])),
        itemLabels: Object.fromEntries(Object.keys(inventory).map((category) => [category, {}]))
    };
}

const data = isElectricalInventory ? store.loadData() : loadMechanicalData();
const { inventory, minimums, manufacturers, partNumbers, groups, itemGroups, itemLabels } = data;
const categorySelect = document.getElementById('category-select');
const groupSelect = document.getElementById('group-select');
const itemList = document.getElementById('item-list');
const addForm = document.getElementById('add-form');
const newItemInput = document.getElementById('new-item');
const status = document.getElementById('admin-status');

Object.keys(inventory).forEach((category) => {
    minimums[category] = cleanRecord(minimums[category], (value) => Number.isInteger(value) && value >= 1);
    manufacturers[category] = cleanRecord(manufacturers[category], (value) => typeof value === 'string' && value.trim());
    partNumbers[category] = cleanRecord(partNumbers[category], (value) => typeof value === 'string' && value.trim());
    itemGroups[category] = cleanRecord(itemGroups[category], (value) =>
        typeof value === 'string' && (groups[category] || []).includes(value));
    itemLabels[category] = cleanRecord(itemLabels[category], (value) => typeof value === 'string' && value.trim());
});

Object.keys(inventory).forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categorySelect.append(option);
});

function renderGroupOptions(selectedGroup) {
    if (!groupSelect) return;
    groupSelect.replaceChildren();
    (groups[categorySelect.value] || []).forEach((group) => {
        const option = document.createElement('option');
        option.value = group;
        option.textContent = group;
        groupSelect.append(option);
    });
    if (selectedGroup && groups[categorySelect.value].includes(selectedGroup)) {
        groupSelect.value = selectedGroup;
    }
}

function saveInventory() {
    try {
        if (isElectricalInventory) {
            if (store.saveData(data) === false) throw new Error('Storage unavailable.');
        } else {
            localStorage.setItem(store.storageKey, JSON.stringify(inventory));
        }
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
        localStorage.setItem(isElectricalInventory ? store.manufacturersKey : store.notesKey, JSON.stringify(manufacturers));
            status.textContent = isElectricalInventory ? 'Manufacturer saved.' : 'Note saved.';
    } catch (error) {
        status.textContent = 'Could not save this value in this browser.';
    }
}

function savePartNumbers() {
    if (!isElectricalInventory) return;
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
    const orderedItems = [...inventory[category]].sort((first, second) => {
        const groupOrder = groupSelect
            ? groups[category].indexOf(itemGroups[category][first]) - groups[category].indexOf(itemGroups[category][second])
            : 0;
        return groupOrder || (itemLabels[category][first] || first).localeCompare(itemLabels[category][second] || second, undefined, {
            numeric: true,
            sensitivity: 'base'
        });
    });
    orderedItems.forEach((name) => {
        const row = document.createElement('li');
        const itemName = document.createElement('span');
        const details = document.createElement('div');
        const groupLabel = groupSelect ? document.createElement('label') : null;
        const itemGroupSelect = groupSelect ? document.createElement('select') : null;
        const minimumLabel = document.createElement('label');
        const minimumInput = document.createElement('input');
        const manufacturerLabel = document.createElement('label');
        const manufacturerInput = document.createElement('input');
        const removeButton = document.createElement('button');
        itemName.textContent = itemLabels[category][name] || name;
        details.className = 'item-details';
        if (groupSelect) {
            groupLabel.className = 'group-field';
            groupLabel.append(document.createTextNode('Electrical group'));
            (groups[category] || []).forEach((group) => {
                const option = document.createElement('option');
                option.value = group;
                option.textContent = group;
                itemGroupSelect.append(option);
            });
            itemGroupSelect.value = itemGroups[category][name] || 'Other items';
            itemGroupSelect.setAttribute('aria-label', `Group for ${itemLabels[category][name] || name}`);
            itemGroupSelect.addEventListener('change', () => {
                itemGroups[category][name] = itemGroupSelect.value;
                saveInventory();
                renderItems();
            });
            groupLabel.append(itemGroupSelect);
        }
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
            inventory[category] = inventory[category].filter((item) => item !== name);
            delete itemGroups[category][name];
            delete itemLabels[category][name];
            delete minimums[category][name];
            delete manufacturers[category][name];
            delete partNumbers[category][name];
            saveInventory();
            saveMinimums();
            saveManufacturers();
            savePartNumbers();
            renderItems();
        });
        details.append(itemName, ...(groupLabel ? [groupLabel] : []), ...itemFields);
        row.append(details, removeButton);
        itemList.append(row);
    });
    if (inventory[category].length === 0) {
        const empty = document.createElement('li');
        empty.textContent = 'There are no items in this tab yet.';
        itemList.append(empty);
    }
}

categorySelect.addEventListener('change', () => {
    renderGroupOptions();
    renderItems();
});
addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = newItemInput.value.trim();
    const category = categorySelect.value;
    const group = groupSelect?.value || '';
    if (!name) return;
    if (inventory[category].some((item) =>
        (itemLabels[category][item] || item).toLowerCase() === name.toLowerCase() &&
        (!groupSelect || itemGroups[category][item] === group)
    )) {
        status.textContent = 'That item is already in this group.';
        return;
    }
    const duplicateLabel = inventory[category].some((item) =>
        (itemLabels[category][item] || item).toLowerCase() === name.toLowerCase()
    );
    const key = duplicateLabel && groupSelect ? `${group} — ${name}` : name;
    inventory[category].push(key);
    if (groupSelect) itemGroups[category][key] = group;
    itemLabels[category][key] = name;
    saveInventory();
    newItemInput.value = '';
    renderItems();
    newItemInput.focus();
});

renderGroupOptions();
renderItems();
