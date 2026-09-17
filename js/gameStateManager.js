window.GameState = {
    items: {},
    // Slot id -> the stage or count the settings started it at. See slotRange().
    floors: {},
    totalHearts: 3,
    totalBossMasks: 0,
    totalRegularMasks: 0,
    regularMaskIds: new Set(),
    config: null,
    // The settings page runs init() again on every change to preview the starting
    // items, so the data is checked on the first run only.
    dataChecked: false,

    // Named groupings from config.json. They cut across the grids on purpose:
    // grids say where a slot is drawn, item_groups say what it means.
    group(name) {
        return (this.config && this.config.item_groups && this.config.item_groups[name]) || [];
    },

    // What kind of slot an id is. Read from config alone rather than this.config,
    // so it works before init() — the settings grants need it that early.
    slotKind(config, slotId) {
        if (Object.prototype.hasOwnProperty.call(config.progressions, slotId)) return "progression";
        const rule = Object.prototype.hasOwnProperty.call(config.item_counts, slotId)
            ? config.item_counts[slotId]
            : undefined;
        if (Array.isArray(rule)) return "capacity";
        if (Number.isInteger(rule)) return "counter";
        if (slotId.startsWith("bombers_code_digit_")) return "digit";
        return "toggle";
    },

    // A slot's current value, read back out of items: a stage from -1 (not owned)
    // up, or a count from 0. A plain item is stage -1 or 0.
    slotValue(slotId) {
        const kind = this.slotKind(this.config, slotId);
        if (kind === "counter" || kind === "digit") return this.items[slotId] || 0;
        if (kind === "toggle") return this.items[slotId] ? 0 : -1;

        const flags = kind === "progression"
            ? this.config.progressions[slotId]
            : this.config.item_counts[slotId].map(size => `${slotId}_${size}`);
        let stage = -1;
        flags.forEach((flag, index) => {
            if (this.items[flag]) stage = index;
        });
        return stage;
    },

    // The values clicking can move a slot through. A starting item raises the
    // bottom to what it was granted, so it can't be clicked away, and a slot whose
    // bottom has reached its top is locked. A granted digit is fixed outright: a
    // code is not something you count up from.
    slotRange(slotId) {
        const config = this.config;
        const kind = this.slotKind(config, slotId);
        let bottom = kind === "counter" || kind === "digit" ? 0 : -1;
        let top = 0;
        if (kind === "progression") top = config.progressions[slotId].length - 1;
        else if (kind === "capacity") top = config.item_counts[slotId].length - 1;
        else if (kind === "counter") top = config.item_counts[slotId];
        else if (kind === "digit") top = config.bombers_code.max_digit_value;

        if (Object.prototype.hasOwnProperty.call(this.floors, slotId)) {
            bottom = this.floors[slotId];
            if (kind === "digit") top = bottom;
        }
        return { kind, bottom, top };
    },

    // A granted starting value as the stage or count its slot takes, or null when
    // it does not fit that slot.
    startingValue(slotId, granted) {
        const kind = this.slotKind(this.config, slotId);
        if (kind === "progression") {
            const stage = this.config.progressions[slotId].indexOf(granted);
            return stage >= 0 ? stage : null;
        }
        if (!Object.prototype.hasOwnProperty.call(this.items, slotId)) return null;
        if (kind === "capacity") {
            const stage = this.config.item_counts[slotId].indexOf(granted);
            return stage >= 0 ? stage : null;
        }
        if (kind === "counter" || kind === "digit") {
            return Number.isInteger(granted) && granted > 0 ? granted : null;
        }
        return granted === true ? 0 : null;
    },

    // startingState is SettingsState.startingItems(): slot id -> what the settings
    // start that slot at. Each one also becomes that slot's floor.
    init(itemsList, configData, startingState = {}) {
        this.config = configData;

        // Tagged on the item in Items.json rather than read off config.grids.mask,
        // which is a layout list — moving a mask to another panel would otherwise
        // quietly change the count. The four transformation masks are simply
        // untagged, leaving exactly the masks that can be given to the moon
        // children.
        this.regularMaskIds = new Set(
            itemsList.filter(item => item.regular_mask).map(item => item.id)
        );

        if (!this.dataChecked) {
            this.dataChecked = true;

            if (!this.regularMaskIds.size) {
                console.warn(
                    'GameState: nothing in Items.json is tagged "regular_mask", so total_masks ' +
                    "will always be 0 and every check gated on it stays unreachable."
                );
            }

            // A slot in both would be treated as a progression but handed the counter
            // rule as its chain, so the click silently does nothing — quiet enough to
            // be worth naming.
            Object.keys(this.config.progressions).forEach(slotId => {
                if (Object.prototype.hasOwnProperty.call(this.config.item_counts, slotId)) {
                    console.warn(
                        `GameState: "${slotId}" is in both progressions and item_counts in config.json. ` +
                        `Those are alternatives, not a combination, and clicking that slot will not work.`
                    );
                }
            });
        }

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

        this.floors = {};
        Object.keys(startingState).forEach(slotId => {
            const value = this.startingValue(slotId, startingState[slotId]);
            if (value === null) {
                console.warn(`GameState: "${slotId}" can't start at ${JSON.stringify(startingState[slotId])}, so it starts empty.`);
                return;
            }
            const kind = this.slotKind(this.config, slotId);
            const counted = kind === "counter" || kind === "digit";
            this.applySlot(slotId, counted ? null : value, counted ? value : null);
            this.floors[slotId] = value;
        });

        this.calculateHearts();
        this.calculateBossMasks();
        this.calculateRegularMasks();
        this.calculateBombersCode();
        this.checkForBottle();
        this.broadcastChange();
    },

    updateItemState(slotId, stageIndex, currentCount) {
        this.applySlot(slotId, stageIndex, currentCount);
        this.broadcastChange();
    },

    // Everything updateItemState does except announcing it, so init() can set a
    // run of starting slots and announce once.
    applySlot(slotId, stageIndex, currentCount) {
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
    },

    calculateHearts() {
        // The base is the rando's Health setting, which heart_rules names. It sets
        // your starting hearts without taking any from the pool, so it can't be a
        // grant on the counters.
        const rules = this.config.heart_rules;
        const settings = window.SettingsState;
        const health = settings ? settings.get(rules.starting_hearts_setting) : undefined;
        const starting = typeof health === "number" ? health : 0;
        const pieces = this.items[rules.piece_id] || 0;
        const containers = this.items[rules.container_id] || 0;
        this.totalHearts = starting + Math.floor(pieces / rules.pieces_per_heart) + containers;
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

// Console helpers live on this one object instead of on window. Each file adds
// its own, so nothing here has to know what they are.
window.TrackerDebug = {};

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

        const settings = window.SettingsState;
        if (settings) {
            // Ids and values come from settings.json, so they are escaped.
            const escape = text => String(text).replace(/[&<>"]/g, ch =>
                ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
            const header = label =>
                `<div style="margin-top:8px; border-bottom:1px dashed #444; padding-bottom:4px;"><strong>${label}</strong></div>`;
            const row = (key, value) => `<div style="display:flex; justify-content:space-between;">
                    <span style="color:#aaa;">${escape(key)}:</span>
                    <span style="color:#55ff55; font-weight:bold;">${escape(value)}</span>
                </div>`;

            // Only what differs from its default or is locked: the full list is
            // long enough to bury the few settings that matter.
            html += header("Settings (changed or locked):");
            const changed = settings.list().filter(entry => entry.forced || entry.value !== entry.default);
            html += changed.length
                ? changed.map(entry => row(entry.id, entry.forced ? `${entry.value} (locked)` : entry.value)).join("")
                : `<div style="color:#888;">(All defaults)</div>`;

            html += header("Starting Items:");
            html += Object.entries(settings.startingItems()).sort()
                .map(([slot, value]) => row(slot, value)).join("");
        }

        content.innerHTML = html;
    });
})();
