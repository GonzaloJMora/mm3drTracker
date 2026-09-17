// settingsState.js
// window.SettingsState: the randomizer settings this tracker runs with, read out
// of data/settings.json. It owns them the way GameState owns the inventory, so
// anything that needs a setting asks here. How that file is written:
// ARCHITECTURE.md, *Settings*.

(function () {
    // Validated definitions, in settings.json order.
    const settings = new Map();
    // What was picked for each setting. A lock can override the pick without
    // replacing it, so the pick comes back once the lock lifts.
    const chosen = new Map();
    const startingMax = new Map();
    // settings.json's sections and groups, holding only the settings that read
    // cleanly, for the settings page to lay out.
    const sectionList = [];
    // Grid slot -> { controller, setters } from the grants, and each controlling
    // setting -> its slot. See slotSettings().
    const slotRoles = new Map();
    const controlledSlot = new Map();
    let alwaysGrants = [];
    let config = null;

    // What each class accepts as a value, and which grants a value switches on.
    // A new class is an entry here plus its control on the settings page.
    const CLASSES = {
        toggle: {
            isValue: (setting, value) => typeof value === "boolean",
            grantsFor: (setting, value) => (value === true ? setting.grants : [])
        },
        dropdown: {
            isValue: (setting, value) => typeof value === "string" && setting.options.has(value),
            grantsFor: (setting, value) => (setting.options.has(value) ? setting.options.get(value).grants : [])
        },
        number: {
            isValue: (setting, value) => Number.isInteger(value) && value >= setting.min && value <= setting.max,
            // A grant of "value" hands on the number picked.
            grantsFor: (setting, value) => setting.grants.map(grant =>
                (grant.value === "value" ? { slot: grant.slot, value } : grant))
        }
    };

    const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

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
        if (!setting || !CLASSES[setting.class].isValue(setting, value)) {
            console.warn(`SettingsState: ${JSON.stringify(value)} is not a value of "${id}".`);
            return false;
        }
        chosen.set(id, value);
        announce({ id, value });
        return true;
    }

    function reset() {
        settings.forEach(setting => chosen.set(setting.id, setting.default));
        announce({ reset: true });
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

    // A setting that grants one slot and nothing else controls that slot, so the
    // settings page steps through its choices when the slot is clicked. Every other
    // setting granting it only fills it in. Worked out from the grants, so no list
    // says which setting belongs to which slot.
    function slotSettings(slot) {
        const role = slotRoles.get(slot);
        if (!role) return { controller: null, setters: [] };
        return { controller: role.controller, setters: role.setters.filter(id => id !== role.controller) };
    }

    // How far along its slot a grant puts it, so choices can be ordered the way
    // clicking that slot on the tracker moves.
    function grantRank({ slot, value }) {
        const kind = window.GameState.slotKind(config, slot);
        if (kind === "progression") return config.progressions[slot].indexOf(value);
        if (kind === "capacity") return config.item_counts[slot].indexOf(value);
        if (kind === "counter" || kind === "digit") return value;
        return 0;
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
        if (!setting || !controlledSlot.has(id) || isForced(id)) return false;
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
        const setting = settings.get(id);
        return Boolean(setting && setting.class === "dropdown" &&
            [...setting.options.values()].some(option => option.value !== undefined));
    }

    // ---------- Clauses ----------

    // One shape serves vanilla_when and a lock's "when": true always matches, an
    // object matches when every setting it names has one of the values given, and
    // a list matches when any of its objects does. Anything malformed never
    // matches; clauseProblem() is what names it.
    function matchesWith(clause, valueOf) {
        if (clause === true) return true;
        return [].concat(clause).some(part => {
            if (!part || typeof part !== "object" || Array.isArray(part)) return false;
            const ids = Object.keys(part);
            return ids.length > 0 && ids.every(id =>
                settings.has(id) && [].concat(part[id]).includes(valueOf(id)));
        });
    }

    function clauseProblem(clause) {
        if (clause === true) return null;
        const parts = [].concat(clause);
        if (!parts.length) return "is an empty list, which never matches";

        for (const part of parts) {
            if (!part || typeof part !== "object" || Array.isArray(part)) {
                return "has to be true, an object, or a list of objects";
            }
            const ids = Object.keys(part);
            if (!ids.length) return "has an empty object, which never matches";

            for (const id of ids) {
                const setting = settings.get(id);
                if (!setting) return `names "${id}", which is not a setting`;
                const wanted = [].concat(part[id]);
                if (!wanted.length) return `gives "${id}" an empty list, which never matches`;
                const bad = wanted.findIndex(value => !CLASSES[setting.class].isValue(setting, value));
                if (bad !== -1) return `gives "${id}" ${JSON.stringify(wanted[bad])}, which is not one of its values`;
            }
        }
        return null;
    }

    function namedIn(clause) {
        return clause === true ? [] : [].concat(clause).flatMap(part => Object.keys(part));
    }

    // ---------- Starting items ----------

    // Every grant that applies, merged into one starting state of slot id -> the
    // value that slot starts at. Counters add, progressions and capacities keep
    // their highest stage, digits their highest number, and a plain item is on if
    // anything grants it. starting_max then caps the slots it names.
    function startingItems() {
        const state = {};

        const give = ({ slot, value }) => {
            const kind = window.GameState.slotKind(config, slot);
            const current = state[slot];

            if (kind === "counter") {
                if (value > 0) state[slot] = Math.min((current || 0) + value, config.item_counts[slot]);
            } else if (kind === "progression" || kind === "capacity") {
                const stages = kind === "progression" ? config.progressions[slot] : config.item_counts[slot];
                if (current === undefined || stages.indexOf(value) > stages.indexOf(current)) state[slot] = value;
            } else if (kind === "digit") {
                state[slot] = Math.max(current || 0, value);
            } else {
                state[slot] = true;
            }
        };

        alwaysGrants.forEach(give);
        settings.forEach(setting => {
            CLASSES[setting.class].grantsFor(setting, get(setting.id)).forEach(give);
        });
        startingMax.forEach((cap, slot) => {
            if (state[slot] > cap) state[slot] = cap;
        });
        return state;
    }

    // ---------- Reading settings.json ----------

    // Each entry is [where, problem]; the problem says what gets ignored.
    function readSettings(data, problems) {
        if (!data || !Array.isArray(data.sections)) {
            problems.push(["settings.json", 'has no "sections" list, so there are no settings']);
            return;
        }

        data.sections.forEach((section, s) => {
            if (!section || typeof section.name !== "string" || !Array.isArray(section.groups)) {
                problems.push([`sections[${s}]`, 'needs a "name" and a "groups" list, and is skipped']);
                return;
            }
            // One section at most is drawn as the item grids; anything else is a list.
            let view = "list";
            if (section.view === "item_grids" && !sectionList.some(entry => entry.view === "item_grids")) {
                view = "item_grids";
            } else if (section.view === "item_grids") {
                problems.push([`"${section.name}"`, 'is a second "item_grids" section; only the first is drawn as the item grids, so this one is a list']);
            } else if (section.view !== undefined && section.view !== "list") {
                problems.push([`"${section.name}"`, `has view ${JSON.stringify(section.view)}, which is not "list" or "item_grids", so it is a list`]);
            }
            const sectionEntry = { name: section.name, view, groups: [] };
            sectionList.push(sectionEntry);

            section.groups.forEach((group, g) => {
                const where = `"${section.name}" groups[${g}]`;
                if (!group || !Array.isArray(group.settings)) {
                    problems.push([where, 'has no "settings" list, and is skipped']);
                    return;
                }
                const groupEntry = { name: typeof group.name === "string" ? group.name : "", ids: [] };
                sectionEntry.groups.push(groupEntry);
                group.settings.forEach((raw, i) => {
                    if (readSetting(raw, `${where} settings[${i}]`, problems)) groupEntry.ids.push(raw.id);
                });
            });
        });
    }

    function readSetting(raw, position, problems) {
        const id = raw && raw.id;
        if (typeof id !== "string" || id === "") {
            problems.push([position, 'has no "id", and is skipped']);
            return;
        }

        const where = `"${id}"`;
        if (settings.has(id)) {
            problems.push([where, "is defined twice; the second one is skipped"]);
            return;
        }
        if (!own(CLASSES, raw.class)) {
            problems.push([where, `has class ${JSON.stringify(raw.class)}, which is not one of ${Object.keys(CLASSES).join(", ")}, and is skipped`]);
            return;
        }

        const setting = { id, name: raw.name, class: raw.class, raw, grants: [], forced: [], options: new Map() };
        if (typeof raw.name !== "string" || raw.name === "") {
            problems.push([where, 'has no "name"; its id is shown instead']);
            setting.name = id;
        }

        if (raw.class === "dropdown") {
            (Array.isArray(raw.options) ? raw.options : []).forEach((option, index) => {
                const optionId = option && option.id;
                if (typeof optionId !== "string" || optionId === "" || setting.options.has(optionId)) {
                    problems.push([`${where} options[${index}]`, 'has a missing or repeated "id", and is skipped']);
                    return;
                }
                if (option.value !== undefined && typeof option.value !== "number") {
                    problems.push([`${where} option "${optionId}"`, 'has a "value" that is not a number, and it is ignored']);
                }
                setting.options.set(optionId, {
                    id: optionId,
                    name: typeof option.name === "string" ? option.name : optionId,
                    value: typeof option.value === "number" ? option.value : undefined,
                    rawGrants: option.grants,
                    grants: []
                });
            });
            if (!setting.options.size) {
                problems.push([where, "is a dropdown with no usable options, and is skipped"]);
                return;
            }
            // A logic string counting to this setting needs a number whichever option
            // is picked, or the comparison is unmet on the options without one.
            const unvalued = [...setting.options.values()].filter(option => option.value === undefined);
            if (unvalued.length && unvalued.length < setting.options.size) {
                const ids = unvalued.map(option => `"${option.id}"`).join(", ");
                problems.push([where, `gives some options a "value" but not ${ids}, so a logic string counting to it is unmet while one of those is picked`]);
            }
        }

        if (raw.class === "number") {
            if (!Number.isInteger(raw.min) || !Number.isInteger(raw.max) || raw.min > raw.max) {
                problems.push([where, 'needs whole numbers for "min" and "max", with min no higher than max, and is skipped']);
                return;
            }
            setting.min = raw.min;
            setting.max = raw.max;
        }

        if (!CLASSES[setting.class].isValue(setting, raw.default)) {
            problems.push([where, `has default ${JSON.stringify(raw.default)}, which is not one of its values, and is skipped`]);
            return;
        }

        setting.default = raw.default;
        settings.set(id, setting);
        chosen.set(id, raw.default);
        return true;
    }

    // The picks handed over from the settings page (launch.js). One that no longer
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
            if (!CLASSES[setting.class].isValue(setting, handed[id])) {
                problems.push([where, `is ${JSON.stringify(handed[id])}, which is not one of its values, so it keeps its default`]);
                return;
            }
            chosen.set(id, handed[id]);
        });
    }

    // Only a grid slot can be granted, because a grant is what that slot starts at.
    function grantProblem(gridSlots, slot, value, setting) {
        if (!gridSlots.has(slot)) return "is not a slot in any config.json grid";
        const kind = window.GameState.slotKind(config, slot);

        if (value === "value") {
            if (!setting || setting.class !== "number") return 'uses "value", which only a number setting has';
            return kind === "counter" ? null : `uses "value" on a ${kind} slot, which needs a counter`;
        }
        if (kind === "toggle") {
            return value === true ? null : "can only be granted true";
        }
        if (kind === "counter") {
            const max = config.item_counts[slot];
            return Number.isInteger(value) && value >= 1 && value <= max ? null : `needs a count from 1 to ${max}`;
        }
        if (kind === "progression") {
            const stages = config.progressions[slot];
            return stages.includes(value) ? null : `needs one of its stages (${stages.join(", ")})`;
        }
        if (kind === "capacity") {
            const sizes = config.item_counts[slot];
            return sizes.includes(value) ? null : `needs one of its sizes (${sizes.join(", ")})`;
        }
        const top = config.bombers_code.max_digit_value;
        return Number.isInteger(value) && value >= 1 && value <= top ? null : `needs a digit from 1 to ${top}`;
    }

    function readAllGrants(data, problems) {
        const gridSlots = new Set(
            Object.values(config.grids)
                .filter(Array.isArray)
                .flat()
                .filter(slot => typeof slot === "string" && slot !== "")
        );

        const read = (raw, where, setting) => {
            if (raw === undefined) return [];
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
                problems.push([where, '"grants" has to be an object of slot ids, and is ignored']);
                return [];
            }
            return Object.keys(raw).flatMap(slot => {
                const problem = grantProblem(gridSlots, slot, raw[slot], setting);
                if (problem) {
                    problems.push([`${where} grant "${slot}"`, `${problem}, and is ignored`]);
                    return [];
                }
                return [{ slot, value: raw[slot] }];
            });
        };

        alwaysGrants = read(data && data.always_grants, "always_grants", null);

        settings.forEach(setting => {
            const where = `"${setting.id}"`;
            if (setting.class !== "dropdown") {
                setting.grants = read(setting.raw.grants, where, setting);
                return;
            }
            if (setting.raw.grants !== undefined) {
                problems.push([where, 'has "grants" on the dropdown itself, which belong on its options, and they are ignored']);
            }
            setting.options.forEach(option => {
                option.grants = read(option.rawGrants, `${where} option "${option.id}"`, setting);
            });
        });
    }

    function readSlotRoles(problems) {
        settings.forEach(setting => {
            const grants = setting.class === "dropdown"
                ? [...setting.options.values()].flatMap(option => option.grants)
                : setting.grants;
            const slots = [...new Set(grants.map(grant => grant.slot))];

            slots.forEach(slot => {
                if (!slotRoles.has(slot)) slotRoles.set(slot, { controller: null, setters: [] });
                slotRoles.get(slot).setters.push(setting.id);
            });

            // A number is typed, not stepped, so it only ever fills a slot in.
            if (setting.class === "number" || slots.length !== 1) return;
            const role = slotRoles.get(slots[0]);
            if (role.controller) {
                problems.push([`"${setting.id}"`, `grants only slot "${slots[0]}", as "${role.controller}" does; only "${role.controller}" steps through that slot on the settings page`]);
                return;
            }
            role.controller = setting.id;
            controlledSlot.set(setting.id, slots[0]);
        });
    }

    // Two passes, so "has a lock of its own" means a lock that survived its own
    // checks: an empty or wholly broken "forced" doesn't block another setting's.
    function readAllForced(problems) {
        const candidates = [];
        settings.forEach(setting => {
            const raw = setting.raw.forced;
            if (raw === undefined) return;
            if (!Array.isArray(raw)) {
                problems.push([`"${setting.id}"`, '"forced" has to be a list, and is ignored']);
                return;
            }

            raw.forEach((entry, index) => {
                const where = `"${setting.id}" forced[${index}]`;
                if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
                    problems.push([where, "has to be { when, value }, and is ignored"]);
                    return;
                }
                const whenProblem = clauseProblem(entry.when);
                if (whenProblem) {
                    problems.push([where, `"when" ${whenProblem}; the lock is ignored`]);
                    return;
                }
                if (!CLASSES[setting.class].isValue(setting, entry.value)) {
                    problems.push([where, `locks to ${JSON.stringify(entry.value)}, which is not one of its values; the lock is ignored`]);
                    return;
                }
                candidates.push({ setting, where, entry });
            });
        });

        const locked = new Set(candidates.map(candidate => candidate.setting.id));
        candidates.forEach(({ setting, where, entry }) => {
            const chained = namedIn(entry.when).filter(id => locked.has(id));
            if (chained.length) {
                problems.push([where, `"when" names ${chained.map(id => `"${id}"`).join(", ")}, which has a lock of its own; locks can't depend on locks, so this one is ignored`]);
                return;
            }
            setting.forced.push({ when: entry.when, value: entry.value });
        });
    }

    function readStartingMax(data, problems) {
        const raw = data && data.starting_max;
        if (raw === undefined) return;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            problems.push(["starting_max", "has to be an object of slot ids, and is ignored"]);
            return;
        }

        Object.keys(raw).forEach(slot => {
            const where = `starting_max "${slot}"`;
            if (!own(config.item_counts, slot) || window.GameState.slotKind(config, slot) !== "counter") {
                problems.push([where, "is not a counter slot, and is ignored"]);
                return;
            }
            if (!Number.isInteger(raw[slot]) || raw[slot] < 1) {
                problems.push([where, "needs a whole number of 1 or more, and is ignored"]);
                return;
            }
            startingMax.set(slot, raw[slot]);
        });
    }

    function checkHeartRules(problems) {
        const id = config.heart_rules && config.heart_rules.starting_hearts_setting;
        const setting = settings.get(id);
        if (!setting || setting.class !== "number") {
            problems.push([
                "config.json heart_rules.starting_hearts_setting",
                `names ${JSON.stringify(id)}, which is not a number setting, so hearts start from 0`
            ]);
        }
    }

    function report(problems) {
        if (!problems.length) return;
        console.warn(
            `SettingsState: ${problems.length} problem(s) reading the settings. ` +
            `Each line below says what is ignored because of it.`
        );
        problems.forEach(([where, problem]) => console.warn(`  ${where} ${problem}`));
    }

    // Each step in its own try/catch, so one that throws costs only what it reads:
    // the later steps still run, the handed-over picks still apply, and every
    // problem found is still reported.
    window.TrackerData.onReady(data => {
        config = data.config;
        const problems = [];

        [
            () => readSettings(data.settings, problems),
            () => readAllGrants(data.settings, problems),
            () => readSlotRoles(problems),
            () => readAllForced(problems),
            () => readStartingMax(data.settings, problems),
            () => checkHeartRules(problems),
            () => applyHandoff(problems)
        ].forEach(step => {
            try {
                step();
            } catch (error) {
                console.error("SettingsState: could not read the settings data", error);
            }
        });

        report(problems);
    });

    window.SettingsState = {
        get,
        set,
        reset,
        picks,
        isForced,
        lockedBy,
        describe,
        sections,
        slotSettings,
        step,
        list,
        matches: clause => matchesWith(clause, get),
        clauseProblem,
        numberOf,
        isNumeric,
        startingItems
    };
})();
