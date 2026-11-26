// File purpose: Electrical catalog schema, defaults, browser-storage recovery, and migrations for electrical groups, item labels, and metadata.

(() => {
// Keep these category and group names in sync with electrical.html.
// Electrical catalog source of truth: category/group membership and visible item labels used to build the default list.
const categoryGroups = {
    'Cable & Wire': {
        'Cable Idents': [
            'Size 3 - 0', 'Size 3 - 1', 'Size 3 - 2', 'Size 3 - 3', 'Size 3 - 4',
            'Size 3 - 5', 'Size 3 - 6', 'Size 3 - 7', 'Size 3 - 8', 'Size 3 - 9',
            'Size 2 - All Numbers', 'Size 2 - 3',
            'Size 1 - 0', 'Size 1 - 1', 'Size 1 - 2', 'Size 1 - 3', 'Size 1 - 4',
            'Size 1 - 5', 'Size 1 - 6', 'Size 1 - 7', 'Size 1 - 8', 'Size 1 - 9'
        ],
        'Panel Wire': [
            '0.5 Blue', '0.5 Black Tri Rated', '0.5 Earth', '0.75 Black Tri Rated',
            '1mm Black Tri Rated', '1.5 Black Tri Rated', '1.5 Earth', '2.5 Black Tri Rated',
            '4mm Black Tri Rated', '4mm Earth', '6mm Black Tri Rated', '6mm Earth'
        ],
        'Wiring Assemblies': [
            '0.5 White Stranded (Rear Fan Bar)', '0.5 White Solid (Lamp Tray)',
            '2 Core 0.5 (Brown/Blue) (GS2/Rear Fan)', '3 Core Screened (R/W/B) (TP1/2)',
            '4 Core 0.5 (R/Y/B/G) (GS1/Rear Fan Bar)', '9 Core Ribbon (PROG 2)',
            '3G0.75 (SV4)', '12G0.75 (CB)', '4G1 (LT1)', '3G1',
            '4G1 Screened (Motors)', '5G1 (CB)', '7G1 (CB)', '5G1.5 (Dryers)',
            '4G4 (Wash Heater Power)', '5G4 (UK Mains Lead Flexo)',
            '5G6 (UK Mains Lead LP)', '4G6 (US Mains Lead)'
        ]
    },
    Connectors: {
        MX150: [
            '2 Way Plug', '2 Way Skt', '4 Way Plug', '4 Way Skt', '6 Way Plug',
            '6 Way Skt', 'Male Pins', 'Female Pins'
        ],
        'Jr Minifits': ['2 Way Plug', '2 Way Skt', 'Male Pins', 'Female Pins'],
        'COM Stuff': [
            'Plug Nuts', 'Female Ribbon/DB9', 'Backshell', 'Male Ribbon/DB9',
            '9 Way Male Solder DB9'
        ]
    },
    'Terminals & Crimps': {
        'Bootlace Ferrules': [
            'White 0.5 Single', 'White 0.5 Double', 'Light Blue 0.75 Single',
            'Light Blue 0.75 Double', 'Red 1 Single', 'Red 1 Double', 'Black 1.5 Single',
            'Black 1.5 Double', 'Grey 2.5 Single', 'Dark Blue 2.5 Double', 'Orange 4 Single',
            'Green 6 Single'
        ],
        'Wire Crimps': [
            'Red M4 Ring', 'Red Large Fork', 'Red Shrouded', 'Red Skinny Fork',
            'Blue Male Bullet', 'Blue Female Bullet', 'Yellow M4 Ring', 'Yellow M5 Ring',
            'Yellow M6 Ring', 'Yellow Skinny Fork', 'Yellow Shrouded', 'Yellow Male Bullet',
            'Yellow Female Bullet'
        ]
    },
    'Cable Management': {
        'Cable Saddles': ['M4', 'M6'],
        'Stuffing Glands': ['M16', 'M20'],
        Grommets: ['20mm Open', '20mm Blind'],
        'Cable Ties': ['Small White (Lamp Tray)', '100mm', '150mm', '203mm', '300mm'],
        Miscellaneous: ['P-Clip']
    },
    'Heatshrink & Sleeving': {
        Heatshrink: [
            '1.6mm', '4.8mm', '12-4mm', '3-1mm', '9-3mm', '18-6mm', '24-8mm (with glue)'
        ],
        Sleeving: ['Grey Braided Sleeving', '6mm']
    },
    'Other Electrical': {
        'Other Electrical': ['Write on Label', '16a Choc Bloc', 'Control Panel Seal']
    }
};

// Derive stable item keys and lookup maps from the source catalog so duplicate labels remain distinguishable.
const defaults = {};
const itemGroups = {};
const itemLabels = {};
const groups = {};

Object.entries(categoryGroups).forEach(([category, sections]) => {
    defaults[category] = [];
    itemGroups[category] = {};
    itemLabels[category] = {};
    groups[category] = Object.keys(sections);
    Object.entries(sections).forEach(([group, names]) => {
        names.forEach((label) => {
            const key = defaults[category].some((item) => itemLabels[category][item] === label)
                ? `${group} — ${label}`
                : label;
            defaults[category].push(key);
            itemGroups[category][key] = group;
            itemLabels[category][key] = label;
        });
    });
});

// Storage validation and migration: safely read persisted edits and repair older catalog formats.
function readSavedValue(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || 'null');
    } catch (error) {
        return null;
    }
}

