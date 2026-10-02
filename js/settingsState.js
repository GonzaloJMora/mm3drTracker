// settingsState.js
// window.SettingsState: the randomizer settings this tracker runs with, read out
// of data/settings.json. It owns them the way GameState owns the inventory, so
// anything that needs a setting asks here. Reading the file is settingsModel.js's;
// how it is written: ARCHITECTURE.md, *Settings*.

(function () {
    const Model = window.SettingsModel;
    // Validated definitions, in settings.json order.
    let settings = new Map();
    // What was picked for each setting. A lock can override the pick without
    // replacing it, so the pick comes back once the lock lifts.
    const chosen = new Map();
    let startingMax = new Map();
    // settings.json's sections and groups, holding only the settings that read
    // cleanly, for the settings page to lay out.
    let sectionList = [];
    // Grid slot -> { controller, setters } from the grants, and each controlling
    // setting -> its slot. See slotSettings().
    let slotRoles = new Map();
    let controlledSlot = new Map();
    let alwaysGrants = [];
    let config = null;
    // A loaded save's settings can't be changed until the save is let go, apart
    // from the ones it didn't hold. Separate from forced locks, which still apply.
    const held = new Set();
    const notInSave = new Set();

    // ---------- Values ----------

    // A lock's "when" reads picks rather than locked values. That is safe only
    // because a "when" may not name a setting that has a lock of its own.
    function lockFor(setting) {
        return setting.forced.find(entry => matchesWith(entry.when, id => chosen.get(id)));
    }

    function get(id) {
        const setting = settings.get(id);
        if (!setting) return undefined;
        const lock = lockFor(setting);
        return lock ? lock.value : chosen.get(id);
    }

    function isForced(id) {
        const setting = settings.get(id);
        return Boolean(setting && lockFor(setting));
    }

    function set(id, value) {
        const setting = settings.get(id);
        if (held.has(id)) return false;
        if (!setting || !Model.isValue(setting, value)) {
            console.warn(`SettingsState: ${JSON.stringify(value)} is not a value of "${id}".`);
            return false;
        }
        chosen.set(id, value);
        announce({ id, value });
        return true;
    }

    // Starts over, so it lets go of a loaded save too.
    function reset() {
        held.clear();
        notInSave.clear();
        settings.forEach(setting => chosen.set(setting.id, setting.default));
        announce({ reset: true });
    }

    // A loaded save's settings: values is { id: value } and editable the ids it
    // didn't hold. Everything else is held. A setting with no usable value takes
    // its default and stays editable too. Returns the ids that took a default.
    function holdFromSave(values, editable = []) {
        held.clear();
        notInSave.clear();
        const defaulted = [];
        settings.forEach(setting => {
            const value = values[setting.id];
            const usable = !editable.includes(setting.id) && Model.isValue(setting, value);
            chosen.set(setting.id, usable ? value : setting.default);
            if (usable) {
                held.add(setting.id);
            } else {
                notInSave.add(setting.id);
                defaulted.push(setting.id);
            }
        });
        announce({ loaded: true });
        return defaulted;
    }

    // Lets go of a loaded save and keeps its values, for a new run on them.
    function releaseSave() {
        held.clear();
        notInSave.clear();
        announce({ released: true });
    }

    // A pick can lock or unlock other settings, so a listener redraws them all.
    function announce(detail) {
        window.dispatchEvent(new CustomEvent("settingsChanged", { detail }));
    }

    // Every pick that differs from its default, as { settingId: value }: what the
    // settings page hands to the tracker. Picks rather than locked values, so the
    // tracker works the locks out again for itself.
    function picks() {
        const result = {};
        settings.forEach(setting => {
            const value = chosen.get(setting.id);
            if (value !== setting.default) result[setting.id] = value;
        });
        return result;
    }

    // Every setting's pick, default or not, for a save.
    function snapshot() {
        const result = {};
        settings.forEach(setting => { result[setting.id] = chosen.get(setting.id); });
        return result;
    }

    // The settings behind a lock, as { id, value } pairs from the part of its
    // "when" that matched. Empty when the setting is not locked, or locked by true.
    function lockedBy(id) {
        const setting = settings.get(id);
        const lock = setting && lockFor(setting);
        if (!lock || lock.when === true) return [];
        const part = [].concat(lock.when).find(clause => matchesWith(clause, other => chosen.get(other)));
        return Object.keys(part).map(other => ({ id: other, value: chosen.get(other) }));
    }

    function describe(id) {
        const setting = settings.get(id);
        if (!setting) return undefined;
        const slot = controlledSlot.get(id) || null;
        const granting = (slot ? choicesInSlotOrder(setting) : []).filter(choice => choice.rank >= 0);
        return {
            id,
            name: setting.name,
            class: setting.class,
            default: setting.default,
            min: setting.min,
            max: setting.max,
            options: [...setting.options.values()].map(option => ({ id: option.id, name: option.name })),
            // The grid slot this setting alone controls, and the choices that put
            // something in it.
            slot,
            slotChoices: granting.map(choice => choice.value),
            // Choices that look the same in the slot, like stick capacities that all
            // just own the sticks, so the slot has to name the pick.
            labelsInSlot: new Set(granting.map(choice => choice.rank)).size < granting.length
        };
    }

    function sections() {
        return sectionList.map(section => ({
            name: section.name,
            view: section.view,
            groups: section.groups.map(group => ({ name: group.name, ids: [...group.ids] }))
        }));
    }

    // ---------- Grid slots ----------

    // Which setting steps through a slot on the settings page, and which others
    // only fill it in (settingsModel.js works it out from the grants).
    function slotSettings(slot) {
        const role = slotRoles.get(slot);
        if (!role) return { controller: null, setters: [] };
        return { controller: role.controller, setters: role.setters.filter(id => id !== role.controller) };
    }

    // How far along its slot a grant puts it, so choices can be ordered the way
    // clicking that slot on the tracker moves.
    function grantRank({ slot, value }) {
        const rank = window.GameState.grantedValue(config, slot, value);
        return rank === null ? -1 : rank;
    }

    // A controlling setting's choices in slot order: a choice that grants nothing
    // first, then up the slot, ties in menu order.
    function choicesInSlotOrder(setting) {
        if (setting.class === "toggle") return [{ value: false, rank: -1 }, { value: true, rank: 0 }];
        const slot = controlledSlot.get(setting.id);
        return [...setting.options.values()]
            .map((option, index) => {
                const grant = option.grants.find(entry => entry.slot === slot);
                return { value: option.id, rank: grant ? grantRank(grant) : -1, index };
            })
            .sort((a, b) => a.rank - b.rank || a.index - b.index);
    }

    // Clicking a slot on the settings page: the next choice along it, or the one
    // before, wrapping. A locked setting doesn't move.
    function step(id, direction) {
        const setting = settings.get(id);
        if (!setting || !controlledSlot.has(id) || isForced(id) || held.has(id)) return false;
        const choices = choicesInSlotOrder(setting).map(choice => choice.value);
        const at = choices.indexOf(chosen.get(id));
        return set(id, choices[(at + direction + choices.length) % choices.length]);
    }

    function list() {
        return [...settings.values()].map(setting => ({
            id: setting.id,
            value: get(setting.id),
            default: setting.default,
            forced: isForced(setting.id)
        }));
    }

    // The number a setting stands for after >= in a logic string. Only a dropdown
    // whose options carry a "value" has one; for anything else it is undefined,
    // which leaves the comparison unmet.
    function numberOf(id) {
        const setting = settings.get(id);
        if (!isNumeric(id)) return undefined;
        const option = setting.options.get(get(id));
        return option ? option.value : undefined;
    }

    function isNumeric(id) {
        return Model.isNumeric(settings.get(id));
    }

    // ---------- Clauses ----------

    function matchesWith(clause, valueOf) {
        return Model.matches(settings, clause, valueOf);
    }

    // ---------- Starting items ----------

    // Every grant that applies, merged into one starting state of slot id -> the
    // value that slot starts at. Counters add, progressions keep their highest
    // stage, digits their highest number, and a plain item is on if anything
    // grants it. starting_max then caps the slots it names.
    function startingItems() {
        const state = {};

        const give = ({ slot, value }) => {
            const kind = window.GameState.slotKind(config, slot);
            const current = state[slot];

            if (kind === "counter") {
                if (value > 0) state[slot] = Math.min((current || 0) + value, config.item_counts[slot]);
            } else if (kind === "progression") {
                const stages = config.progressions[slot];
                if (current === undefined || stages.indexOf(value) > stages.indexOf(current)) state[slot] = value;
            } else if (kind === "digit") {
                state[slot] = Math.max(current || 0, value);
            } else {
                state[slot] = true;
            }
        };

        alwaysGrants.forEach(give);
        settings.forEach(setting => {
            Model.grantsFor(setting, get(setting.id)).forEach(give);
        });
        startingMax.forEach((cap, slot) => {
            if (state[slot] > cap) state[slot] = cap;
        });
        return state;
    }

    // ---------- Starting up ----------

    // The picks handed over from the settings page (trackerLaunch.js). One that no longer
    // fits the data keeps its default rather than stopping the rest.
    function applyHandoff(problems) {
        const handed = window.TrackerLaunch ? window.TrackerLaunch.read() : null;
        if (!handed) return;

        Object.keys(handed).forEach(id => {
            const where = `handed-over "${id}"`;
            const setting = settings.get(id);
            if (!setting) {
                problems.push([where, "is not a setting, and is ignored"]);
                return;
            }
            if (!Model.isValue(setting, handed[id])) {
                problems.push([where, `is ${JSON.stringify(handed[id])}, which is not one of its values, so it keeps its default`]);
                return;
            }
            chosen.set(id, handed[id]);
        });
    }

    // Picks that no longer fit the data are about this tab, not the files, so they
    // are named here rather than by the data checks.
    function report(problems) {
        if (!problems.length) return;
        console.warn(`SettingsState: ${problems.length} handed-over pick(s) don't fit the settings.`);
        problems.forEach(([where, problem]) => console.warn(`  ${where} ${problem}`));
    }

    // The data checks have already named whatever settings.json gets wrong
    // (dataChecks.js, the "settings-" rules), so the findings aren't printed again.
    window.TrackerData.onReady(data => {
        config = data.config;
        const problems = [];
        try {
            const read = Model.read(data.settings, config);
            settings = read.settings;
            sectionList = read.sections;
            alwaysGrants = read.alwaysGrants;
            startingMax = read.startingMax;
            slotRoles = read.slotRoles;
            controlledSlot = read.controlledSlot;
            settings.forEach(setting => chosen.set(setting.id, setting.default));
            applyHandoff(problems);
        } catch (error) {
            console.error("SettingsState: could not read the settings data", error);
        }
        report(problems);
    });

    window.SettingsState = {
        get,
        set,
        reset,
        holdFromSave,
        releaseSave,
        holdsSave: () => held.size > 0 || notInSave.size > 0,
        isHeld: id => held.has(id),
        isNotInSave: id => notInSave.has(id),
        picks,
        snapshot,
        isForced,
        lockedBy,
        describe,
        sections,
        slotSettings,
        step,
        list,
        matches: clause => matchesWith(clause, get),
        numberOf,
        isNumeric,
        startingItems
    };
})();
