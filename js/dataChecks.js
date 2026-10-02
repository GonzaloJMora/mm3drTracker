// window.DataChecks — every rule the data in data/ has to keep, by name, and the one
// place the page prints what breaks them. dataLoader.js runs them once the files are
// read; the tests run the same rules without a browser, one test each
// (tests/node/dataChecks.test.js). No DOM.
//
// A rule only finds and names. What the page does about a broken one, such as
// drawing an empty slot or skipping a region, stays with the file that draws it.
// Rules about the running page rather than the files (a file that won't download,
// a region that throws while drawing, a save) stay in the file that meets them.
// See ARCHITECTURE.md, *When the data is wrong*.
(function (root) {
    "use strict";

    const model = () => root.DataModel || require("./dataModel.js");
    const parser = () => root.LogicParser || require("./logicParser.js");
    const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

    // Where a check sits, sub-regions included, for a line that has to be findable in
    // the file. A value a group set names the group as well, since the fix is there.
    const checkWhere = (region, check) => [region.region_name, ...(check.group_path || []), check.id].join(" -> ");
    const fromNote = source => (source ? ` (set by "${source}")` : "");

    // ---------- What every rule reads ----------

    // data is TrackerData's shape: config, items, regions (flattened), locationFlags,
    // logicHelpers, settings (as written). options.regions is false on a page that
    // didn't load the region files, which skips every rule about them;
    // options.failedLogicFiles names a flags or helpers file that couldn't be read.
    function context(data, options = {}) {
        const m = model();
        const fileOf = options.fileOf || (() => null);
        const settings = m.settingsById(data.settings);
        const isNumberSetting = id => settings.has(id) && settings.get(id).class === "number";
        const itemState = m.emptyItemState(data.config, data.items);
        const tokens = m.readTokens(data.config, data.items, itemState, isNumberSetting);
        const regionsLoaded = options.regions !== false;
        const accepted = regionsLoaded ? m.acceptRegions(data.regions, fileOf) : { accepted: [], findings: [] };
        const taken = new Set([...data.items.map(item => item.id), ...Object.keys(itemState),
            ...tokens.sources.map(source => source.def.id)]);
        return {
            data,
            config: data.config,
            items: data.items,
            settings,
            itemState,
            tokens,
            regionsLoaded,
            acceptance: accepted,
            regions: accepted.accepted,
            named: m.namedTokens(data.locationFlags, data.logicHelpers, accepted.accepted, taken),
            taken,
            failedLogicFiles: options.failedLogicFiles || []
        };
    }

    // ---------- The rules ----------

    // Each rule: id (what a test and a printed line are named by), title (what it
    // asks of the data), header(n) (the line above its findings, or null to print
    // each finding as its own warning), regions (true when it is about the region
    // files) and check(ctx) returning finding lines. The first five have no check:
    // DataModel finds those while reading the files.
    const RULES = [
        { id: "config-keys", title: "no key is in two config files", header: null },
        { id: "item-ids", title: "every Items.json entry has an id", header: null },
        { id: "check-group-shape", title: "check_groups is a list of lists of at least two check ids",
            header: n => `${n} group(s) in config/checkGroups.json are dropped, so their checks are not linked.` },
        { id: "region-names", title: "no region_name has spaces around it", header: null, regions: true },
        { id: "region-trees", title: "every region's checks and sub-regions can be read", regions: true,
            header: n => `${n} problem(s) in the region files' checks.` },

        { id: "region-accepted", title: "every region has a unique region_name, an item_checks list and an id on every check", regions: true,
            header: n => `${n} region(s) were not rendered. Their checks are missing from the tracker, and any marker they have will not open them.`,
            check: ctx => ctx.acceptance.findings.flatMap(finding => finding.lines) },

        { id: "grid-slots", title: "every grid slot names an item",
            header: n => `${n} grid slot(s) will not draw an item. Each one renders as an empty slot instead.`,
            check: gridSlots },

        { id: "digit-slots-named", title: "the Bomber's code digit slots have a name", header: null,
            check: ctx => {
                const digits = model().digitIds(ctx.config);
                const named = ctx.config.digit_slots && typeof ctx.config.digit_slots.name === "string" && ctx.config.digit_slots.name !== "";
                return digits.length && !named
                    ? ['config/inventory.json\'s "digit_slots" has no "name", so each digit slot\'s tooltip shows its slot id.']
                    : [];
            } },

        { id: "progressions-or-counts", title: "no slot is both a progression and a counter", header: null,
            check: ctx => Object.keys(ctx.config.progressions || {})
                .filter(slotId => has(ctx.config.item_counts || {}, slotId))
                .map(slotId => `"${slotId}" is in both progressions and item_counts in config/inventory.json. ` +
                    "Those are alternatives, not a combination, and clicking that slot will not work.") },

        { id: "logic-tokens-defined", title: "every token in config/logicTokens.json is well formed", header: null,
            check: ctx => ctx.tokens.findings.flatMap(finding => finding.lines) },

        { id: "logic-parses", title: "every logic string can be read", regions: true,
            header: n => `${n} logic string(s) can't be read, so every check they gate reads unreachable.`,
            check: ctx => logicNames(ctx).unreadable },

        { id: "logic-tokens-known", title: "every logic token names an item, a token, a flag or a helper", regions: true,
            header: (n, ctx) => {
                // Which names a missing file held can't be known, so they stay listed,
                // but the file that failed is the likelier cause than every region file.
                const failed = ((ctx && ctx.failedLogicFiles) || []).map(path => path.replace(/^data\//, ""));
                const cause = failed.length
                    ? ` ${failed.join(" and ")} could not be loaded, so ${failed.length === 1 ? "its" : "their"} entries are likely among these.`
                    : "";
                return `${n} logic token(s) match nothing in the item state. ` +
                    `Every check using one of these will stay unreachable no matter what you collect.${cause}`;
            },
            check: ctx => logicNames(ctx).unknown },

        { id: "logic-counts", title: "every name after >= is a dropdown setting whose options carry a value", regions: true,
            header: n => `${n} name(s) after >= are not a count. Every check comparing against one of these will stay unreachable.`,
            check: ctx => logicNames(ctx).badCounts },

        { id: "logic-demanded-once", title: "no item is demanded twice down one check's chain", regions: true,
            header: n => `${n} item(s) are demanded twice in one check's requirement, where the second copy asks for nothing the first did not.`,
            check: repeatedDemands },

        { id: "flags-and-helpers", title: "every location flag and logic helper is well formed", regions: true,
            header: n => `${n} problem(s) in locationFlags.json or logicHelpers.json.`,
            check: namedTokenProblems },

        { id: "check-ids-unique", title: "no two checks share an id", regions: true,
            header: n => `${n} check id(s) are used more than once. Each set ticks off together and counts as a single location, exactly as a declared check_group would.`,
            check: ctx => {
                const usedBy = new Map();
                ctx.regions.forEach(region => region.item_checks.forEach(check => {
                    if (!usedBy.has(check.id)) usedBy.set(check.id, []);
                    usedBy.get(check.id).push(region.region_name);
                }));
                return [...usedBy].filter(([, where]) => where.length > 1)
                    .map(([id, where]) => `"${id}" — used by: ${where.join(", ")}`);
            } },

        { id: "check-groups", title: "every check_groups id is a check, in one group only", regions: true,
            header: n => `${n} problem(s) in config/checkGroups.json. A location they name may not tick off or count as one.`,
            check: ctx => {
                const ids = new Set();
                ctx.regions.forEach(region => region.item_checks.forEach(check => ids.add(check.id)));
                const lines = [];
                const groupOf = new Map();
                (ctx.config.check_groups || []).forEach((group, index) => group.forEach(id => {
                    if (!ids.has(id)) lines.push(`check_groups[${index}]: "${id}" matches no check on the page`);
                    if (groupOf.has(id)) lines.push(`check_groups[${index}]: "${id}" is already in check_groups[${groupOf.get(id)}]`);
                    else groupOf.set(id, index);
                }));
                return lines;
            } },

        { id: "check-names", title: "every check has a name", regions: true,
            header: n => `${n} check(s) have no name, so each draws as a blank row.`,
            check: ctx => ctx.regions.flatMap(region => region.item_checks
                .filter(check => typeof check.name !== "string" || check.name.trim() === "")
                .map(check => checkWhere(region, check))) },

        { id: "vanilla-items", title: "every vanilla_item is an item id or text, on a check with a vanilla_when", regions: true,
            header: n => `${n} vanilla_item(s) can't be shown.`,
            check: ctx => {
                const ids = new Set(ctx.items.map(item => item.id));
                const lines = [];
                ctx.regions.forEach(region => region.item_checks.forEach(check => {
                    if (check.vanilla_item === undefined) return;
                    const where = `${checkWhere(region, check)}${fromNote(check.vanilla_item_from)}`;
                    const value = check.vanilla_item;
                    if (typeof value !== "string" || value.trim() === "") {
                        lines.push(`${where}: vanilla_item has to be an item id or text`);
                    } else if (/^[a-z0-9_]+$/.test(value) && !ids.has(value)) {
                        lines.push(`${where}: "${value}" is not an item id; write an untracked item as text, like "Red Rupee"`);
                    } else if (check.vanilla_when === undefined) {
                        lines.push(`${where}: has a vanilla_item but no vanilla_when, so it never shows`);
                    }
                }));
                return lines;
            } },

        { id: "map-coordinates", title: "every region has map_coordinates from 0 to 100", regions: true,
            header: n => `${n} region(s) have no map_coordinates with an xPercent and yPercent from 0 to 100, so they get no marker. ` +
                "On desktop that leaves their checks unreachable — the accordion list is mobile-only.",
            check: ctx => ctx.regions.filter(region => !model().hasUsableCoordinates(region)).map(region => region.region_name) }
    ];

    // ---------- The longer checks ----------

    // A bad slot draws as an empty one rather than taking the grid down, but a hole
    // with no explanation is its own puzzle. Progression chains are walked in full:
    // a typo in a later stage draws fine at load and only shows once the slot is
    // clicked up to it.
    function gridSlots(ctx) {
        const config = ctx.config;
        const known = new Set(ctx.items.map(item => item.id));
        const digits = model().digitIds(config);
        const lines = [];
        Object.keys(config.grids || {}).forEach(gridName => {
            const slots = config.grids[gridName];
            if (!Array.isArray(slots)) {
                lines.push(`"${gridName}" — grids.${gridName} is not a list of slot ids — the whole grid is skipped`);
                return;
            }
            slots.forEach((slotId, index) => {
                if (typeof slotId !== "string") {
                    lines.push(`"${String(slotId)}" — grids.${gridName}[${index}] is not a slot id`);
                    return;
                }
                if (slotId === "" || digits.includes(slotId)) return;
                const at = `grids.${gridName}[${index}]`;
                const chain = (config.progressions || {})[slotId];
                if (!chain) {
                    if (!known.has(slotId)) lines.push(`"${slotId}" — ${at}`);
                    return;
                }
                if (!chain.length) {
                    lines.push(`"${slotId}" — ${at} — progressions.${slotId} is an empty chain`);
                    return;
                }
                chain.forEach((stageId, stageIndex) => {
                    if (!known.has(stageId)) lines.push(`"${stageId}" — ${at} — progressions.${slotId} stage ${stageIndex + 1}`);
                });
            });
        });
        return lines;
    }

    // Every logic string, walked once and shared by the three rules that read it:
    // strings that can't be read, names matching nothing, and names after >= that
    // aren't a count. The walk follows the parsed tree, since only the tree knows
    // which side of >= a name is on.
    const logicCache = new WeakMap();
    function logicNames(ctx) {
        if (logicCache.has(ctx)) return logicCache.get(ctx);
        const LogicParser = parser();
        const known = new Set([...Object.keys(ctx.itemState), ...ctx.tokens.sources.map(source => source.def.id), ...ctx.named.keys()]);
        const isNumeric = id => {
            const setting = ctx.settings.get(id);
            return Boolean(setting && setting.class === "dropdown" && Array.isArray(setting.options) &&
                setting.options.some(option => option && option.value !== undefined));
        };
        const progressions = ctx.config.progressions || {};
        const unknown = new Map();
        const badCounts = new Map();
        const unreadable = new Map();
        const note = (seen, name, where) => {
            if (!seen.has(name)) seen.set(name, []);
            seen.get(name).push(where);
        };
        const walk = (node, where) => {
            if (node.type === "and" || node.type === "or") node.children.forEach(child => walk(child, where));
            else if (node.type === "compare") {
                walk(node.left, where);
                if (node.right.type === "setting" && !isNumeric(node.right.id)) note(badCounts, node.right.id, where);
            } else if (node.type === "token" && !known.has(node.id)) note(unknown, node.id, where);
        };
        // In a list of one, so a layer is parsed as the sweep parses it: a list
        // written as a layer is one bad part, not a list of parts.
        const scan = (logic, where) => {
            let tree = null;
            try {
                tree = LogicParser.parse([logic]);
            } catch (error) {
                note(unreadable, typeof logic === "string" ? `"${logic}"` : JSON.stringify(logic), where);
                return;
            }
            if (tree) walk(tree, where);
        };

        ctx.data.locationFlags.forEach(entry => {
            if (entry && typeof entry.logic === "string") scan(entry.logic, `locationFlags.json -> ${entry.id}`);
        });
        ctx.data.logicHelpers.forEach(entry => {
            if (entry && typeof entry.logic === "string") scan(entry.logic, `logicHelpers.json -> ${entry.id}`);
        });
        ctx.regions.forEach(region => {
            scan(region.logic, `${region.region_name} (region entry)`);
            // A sub-region's logic is on every check under it, so it is scanned once
            // under the group's own name rather than once per check.
            const groupsSeen = new Set();
            region.item_checks.forEach(check => {
                const path = check.group_path || [];
                (check.group_logic || []).forEach((logic, depth) => {
                    const where = `${region.region_name} -> ${path.slice(0, depth + 1).join(" -> ")}`;
                    const key = `${where}||${logic}`;
                    if (groupsSeen.has(key)) return;
                    groupsSeen.add(key);
                    scan(logic, where);
                });
                scan(check.logic, checkWhere(region, check));
            });
        });

        const usedBy = places => `\n        used by: ${places.join(", ")}`;
        const result = {
            unreadable: [...unreadable].map(([shown, places]) => `${shown}${usedBy(places)}`),
            unknown: [...unknown].map(([token, places]) => {
                const chain = has(progressions, token) ? progressions[token] : null;
                let hint = "";
                // A progression's slot id looks like it should work, but the state only
                // holds the stage ids, so you name the lowest stage you will accept.
                if (Array.isArray(chain) && chain.length) {
                    hint = ` - "${token}" is a progression slot, not an item; name a stage instead, e.g. "${chain[0]}" for "any ${token}".`;
                } else if (ctx.settings.has(token)) {
                    hint = ` - "${token}" is a setting, which only goes after >= as the count to reach.`;
                }
                return `${token}${hint}${usedBy(places)}`;
            }),
            badCounts: [...badCounts].map(([name, places]) => {
                const hint = ctx.settings.has(name)
                    ? ` - "${name}" is a setting, but only a dropdown whose options carry a "value" can go after >=.`
                    : ` - "${name}" matches no setting.`;
                return `${name}${hint}${usedBy(places)}`;
            })
        };
        logicCache.set(ctx, result);
        return result;
    }

    // Tokens a layer demands outright: the & spine only. A token inside an | is an
    // alternative rather than a demand, and `key>=2` is the right way to ask for a
    // second one, so neither is collected.
    function demandedTokens(logic) {
        const found = new Set();
        let tree = null;
        try {
            tree = parser().parse(logic);
        } catch (error) {
            return found;
        }
        (function walk(node) {
            if (!node) return;
            if (node.type === "and") node.children.forEach(walk);
            else if (node.type === "token") found.add(node.id);
        })(tree);
        return found;
    }

    // A bare token is a yes/no question, so demanding one twice down a sub-region
    // chain asks for no more than demanding it once: one small key opens both doors.
    // It fails open (the check turns green early and nothing looks wrong).
    function repeatedDemands(ctx) {
        const counted = ctx.config.item_counts || {};
        const found = new Map();
        ctx.regions.forEach(region => region.item_checks.forEach(check => {
            const path = check.group_path || [];
            const layers = [
                { where: "the region's entry", logic: region.logic },
                ...(check.group_logic || []).map((logic, depth) => ({ where: `"${path[depth]}"`, logic })),
                { where: "the check itself", logic: check.logic }
            ];
            // Keyed by the two layers rather than by the check, so a group that
            // repeats its parent is named once and not once per check under it.
            const seen = new Map();
            layers.forEach(layer => demandedTokens(layer.logic).forEach(token => {
                if (!seen.has(token)) {
                    seen.set(token, layer.where);
                    return;
                }
                const key = [region.region_name, seen.get(token), layer.where, token].join("|");
                if (!found.has(key)) found.set(key, { region: region.region_name, first: seen.get(token), again: layer.where, token, example: check.id });
            }));
        }));
        return [...found.values()].map(entry => {
            // Only a counted item can be asked for twice, with a running total.
            const fix = typeof counted[entry.token] === "number"
                ? ` Write the running total on the deeper one, like "${entry.token}>=2", if two are needed.`
                : " Drop one of them.";
            return `${entry.region}: "${entry.token}" is demanded by ${entry.first} and again by ${entry.again} (for example ${entry.example}).${fix}`;
        });
    }

    // A bad named token reads false, so every check using it stays red for a reason
    // that is nowhere near the check. Each problem is named once here instead.
    function namedTokenProblems(ctx) {
        const items = new Set(ctx.items.map(item => item.id));
        const bad = [];
        const declaredIn = new Map();

        // What every entry needs, whichever file it's in. Returns where to name it,
        // or null when the entry is ignored.
        const common = (entry, index, file, example) => {
            const label = entry && typeof entry.id === "string" && entry.id ? entry.id : `[${index}]`;
            const where = `${file} -> ${label}`;
            if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !/^[a-z0-9_]+$/.test(entry.id)) {
                bad.push(`${where}: needs an "id" written like a logic token, such as "${example}"`);
                return null;
            }
            if (declaredIn.has(entry.id)) {
                bad.push(`${where}: is already declared in ${declaredIn.get(entry.id)}; only the first counts`);
                return null;
            }
            declaredIn.set(entry.id, file);
            if (items.has(entry.id) || ctx.taken.has(entry.id)) {
                bad.push(`${where}: is already an item or derived token, so logic reads that and ignores this entry`);
                return null;
            }
            if (typeof entry.name !== "string" || entry.name === "") bad.push(`${where}: has no "name", so the tooltip shows the id`);
            return where;
        };

        ctx.data.locationFlags.forEach((entry, index) => {
            const where = common(entry, index, "locationFlags.json", "odolwa_defeated");
            if (!where) return;
            const at = entry.at || {};
            const pointers = ["check", "region"].filter(key => typeof at[key] === "string");
            if (pointers.length !== 1) {
                bad.push(`${where}: "at" needs exactly one of "check" or "region", so it reads false`);
            } else if (!ctx.named.get(entry.id) || !ctx.named.get(entry.id).chain) {
                bad.push(`${where}: "at" names ${pointers[0]} "${at[pointers[0]]}", which isn't in any rendered region, so it reads false`);
            }
        });

        ctx.data.logicHelpers.forEach((entry, index) => {
            const where = common(entry, index, "logicHelpers.json", "fighting");
            if (!where) return;
            if (typeof entry.logic !== "string" || entry.logic.trim() === "") bad.push(`${where}: has no "logic", so it reads false`);
        });

        // A loop can only close through other named tokens, so following those is enough.
        const uses = id => {
            const named = ctx.named.get(id);
            if (!named || !named.chain) return [];
            const tokens = new Set();
            named.chain.forEach(part => {
                let tree = null;
                try { tree = parser().parse(part); } catch (error) { return; }
                (function walk(node) {
                    if (!node) return;
                    if (node.type === "token") tokens.add(node.id);
                    else if (node.type === "compare") tokens.add(node.left.id);
                    else if (node.children) node.children.forEach(walk);
                })(tree);
            });
            return [...tokens].filter(token => ctx.named.has(token));
        };
        ctx.named.forEach((named, id) => {
            const stack = [[id, [id]]];
            const visited = new Set();
            while (stack.length) {
                const [current, path] = stack.pop();
                for (const next of uses(current)) {
                    if (next === id) {
                        bad.push(`${id}: needs itself through ${path.concat(id).join(" -> ")}; that path reads false`);
                        stack.length = 0;
                        break;
                    }
                    if (!visited.has(next)) {
                        visited.add(next);
                        stack.push([next, path.concat(next)]);
                    }
                }
            }
        });
        return bad;
    }

    // ---------- Running them ----------

    // Every rule with a check, each in its own try/catch: a rule that throws is a
    // finding of its own and never stops the others. Returns { rule, lines } per rule
    // that found something. Rules about the region files are skipped when they
    // weren't loaded.
    function run(ctx, only) {
        const findings = [];
        RULES.forEach(rule => {
            if (!rule.check || (only && !only.includes(rule.id))) return;
            if (rule.regions && !ctx.regionsLoaded) return;
            try {
                const lines = rule.check(ctx);
                if (lines.length) findings.push({ rule: rule.id, lines });
            } catch (error) {
                findings.push({ rule: rule.id, lines: [`this check could not run (${error && error.message})`], error });
            }
        });
        return findings;
    }

    // Prints findings as the page does: a header and its lines, or each line on its
    // own for a rule without a header. warn is console.warn in the page.
    function print(findings, warn, ctx) {
        findings.forEach(({ rule: id, lines }) => {
            const rule = RULES.find(entry => entry.id === id);
            const prefix = `Data check "${id}":`;
            if (rule && rule.header) {
                warn(`${prefix} ${rule.header(lines.length, ctx)}`);
                lines.forEach(line => warn(`  ${line}`));
            } else {
                lines.forEach(line => warn(`${prefix} ${line}`));
            }
        });
    }

    const api = { RULES, context, run, print };
    root.DataChecks = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
