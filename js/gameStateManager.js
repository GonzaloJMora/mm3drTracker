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
    // The settings page runs init() again on every change to preview the starting
    // items, so the data is checked on the first run only.
    dataChecked: false,

    // What kind of slot an id is. Read from config alone rather than this.config,
    // so it works before init() — the settings grants need it that early.
    slotKind(config, slotId) {
        if (Object.prototype.hasOwnProperty.call(config.progressions, slotId)) return "progression";
        const rule = Object.prototype.hasOwnProperty.call(config.item_counts, slotId)
            ? config.item_counts[slotId]
            : undefined;
        if (Number.isInteger(rule)) return "counter";
        if (this.digitIds(config).includes(slotId)) return "digit";
        return "toggle";
    },

    // The slots that each hold a digit. Read from config alone, like slotKind().
    digitIds(config) {
        return (config.digit_slots && Array.isArray(config.digit_slots.ids)) ? config.digit_slots.ids : [];
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

    // Every value a slot can hold, whatever the settings: a stage from -1 (not
    // owned) or a count from 0, up to the last stage, the counter's cap or the
    // highest digit. Read from config alone, like slotKind(), so the settings and the
    // save layout check can ask before init().
    slotBounds(config, slotId) {
        const kind = this.slotKind(config, slotId);
        const counted = kind === "counter" || kind === "digit";
        let high = 0;
        if (kind === "progression") high = config.progressions[slotId].length - 1;
        else if (kind === "counter") high = config.item_counts[slotId];
        else if (kind === "digit") high = config.digit_slots.max_value;
        return { kind, low: counted ? 0 : -1, high };
    },

    // What a grant from settings.json means for its slot: the stage a progression's
    // item id stands for, a count or digit as it is, true as a plain item's 0. Null
    // when the grant doesn't fit that kind of slot. Config alone, like slotBounds().
    grantedValue(config, slotId, granted) {
        const kind = this.slotKind(config, slotId);
        if (kind === "progression") {
            const stage = config.progressions[slotId].indexOf(granted);
            return stage >= 0 ? stage : null;
        }
        if (kind === "counter" || kind === "digit") {
            return Number.isInteger(granted) && granted > 0 ? granted : null;
        }
        return granted === true ? 0 : null;
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

    // Every slot the grids draw, once each, in grid order. Config alone, so the
    // settings can ask before init(); a grid that isn't a list is skipped, and
    // itemGrids.js names it.
    gridSlots(config = this.config) {
        const ids = new Set();
        Object.values((config && config.grids) || {}).forEach(grid => {
            if (!Array.isArray(grid)) return;
            grid.forEach(id => { if (typeof id === "string" && id !== "") ids.add(id); });
        });
        return [...ids];
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
        const firstRun = !this.dataChecked;

        if (firstRun) {
            this.dataChecked = true;

            // A slot in both would be treated as a progression but handed the counter
            // rule as its chain, so the click silently does nothing — quiet enough to
            // be worth naming.
            Object.keys(this.config.progressions).forEach(slotId => {
                if (Object.prototype.hasOwnProperty.call(this.config.item_counts, slotId)) {
                    console.warn(
                        `GameState: "${slotId}" is in both progressions and item_counts in config/inventory.json. ` +
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
            this.items[slotId] = 0;
        });

        this.digitIds(this.config).forEach(slotId => {
            this.items[slotId] = 0;
        });

        this.buildTokens(itemsList, firstRun);

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
    // out, with the item ids it looks at. A token with a fault warns once and still
    // exists, reading 0 or false, so logic that names it stays parseable; one that
    // has no usable id or kind is left out.
    buildTokens(itemsList, report) {
        const warn = (id, problem) => {
            if (report) console.warn(`GameState: token "${id}" in config/logicTokens.json ${problem}`);
        };
        const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
        const defs = this.config.tokens;
        // Groups and tags say what an item means, where the grids only say where a
        // slot is drawn: moving an item to another panel must not change a count.
        const groups = this.config.item_groups || {};
        const settings = window.SettingsState;

        this.tokenSources = [];
        if (!Array.isArray(defs)) {
            if (report) console.warn('GameState: config/logicTokens.json has no "tokens" list, so no token has a value.');
            this.computeTokens();
            return;
        }

        const seen = new Set();
        defs.forEach((def, index) => {
            try {
                if (!def || typeof def !== "object" || typeof def.id !== "string" || def.id === "" || typeof def.name !== "string") {
                    if (report) console.warn(`GameState: tokens[${index}] in config/logicTokens.json needs a string "id" and "name", and is skipped.`);
                    return;
                }
                if (seen.has(def.id)) return warn(def.id, "is listed twice, and the second is skipped.");
                if (has(this.items, def.id)) return warn(def.id, "has the id of an item, which would replace it in every check, and is skipped.");
                seen.add(def.id);

                let ids = [];
                if (def.kind === "count" || def.kind === "any") {
                    if (has(def, "group") === has(def, "tag")) {
                        warn(def.id, 'needs exactly one of "group" or "tag", so it reads as empty.');
                    } else if (has(def, "group")) {
                        const group = has(groups, def.group) ? groups[def.group] : undefined;
                        if (group === undefined) {
                            warn(def.id, `names the group "${def.group}", which is not in item_groups, so it reads as empty.`);
                        } else if (!Array.isArray(group)) {
                            warn(def.id, `names the group "${def.group}", which is not a list of item ids in item_groups, so it reads as empty.`);
                        } else {
                            ids = group;
                            const unknown = group.filter(id => typeof id !== "string" || !has(this.items, id));
                            if (unknown.length) {
                                warn(def.id, `reads the group "${def.group}", whose ${unknown.map(id => JSON.stringify(id)).join(", ")} ` +
                                    `${unknown.length === 1 ? "is not an item" : "are not items"}, so ${unknown.length === 1 ? "it counts" : "they count"} as never owned.`);
                            }
                        }
                    } else {
                        ids = itemsList.filter(item => item[def.tag]).map(item => item.id);
                        if (!ids.length) warn(def.id, `names the tag "${def.tag}", which no item in Items.json has, so it reads as empty.`);
                    }
                } else if (def.kind === "sum") {
                    const terms = Array.isArray(def.terms) ? def.terms : [];
                    if (!terms.length) warn(def.id, 'needs a non-empty "terms" list, so it reads as 0.');
                    def = Object.assign({}, def, { terms: terms.filter(term => {
                        if (term && typeof term.setting === "string") {
                            if (!settings || typeof settings.get(term.setting) !== "number") {
                                warn(def.id, `has a term naming "${term.setting}", which is not a number setting, so that term counts as 0.`);
                            }
                            return true;
                        }
                        if (term && typeof term.item === "string" && has(this.items, term.item)
                            && (term.per === undefined || (Number.isInteger(term.per) && term.per >= 1))) {
                            return true;
                        }
                        warn(def.id, `has a term that is neither a setting nor a known item with a "per" of 1 or more (${JSON.stringify(term)}), and it is skipped.`);
                        return false;
                    }) });
                } else if (def.kind === "distinct") {
                    const source = this.config[def.slots];
                    if (source && Array.isArray(source.ids) && source.ids.length) ids = source.ids;
                    else if (source && Array.isArray(source.ids)) warn(def.id, `names "${def.slots}" as its slots, whose "ids" list is empty, so it reads as false.`);
                    else warn(def.id, `names "${def.slots}" as its slots, which has no "ids" list, so it reads as false.`);
                } else {
                    return warn(def.id, `has the kind ${JSON.stringify(def.kind)}, which is not count, any, sum or distinct, and is skipped.`);
                }

                this.tokenSources.push({ def, ids });
            } catch (error) {
                console.error(`GameState: could not read token ${JSON.stringify(def && def.id)}`, error);
            }
        });

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
