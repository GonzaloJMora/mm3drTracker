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
            // loop and reads false rather than recursing; validateNamedTokens()
            // names it at load.
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

            // An unknown token is not an error here — validateLogicTokens() has
            // already named it once at load, and the check simply stays unreachable.
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
    function indexNamedTokens(regions) {
        namedTokens.clear();
        const data = window.TrackerData || {};
        const taken = new Set([
            ...(data.items || []).map(item => item.id),
            ...Object.keys(window.GameState ? window.GameState.items : {}),
            ...Object.keys(window.GameState ? window.GameState.tokens : {})
        ]);
        const add = (entry, kind, chainOf) => {
            if (!entry || typeof entry.id !== "string" || !/^[a-z0-9_]+$/.test(entry.id)) return;
            if (namedTokens.has(entry.id) || taken.has(entry.id)) return;
            namedTokens.set(entry.id, {
                id: entry.id,
                kind,
                name: typeof entry.name === "string" && entry.name !== "" ? entry.name : entry.id,
                chain: chainOf(entry)
            });
        };
        (data.locationFlags || []).forEach(entry => add(entry, "flag", e => flagChain(e, regions)));
        (data.logicHelpers || []).forEach(entry => add(entry, "helper",
            e => (typeof e.logic === "string" && e.logic.trim() !== "" ? [e.logic] : null)));
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

    // An unrecognized token resolves to false in canAccess() and stays that way, so
    // the check never turns green and it reads as bad region logic rather than a typo.
    //
    // The progression hint is the part worth having: a progression's slot id looks
    // like it should work, but the state only holds the stage ids, so you name the
    // lowest stage you will accept. See ARCHITECTURE.md, "Logic strings".
    //
    // It walks the parsed tree rather than the text: the name after >= is a setting
    // and every other name an item, and only the tree knows which side a name is on.
    // A string that fails to parse is skipped, since LogicParser has already named it.
    function validateLogicTokens(regions, config) {
        const known = new Set(Object.keys(window.GameState ? window.GameState.items : {}));
        Object.keys(window.GameState ? window.GameState.tokens : {}).forEach(token => known.add(token));
        namedTokens.forEach((named, id) => known.add(id));

        const settings = window.SettingsState;
        const isSetting = name => Boolean(settings) && settings.get(name) !== undefined;
        const progressions = config.progressions || {};
        const unknown = new Map(); // token -> where it was seen
        const badCounts = new Map(); // name after >= -> where it was seen

        const note = (seen, name, where) => {
            if (!seen.has(name)) seen.set(name, []);
            seen.get(name).push(where);
        };

        const walk = (node, where) => {
            if (node.type === "and" || node.type === "or") {
                node.children.forEach(child => walk(child, where));
            } else if (node.type === "compare") {
                walk(node.left, where);
                if (node.right.type === "setting" && !(settings && settings.isNumeric(node.right.id))) {
                    note(badCounts, node.right.id, where);
                }
            } else if (node.type === "token" && !known.has(node.id)) {
                note(unknown, node.id, where);
            }
        };

        // LogicParser says what is wrong with a string, but not where it is used.
        const unreadable = new Map(); // the string as written -> where it was seen
        // In a list of one, so a layer is parsed as the sweep parses it: a list
        // written as a layer is one bad part, not a list of parts.
        const scan = (logic, where) => {
            let tree = null;
            try {
                tree = window.LogicParser.parse([logic]);
            } catch (error) {
                note(unreadable, typeof logic === "string" ? `"${logic}"` : JSON.stringify(logic), where);
                return;
            }
            if (tree) walk(tree, where);
        };

        ((window.TrackerData && window.TrackerData.locationFlags) || []).forEach(entry => {
            if (entry && typeof entry.logic === "string") scan(entry.logic, `locationFlags.json -> ${entry.id}`);
        });
        ((window.TrackerData && window.TrackerData.logicHelpers) || []).forEach(entry => {
            if (entry && typeof entry.logic === "string") scan(entry.logic, `logicHelpers.json -> ${entry.id}`);
        });

        regions.forEach(region => {
            scan(region.logic, `${region.region_name} (region entry)`);
            // A sub-region's logic is on every check under it, so it is scanned once
            // under the group's own name rather than once per check.
            const groupsSeen = new Set();
            (region.item_checks || []).forEach(check => {
                if (!check) return;
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

        if (unreadable.size) {
            console.warn(
                `locationTracker: ${unreadable.size} logic string(s) can't be read, so every check ` +
                `they gate reads unreachable.`
            );
            unreadable.forEach((places, shown) => console.warn(`  ${shown}
        used by: ${places.join(", ")}`));
        }

        if (unknown.size) {
            // Which names a missing file held can't be known, so they stay listed,
            // but the file that failed is the likelier cause than every region file.
            const failed = ((window.TrackerData && window.TrackerData.failedLogicFiles) || [])
                .map(path => path.replace(/^data\//, ""));
            const cause = failed.length
                ? ` ${failed.join(" and ")} could not be loaded, so ${failed.length === 1 ? "its" : "their"} ` +
                  `entries are likely among these.`
                : "";
            console.warn(
                `locationTracker: ${unknown.size} logic token(s) match nothing in the item state. ` +
                `Every check using one of these will stay unreachable no matter what you collect.${cause}`
            );
            unknown.forEach((places, token) => {
                const chain = Object.prototype.hasOwnProperty.call(progressions, token) ? progressions[token] : null;
                let hint = "";
                if (Array.isArray(chain) && chain.length) {
                    hint = ` - "${token}" is a progression slot, not an item; name a stage instead, e.g. "${chain[0]}" for "any ${token}".`;
                } else if (isSetting(token)) {
                    hint = ` - "${token}" is a setting, which only goes after >= as the count to reach.`;
                }
                console.warn(`  ${token}${hint}
        used by: ${places.join(", ")}`);
            });
        }

        if (badCounts.size) {
            console.warn(
                `locationTracker: ${badCounts.size} name(s) after >= are not a count. ` +
                `Every check comparing against one of these will stay unreachable.`
            );
            badCounts.forEach((places, name) => {
                const hint = isSetting(name)
                    ? ` - "${name}" is a setting, but only a dropdown whose options carry a "value" can go after >=.`
                    : ` - "${name}" matches no setting.`;
                console.warn(`  ${name}${hint}
        used by: ${places.join(", ")}`);
            });
        }
    }

    // Tokens a layer demands outright: the & spine only. A token inside an | is an
    // alternative rather than a demand, and `key>=2` is the right way to ask for a
    // second one, so neither is collected here.
    function demandedTokens(logic) {
        const found = new Set();
        let tree = null;
        try {
            tree = window.LogicParser.parse(logic);
        } catch (error) {
            return found;
        }
        (function walk(node) {
            if (!node) return;
            if (node.type === "and") {
                node.children.forEach(walk);
                return;
            }
            if (node.type === "token") found.add(node.id);
        })(tree);
        return found;
    }

    // A bare token is a yes/no question, so demanding one twice down a sub-region
    // chain asks for no more than demanding it once: one small key opens both doors.
    // It fails open — the check turns green early and nothing looks wrong — which is
    // why it is worth a warning rather than a comment somewhere.
    function validateRepeatedTokens(regions) {
        const counted = (window.TrackerData.config && window.TrackerData.config.item_counts) || {};
        const found = new Map();

        regions.forEach(region => {
            (region.item_checks || []).forEach(check => {
                const path = check.group_path || [];
                const layers = [
                    { where: "the region's entry", logic: region.logic },
                    ...(check.group_logic || []).map((logic, depth) => ({
                        where: `"${path[depth]}"`, logic
                    })),
                    { where: "the check itself", logic: check.logic }
                ];

                // Keyed by the two layers rather than by the check, so a group that
                // repeats its parent is named once and not once per check under it.
                const seen = new Map();
                layers.forEach(layer => {
                    demandedTokens(layer.logic).forEach(token => {
                        if (!seen.has(token)) {
                            seen.set(token, layer.where);
                            return;
                        }
                        const key = [region.region_name, seen.get(token), layer.where, token].join("|");
                        if (found.has(key)) return;
                        found.set(key, { region: region.region_name, first: seen.get(token),
                            again: layer.where, token, example: check.id });
                    });
                });
            });
        });

        if (!found.size) return;
        console.warn(
            `locationTracker: ${found.size} item(s) are demanded twice in one check's ` +
            `requirement, where the second copy asks for nothing the first did not.`
        );
        found.forEach(entry => {
            // Only a counted item can be asked for twice, with a running total.
            // Anything else is a yes/no token, where "two of them" is not a thing
            // to suggest.
            const fix = typeof counted[entry.token] === "number"
                ? ` Write the running total on the deeper one, like "${entry.token}>=2", if two are needed.`
                : " Drop one of them.";
            console.warn(
                `  ${entry.region}: "${entry.token}" is demanded by ${entry.first} and again ` +
                `by ${entry.again} (for example ${entry.example}).${fix}`
            );
        });
    }

    // A bad named token reads false, so every check using it stays red for a reason
    // that is nowhere near the check. Each problem is named once here instead.
    function validateNamedTokens() {
        const data = window.TrackerData || {};
        const items = new Set((data.items || []).map(item => item.id));
        const derived = new Set([
            ...Object.keys(window.GameState ? window.GameState.items : {}),
            ...Object.keys(window.GameState ? window.GameState.tokens : {})
        ]);
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
            if (items.has(entry.id) || derived.has(entry.id)) {
                bad.push(`${where}: is already an item or derived token, so logic reads that and ignores this entry`);
                return null;
            }
            if (typeof entry.name !== "string" || entry.name === "") {
                bad.push(`${where}: has no "name", so the tooltip shows the id`);
            }
            return where;
        };

        (data.locationFlags || []).forEach((entry, index) => {
            const where = common(entry, index, "locationFlags.json", "odolwa_defeated");
            if (!where) return;
            const at = entry.at || {};
            const pointers = ["check", "region"].filter(key => typeof at[key] === "string");
            if (pointers.length !== 1) {
                bad.push(`${where}: "at" needs exactly one of "check" or "region", so it reads false`);
            } else if (!namedTokens.get(entry.id) || !namedTokens.get(entry.id).chain) {
                bad.push(`${where}: "at" names ${pointers[0]} "${at[pointers[0]]}", which isn't in any rendered region, so it reads false`);
            }
        });

        (data.logicHelpers || []).forEach((entry, index) => {
            const where = common(entry, index, "logicHelpers.json", "fighting");
            if (!where) return;
            if (typeof entry.logic !== "string" || entry.logic.trim() === "") {
                bad.push(`${where}: has no "logic", so it reads false`);
            }
        });

        // A loop can only close through other named tokens, so following those is enough.
        const uses = id => {
            const named = namedTokens.get(id);
            if (!named || !named.chain) return [];
            const tokens = new Set();
            named.chain.forEach(part => {
                let tree = null;
                try { tree = window.LogicParser.parse(part); } catch (error) { return; }
                (function walk(node) {
                    if (!node) return;
                    if (node.type === "token") tokens.add(node.id);
                    else if (node.type === "compare") tokens.add(node.left.id);
                    else if (node.children) node.children.forEach(walk);
                })(tree);
            });
            return [...tokens].filter(token => namedTokens.has(token));
        };
        namedTokens.forEach((named, id) => {
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

        if (!bad.length) return;
        console.warn(`locationTracker: ${bad.length} problem(s) in locationFlags.json or logicHelpers.json.`);
        bad.forEach(line => console.warn(`  ${line}`));
    }

    // Two checks sharing an id are one location as far as the rest of the tracker is
    // concerned — they tick off together and count once. That is what check_groups is
    // for, and it is indistinguishable from a typo, which instead makes a check tick
    // itself off somewhere else and quietly shrinks the total.
    //
    // Ids carry a per-region prefix by convention, so this should stay quiet. A check
    // with no id never gets here: it costs its region at render.
    function validateCheckIds(regions) {
        const usedBy = new Map(); // id -> region names using it

        regions.forEach(region => {
            region.item_checks.forEach(check => {
                if (!usedBy.has(check.id)) usedBy.set(check.id, []);
                usedBy.get(check.id).push(region.region_name);
            });
        });

        const duplicated = [...usedBy].filter(([, where]) => where.length > 1);
        if (!duplicated.length) return;

        console.warn(
            `locationTracker: ${duplicated.length} check id(s) are used more than once. Each set ticks ` +
            `off together and counts as a single location, exactly as a declared check_group would.`
        );
        duplicated.forEach(([id, where]) => console.warn(`  "${id}" — used by: ${where.join(", ")}`));
    }

    // dataLoader.js has already dropped groups that aren't lists of ids. What's left
    // to ask needs the rendered checks: an id that matches none leaves its location
    // unlinked, and an id in two groups makes ItemCheckState merge them into one
    // location, which is rarely what was meant.
    function validateCheckGroups(regions, checkGroups) {
        const ids = new Set();
        regions.forEach(region => (region.item_checks || []).forEach(check => {
            if (check && typeof check.id === "string") ids.add(check.id);
        }));

        const problems = [];
        const groupOf = new Map();
        checkGroups.forEach((group, index) => {
            group.forEach(id => {
                if (!ids.has(id)) problems.push(`check_groups[${index}]: "${id}" matches no check on the page`);
                if (groupOf.has(id)) {
                    problems.push(`check_groups[${index}]: "${id}" is already in check_groups[${groupOf.get(id)}]`);
                } else {
                    groupOf.set(id, index);
                }
            });
        });

        if (!problems.length) return;
        console.warn(`locationTracker: ${problems.length} problem(s) in config/checkGroups.json. A location they name may not tick off or count as one.`);
        problems.forEach(line => console.warn(`  ${line}`));
    }

    // A check with no name draws as a blank row that can still be ticked.
    function validateCheckNames(regions) {
        const unnamed = [];
        regions.forEach(region => (region.item_checks || []).forEach((check, index) => {
            if (typeof check.name !== "string" || check.name.trim() === "") {
                unnamed.push(typeof check.id === "string" && check.id ? checkWhere(region, check)
                    : `${region.region_name} -> item_checks[${index}]`);
            }
        }));

        if (!unnamed.length) return;
        console.warn(`locationTracker: ${unnamed.length} check(s) have no name, so each draws as a blank row.`);
        unnamed.forEach(where => console.warn(`  ${where}`));
    }

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

    // A vanilla_item that can't be shown just leaves the tooltip line out, so each
    // problem is named once here. Plain text is always allowed, since most vanilla
    // contents aren't tracked items; only a value written like an id has to be one.
    function validateVanillaItems(regions) {
        const ids = new Set(((window.TrackerData && window.TrackerData.items) || []).map(item => item.id));
        const bad = [];
        regions.forEach(region => {
            (region.item_checks || []).forEach(check => {
                if (!check || check.vanilla_item === undefined) return;
                const where = `${checkWhere(region, check)}${fromNote(check.vanilla_item_from)}`;
                const value = check.vanilla_item;
                if (typeof value !== "string" || value.trim() === "") {
                    bad.push(`${where}: vanilla_item has to be an item id or text`);
                } else if (/^[a-z0-9_]+$/.test(value) && !ids.has(value)) {
                    bad.push(`${where}: "${value}" is not an item id; write an untracked item as text, like "Red Rupee"`);
                } else if (check.vanilla_when === undefined) {
                    bad.push(`${where}: has a vanilla_item but no vanilla_when, so it never shows`);
                }
            });
        });
        if (!bad.length) return;
        console.warn(`locationTracker: ${bad.length} vanilla_item(s) can't be shown.`);
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
            // regionStatusChanged all key off. If two regions share one, the second
            // marker sits at its own coordinates and opens the first region's checks —
            // so skip it and say so rather than leave that to be found on the map.
            const seen = new Map(); // region_name -> the file that claimed it

            regions.forEach(regionData => {
                const name = regionData.region_name;
                // Every rejection names the file: when the name is the problem, it is
                // the only way to find the region.
                const file = window.TrackerData.regionFile(regionData) || "a region file";

                // Text only: the name is keyed as a string on the page (dataset) and
                // as written by locationMap.js, so a number would render with no marker.
                // dataLoader.js has already trimmed it.
                if (typeof name !== "string" || name === "") {
                    const count = Array.isArray(regionData.item_checks) ? regionData.item_checks.length : 0;
                    const what = name === undefined ? "no region_name"
                        : typeof name === "string" ? "a blank region_name"
                        : `a region_name that isn't text (${JSON.stringify(name)})`;
                    rejected.push(`${file} has ${what} (${count} check${count === 1 ? "" : "s"})`);
                    return;
                }
                if (seen.has(name)) {
                    rejected.push(seen.get(name) === file
                        ? `"${name}" in ${file} is loaded twice, because manifest.json lists ${file} twice`
                        : `"${name}" in ${file} is already used by ${seen.get(name)}`);
                    return;
                }
                // An empty list is normal — a region whose checks aren't written yet
                // renders as an empty accordion. A missing one is not: it throws, and
                // takes every region after it down with the regionsRendered handoff.
                // Tested before seen.set(), so a good file can still claim the name.
                if (!Array.isArray(regionData.item_checks)) {
                    rejected.push(`"${name}" in ${file} has no item_checks list`);
                    return;
                }
                // A check's id is where a save keeps it, so one without an id can't be
                // saved, and every such check would tick together.
                const idless = regionData.item_checks.filter(check => !check || typeof check.id !== "string" || check.id.trim() === "");
                if (idless.length) {
                    const named = idless.map(check => JSON.stringify((check && check.name) || "(no name)")).join(", ");
                    rejected.push(`"${name}" in ${file} has ${idless.length} check(s) with no id: ${named}`);
                    return;
                }

                seen.set(name, file);

                // Per region on purpose. Anything unexpected in one region file should
                // cost that region and nothing else; the outer catch stays for whatever
                // goes wrong outside the loop.
                try {
                    renderRegionDropdown(regionData, regionContainer);
                    rendered.push(regionData);
                } catch (error) {
                    rejected.push(`"${name}" in ${file} could not be rendered (${error.message})`);
                    console.error(`locationTracker: rendering "${name}" failed`, error);
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

            // Rendered regions only, and each validator in its own try/catch — they
            // run ahead of the first sweep, so a throw would cost the sweep too. A
            // rejected region isn't on the page and has already been named above, and
            // it is the malformed ones that make a validator throw, so handing over the
            // full list would cost you the diagnosis of every other file.
            //
            // Before the validators and the first sweep, which both read it, and after
            // GameState.init (itemTracker.js runs first), so there is item state to
            // check the tokens against.
            // Before the validators, which read its locations, and before the first
            // sweep and any click.
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
                validateNamedTokens();
            } catch (error) {
                console.error("locationTracker: could not validate the location flags and logic helpers", error);
            }

            try {
                validateLogicTokens(rendered, config);
            } catch (error) {
                console.error("locationTracker: could not validate the logic tokens", error);
            }

            // Duplicates especially: a region rejected for a repeated region_name is a
            // near-copy of one that did render, so the full list would report every
            // check inside it as a duplicate id.
            try {
                validateCheckIds(rendered);
            } catch (error) {
                console.error("locationTracker: could not validate the check ids", error);
            }

            try {
                validateCheckNames(rendered);
            } catch (error) {
                console.error("locationTracker: could not validate the check names", error);
            }

            try {
                validateCheckGroups(rendered, CHECK_GROUPS);
            } catch (error) {
                console.error("locationTracker: could not validate the check groups", error);
            }

            try {
                validateVanillaClauses(rendered);
            } catch (error) {
                console.error("locationTracker: could not validate the vanilla_when clauses", error);
            }

            try {
                validateVanillaItems(rendered);
            } catch (error) {
                console.error("locationTracker: could not validate the vanilla_item values", error);
            }

            try {
                validateVanillaAgreement(rendered);
            } catch (error) {
                console.error("locationTracker: could not compare vanilla_when across grouped checks", error);
            }

            try {
                validateRepeatedTokens(rendered);
            } catch (error) {
                console.error("locationTracker: could not look for items demanded twice", error);
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
