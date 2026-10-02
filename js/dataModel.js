// window.DataModel — reads the files in data/ into what the page uses: the config
// merged from its parts, Items.json's usable entries, check_groups that can be
// linked, every region's sub-region tree flattened into one check list, the
// regions that can render, the slot model, the logic tokens and the location
// flags and logic helpers by name. No DOM and no fetching, so the tests read the
// files through exactly the same code (tests/node/dataChecks.test.js).
//
// Reading never warns. Each step returns what it found wrong as findings,
// { rule, lines }, which dataChecks.js titles and the page prints: see
// ARCHITECTURE.md, *When the data is wrong*.
(function (root) {
    "use strict";

    const isObject = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
    const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

    // ---------- Config, items and check groups ----------

    // parts is every file config.json lists, as { name, data }, in its order. A key
    // in two files: the later one wins.
    function mergeConfig(parts) {
        const config = {};
        const lines = [];
        parts.forEach(({ name, data }) => {
            Object.keys(data).forEach(key => {
                if (has(config, key)) lines.push(`"${key}" is in more than one config file (again in ${name}), so the later one wins.`);
                config[key] = data[key];
            });
        });
        return { config, findings: lines.length ? [{ rule: "config-keys", lines }] : [] };
    }

    // An entry without an id throws in every file that reads the items, so it is
    // dropped here, and a grid slot naming it draws empty.
    function readItems(items) {
        const bad = [];
        const kept = items.filter((item, index) => {
            if (isObject(item) && typeof item.id === "string" && item.id !== "") return true;
            bad.push(index);
            return false;
        });
        return {
            items: kept,
            findings: bad.length ? [{ rule: "item-ids", lines: [`Items.json entries ${bad.map(index => `[${index}]`).join(", ")} have no "id", and are dropped.`] }] : []
        };
    }

    // Three files read check_groups, and one bad group throws in all of them, so a
    // group that can't be used is dropped here. Whether its ids match real checks is
    // asked once the regions are read ("check-groups").
    function readCheckGroups(config) {
        if (!has(config, "check_groups")) return [];
        const groups = config.check_groups;
        if (!Array.isArray(groups)) {
            config.check_groups = [];
            return [{ rule: "check-group-shape", lines: ['config/checkGroups.json\'s "check_groups" is not a list, so no checks are linked.'] }];
        }
        const lines = [];
        config.check_groups = groups.filter((group, index) => {
            const where = `check_groups[${index}]`;
            if (!Array.isArray(group)) lines.push(`${where} is not a list of check ids`);
            else if (!group.every(id => typeof id === "string" && id.trim() !== "")) lines.push(`${where} has an entry that is not a check id`);
            else if (group.length < 2) lines.push(`${where} links fewer than two checks`);
            else return true;
            return false;
        });
        return lines.length ? [{ rule: "check-group-shape", lines }] : [];
    }

    // ---------- Regions ----------

    // A region read from its file: region is the parsed object, file its manifest name.
    // The name is trimmed first, or "Name " and "Name" pass as two regions and render
    // as one name twice. A blank name is left empty for acceptRegions() to reject.
    function trimRegionName(region, file) {
        const name = region.region_name;
        if (typeof name !== "string" || name === name.trim()) return [];
        region.region_name = name.trim();
        return region.region_name
            ? [{ rule: "region-names", lines: [`${file}'s region_name has spaces around it, and is read as "${region.region_name}".`] }]
            : [];
    }

    // How a finding names a region: its name, with its file when another region
    // shares the name, or just its file when the name is unusable.
    function labeller(regions, fileOf) {
        const seen = new Set();
        const shared = new Set();
        regions.forEach(({ region_name: name }) => {
            if (typeof name !== "string" || name === "") return;
            if (seen.has(name)) shared.add(name);
            seen.add(name);
        });
        return region => {
            const name = region.region_name;
            const file = fileOf(region) || "a region file";
            if (typeof name !== "string" || name === "") return file;
            return shared.has(name) ? `${name} (${file})` : name;
        };
    }

    // A region file may nest its checks in sub-regions, so checks sharing a
    // requirement write it once. Flattening to one item_checks list here is what
    // lets every other file go on reading the list it has always read.
    //
    // `logic` accumulates the whole way down: you pass through every area to reach
    // a check. `vanilla_when` and `vanilla_item` instead come from the nearest node
    // that sets one and replace rather than merge, because whether a check is
    // randomized is a property of that one check, not something it collects on the
    // way in. See ARCHITECTURE.md, *Sub-regions*.
    function resolveRegion(region, label) {
        const problems = [];
        const checks = [];

        function addCheck(check, path, carried) {
            const where = [label, ...path, check.id].join(" -> ");
            const resolved = Object.assign({}, check);
            resolved.group_logic = carried.logic;
            resolved.group_path = path;

            if (!has(check, "vanilla_when") && carried.when !== undefined) {
                resolved.vanilla_when = carried.when;
                resolved.vanilla_when_from = carried.whenFrom;
            }
            if (!has(check, "vanilla_item") && carried.item !== undefined) {
                resolved.vanilla_item = carried.item;
                resolved.vanilla_item_from = carried.itemFrom;
            }

            // false says "randomized whatever my group said", which is what an absent
            // clause already means everywhere downstream — so it normalizes to absent
            // rather than becoming a second spelling every check has to know. An item
            // it only inherited goes with it; one it names itself is a mistake.
            if (resolved.vanilla_when === false) {
                if (has(check, "vanilla_item")) {
                    problems.push(`${where}: names a vanilla_item but sets vanilla_when to false, so it never shows`);
                }
                delete resolved.vanilla_when;
                delete resolved.vanilla_when_from;
                delete resolved.vanilla_item;
                delete resolved.vanilla_item_from;
            }

            // null is how a check says "vanilla, holding nothing listed" against a
            // group that set an item. Absent already means inherit, so this needs a
            // spelling of its own; nothing downstream has to see it.
            if (resolved.vanilla_item === null) {
                delete resolved.vanilla_item;
                delete resolved.vanilla_item_from;
            }

            checks.push(resolved);
        }

        function walk(node, path, inherited, isRoot) {
            const where = [label, ...path].join(" -> ");
            const carried = Object.assign({}, inherited);

            // The region's own logic reaches a check through locationTracker.js, which
            // holds it separately, so only a sub-region's adds to the chain here.
            // Logic that isn't text goes into the chain too, where LogicParser rejects
            // it and the checks below read unreachable, as they would at any other
            // level. Dropped, it would let them turn green early.
            if (!isRoot && node.logic !== undefined && node.logic !== null && node.logic !== "") {
                if (typeof node.logic !== "string") {
                    problems.push(`${where}: logic is not text, so every check under it reads unreachable`);
                }
                if (typeof node.logic !== "string" || node.logic.trim() !== "") {
                    carried.logic = carried.logic.concat([node.logic]);
                }
            }
            if (has(node, "vanilla_when")) {
                carried.when = node.vanilla_when;
                carried.whenFrom = where;
            }
            if (has(node, "vanilla_item")) {
                carried.item = node.vanilla_item;
                carried.itemFrom = where;
            }

            if (has(node, "item_checks") && !Array.isArray(node.item_checks)) {
                problems.push(`${where}: item_checks is not a list, so its checks are dropped`);
            } else if (Array.isArray(node.item_checks)) {
                node.item_checks.forEach((check, index) => {
                    if (!isObject(check)) {
                        problems.push(`${where}: item_checks[${index}] is not a check`);
                        return;
                    }
                    addCheck(check, path, carried);
                });
            }

            if (has(node, "subregions") && !Array.isArray(node.subregions)) {
                problems.push(`${where}: subregions is not a list, so its checks are dropped`);
                return;
            }
            if (!Array.isArray(node.subregions)) return;

            node.subregions.forEach((sub, index) => {
                if (!isObject(sub)) {
                    problems.push(`${where}: subregions[${index}] is not a sub-region`);
                    return;
                }
                // The name is never rendered. It earns its place by naming the node in
                // every finding here, which is the only way to find the one group that
                // put a wrong value on thirty checks.
                const named = typeof sub.name === "string" && sub.name.trim() !== "";
                if (!named) problems.push(`${where}: subregions[${index}] has no name`);
                const childPath = path.concat(named ? sub.name.trim() : `subregions[${index}]`);

                const holdsChecks = Array.isArray(sub.item_checks) && sub.item_checks.length;
                const holdsGroups = Array.isArray(sub.subregions) && sub.subregions.length;
                if (!holdsChecks && !holdsGroups) {
                    problems.push(`${[label, ...childPath].join(" -> ")}: has no checks and no sub-regions, so it does nothing`);
                }

                walk(sub, childPath, carried, false);
            });
        }

        walk(region, [], { logic: [], when: undefined, whenFrom: null, item: undefined, itemFrom: null }, true);
        return { checks, problems };
    }

    // Flat regions go through the same walk as nested ones, so a region's own
    // vanilla_when and vanilla_item, and the false and null escape hatches, mean the
    // same in every file. A region whose tree can't be walked keeps whatever checks
    // it listed rather than costing the whole tracker. Rewrites each region's
    // item_checks in place.
    function flattenRegions(regions, fileOf) {
        const label = labeller(regions, fileOf);
        const lines = [];
        const errors = [];
        regions.forEach(region => {
            // With neither list there is nothing to walk; acceptRegions() rejects a
            // region with no item_checks, and names it there.
            if (!Array.isArray(region.item_checks) && !Array.isArray(region.subregions)) {
                if (has(region, "subregions")) lines.push(`${label(region)}: subregions is not a list, so its checks are dropped`);
                return;
            }
            try {
                const resolved = resolveRegion(region, label(region));
                region.item_checks = resolved.checks;
                lines.push(...resolved.problems);
            } catch (error) {
                errors.push({ region: label(region), error });
            }
        });
        return { findings: lines.length ? [{ rule: "region-trees", lines }] : [], errors };
    }

    // The regions that can be drawn, in manifest order, and why each other one
    // can't. region_name is the key the markers, the map overlay and every status
    // announcement use, so a missing or repeated one costs the region; a check's id
    // is where a save keeps it, so a check without one costs its region too.
    function acceptRegions(regions, fileOf) {
        const accepted = [];
        const lines = [];
        const seen = new Map(); // region_name -> the file that claimed it

        regions.forEach(region => {
            const name = region.region_name;
            // Every rejection names the file: when the name is the problem, it is the
            // only way to find the region.
            const file = fileOf(region) || "a region file";
            if (typeof name !== "string" || name === "") {
                const count = Array.isArray(region.item_checks) ? region.item_checks.length : 0;
                const what = name === undefined ? "no region_name"
                    : typeof name === "string" ? "a blank region_name"
                    : `a region_name that isn't text (${JSON.stringify(name)})`;
                lines.push(`${file} has ${what} (${count} check${count === 1 ? "" : "s"})`);
                return;
            }
            if (seen.has(name)) {
                lines.push(seen.get(name) === file
                    ? `"${name}" in ${file} is loaded twice, because manifest.json lists ${file} twice`
                    : `"${name}" in ${file} is already used by ${seen.get(name)}`);
                return;
            }
            // An empty list is normal: a region whose checks aren't written yet. A
            // missing one is not. Tested before the name is claimed, so a good file can
            // still claim it.
            if (!Array.isArray(region.item_checks)) {
                lines.push(`"${name}" in ${file} has no item_checks list`);
                return;
            }
            const idless = region.item_checks.filter(check => !check || typeof check.id !== "string" || check.id.trim() === "");
            if (idless.length) {
                const named = idless.map(check => JSON.stringify((check && check.name) || "(no name)")).join(", ");
                lines.push(`"${name}" in ${file} has ${idless.length} check(s) with no id: ${named}`);
                return;
            }
            seen.set(name, file);
            accepted.push(region);
        });
        return { accepted, findings: lines.length ? [{ rule: "region-accepted", lines }] : [] };
    }

    // Where a region's marker goes: map_coordinates with an xPercent and yPercent
    // from 0 to 100. A region without them gets no marker ("map-coordinates").
    function hasUsableCoordinates(region) {
        const at = region.map_coordinates;
        const percent = value => typeof value === "number" && value >= 0 && value <= 100;
        return Boolean(at) && percent(at.xPercent) && percent(at.yPercent);
    }

    // ---------- The slot model ----------

    // What kind of slot an id is, from the config alone, so it works before the
    // item state exists: the settings grants need it that early.
    function slotKind(config, slotId) {
        if (has(config.progressions, slotId)) return "progression";
        const rule = has(config.item_counts, slotId) ? config.item_counts[slotId] : undefined;
        if (Number.isInteger(rule)) return "counter";
        if (digitIds(config).includes(slotId)) return "digit";
        return "toggle";
    }

    function digitIds(config) {
        return (config.digit_slots && Array.isArray(config.digit_slots.ids)) ? config.digit_slots.ids : [];
    }

    // Every value a slot can hold, whatever the settings: a stage from -1 (not
    // owned) or a count from 0, up to the last stage, the counter's cap or the
    // highest digit.
    function slotBounds(config, slotId) {
        const kind = slotKind(config, slotId);
        const counted = kind === "counter" || kind === "digit";
        let high = 0;
        if (kind === "progression") high = config.progressions[slotId].length - 1;
        else if (kind === "counter") high = config.item_counts[slotId];
        else if (kind === "digit") high = config.digit_slots.max_value;
        return { kind, low: counted ? 0 : -1, high };
    }

    // What a grant from settings.json means for its slot: the stage a progression's
    // item id stands for, a count or digit as it is, true as a plain item's 0. Null
    // when the grant doesn't fit that kind of slot.
    function grantedValue(config, slotId, granted) {
        const kind = slotKind(config, slotId);
        if (kind === "progression") {
            const stage = config.progressions[slotId].indexOf(granted);
            return stage >= 0 ? stage : null;
        }
        if (kind === "counter" || kind === "digit") {
            return Number.isInteger(granted) && granted > 0 ? granted : null;
        }
        return granted === true ? 0 : null;
    }

    // Every slot the grids draw, once each, in grid order. A grid that isn't a list
    // is skipped ("grid-slots" names it).
    function gridSlots(config) {
        const ids = new Set();
        Object.values((config && config.grids) || {}).forEach(grid => {
            if (!Array.isArray(grid)) return;
            grid.forEach(id => { if (typeof id === "string" && id !== "") ids.add(id); });
        });
        return [...ids];
    }

    // Every name the item state holds, each with its starting value: every item, every
    // progression stage, every counter and digit slot.
    function emptyItemState(config, items) {
        const state = {};
        items.forEach(item => { state[item.id] = false; });
        Object.keys(config.progressions || {}).forEach(slotId => {
            (config.progressions[slotId] || []).forEach(itemId => { state[itemId] = false; });
        });
        Object.keys(config.item_counts || {}).forEach(slotId => { state[slotId] = 0; });
        digitIds(config).forEach(slotId => { state[slotId] = 0; });
        return state;
    }

    // ---------- Logic tokens (config/logicTokens.json) ----------

    // Each token that can be worked out, with the item ids it looks at. A token with
    // a fault still exists, reading 0 or false, so logic that names it stays
    // parseable; one with no usable id or kind is left out. itemState is
    // emptyItemState(); isNumberSetting(id) says whether a settings id is a number
    // setting.
    function readTokens(config, items, itemState, isNumberSetting) {
        const defs = config.tokens;
        const lines = [];
        const sources = [];
        const warn = (id, problem) => lines.push(`token "${id}" in config/logicTokens.json ${problem}`);
        // Groups and tags say what an item means, where the grids only say where a
        // slot is drawn: moving an item to another panel must not change a count.
        const groups = config.item_groups || {};

        if (!Array.isArray(defs)) {
            return { sources, findings: [{ rule: "logic-tokens-defined", lines: ['config/logicTokens.json has no "tokens" list, so no token has a value.'] }] };
        }

        const seen = new Set();
        // One token that throws while being read costs only itself.
        defs.forEach((def, index) => {
            try {
                readToken(def, index);
            } catch (error) {
                lines.push(`tokens[${index}] in config/logicTokens.json could not be read (${error && error.message}), and is skipped.`);
            }
        });

        function readToken(def, index) {
            if (!isObject(def) || typeof def.id !== "string" || def.id === "" || typeof def.name !== "string") {
                lines.push(`tokens[${index}] in config/logicTokens.json needs a string "id" and "name", and is skipped.`);
                return;
            }
            if (seen.has(def.id)) return warn(def.id, "is listed twice, and the second is skipped.");
            if (has(itemState, def.id)) return warn(def.id, "has the id of an item, which would replace it in every check, and is skipped.");
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
                        const unknown = group.filter(id => typeof id !== "string" || !has(itemState, id));
                        if (unknown.length) {
                            warn(def.id, `reads the group "${def.group}", whose ${unknown.map(id => JSON.stringify(id)).join(", ")} ` +
                                `${unknown.length === 1 ? "is not an item" : "are not items"}, so ${unknown.length === 1 ? "it counts" : "they count"} as never owned.`);
                        }
                    }
                } else {
                    ids = items.filter(item => item[def.tag]).map(item => item.id);
                    if (!ids.length) warn(def.id, `names the tag "${def.tag}", which no item in Items.json has, so it reads as empty.`);
                }
            } else if (def.kind === "sum") {
                const terms = Array.isArray(def.terms) ? def.terms : [];
                if (!terms.length) warn(def.id, 'needs a non-empty "terms" list, so it reads as 0.');
                def = Object.assign({}, def, { terms: terms.filter(term => {
                    if (term && typeof term.setting === "string") {
                        if (!isNumberSetting(term.setting)) {
                            warn(def.id, `has a term naming "${term.setting}", which is not a number setting, so that term counts as 0.`);
                        }
                        return true;
                    }
                    if (term && typeof term.item === "string" && has(itemState, term.item)
                        && (term.per === undefined || (Number.isInteger(term.per) && term.per >= 1))) {
                        return true;
                    }
                    warn(def.id, `has a term that is neither a setting nor a known item with a "per" of 1 or more (${JSON.stringify(term)}), and it is skipped.`);
                    return false;
                }) });
            } else if (def.kind === "distinct") {
                const source = config[def.slots];
                if (source && Array.isArray(source.ids) && source.ids.length) ids = source.ids;
                else if (source && Array.isArray(source.ids)) warn(def.id, `names "${def.slots}" as its slots, whose "ids" list is empty, so it reads as false.`);
                else warn(def.id, `names "${def.slots}" as its slots, which has no "ids" list, so it reads as false.`);
            } else {
                return warn(def.id, `has the kind ${JSON.stringify(def.kind)}, which is not count, any, sum or distinct, and is skipped.`);
            }
            sources.push({ def, ids });
        }

        return { sources, findings: lines.length ? [{ rule: "logic-tokens-defined", lines }] : [] };
    }

    // ---------- Location flags and logic helpers ----------

    // Tokens that aren't items, each standing for a stored logic chain: a location
    // flag (locationFlags.json) is everything its check or region takes to reach,
    // plus any logic of its own; a logic helper (logicHelpers.json) is a list of items
    // written once. regions are the ones that can render, so a flag pointing into one
    // that can't has no chain and reads false. taken holds every item and derived
    // token id: a named token can't take one, or it would replace every requirement
    // for it. See ARCHITECTURE.md, *Location flags* and *Logic helpers*.
    function namedTokens(flags, helpers, regions, taken) {
        const named = new Map();
        const add = (entry, kind, chainOf) => {
            if (!entry || typeof entry.id !== "string" || !/^[a-z0-9_]+$/.test(entry.id)) return;
            if (named.has(entry.id) || taken.has(entry.id)) return;
            named.set(entry.id, {
                id: entry.id,
                kind,
                name: typeof entry.name === "string" && entry.name !== "" ? entry.name : entry.id,
                chain: chainOf(entry)
            });
        };
        (flags || []).forEach(entry => add(entry, "flag", e => flagChain(e, regions)));
        (helpers || []).forEach(entry => add(entry, "helper",
            e => (typeof e.logic === "string" && e.logic.trim() !== "" ? [e.logic] : null)));
        return named;
    }

    function flagChain(entry, regions) {
        const at = entry.at || {};
        const extra = typeof entry.logic === "string" ? entry.logic : "";
        if (typeof at.check === "string" && typeof at.region === "string") return null;
        if (typeof at.check === "string") {
            for (const region of regions) {
                const check = (region.item_checks || []).find(c => c && c.id === at.check);
                if (check) return [region.logic, ...(check.group_logic || []), check.logic, extra];
            }
            return null;
        }
        if (typeof at.region === "string") {
            const region = regions.find(r => r.region_name === at.region);
            return region ? [region.logic, extra] : null;
        }
        return null;
    }

    // ---------- Locations ----------

    // Which checks are one location: each check id -> its location's key. A check is
    // its own location unless a check_group links it with others; an id in two
    // groups joins them into one, so a click and a count can't disagree ("check-groups"
    // names it). Ids a group names that aren't in checkIds are left out. The key is an
    // id from the location, internal only: saves name check ids, never these.
    function locationsOf(checkIds, checkGroups) {
        const keyOf = new Map();
        const members = new Map();
        checkIds.forEach(id => {
            if (keyOf.has(id)) return;
            keyOf.set(id, id);
            members.set(id, [id]);
        });
        (checkGroups || []).forEach(group => {
            const ids = group.filter(id => keyOf.has(id));
            if (ids.length < 2) return;
            const into = keyOf.get(ids[0]);
            ids.slice(1).forEach(id => {
                const from = keyOf.get(id);
                if (from === into) return;
                members.get(from).forEach(member => {
                    keyOf.set(member, into);
                    members.get(into).push(member);
                });
                members.delete(from);
            });
        });
        return keyOf;
    }

    // ---------- Everything at once ----------

    // The raw files, read: { configParts: [{ name, data }], items, regions: [{ file,
    // data }], flags, helpers, settings }. Returns the data the page uses, every
    // finding from reading it, and a lookup from region to file. dataLoader.js has
    // already turned away anything that isn't the right shape to read at all.
    function assemble(raw) {
        const findings = [];
        const merged = mergeConfig(raw.configParts);
        findings.push(...merged.findings);
        const config = merged.config;
        findings.push(...readCheckGroups(config));
        const read = readItems(raw.items);
        findings.push(...read.findings);

        const files = new WeakMap();
        const regions = (raw.regions || []).map(({ file, data }) => {
            files.set(data, file);
            findings.push(...trimRegionName(data, file));
            return data;
        });
        const fileOf = region => files.get(region) || null;
        const flattened = flattenRegions(regions, fileOf);
        findings.push(...flattened.findings);

        return {
            data: { config, items: read.items, regions, locationFlags: raw.flags || [], logicHelpers: raw.helpers || [], settings: raw.settings },
            findings,
            treeErrors: flattened.errors,
            fileOf
        };
    }

    const api = {
        isObject, mergeConfig, readItems, readCheckGroups, trimRegionName, flattenRegions, acceptRegions, hasUsableCoordinates,
        slotKind, digitIds, slotBounds, grantedValue, gridSlots, emptyItemState, readTokens,
        namedTokens, locationsOf, assemble
    };
    root.DataModel = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
