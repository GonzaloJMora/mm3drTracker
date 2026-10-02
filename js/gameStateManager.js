window.GameState = {
    items: {},
    // Slot id -> the stage or count the settings started it at. See slotRange().
    floors: {},
    // What logic can name besides items, worked out from the inventory: token id ->
    // a number or a yes/no. Defined in config/logicTokens.json.
    tokens: {},
    // The tokens that read cleanly, each with the item ids it looks at.
    tokenSources: [],
    config: null,

    // The slot model is DataModel's, so the data checks and the tests read slots
    // exactly as the page does. Config alone, so it works before init(): the
    // settings grants need it that early.
    slotKind(config, slotId) {
        return window.DataModel.slotKind(config, slotId);
    },

    digitIds(config) {
        return window.DataModel.digitIds(config);
    },

    // A slot's current value, read back out of items: a stage from -1 (not owned)
    // up, or a count from 0. A plain item is stage -1 or 0.
    slotValue(slotId) {
        const kind = this.slotKind(this.config, slotId);
        if (kind === "counter" || kind === "digit") return this.items[slotId] || 0;
        if (kind === "toggle") return this.items[slotId] ? 0 : -1;

        let stage = -1;
        this.config.progressions[slotId].forEach((flag, index) => {
            if (this.items[flag]) stage = index;
        });
        return stage;
    },

    // Every value a slot can hold, whatever the settings, and what a settings grant
    // means for its slot: DataModel's, like slotKind().
    slotBounds(config, slotId) {
        return window.DataModel.slotBounds(config, slotId);
    },

    grantedValue(config, slotId, granted) {
        return window.DataModel.grantedValue(config, slotId, granted);
    },

    // The values clicking can move a slot through. A starting item raises the
    // bottom to what it was granted, so it can't be clicked away, and a slot whose
    // bottom has reached its top is locked. A granted digit is fixed outright: a
    // code is not something you count up from.
    slotRange(slotId) {
        const { kind, low, high } = this.slotBounds(this.config, slotId);
        let bottom = low;
        let top = high;
        if (Object.prototype.hasOwnProperty.call(this.floors, slotId)) {
            bottom = this.floors[slotId];
            if (kind === "digit") top = bottom;
        }
        return { kind, bottom, top };
    },

    // A granted starting value as the value its slot takes, or null when it does not
    // fit that slot or the slot is an item Items.json doesn't have.
    startingValue(slotId, granted) {
        const kind = this.slotKind(this.config, slotId);
        if (kind !== "progression" && !Object.prototype.hasOwnProperty.call(this.items, slotId)) return null;
        return this.grantedValue(this.config, slotId, granted);
    },

    // Every slot the grids draw, once each, in grid order.
    gridSlots(config = this.config) {
        return window.DataModel.gridSlots(config);
    },

    // Slot id -> its value, for a save. Values rather than items, which hold one
    // flag per progression stage.
    snapshot() {
        const slots = {};
        this.gridSlots().forEach(slotId => { slots[slotId] = this.slotValue(slotId); });
        return slots;
    },

    // startingState is SettingsState.startingItems(): slot id -> what the settings
    // start that slot at. Each one also becomes that slot's floor. saved is a save's
    // slot values, applied on top and kept between each slot's floor and its top.
    init(itemsList, configData, startingState = {}, saved = null) {
        this.config = configData;
        // A slot in both progressions and item_counts, or a malformed token, is named
        // by the data checks at load ("progressions-or-counts", "logic-tokens-defined").
        Object.assign(this.items, window.DataModel.emptyItemState(this.config, itemsList));
        this.buildTokens(itemsList);

        this.floors = {};
        Object.keys(startingState).forEach(slotId => {
            const value = this.startingValue(slotId, startingState[slotId]);
            if (value === null) {
                console.warn(`GameState: "${slotId}" can't start at ${JSON.stringify(startingState[slotId])}, so it starts empty.`);
                return;
            }
            this.applySlot(slotId, value);
            this.floors[slotId] = value;
        });

        if (saved) this.applySaved(saved);

        this.broadcastChange();
    },

    applySaved(saved) {
        const known = new Set(this.gridSlots());
        const unknown = [];
        const unreadable = [];
        Object.keys(saved).forEach(slotId => {
            const value = saved[slotId];
            if (!known.has(slotId)) {
                unknown.push(slotId);
                return;
            }
            if (!Number.isInteger(value)) {
                unreadable.push(slotId);
                return;
            }
            const { bottom, top } = this.slotRange(slotId);
            this.applySlot(slotId, Math.min(Math.max(value, bottom), top));
        });
        if (unknown.length) {
            console.warn(`GameState: the save names ${unknown.length} slot(s) the grids don't have, left out: ${unknown.join(", ")}`);
        }
        if (unreadable.length) {
            console.warn(`GameState: the save has no number for ${unreadable.length} slot(s), which keep their starting value: ${unreadable.join(", ")}`);
        }
    },

    // The one way a slot changes after init(): a stage or a count, as slotValue()
    // reads it back.
    setSlot(slotId, value) {
        this.applySlot(slotId, value);
        this.broadcastChange();
    },

    // Everything setSlot() does except announcing it, so init() can set a run of
    // starting slots and announce once. A progression's stage owns every stage up
    // to it, so logic asking for an earlier stage is met too.
    applySlot(slotId, value) {
        const kind = this.slotKind(this.config, slotId);
        if (kind === "progression") {
            this.config.progressions[slotId].forEach((itemId, stage) => { this.items[itemId] = stage <= value; });
        } else if (kind === "counter" || kind === "digit") {
            this.items[slotId] = value;
        } else {
            this.items[slotId] = value !== -1;
        }
    },

    // What an item counts for in a token: a count is its number, a plain item is 1
    // when owned.
    countOf(itemId) {
        const value = this.items[itemId];
        if (Number.isInteger(value)) return value;
        return value === true ? 1 : 0;
    },

    // Reads config/logicTokens.json into tokenSources: each token that can be worked
    // out, with the item ids it looks at (DataModel.readTokens; what's wrong with
    // one is the data checks' to say).
    buildTokens(itemsList) {
        const settings = window.SettingsState;
        const isNumberSetting = id => Boolean(settings) && typeof settings.get(id) === "number";
        this.tokenSources = window.DataModel.readTokens(this.config, itemsList, this.items, isNumberSetting).sources;
        this.computeTokens();
    },

    // One token's value from the inventory and the settings.
    tokenValue(def, ids, settings) {
        if (def.kind === "count") return ids.filter(id => this.countOf(id) > 0).length;
        if (def.kind === "any") return ids.some(id => this.countOf(id) > 0);
        if (def.kind === "sum") {
            return def.terms.reduce((total, term) => {
                if (term.setting !== undefined) {
                    const value = settings ? settings.get(term.setting) : undefined;
                    return total + (typeof value === "number" ? value : 0);
                }
                return total + Math.floor(this.countOf(term.item) / (term.per || 1));
            }, 0);
        }
        // Both tests below pass on an empty list, which would make a token with no
        // slots read true.
        if (!ids.length) return false;
        const digits = ids.map(id => this.countOf(id));
        return !digits.includes(0) && new Set(digits).size === digits.length;
    },

    // Tokens already named as failing in computeTokens(), so each is named once.
    computeFailures: new Set(),

    // Runs on every state change, outside buildTokens()'s guard, so one token that
    // throws must not stop the announcement: it reads 0 or false, and is named once.
    computeTokens() {
        const settings = window.SettingsState;
        const tokens = {};
        this.tokenSources.forEach(({ def, ids }) => {
            try {
                tokens[def.id] = this.tokenValue(def, ids, settings);
            } catch (error) {
                tokens[def.id] = def.kind === "count" || def.kind === "sum" ? 0 : false;
                if (!this.computeFailures.has(def.id)) {
                    this.computeFailures.add(def.id);
                    console.error(`GameState: could not work out token "${def.id}", so it reads ${tokens[def.id]}`, error);
                }
            }
        });
        this.tokens = tokens;
    },

    broadcastChange() {
        this.computeTokens();
        window.dispatchEvent(new CustomEvent("trackerStateUpdated", {
            detail: {
                items: { ...this.items },
                tokens: { ...this.tokens }
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
        const { items, tokens } = e.detail;
        // Everything shown comes from data/, so all of it is escaped.
        const escape = text => String(text).replace(/[&<>"]/g, ch =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
        const header = label =>
            `<div style="margin-top:8px; border-bottom:1px dashed #444; padding-bottom:4px;"><strong>${label}</strong></div>`;
        const row = (key, value) => `<div style="display:flex; justify-content:space-between;">
                    <span style="color:#aaa;">${escape(key)}:</span>
                    <span style="color:#55ff55; font-weight:bold;">${escape(value)}</span>
                </div>`;

        let html = window.GameState.tokenSources.map(({ def }) => {
            const value = tokens[def.id];
            return `<div><strong>${escape(def.name)}:</strong> ${typeof value === "boolean" ? (value ? "YES ✅" : "NO ❌") : escape(value)}</div>`;
        }).join("");
        html += header("Active Flags &amp; Numbers:");

        const activeItems = Object.entries(items).filter(([_, val]) => val !== false && val !== 0);

        if (activeItems.length === 0) {
            html += `<div style="color:#888;">(Inventory Empty)</div>`;
        } else {
            activeItems.sort().forEach(([key, value]) => {
                html += row(key, value);
            });
        }

        const settings = window.SettingsState;
        if (settings) {
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
