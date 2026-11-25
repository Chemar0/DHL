(() => {
    const electricalCategories = new Set([
        'Cable & Wire', 'Cable Indents', 'Connectors', 'Switches', 'Fuses', 'Relays',
        'Sensors', 'Power Supplies', 'Terminals', 'Terminals & Crimps', 'Lighting',
        'Motors', 'Control Gear', 'Cable Management', 'Heatshrink & Sleeving',
        'Other Electrical'
    ]);

    window.CartGrouping = {
        byType(cart) {
            const groups = new Map([
                ['Mechanical', []],
                ['Electrical', []]
            ]);
            cart.forEach((items, category) => {
                const type = electricalCategories.has(category) ? 'Electrical' : 'Mechanical';
                groups.get(type).push([category, items]);
            });
            return groups;
        }
    };
})();
