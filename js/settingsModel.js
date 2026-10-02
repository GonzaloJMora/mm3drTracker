// window.SettingsModel — reads data/settings.json into what settingsState.js runs
// on: every setting that reads cleanly, the sections the settings page lays out,
// the grants, the locks, starting_max and which setting controls which grid slot.
// Also the clause shape vanilla_when and a lock's "when" share. No DOM, so the
// tests read the file through exactly the same code (tests/node/dataChecks.test.js).
//
// Reading never warns. What it finds wrong comes back as findings, { rule, lines },
// which dataChecks.js titles and the page prints: see ARCHITECTURE.md, *When the
// data is wrong*. How the file is written: ARCHITECTURE.md, *Settings*.
(function (root) {
    "use strict";

    const model = () => root.DataModel || require("./dataModel.js");
    const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    const isObject = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);

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

    const isValue = (setting, value) => CLASSES[setting.class].isValue(setting, value);
    const grantsFor = (setting, value) => CLASSES[setting.class].grantsFor(setting, value);

    // Whether a setting can stand after >= in a logic string: a dropdown whose
    // options carry a "value".
    const isNumeric = setting => Boolean(setting && setting.class === "dropdown" &&
        [...setting.options.values()].some(option => option.value !== undefined));

    // ---------- Clauses ----------

    // One shape serves vanilla_when and a lock's "when": true always matches, an
    // object matches when every setting it names has one of the values given, and
    // a list matches when any of its objects does. Anything malformed never
    // matches; clauseProblem() is what names it. settings is read()'s map.
    function matches(settings, clause, valueOf) {
        if (clause === true) return true;
        return [].concat(clause).some(part => {
            if (!isObject(part)) return false;
            const ids = Object.keys(part);
            return ids.length > 0 && ids.every(id =>
                settings.has(id) && [].concat(part[id]).includes(valueOf(id)));
        });
    }

    function clauseProblem(settings, clause) {
        if (clause === true) return null;
        const parts = [].concat(clause);
        if (!parts.length) return "is an empty list, which never matches";

        for (const part of parts) {
            if (!isObject(part)) return "has to be true, an object, or a list of objects";
            const ids = Object.keys(part);
            if (!ids.length) return "has an empty object, which never matches";

            for (const id of ids) {
                const setting = settings.get(id);
                if (!setting) return `names "${id}", which is not a setting`;
                const wanted = [].concat(part[id]);
                if (!wanted.length) return `gives "${id}" an empty list, which never matches`;
                const bad = wanted.findIndex(value => !isValue(setting, value));
                if (bad !== -1) return `gives "${id}" ${JSON.stringify(wanted[bad])}, which is not one of its values`;
            }
        }
        return null;
    }

    function namedIn(clause) {
        return clause === true ? [] : [].concat(clause).flatMap(part => Object.keys(part));
    }

    // ---------- Reading settings.json ----------

    // Each step pushes [where, problem] to its own list; the problem says what gets
    // ignored.
    function readSections(json, read, problems) {
        if (!isObject(json) || !Array.isArray(json.sections)) {
            problems.push(["settings.json", 'needs a "sections" list, so there are no settings']);
            return;
        }
        json.sections.forEach((section, s) => {
            if (!section || typeof section.name !== "string" || !Array.isArray(section.groups)) {
                problems.push([`sections[${s}]`, 'needs a "name" and a "groups" list, and is skipped']);
                return;
            }
            // One section at most is drawn as the item grids; anything else is a list.
            let view = "list";
            if (section.view === "item_grids" && !read.sections.some(entry => entry.view === "item_grids")) {
                view = "item_grids";
            } else if (section.view === "item_grids") {
                problems.push([`"${section.name}"`, 'is a second "item_grids" section; only the first is drawn as the item grids, so this one is a list']);
            } else if (section.view !== undefined && section.view !== "list") {
                problems.push([`"${section.name}"`, `has view ${JSON.stringify(section.view)}, which is not "list" or "item_grids", so it is a list`]);
            }
            const sectionEntry = { name: section.name, view, groups: [] };
            read.sections.push(sectionEntry);

            section.groups.forEach((group, g) => {
                const where = `"${section.name}" groups[${g}]`;
                if (!group || !Array.isArray(group.settings)) {
                    problems.push([where, 'has no "settings" list, and is skipped']);
                    return;
                }
                const groupEntry = { name: typeof group.name === "string" ? group.name : "", ids: [] };
                sectionEntry.groups.push(groupEntry);
                group.settings.forEach((raw, i) => {
                    if (readSetting(raw, `${where} settings[${i}]`, read.settings, problems)) groupEntry.ids.push(raw.id);
                });
            });
        });
    }

    function readSetting(raw, position, settings, problems) {
        const id = raw && raw.id;
        if (typeof id !== "string" || id === "") {
            problems.push([position, 'has no "id", and is skipped']);
            return false;
        }

        const where = `"${id}"`;
        if (settings.has(id)) {
            problems.push([where, "is defined twice; the second one is skipped"]);
            return false;
        }
        if (!has(CLASSES, raw.class)) {
            problems.push([where, `has class ${JSON.stringify(raw.class)}, which is not one of ${Object.keys(CLASSES).join(", ")}, and is skipped`]);
            return false;
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
                return false;
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
                return false;
            }
            setting.min = raw.min;
            setting.max = raw.max;
        }

        if (!isValue(setting, raw.default)) {
            problems.push([where, `has default ${JSON.stringify(raw.default)}, which is not one of its values, and is skipped`]);
            return false;
        }

        setting.default = raw.default;
        settings.set(id, setting);
        return true;
    }

    // Only a grid slot can be granted, because a grant is what that slot starts at.
    function grantProblem(config, gridSlots, slot, value, setting) {
        const m = model();
        if (!gridSlots.has(slot)) return "is not a slot in any grid in config/grids.json";
        const { kind, high } = m.slotBounds(config, slot);

        if (value === "value") {
            if (!setting || setting.class !== "number") return 'uses "value", which only a number setting has';
            return kind === "counter" ? null : `uses "value" on a ${kind} slot, which needs a counter`;
        }
        // A grant of 0 would start nothing, so a count or digit starts from 1.
        const fits = m.grantedValue(config, slot, value);
        if (fits !== null && fits <= high) return null;
        if (kind === "toggle") return "can only be granted true";
        if (kind === "counter") return `needs a count from 1 to ${high}`;
        if (kind === "progression") return `needs one of its stages (${config.progressions[slot].join(", ")})`;
        return `needs a digit from 1 to ${high}`;
    }

    function readGrants(json, config, read, problems) {
        const gridSlots = new Set(model().gridSlots(config));

        const readOne = (raw, where, setting) => {
            if (raw === undefined) return [];
            if (!isObject(raw)) {
                problems.push([where, '"grants" has to be an object of slot ids, and is ignored']);
                return [];
            }
            return Object.keys(raw).flatMap(slot => {
                const problem = grantProblem(config, gridSlots, slot, raw[slot], setting);
                if (problem) {
                    problems.push([`${where} grant "${slot}"`, `${problem}, and is ignored`]);
                    return [];
                }
                return [{ slot, value: raw[slot] }];
            });
        };

        read.alwaysGrants = readOne(json && json.always_grants, "always_grants", null);

        read.settings.forEach(setting => {
            const where = `"${setting.id}"`;
            if (setting.class !== "dropdown") {
                setting.grants = readOne(setting.raw.grants, where, setting);
                return;
            }
            if (setting.raw.grants !== undefined) {
                problems.push([where, 'has "grants" on the dropdown itself, which belong on its options, and they are ignored']);
            }
            setting.options.forEach(option => {
                option.grants = readOne(option.rawGrants, `${where} option "${option.id}"`, setting);
            });
        });
    }

    function readStartingMax(json, config, read, problems) {
        const raw = json && json.starting_max;
        if (raw === undefined) return;
        if (!isObject(raw)) {
            problems.push(["starting_max", "has to be an object of slot ids, and is ignored"]);
            return;
        }

        Object.keys(raw).forEach(slot => {
            const where = `starting_max "${slot}"`;
            if (!has(config.item_counts || {}, slot) || model().slotKind(config, slot) !== "counter") {
                problems.push([where, "is not a counter slot, and is ignored"]);
                return;
            }
            if (!Number.isInteger(raw[slot]) || raw[slot] < 1) {
                problems.push([where, "needs a whole number of 1 or more, and is ignored"]);
                return;
            }
            read.startingMax.set(slot, raw[slot]);
        });
    }

    // A setting that grants one slot and nothing else controls that slot, so the
    // settings page steps through its choices when the slot is clicked. Every other
    // setting granting it only fills it in. Worked out from the grants, so no list
    // says which setting belongs to which slot.
    function readSlotRoles(read, problems) {
        read.settings.forEach(setting => {
            const grants = setting.class === "dropdown"
                ? [...setting.options.values()].flatMap(option => option.grants)
                : setting.grants;
            const slots = [...new Set(grants.map(grant => grant.slot))];

            slots.forEach(slot => {
                if (!read.slotRoles.has(slot)) read.slotRoles.set(slot, { controller: null, setters: [] });
                read.slotRoles.get(slot).setters.push(setting.id);
            });

            // A number is typed, not stepped, so it only ever fills a slot in.
            if (setting.class === "number" || slots.length !== 1) return;
            const role = read.slotRoles.get(slots[0]);
            if (role.controller) {
                problems.push([`"${setting.id}"`, `grants only slot "${slots[0]}", as "${role.controller}" does; only "${role.controller}" steps through that slot on the settings page`]);
                return;
            }
            role.controller = setting.id;
            read.controlledSlot.set(setting.id, slots[0]);
        });
    }

    // Two passes, so "has a lock of its own" means a lock that survived its own
    // checks: an empty or wholly broken "forced" doesn't block another setting's.
    function readLocks(read, problems) {
        const candidates = [];
        read.settings.forEach(setting => {
            const raw = setting.raw.forced;
            if (raw === undefined) return;
            if (!Array.isArray(raw)) {
                problems.push([`"${setting.id}"`, '"forced" has to be a list, and is ignored']);
                return;
            }

            raw.forEach((entry, index) => {
                const where = `"${setting.id}" forced[${index}]`;
                if (!isObject(entry)) {
                    problems.push([where, "has to be { when, value }, and is ignored"]);
                    return;
                }
                const whenProblem = clauseProblem(read.settings, entry.when);
                if (whenProblem) {
                    problems.push([where, `"when" ${whenProblem}; the lock is ignored`]);
                    return;
                }
                if (!isValue(setting, entry.value)) {
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

    // settings.json read against the merged config. Each step in its own try/catch,
    // so one that throws costs only what it reads and the later steps still run.
    // A step's problems are findings under its own rule.
    function read(json, config) {
        const result = {
            settings: new Map(),   // id -> setting, in settings.json order
            sections: [],          // only the settings that read cleanly
            alwaysGrants: [],
            startingMax: new Map(),
            slotRoles: new Map(),  // grid slot -> { controller, setters }
            controlledSlot: new Map(), // controlling setting -> its slot
            findings: []
        };
        [
            ["settings-entries", problems => readSections(json, result, problems)],
            ["settings-grants", problems => {
                readGrants(json, config, result, problems);
                readStartingMax(json, config, result, problems);
            }],
            ["settings-slots", problems => readSlotRoles(result, problems)],
            ["settings-locks", problems => readLocks(result, problems)]
        ].forEach(([rule, step]) => {
            const problems = [];
            try {
                step(problems);
            } catch (error) {
                problems.push(["settings.json", `could not be read past here (${error && error.message})`]);
            }
            if (problems.length) result.findings.push({ rule, lines: problems.map(([where, problem]) => `${where} ${problem}`) });
        });
        return result;
    }

    const api = { CLASSES, read, isValue, grantsFor, isNumeric, matches, clauseProblem };
    root.SettingsModel = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