function copyObject(value) {
    return JSON.parse(JSON.stringify(value));
}

function cleanRecord(value, isAllowed) {
    const cleaned = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return cleaned;
    Object.entries(value).forEach(([key, entry]) => {
        if (typeof key === 'string' && isAllowed(entry)) cleaned[key] = entry;
    });
    return cleaned;
}

// Inventory store API: load, normalize, migrate, and persist electrical catalog data for the list and admin page.
const inventoryStore = {
    storageKey: 'electrical-list-inventory',
    groupsKey: 'electrical-list-item-groups',
    labelsKey: 'electrical-list-item-labels',
    groups,
    defaults,
    itemGroups,
    itemLabels,
    minimumsKey: 'electrical-list-minimums',
    manufacturersKey: 'electrical-list-manufacturers',
    partNumbersKey: 'electrical-list-part-numbers',
    partNumbers: {},
    loadData() {
        const data = {
            inventory: copyObject(defaults),
            groups: copyObject(groups),
            itemGroups: copyObject(itemGroups),
            itemLabels: copyObject(itemLabels),
            minimums: {},
            manufacturers: {},
            partNumbers: copyObject(this.partNumbers)
        };
        const savedInventory = readSavedValue(this.storageKey);
        const versionKey = 'electrical-list-category-layout-v2';
        let migrated = false;
        try {
            migrated = localStorage.getItem(versionKey) === 'done';
        } catch (error) {
            // Defaults remain available when storage is disabled.
        }

        if (migrated) {
            if (savedInventory && typeof savedInventory === 'object' && !Array.isArray(savedInventory)) {
                Object.keys(data.inventory).forEach((category) => {
                    if (Array.isArray(savedInventory[category])) {
                        data.inventory[category] = savedInventory[category].filter((item) => typeof item === 'string' && item.trim());
                    }
                });
            }
            const savedGroups = readSavedValue(this.groupsKey);
            const savedLabels = readSavedValue(this.labelsKey);
            if (savedGroups && typeof savedGroups === 'object') {
                Object.entries(savedGroups).forEach(([category, values]) => {
                    if (!data.itemGroups[category] || !values || typeof values !== 'object' || Array.isArray(values)) return;
                    Object.assign(data.itemGroups[category], values);
                });
            }
            if (savedLabels && typeof savedLabels === 'object') {
                Object.entries(savedLabels).forEach(([category, values]) => {
                    if (!data.itemLabels[category] || !values || typeof values !== 'object' || Array.isArray(values)) return;
                    Object.assign(data.itemLabels[category], values);
                });
            }
        } else if (savedInventory && typeof savedInventory === 'object' && !Array.isArray(savedInventory)) {
            const legacyTargets = {
                'Cable Indents': ['Cable & Wire', 'Cable Idents'],
                Connectors: ['Connectors', 'Other Connector Items'],
                Switches: ['Other Electrical', 'Legacy Switches'],
                Fuses: ['Other Electrical', 'Legacy Fuses'],
                Relays: ['Other Electrical', 'Legacy Relays'],
                Sensors: ['Other Electrical', 'Legacy Sensors'],
                'Power Supplies': ['Other Electrical', 'Legacy Power Supplies'],
                Terminals: ['Terminals & Crimps', 'Other Terminal Items'],
                Lighting: ['Other Electrical', 'Legacy Lighting'],
                Motors: ['Other Electrical', 'Legacy Motors'],
                'Control Gear': ['Other Electrical', 'Legacy Control Gear'],
                'Other Electrical': ['Other Electrical', 'Other Electrical']
            };
            const oldCableItems = Array.isArray(savedInventory['Cable Indents'])
                ? savedInventory['Cable Indents'].filter((item) => typeof item === 'string' && item.trim())
                : null;
            if (oldCableItems) {
                data.inventory['Cable & Wire'] = data.inventory['Cable & Wire'].filter((item) => data.itemGroups['Cable & Wire'][item] !== 'Cable Idents');
                oldCableItems.forEach((item) => addLegacyItem(data, 'Cable & Wire', 'Cable Idents', item));
            }
            Object.entries(legacyTargets).forEach(([oldCategory, [category, group]]) => {
                if (oldCategory === 'Cable Indents') return;
                const oldItems = savedInventory[oldCategory];
                if (!Array.isArray(oldItems)) return;
                oldItems.forEach((item) => {
                    if (typeof item === 'string' && item.trim()) addLegacyItem(data, category, group, item);
                });
            });
            migrateMetadata(data, legacyTargets, 'minimumsKey', 'minimums');
            migrateMetadata(data, legacyTargets, 'manufacturersKey', 'manufacturers');
            if (this.saveData(data)) {
                try {
                    localStorage.setItem(versionKey, 'done');
                } catch (error) {
                    // The migration can be retried on a later page load.
                }
            }
        }

        if (migrated) {
            const savedMinimums = readSavedValue(this.minimumsKey);
            const savedManufacturers = readSavedValue(this.manufacturersKey);
            Object.keys(data.inventory).forEach((category) => {
                data.minimums[category] = cleanRecord(savedMinimums?.[category], (value) => Number.isInteger(value) && value >= 1);
                data.manufacturers[category] = cleanRecord(savedManufacturers?.[category], (value) => typeof value === 'string' && value.trim());
            });
            const savedPartNumbers = readSavedValue(this.partNumbersKey);
            if (savedPartNumbers && typeof savedPartNumbers === 'object' && !Array.isArray(savedPartNumbers)) {
                Object.entries(savedPartNumbers).forEach(([category, values]) => {
                    if (!data.partNumbers[category]) data.partNumbers[category] = {};
                    if (values && typeof values === 'object' && !Array.isArray(values)) {
                        Object.assign(data.partNumbers[category], cleanRecord(values, (value) => typeof value === 'string' && value.trim()));
                    }
                });
            }
        }

        Object.keys(data.inventory).forEach((category) => {
            if (!data.itemGroups[category]) data.itemGroups[category] = {};
            if (!data.itemLabels[category]) data.itemLabels[category] = {};
            if (!data.groups[category]) data.groups[category] = [];
            data.minimums[category] = cleanRecord(data.minimums[category], (value) => Number.isInteger(value) && value >= 1);
            data.manufacturers[category] = cleanRecord(data.manufacturers[category], (value) => typeof value === 'string' && value.trim());
            data.partNumbers[category] = cleanRecord(data.partNumbers[category], (value) => typeof value === 'string' && value.trim());
            data.inventory[category].forEach((item) => {
                if (!data.itemGroups[category][item]) data.itemGroups[category][item] = 'Other items';
                if (!data.itemLabels[category][item]) data.itemLabels[category][item] = item;
                const group = data.itemGroups[category][item];
                if (!data.groups[category].includes(group)) data.groups[category].push(group);
            });
        });
        return data;
    },
    saveData(data) {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(data.inventory));
            localStorage.setItem(this.groupsKey, JSON.stringify(data.itemGroups));
            localStorage.setItem(this.labelsKey, JSON.stringify(data.itemLabels));
            localStorage.setItem(this.minimumsKey, JSON.stringify(data.minimums));
            localStorage.setItem(this.manufacturersKey, JSON.stringify(data.manufacturers));
            localStorage.setItem(this.partNumbersKey, JSON.stringify(data.partNumbers));
            return true;
        } catch (error) {
            return false;
        }
    }
};

// Legacy conversion helpers keep existing saved inventories usable after schema changes.
function addLegacyItem(data, category, group, item) {
    const normalized = item.trim().toLocaleLowerCase();
    const alreadyListed = data.inventory[category].some((key) =>
        (data.itemLabels[category][key] || key).trim().toLocaleLowerCase() === normalized
    );
    if (alreadyListed) return;
    const key = `${group} — ${item.trim()}`;
    if (!data.inventory[category].includes(key)) {
        data.inventory[category].push(key);
        data.itemGroups[category][key] = group;
        data.itemLabels[category][key] = item.trim();
    }
    if (!data.groups[category].includes(group)) data.groups[category].push(group);
}

function migrateMetadata(data, legacyTargets, key, property) {
    const saved = readSavedValue(inventoryStore[key]);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
    Object.entries(legacyTargets).forEach(([oldCategory, [category]]) => {
        const values = saved[oldCategory];
        if (!values || typeof values !== 'object' || Array.isArray(values)) return;
        if (!data[property][category]) data[property][category] = {};
        Object.entries(values).forEach(([name, value]) => {
            data[property][category][name] = value;
        });
    });
}

window.FastenerInventory = inventoryStore;
})();
