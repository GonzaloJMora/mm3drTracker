window.GameState = {
    items: {},
    totalHearts: 3,
    totalBossMasks: 0,
    totalRegularMasks: 0,
    regularMaskIds: new Set(),
    config: null,

    // Named groupings from config.json. They cut across the grids on purpose:
    // grids say where a slot is drawn, item_groups say what it means.
    group(name) {
        return (this.config && this.config.item_groups && this.config.item_groups[name]) || [];
    },

    init(itemsList, configData) {
        this.config = configData;

        // Tagged on the item in Items.json rather than read off config.grids.mask,
        // which is a layout list — moving a mask to another panel would otherwise
        // quietly change the count. The four transformation masks are simply
        // untagged, leaving exactly the masks that can be given to the moon
        // children.
        this.regularMaskIds = new Set(
            itemsList.filter(item => item.regular_mask).map(item => item.id)
        );

        if (!this.regularMaskIds.size) {
            console.warn(
                'GameState: nothing in Items.json is tagged "regular_mask", so total_masks ' +
                "will always be 0 and every check gated on it stays unreachable."
            );
        }

        // A slot in both would be treated as a progression but handed the counter
        // rule as its chain, so the click silently does nothing. Nothing does this
        // today, but it fails quietly enough to be worth naming.
        Object.keys(this.config.progressions).forEach(slotId => {
            if (Object.prototype.hasOwnProperty.call(this.config.item_counts, slotId)) {
                console.warn(
                    `GameState: "${slotId}" is in both progressions and item_counts in config.json. ` +
                    `Those are alternatives, not a combination, and clicking that slot will not work.`
                );
            }
        });

        itemsList.forEach(item => {
            this.items[item.id] = false;
        });

        Object.keys(this.config.progressions).forEach(slotId => {
            this.config.progressions[slotId].forEach(itemId => {
                this.items[itemId] = false;
            });
        });

        Object.keys(this.config.item_counts).forEach(slotId => {
            const rule = this.config.item_counts[slotId];
            if (Array.isArray(rule)) {
                this.items[slotId] = false;
                rule.forEach(val => { this.items[`${slotId}_${val}`] = false; });
            } else {
                this.items[slotId] = 0;
            }
        });

        for (let i = 1; i <= this.config.bombers_code.digits; i++) {
            this.items[`bombers_code_digit_${i}`] = 0;
        }

        this.items["bombers_code"] = false;
        this.items["bottle"] = false;

        this.calculateHearts();
        this.calculateBossMasks();
        this.calculateRegularMasks();
        this.calculateBombersCode();
        this.checkForBottle();
        this.broadcastChange();
    },

    updateItemState(slotId, stageIndex, currentCount) {
        const isProgression = this.config.progressions.hasOwnProperty(slotId);
        const countRule = this.config.item_counts[slotId];

        if (isProgression) {
            const chain = this.config.progressions[slotId];
            chain.forEach(itemId => { this.items[itemId] = false; });
            
            for (let i = 0; i <= stageIndex; i++) {
                if (chain[i]) this.items[chain[i]] = true;
            }
        }
        else if (countRule && Array.isArray(countRule)) {
            this.items[slotId] = (stageIndex >= 0);
            countRule.forEach(val => { this.items[`${slotId}_${val}`] = false; });
            
            for (let i = 0; i <= stageIndex; i++) {
                this.items[`${slotId}_${countRule[i]}`] = true;
            }
        }
        else if ((countRule && Number.isInteger(countRule)) || (slotId && slotId.startsWith("bombers_code_digit_"))) {
            this.items[slotId] = currentCount;
            
            // Off heart_rules rather than literal ids, like calculateHearts().
            // Otherwise renaming one in config leaves the count right on load and
            // frozen on every click after.
            const heartRules = this.config.heart_rules;
            if (slotId === heartRules.piece_id || slotId === heartRules.container_id) {
                this.calculateHearts();
            }
        }
        else {
            this.items[slotId] = (stageIndex !== -1);
        }

        if (this.group("boss_masks").includes(slotId)) {
            this.calculateBossMasks();
        }

        if (this.regularMaskIds.has(slotId)) {
            this.calculateRegularMasks();
        }

        if (slotId && slotId.startsWith("bombers_code_")) {
            this.calculateBombersCode();
        }

        if (this.group("bottles").includes(slotId)) {
            this.checkForBottle();
        }

        this.broadcastChange();
    },

    calculateHearts() {
        // starting_hearts / pieces_per_heart live in config.json but are really
        // randomizer settings; Phase 2 folds this block into the settings model.
        const rules = this.config.heart_rules;
        const pieces = this.items[rules.piece_id] || 0;
        const containers = this.items[rules.container_id] || 0;
        this.totalHearts = rules.starting_hearts + Math.floor(pieces / rules.pieces_per_heart) + containers;
    },

    calculateBossMasks() {
        let count = 0;
        this.group("boss_masks").forEach(maskId => {
            if (this.items[maskId] === true) {
                count++;
            }
        });
        this.totalBossMasks = count;
    },

    calculateRegularMasks() {
        let count = 0;
        this.regularMaskIds.forEach(maskId => {
            if (this.items[maskId] === true) {
                count++;
            }
        });
        this.totalRegularMasks = count;
    },

    calculateBombersCode() {
        let digits = [];
        for (let i = 1; i <= this.config.bombers_code.digits; i++) {
            let val = this.items[`bombers_code_digit_${i}`] ?? 0;
            digits.push(parseInt(val, 10) || 0);
        }

        const hasZero = digits.includes(0);
        const allUnique = new Set(digits).size === digits.length;
        this.items["bombers_code"] = !hasZero && allUnique;
    },

    checkForBottle() {
        let hasBottle = false;

        for (const bottleId of this.group("bottles")) {
            const item = this.items[bottleId];

            if (item === true || (Number.isInteger(item) && item > 0)) {
                hasBottle = true;
                break;
            }
        }

        this.items["bottle"] = hasBottle;
    },

    broadcastChange() {
        window.dispatchEvent(new CustomEvent("trackerStateUpdated", {
            detail: {
                items: { ...this.items },
                totalHearts: this.totalHearts,
                totalBossMasks: this.totalBossMasks,
                totalRegularMasks: this.totalRegularMasks
            }
        }));
    }
};

