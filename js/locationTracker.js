(function () {
    // Every rendered region and its checks, so one sweep can re-evaluate them all
    const activeRegionTrackers = [];

    function evaluateAllRegions(inventory, tokens) {
        // Check id -> { accessible, vanilla } for ItemCheckState. A check shown in two
        // places is accessible if either one is.
        const statuses = new Map();

        activeRegionTrackers.forEach(region => {
            region.checks.forEach(checkObj => {
                const el = checkObj.element;

                // Combine regional route requirements with individual item checks
                const finalLogic = combinedLogic(region.entryLogic, checkObj);
                const isAvailable = canAccess(finalLogic, inventory, tokens);
                checkObj.accessible = isAvailable;

                const seen = statuses.get(checkObj.id);
                statuses.set(checkObj.id, {
                    accessible: isAvailable || Boolean(seen && seen.accessible),
                    vanilla: checkObj.vanilla || Boolean(seen && seen.vanilla)
                });

                // Both rules here exist to stop the check text flickering on every
                // state update: toggle(name, bool) is a no-op when the class already
                // matches, and clearing the opposite class first means the element is
                // never briefly tagged as both, which would re-raster the glyphs.
                if (isAvailable) {
                    el.classList.toggle("inaccessible", false);
                    el.classList.toggle("accessible", true);
                } else {
                    el.classList.toggle("accessible", false);
                    el.classList.toggle("inaccessible", true);
                }
            });

            determineRegionLocationAccessibility(region);
        });

        if (window.ItemCheckState) window.ItemCheckState.setStatuses(statuses);

        // One announcement per sweep rather than per region: locationStatsTracker.js
        // recounts from scratch, so it only needs telling that something moved.
        window.dispatchEvent(new CustomEvent("trackerChecksUpdated"));
    }

    window.addEventListener("trackerStateUpdated", (event) => {
        evaluateAllRegions(event.detail.items, event.detail.tokens);
    });

    // The one place rows get `completed`, whether a tap or a loaded save moved it.
    // Queried globally because a region's rows may be sitting in the map overlay.
    // The linked rows can sit in other regions, so every region's counts are redone.
    window.addEventListener("checkCompletionChanged", (event) => {
        event.detail.ids.forEach(id => {
            const isCompleted = window.ItemCheckState.isCompleted(id);
            rowsFor(id).forEach(el => el.classList.toggle("completed", isCompleted));
        });
        if (window.GameState) {
            evaluateAllRegions(window.GameState.items, window.GameState.tokens);
        } else {
            window.dispatchEvent(new CustomEvent("trackerChecksUpdated"));
        }
    });

    function rowsFor(id) {
        return document.querySelectorAll(`div.region-check-item[data-check-id="${CSS.escape(id)}"]`);
    }

    // Hiding non-randomized checks moves every count and some region colors, so the
    // sweep runs again, and everything downstream hears about it the usual way.
    // Flipping a toggle also applies at once, so rows a tap kept shown go.
    window.addEventListener("trackerViewChanged", () => {
        releaseKeptRows(document);
        const state = window.GameState;
        if (state) evaluateAllRegions(state.items, state.tokens);
    });

    // Leaving the list for the other tab counts as done with the open regions.
    window.addEventListener("mobileTabChanged", () => releaseKeptRows(document));

    // The map overlay closes a region without its header, so it announces the close.
    window.addEventListener("regionOverlayClosed", (event) => {
        const region = activeRegionTrackers.find(entry => entry.regionName === event.detail.regionName);
        if (region) releaseKeptRows(region.groupEl);
    });

    // Show Only Accessible Checks hides a completed check, and a region with nothing
    // accessible left, but not while a tap in that region has just done it: the row
    // stays so a mistaken tap can be undone, and the list doesn't jump under the
    // finger. .keep-shown marks those rows until the region closes
    // (ARCHITECTURE.md, *Hiding checks*).
    function releaseKeptRows(root) {
        if (root.classList) root.classList.remove("keep-shown");
        root.querySelectorAll(".keep-shown").forEach(el => el.classList.remove("keep-shown"));
    }

    // A tap never hides what it just changed, the same location's other rows
    // included: a check_group completes them together, and they may be sitting in
    // regions the reader also has open.
    //
    // Whether to mark at all is asked of the row's own info button, which CSS gives
    // a display only in the phone layout — where the hiding rules live. So a check
    // completed in the desktop map overlay leaves no mark for a later narrow window
    // to honor, and this file still never learns the breakpoint.
    //
    // The question is what CSS says about the button, not whether it is on screen:
    // the row this runs for has just been marked completed, which Show Only
    // Accessible hides, so anything measured would already be gone.
    function keepRowShown(row) {
        const button = row.querySelector(".region-check-info");
        if (!button || window.getComputedStyle(button).display === "none") return;
        const content = row.closest(".region-content");
        if (!content || !content.classList.contains("open")) return;
        row.classList.add("keep-shown");
        const group = row.closest(".region-group");
        if (group) group.classList.add("keep-shown");
    }

    // What a bare token is worth. The requirements tooltip resolves tokens through
    // this same function, so the two cannot disagree about why a check is red.
    //
    // A name after >= is a setting (`item>=setting`), looked up
    // as one so it never falls through to the inventory. Without a number it is
    // undefined, and the comparison is unmet.
    function tokenResolver(inventory, tokens) {
        const namedValues = new Map();
        const namedBeingWorkedOut = new Set();

        const resolve = (token, kind) => {
            if (kind === "setting") {
                return window.SettingsState ? window.SettingsState.numberOf(token) : undefined;
            }
            if (Object.prototype.hasOwnProperty.call(tokens, token)) return tokens[token];

            // A named token is worth whatever its chain needs, worked out with this
            // same resolver. One met again while it is still being worked out is a
            // loop and reads false rather than recursing; the data checks name
            // it at load ("flags-and-helpers").
            const named = namedTokens.get(token);
            if (named) {
                if (namedValues.has(token)) return namedValues.get(token);
                if (namedBeingWorkedOut.has(token) || !named.chain) return false;
                namedBeingWorkedOut.add(token);
                let value = false;
                try {
                    value = window.LogicParser.evaluate(named.chain, resolve);
                } catch (error) {
                    value = false;
                }
                namedBeingWorkedOut.delete(token);
                namedValues.set(token, value);
                return value;
            }

            const value = inventory[token];
            if (typeof value === "boolean") return value;
            if (typeof value === "number") return value;

            // An unknown token is not an error here — the data checks have
            // already named it once at load ("logic-tokens-known"), and the check
            // simply stays unreachable.
            return false;
        };
        return resolve;
    }

    // ---------- Named tokens: location flags and logic helpers ----------

    // Tokens that aren't items, each standing for a stored logic chain. A location
    // flag (locationFlags.json) is progress somewhere else, like a boss being
    // beatable: everything its check or region takes to reach, plus any logic of its
    // own. A logic helper (logicHelpers.json) is a list of items written once, like
    // any melee damage source. Filled once the regions have rendered, so a flag
    // pointing into a region that failed to load has no chain and reads false. See
    // ARCHITECTURE.md, *Location flags* and *Logic helpers*.
    const namedTokens = new Map();

    // A named token can't take an item's name: the resolver asks for these first,
    // so one sharing an item's id would quietly replace every requirement for it.
    // Built by DataModel, as the data checks build it ("flags-and-helpers").
    function indexNamedTokens(regions) {
        namedTokens.clear();
        const data = window.TrackerData || {};
        const taken = new Set([
            ...(data.items || []).map(item => item.id),
            ...Object.keys(window.GameState ? window.GameState.items : {}),
            ...Object.keys(window.GameState ? window.GameState.tokens : {})
        ]);
        window.DataModel.namedTokens(data.locationFlags, data.logicHelpers, regions, taken)
            .forEach((named, id) => namedTokens.set(id, named));
    }

    // A check's element to its display name, for the docked panel's heading. Held
    // rather than read back off the rendered row, so the panel does not depend on
    // how that row is marked up.
    const checkNames = new WeakMap();

    // A non-randomized check's element to the name of what it holds, for the
    // tooltip's "Vanilla:" line. Only non-randomized checks get an entry.
    const checkVanillaItems = new WeakMap();

    // An Items.json id reads as the tracker's own name. Anything else is an item
    // the tracker doesn't track, already written as the text to show.
    function vanillaItemName(value) {
        const data = window.TrackerData;
        const item = data && data.items && data.items.find(entry => entry.id === value);
        return item && item.name ? item.name : value;
    }

    // A check's element to the logic that gates it. Held here rather than on the
    // element because a .region-group is moved into the map overlay and back, and a
    // WeakMap follows the node wherever it goes.
    const checkRequirements = new WeakMap();

    // Region entry, every sub-region the check sits inside, and the check's own logic
    // are one requirement, not several lists: you need all of them, so they read as a
    // single set of bullets.
    // A list rather than one joined string, so LogicParser parses and names each part
    // on its own — a broken region string is reported once, not once per check — and
    // so an `a|b` group can never bind loosely against the `c` below it.
    function combinedLogic(regionLogic, check) {
        return [regionLogic, ...(check.group_logic || []), check.logic];
    }

    // Names come from the item data, with the token definitions covering the
    // derived tokens that have no Items.json entry.
    function tokenDisplayName(token) {
        const data = window.TrackerData;
        const item = data && data.items && data.items.find(entry => entry.id === token);
        if (item && item.name) return item.name;

        const named = namedTokens.get(token);
        if (named) return named.name;

        // Falling back to the raw id keeps a typo visible in the tooltip instead of
        // rendering a blank bullet.
        const defs = (data && data.config && data.config.tokens) || [];
        const def = defs.find(entry => entry && entry.id === token);
        return (def && def.name) || token;
    }

    // Inside onReady so this file does not depend on tooltip.js loading first.
    window.TrackerData.onReady(() => {
        window.Tooltip.register(".region-check-item", (element, context) => {
            const logic = checkRequirements.get(element);
            const fragment = document.createDocumentFragment();

            // Docked at the bottom of the screen the panel is nowhere near the row it
            // describes, so it has to name it. On hover the pointer is already on it.
            const pinned = Boolean(context && context.pinned);
            const heading = document.createElement("div");
            heading.className = "tooltip-heading";
            heading.textContent = pinned ? checkNames.get(element) || "Items Required" : "Items Required";

            // Above the requirements either way: under the check's name when pinned,
            // over the "Items Required" heading on hover.
            const vanillaItem = checkVanillaItems.get(element);
            let vanillaLine = null;
            if (vanillaItem) {
                vanillaLine = document.createElement("div");
                vanillaLine.className = "tooltip-vanilla";
                const label = document.createElement("span");
                label.className = "tooltip-vanilla-label";
                label.textContent = "Vanilla:";
                vanillaLine.append(label, ` ${vanillaItem}`);
            }
            if (pinned) {
                fragment.appendChild(heading);
                if (vanillaLine) fragment.appendChild(vanillaLine);
            } else {
                if (vanillaLine) fragment.appendChild(vanillaLine);
                fragment.appendChild(heading);
            }

            let tree = null;
            let unreadable = false;
            try {
                tree = logic ? window.LogicParser.parse(logic) : null;
            } catch (error) {
                // Already named by LogicParser. Caught here rather than left to
                // tooltip.js, which would close the panel instead of saying why.
                unreadable = true;
            }

            if (!tree) {
                const none = document.createElement("div");
                none.className = "tooltip-none";
                none.textContent = unreadable ? "Requirements could not be read" : "None";
                fragment.appendChild(none);
                return fragment;
            }

            const state = window.GameState;
            const resolve = tokenResolver(state.items, state.tokens);

            const annotated = window.LogicParser.annotate(tree, resolve);
            const chips = window.RequirementsView.render(annotated, tokenDisplayName, resolve);

            // What is still short, in the heading, so it reads before the chips do.
            const missing = Number(chips.dataset.missing);
            const count = document.createElement("span");
            count.className = missing ? "tooltip-count" : "tooltip-count tooltip-count-met";
            count.textContent = missing ? `${missing} missing` : "all met";
            heading.appendChild(count);

            fragment.appendChild(chips);
            return fragment;
        });
    });

    function canAccess(logic, inventory, tokens) {
        try {
            return window.LogicParser.evaluate(
                logic,
                tokenResolver(inventory, tokens)
            );
        } catch (error) {
            // A malformed logic string is a data bug, and this runs on every click,
            // so it reports unreachable rather than taking the whole sweep down.
            // LogicParser has already named it in the console.
            return false;
        }
    }

    // ---------- Implied layers (console helpers only) ----------

    // A layer is implied when the rest of a check's requirement already covers it:
    // a strict requirement nested under a group offering a looser one evaluates
    // correctly and still renders a bullet nobody can act on.
    //
    // Decided exactly: logic has no "not", so holding more never turns a check red.
    // Any inventory the other layers accept holds one of their minimal ways in, so a
    // layer met by every one of those ways is met by all of them, and a way that
    // misses it proves it matters. Flags, helpers and counts against a setting stay
    // plain tokens as written, which can miss an implication but never invent one.
    // A console helper rather than a validator: some implied layers are deliberate.

    // Past this, the ways in are too many to list, and the layer is left undecided
    // rather than guessed at. Checked before pruning, which compares every way with
    // every other and would take minutes on a chain far past it.
    const WAYS_LIMIT = 1000;

    // A count against a setting only matches the same count written the same way.
    const settingAtom = node => `${node.left.id}>=${node.right.id}`;

    // Every minimal way to meet a tree, each a Map of token -> the count it needs.
    function waysIn(node) {
        if (node.type === "token") return [new Map([[node.id, 1]])];
        if (node.type === "compare") {
            return node.right.type === "setting"
                ? [new Map([[settingAtom(node), 1]])]
                : [new Map([[node.left.id, node.right.value]])];
        }
        if (node.type === "or") return withoutDominated(node.children.flatMap(waysIn));

        let ways = [new Map()];
        node.children.forEach(child => {
            const next = [];
            waysIn(child).forEach(tail => ways.forEach(head => {
                const way = new Map(head);
                tail.forEach((count, token) => way.set(token, Math.max(count, way.get(token) || 0)));
                next.push(way);
            }));
            if (next.length > WAYS_LIMIT) throw new RangeError("too many ways in");
            ways = withoutDominated(next);
        });
        return ways;
    }

    // A way that asks for everything another asks, and maybe more, adds nothing.
    function withoutDominated(ways) {
        const covers = (small, big) => [...small].every(([token, count]) => (big.get(token) || 0) >= count);
        return ways.filter((way, index) => !ways.some((other, at) =>
            at !== index && covers(other, way) && (!covers(way, other) || at < index)));
    }

    // Whether a tree is met by an inventory holding exactly one way in.
    function metBy(node, way) {
        switch (node.type) {
            case "token": return (way.get(node.id) || 0) >= 1;
            case "compare":
                return node.right.type === "setting"
                    ? way.has(settingAtom(node))
                    : (way.get(node.left.id) || 0) >= node.right.value;
            case "and": return node.children.every(child => metBy(child, way));
            case "or": return node.children.some(child => metBy(child, way));
        }
        return false;
    }

    // `where` names the check in a warning, for a chain too large to decide.
    function redundantLayers(parts, where) {
        if (parts.length < 2) return [];
        let trees;
        try {
            trees = parts.map(part => window.LogicParser.parse(part));
        } catch (error) {
            return []; // LogicParser has named it.
        }

        const dead = [];
        trees.forEach((tree, index) => {
            const rest = trees.filter((other, at) => at !== index && other);
            if (!tree || !rest.length) return;
            let ways;
            try {
                ways = waysIn({ type: "and", children: rest });
            } catch (error) {
                if (!(error instanceof RangeError)) throw error;
                console.warn(`locationTracker: ${where}: too many ways in to decide whether "${parts[index]}" is implied.`);
                return;
            }
            if (ways.every(way => metBy(tree, way))) dead.push(parts[index]);
        });
        return dead;
    }

    // The sweep and canAccess() for a devtools console, run against the live
    // GameState so nobody has to type the inventory in. Inside onReady because
    // TrackerDebug is gameStateManager.js's object, like Tooltip.register above.
    window.TrackerData.onReady(() => {
        const debug = window.TrackerDebug;
        if (!debug) return;

        debug.evaluateAllRegions = () => {
            const state = window.GameState;
            evaluateAllRegions(state.items, state.tokens);
        };

        debug.canAccess = (logic) => {
            const state = window.GameState;
            return canAccess(logic, state.items, state.tokens);
        };

        // Every location flag and logic helper, and whether the current inventory
        // meets it.
        debug.namedTokens = () => {
            const state = window.GameState;
            const resolve = tokenResolver(state.items, state.tokens);
            return [...namedTokens.values()].map(named => ({
                id: named.id,
                kind: named.kind,
                name: named.name,
                met: Boolean(resolve(named.id)),
                resolvable: Boolean(named.chain)
            }));
        };

        // The same answer as the dump's "implied" lines, as data and without printing,
        // so a test can assert on it. Takes a region name, part of one, or nothing.
        debug.impliedLayers = (match) => {
            const wanted = typeof match === "string" ? match.toLowerCase() : null;
            const found = [];
            (window.TrackerData.regions || []).forEach(region => {
                if (wanted && !String(region.region_name).toLowerCase().includes(wanted)) return;
                (region.item_checks || []).forEach(check => {
                    const parts = [region.logic, ...(check.group_logic || []), check.logic]
                        .filter(part => typeof part === "string" && part.trim() !== "");
                    redundantLayers(parts, checkWhere(region, check)).forEach(part => found.push({
                        region: region.region_name,
                        path: (check.group_path || []).join(" -> "),
                        check: check.id,
                        implied: part
                    }));
                });
            });
            return found;
        };

        // What the sub-region trees actually resolved to. Inheritance is only worth
        // trusting if you can read the result instead of re-deriving it in your head,
        // so this prints each check's full requirement and where its vanilla values
        // came from. Takes a region name, part of one, or nothing for every region.
        debug.resolvedChecks = (match) => {
            const wanted = typeof match === "string" ? match.toLowerCase() : null;
            const regions = (window.TrackerData.regions || []).filter(region =>
                !wanted || String(region.region_name).toLowerCase().includes(wanted));

            if (!regions.length) {
                console.warn(`No region matches "${match}".`);
                return;
            }

            regions.forEach(region => {
                console.group(`${region.region_name} - ${(region.item_checks || []).length} check(s)`);
                if (region.logic) console.log(`region entry: ${region.logic}`);

                (region.item_checks || []).forEach(check => {
                    const path = (check.group_path || []).join(" -> ");
                    console.group(`${check.id}${path ? `   [${path}]` : ""}`);

                    const parts = [region.logic, ...(check.group_logic || []), check.logic]
                        .filter(part => typeof part === "string" && part.trim() !== "");
                    console.log(`logic: ${parts.length ? parts.join("  &  ") : "(none)"}`);

                    redundantLayers(parts, checkWhere(region, check)).forEach(part => console.info(
                        `implied: "${part}" is already covered by the rest of this check's ` +
                        `requirement, so it renders a bullet that can never change. Expected ` +
                        `where an area is entered more loosely than a check inside it needs; ` +
                        `worth moving the check out if that was not deliberate.`
                    ));

                    if (check.vanilla_when === undefined) {
                        console.log("vanilla: randomized");
                    } else {
                        console.log(`vanilla_when: ${JSON.stringify(check.vanilla_when)}${fromNote(check.vanilla_when_from)}`);
                        const item = check.vanilla_item === undefined ? "(nothing listed)" : check.vanilla_item;
                        console.log(`vanilla_item: ${item}${fromNote(check.vanilla_item_from)}`);
                    }
                    console.groupEnd();
                });
                console.groupEnd();
            });
        };
    });

    // Where a check sits, sub-regions included, for a warning that has to be
    // findable in the file. A value a group set names the group as well, since the
    // fix is there and not on the thirty checks that inherited it.
    function checkWhere(region, check) {
        return [region.region_name, ...(check.group_path || []), check.id].join(" -> ");
    }

    function fromNote(source) {
        return source ? ` (set by "${source}")` : "";
    }

    // A vanilla_when that can't be read never matches, so its check shows as
    // randomized. Named once here rather than left as a check that should be purple.
    function validateVanillaClauses(regions) {
        const settings = window.SettingsState;
        if (!settings) return;
        const bad = [];

        regions.forEach(region => {
            (region.item_checks || []).forEach(check => {
                if (!check || check.vanilla_when === undefined) return;
                const problem = settings.clauseProblem(check.vanilla_when);
                if (problem) {
                    bad.push(`${checkWhere(region, check)}: vanilla_when ${problem}${fromNote(check.vanilla_when_from)}`);
                }
            });
        });

        if (!bad.length) return;
        console.warn(
            `locationTracker: ${bad.length} vanilla_when clause(s) can't be read, so each of ` +
            `these checks shows as randomized.`
        );
        bad.forEach(line => console.warn(`  ${line}`));
    }

    // One location shown in several places must be randomized in all of them or in
    // none, or it counts as half purple, and hold the same vanilla_item, or the
    // tooltip names two different things for one spot. Compared as written rather
    // than by what matches now, so a disagreement shows under any settings.
    function validateVanillaAgreement(regions) {
        const canonical = clause => {
            if (clause === undefined) return "(randomized)";
            const part = p => (p && typeof p === "object" && !Array.isArray(p))
                ? JSON.stringify(Object.keys(p).sort().map(id => [id, [].concat(p[id]).sort()]))
                : JSON.stringify(p);
            return JSON.stringify([].concat(clause).map(part).sort());
        };

        const byLocation = new Map(); // location key -> [{ where, clause, item }]
        regions.forEach(region => {
            (region.item_checks || []).forEach(check => {
                if (!check || typeof check.id !== "string" || check.id === "") return;
                const key = window.ItemCheckState.locationKey(check.id);
                if (!byLocation.has(key)) byLocation.set(key, []);
                byLocation.get(key).push({
                    where: `${region.region_name} -> ${check.id}`,
                    clause: canonical(check.vanilla_when),
                    item: check.vanilla_item === undefined ? "(none)" : JSON.stringify(check.vanilla_item)
                });
            });
        });

        const sets = [...byLocation.values()].filter(entries => entries.length > 1);

        const disagreeing = sets.filter(entries => new Set(entries.map(e => e.clause)).size > 1);
        if (disagreeing.length) {
            console.warn(
                `locationTracker: ${disagreeing.length} set(s) of checks are one location but disagree on ` +
                `vanilla_when. Give every check in a set the same clause.`
            );
            disagreeing.forEach(entries => console.warn(`  ${entries.map(e => e.where).join(", ")}`));
        }

        const itemsDisagree = sets.filter(entries => new Set(entries.map(e => e.item)).size > 1);
        if (itemsDisagree.length) {
            console.warn(
                `locationTracker: ${itemsDisagree.length} set(s) of checks are one location but disagree on ` +
                `vanilla_item. Give every check in a set the same one.`
            );
            itemsDisagree.forEach(entries => console.warn(`  ${entries.map(e => e.where).join(", ")}`));
        }
    }

    // TrackerData.regions is already in manifest.json order, which is the one place
    // display order is controlled from — don't re-sort here.
    window.TrackerData.onReady(({ config, regions }) => {
        const regionContainer = document.getElementById("region-dropdown-container");
        const CHECK_GROUPS = config.check_groups || [];

        // Both filled in by the loop below, and both read from the finally block —
        // which has to report and hand off whatever the loop managed, throw or no throw.
        const rejected = [];
        const rendered = [];

        try {
            // region_name is the identity the marker lookup, the overlay handoff and
            // regionStatusChanged all key off, and a check's id is where a save keeps
            // it, so a region without a unique name, an item_checks list or an id on
            // every check isn't drawn. Which ones pass is DataModel's to say, and the
            // data checks have already named the rest ("region-accepted").
            const { accepted } = window.DataModel.acceptRegions(regions, window.TrackerData.regionFile);
            accepted.forEach(regionData => {
                // Per region on purpose. Anything unexpected in one region file should
                // cost that region and nothing else; the outer catch stays for whatever
                // goes wrong outside the loop.
                try {
                    renderRegionDropdown(regionData, regionContainer);
                    rendered.push(regionData);
                } catch (error) {
                    const file = window.TrackerData.regionFile(regionData) || "a region file";
                    rejected.push(`"${regionData.region_name}" in ${file} could not be rendered (${error.message})`);
                    console.error(`locationTracker: rendering "${regionData.region_name}" failed`, error);
                }
            });

        } catch (error) {
            console.error("Error rendering regions:", error);
        } finally {
            if (rejected.length) {
                console.warn(
                    `locationTracker: ${rejected.length} region(s) were not rendered. Their checks are ` +
                    `missing from the tracker, and any marker they have will not open them.`
                );
                rejected.forEach(line => console.warn(`  ${line}`));
            }

            // In the finally, because the rest of the page still has to hear about the
            // regions that did render. On the throw path no marker gets a color and no
            // check gets tagged, so the tracker reads as "nothing is reachable" and
            // sends you to the logic strings instead of the region file that broke.
            window.dispatchEvent(new CustomEvent("regionsRendered"));

            // Rendered regions only, and each check in its own try/catch: they run
            // ahead of the first sweep, so a throw would cost the sweep too. After
            // GameState.init (itemTracker.js runs first), and before the first sweep
            // and any click, which read the locations and the named tokens.
            try {
                const save = window.TrackerLaunch ? window.TrackerLaunch.readSave() : null;
                window.ItemCheckState.init(rendered, CHECK_GROUPS, save && Array.isArray(save.checks) ? save.checks : []);
                window.ItemCheckState.completedIds().forEach(id => rowsFor(id).forEach(el => el.classList.add("completed")));
            } catch (error) {
                console.error("locationTracker: could not set up the check state", error);
            }

            try {
                indexNamedTokens(rendered);
            } catch (error) {
                console.error("locationTracker: could not read the location flags and logic helpers", error);
            }

            try {
                validateVanillaClauses(rendered);
            } catch (error) {
                console.error("locationTracker: could not validate the vanilla_when clauses", error);
            }

            try {
                validateVanillaAgreement(rendered);
            } catch (error) {
                console.error("locationTracker: could not compare vanilla_when across grouped checks", error);
            }

            // Run evaluation sweep using initial baseline numbers immediately after files finish rendering
            if (window.GameState) {
                evaluateAllRegions(window.GameState.items, window.GameState.tokens);
            }
        }
    });

    // Deduping is the caller's job: it has the whole list, so it can report what it
    // rejected. Doing it here would mean matching on the rendered header text, which
    // is the thing dataset.regionName exists to avoid.
    function renderRegionDropdown(regionData, container) {
        const groupDiv = document.createElement("div");
        groupDiv.classList.add("region-group");
        // The region's identity as data rather than as the text inside its header.
        // Matching on the displayed string quietly breaks the moment two regions share
        // a name or one is renamed, so locationMap.js keys off this attribute.
        groupDiv.dataset.regionName = regionData.region_name;

        const headerBtn = document.createElement("button");
        headerBtn.classList.add("region-header");

        // Name and count share one element so they wrap together like a sentence;
        // as siblings, large text pushes the count past the header's edge.
        const titleSpan = document.createElement("span");
        titleSpan.classList.add("region-title");
        headerBtn.appendChild(titleSpan);

        // Node by node rather than innerHTML: region_name is data, and everywhere else
        // a data string reaches the page it is set as text.
        const nameSpan = document.createElement("span");
        nameSpan.textContent = regionData.region_name;
        titleSpan.appendChild(nameSpan);

        // Filled by determineRegionLocationAccessibility(); empty until the first
        // sweep so a region never briefly reads as (0/0).
        const countSpan = document.createElement("span");
        countSpan.classList.add("region-count");
        titleSpan.appendChild(countSpan);

        // The arrow glyph itself lives in CSS (.region-arrow::after) — this span is
        // just the hook. Keeps the ▼/▲ characters out of three different JS files.
        const arrowSpan = document.createElement("span");
        arrowSpan.classList.add("region-arrow");
        headerBtn.appendChild(arrowSpan);

        // The arrow glyph is the sighted cue for open/closed and it lives in CSS, so
        // without this there is nothing saying which state the accordion is in.
        headerBtn.setAttribute("aria-expanded", "false");

        const contentDiv = document.createElement("div");
        contentDiv.classList.add("region-content");

        const checks = [];

        regionData.item_checks.forEach(check => {
            const itemDiv = document.createElement("div");
            itemDiv.classList.add("region-check-item");
            itemDiv.dataset.checkId = check.id;
            // Decided once: a tracker's settings don't change while it is open. A
            // clause that can't be read never matches, and validateVanillaClauses()
            // names it.
            const vanilla = check.vanilla_when !== undefined && Boolean(window.SettingsState) &&
                window.SettingsState.matches(check.vanilla_when);
            if (vanilla) {
                itemDiv.classList.add("vanilla");
                if (typeof check.vanilla_item === "string" && check.vanilla_item.trim() !== "") {
                    checkVanillaItems.set(itemDiv, vanillaItemName(check.vanilla_item));
                }
            }
            // The name is its own element so `completed` can strike the text without
            // striking the info button — a decoration line propagates into
            // descendants and cannot be turned off from inside them.
            const nameSpan = document.createElement("span");
            nameSpan.className = "region-check-name";
            nameSpan.textContent = check.name;
            itemDiv.appendChild(nameSpan);
            checkNames.set(itemDiv, check.name);

            // Touch has no hover, so the requirements need a control of their own.
            // Hidden above the breakpoint, where hovering the row already does it.
            const infoBtn = document.createElement("button");
            infoBtn.type = "button";
            infoBtn.className = "region-check-info";
            infoBtn.setAttribute("aria-label", `Requirements for ${check.name}`);
            infoBtn.setAttribute("aria-expanded", "false");
            infoBtn.addEventListener("click", (event) => {
                // Without this the row's own handler marks the check complete.
                event.stopPropagation();
                window.Tooltip.togglePin(itemDiv);
            });
            itemDiv.appendChild(infoBtn);

            // The id as the row carries it, so a check with no id matches its row.
            checks.push({
                id: itemDiv.dataset.checkId,
                element: itemDiv,
                logic: check.logic,
                group_logic: check.group_logic,
                vanilla: vanilla,
                accessible: false
            });

            // The same expression the sweep evaluates, so the tooltip can never
            // explain a check by different rules than the ones that colored it.
            checkRequirements.set(itemDiv, combinedLogic(regionData.logic, check));

            // The checkCompletionChanged listener redraws every row of the location.
            itemDiv.addEventListener("click", () => {
                const id = itemDiv.dataset.checkId;
                if (!window.ItemCheckState.toggle(id)) return;
                window.ItemCheckState.linkedIds(id).forEach(linkedId => rowsFor(linkedId).forEach(keepRowShown));
            });

            contentDiv.appendChild(itemDiv);
        });

        // Opening as well as closing lets kept rows go, so a region always opens
        // with nothing held over.
        headerBtn.addEventListener("click", () => {
            const isOpen = contentDiv.classList.toggle("open");
            headerBtn.classList.toggle("expanded", isOpen);
            headerBtn.setAttribute("aria-expanded", String(isOpen));
            releaseKeptRows(groupDiv);
        });

        groupDiv.appendChild(headerBtn);
        groupDiv.appendChild(contentDiv);
        container.appendChild(groupDiv);

        activeRegionTrackers.push({
            regionName: regionData.region_name,
            entryLogic: regionData.logic,
            headerBtn: headerBtn,
            countEl: countSpan,
            groupEl: groupDiv,
            checks: checks
        });
    }

    function determineRegionLocationAccessibility(region) {
        const headerBtn = region.headerBtn;
        let hasRed = false;
        let hasGreen = false;
        let hasPurple = false;

        // "How many can I go and do, out of how many are left here", counted by the
        // same rule as the progress numbers, over this region's own rows: two ids of
        // one check_group here count once, and each region showing the location still
        // counts it. Hidden non-randomized checks leave the color too.
        const tally = window.ItemCheckState.count(region.checks,
            Boolean(window.TrackerView && window.TrackerView.hidesNonRandomized()));
        const accessibleCount = tally.accessible;
        const remainingCount = tally.remaining;

        tally.locations.forEach(location => {
            if (location.completed) return;
            if (!location.accessible) hasRed = true;
            else if (location.vanilla) hasPurple = true;
            else hasGreen = true;
        });

        // Red plus anything reachable is partial. Green outranks purple, so a region
        // reads purple only when everything reachable left in it is non-randomized.
        let newStatus;
        if (hasRed && (hasGreen || hasPurple)) {
            newStatus = "partialCompletion";
        }
        else if (hasRed) {
            newStatus = "inaccessible";
        }
        else if (hasGreen) {
            newStatus = "fullClear";
        }
        else if (hasPurple) {
            newStatus = "vanilla";
        }
        else {
            newStatus = "completed";
        }

        // For Show Only Accessible Checks, which hides a region with nothing left to go
        // and do. A class rather than the count attribute because CSS can't compare
        // numbers; toggling to the class it already has changes nothing.
        region.groupEl.classList.toggle("nothing-accessible", accessibleCount === 0);

        const counts = `(${accessibleCount}/${remainingCount})`;
        const statusMoved = headerBtn.dataset.status !== newStatus;
        const countsMoved = headerBtn.dataset.counts !== counts;

        // Only touch the DOM if the status actually moved. Rewriting the classes for
        // every region on every state change forces a restyle across every check, which
        // reads as the text flickering on each click.
        //
        // data-status is both the contract locationMap.js mirrors onto its markers and
        // the record of which class was last applied, so neither file has to keep its
        // own list of status names.
        if (statusMoved) {
            if (headerBtn.dataset.status) headerBtn.classList.remove(headerBtn.dataset.status);
            headerBtn.dataset.status = newStatus;
            headerBtn.classList.add(newStatus);
        }

        if (countsMoved) {
            headerBtn.dataset.counts = counts;
            // The same count as a number, so nothing has to parse the display text.
            headerBtn.dataset.accessible = accessibleCount;
            if (region.countEl) region.countEl.textContent = counts;
        }

        // Counts move without the status moving — three accessible dropping to two is
        // still partialCompletion — so both have to announce, or the marker and the
        // overlay titlebar hold a stale number.
        //
        // Announced rather than watched for: the region whose marker was just clicked
        // has been moved out into the overlay, where a watcher on the container could
        // not see it.
        if (statusMoved || countsMoved) {
            window.dispatchEvent(new CustomEvent("regionStatusChanged", {
                detail: {
                    regionName: region.regionName,
                    status: newStatus,
                    accessible: accessibleCount,
                    remaining: remainingCount
                }
            }));
        }
    }
})();