// Debug Overlay Panel (Draggable & Toggleable via F1)
(function createDebugPanel() {
    if (!document.body) {
        window.addEventListener('DOMContentLoaded', createDebugPanel);
        return;
    }

    if (document.getElementById('tracker-debug-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'tracker-debug-panel';
    panel.style.cssText = `
        position: fixed; bottom: 10px; left: 10px; width: 320px; max-height: 400px;
        overflow-y: auto; background: rgba(0, 0, 0, 0.9); color: #00ff00;
        font-family: monospace; font-size: 11px; padding: 10px;
        border: 2px solid #555; border-radius: 5px; z-index: 9999;
        box-shadow: 0 4px 20px rgba(0,0,0,0.8); display: none; user-select: none;
    `;

    const title = document.createElement('div');
    title.id = 'tracker-debug-title';
    title.style.cssText = 'cursor: move; padding-bottom: 4px;';
    title.innerHTML = '<strong>⚙️ LIVE STATE TRACKER DEBUG</strong> <span style="color:#666; font-size:9px; float:right;">[F1 to close]</span><hr style="border-color:#444; margin-top:4px;">';
    panel.appendChild(title);

    const content = document.createElement('div');
    content.id = 'debug-state-content';
    panel.appendChild(content);
    document.body.appendChild(panel);

    let isDragging = false;
    let startX, startY;

    title.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX - panel.offsetLeft;
        startY = e.clientY - panel.offsetTop;
        e.preventDefault();
    });

    // Keep a grip on screen. The title bar is the drag handle, and the position is
    // inline style that survives an F1 toggle — so a panel dragged fully off the
    // edge cannot be recovered at all.
    const MIN_ON_SCREEN = 60;

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const maxLeft = window.innerWidth - MIN_ON_SCREEN;
        const minLeft = MIN_ON_SCREEN - panel.offsetWidth;
        // Top is clamped at 0 rather than at -height: the title bar is along the
        // top edge, so letting it go negative puts the handle out of reach even
        // while the panel is still visible.
        const maxTop = window.innerHeight - MIN_ON_SCREEN;

        panel.style.left = `${Math.min(Math.max(e.clientX - startX, minLeft), maxLeft)}px`;
        panel.style.top = `${Math.min(Math.max(e.clientY - startY, 0), maxTop)}px`;
        panel.style.bottom = 'auto';
    });

    window.addEventListener('mouseup', () => { isDragging = false; });

    window.addEventListener("keydown", (e) => {
        if (e.key === "F1") {
            e.preventDefault(); 
            panel.style.display = panel.style.display === "none" ? "block" : "none";
        }
    });

    window.addEventListener('trackerStateUpdated', (e) => {
        const { items, totalHearts, totalBossMasks, totalRegularMasks } = e.detail;
        let html = `<div><strong>Total Hearts:</strong> ${totalHearts} ❤️</div>`;
        html += `<div><strong>Boss Masks Count:</strong> ${totalBossMasks} 🎭</div>`;
        html += `<div><strong>Regular Masks Count:</strong> ${totalRegularMasks} 🎭</div>`;
        html += `<div><strong>Bombers Code Valid:</strong> ${items["bombers_code"] ? "YES ✅" : "NO ❌"}</div>`;
        html += `<div><strong>Has Bottle:</strong> ${items["bottle"] ? "YES ✅" : "NO ❌"}</div>`;
        html += `<div style="margin-top:8px; border-bottom:1px dashed #444; padding-bottom:4px;"><strong>Active Flags & Numbers:</strong></div>`;

        const activeItems = Object.entries(items).filter(([_, val]) => val !== false && val !== 0);

        if (activeItems.length === 0) {
            html += `<div style="color:#888;">(Inventory Empty)</div>`;
        } else {
            activeItems.sort().forEach(([key, value]) => {
                html += `<div style="display:flex; justify-content:space-between;">
                    <span style="color:#aaa;">${key}:</span>
                    <span style="color:#55ff55; font-weight:bold;">${value}</span>
                </div>`;
            });
        }
        content.innerHTML = html;
    });
})();
