// Global memory registry to track active nodes for global real-time re-scans
const activeRegionTrackers = [];

// Reusable master execution sweep
function evaluateAllRegions(inventory, hearts, bossMasks, totalMasks) {
    activeRegionTrackers.forEach(region => {
        region.itemChecks.forEach(checkObj => {
            const el = checkObj.element;

            // A non-randomized check has known contents, so it is not part of the
            // reachability question. Tagging it would also stop its region ever
            // rolling up as vanilla. Cleared rather than skipped, so a check that
            // becomes vanilla later loses any tag it already had.
            if (el.classList.contains("vanilla")) {
                el.classList.toggle("accessible", false);
                el.classList.toggle("inaccessible", false);
                return;
            }

            // Combine regional route requirements with individual item checks
            const finalLogic = combinedLogic(region.entryLogic, checkObj.logic);
            const isAvailable = canAccess(finalLogic, inventory, hearts, bossMasks, totalMasks);

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

        // Trigger dynamic header coloration update functions across regions
        determineRegionLocationAccessibility(region);
    });

    // One announcement per sweep rather than per region: locationStatsTracker.js
    // recounts from scratch, so it only needs telling that something moved.
    window.dispatchEvent(new CustomEvent("trackerChecksUpdated"));
}

// Listen for updates dispatched by stateManager.js
window.addEventListener("trackerStateUpdated", (event) => {
    evaluateAllRegions(event.detail.items, event.detail.totalHearts, event.detail.totalBossMasks, event.detail.totalRegularMasks);
});

// The tokens that are not items. Defined once, as a function of the numbers they
// stand for, so canAccess() and validateLogicTokens() cannot drift apart about
// which names are legal.
function specialTokenValues(hearts, bossMasks, totalMasks) {
    return { hearts: hearts, boss_masks: bossMasks, total_masks: totalMasks };
}

// What a bare token is worth. The requirements tooltip resolves tokens through
// this same function, so the two cannot disagree about why a check is red.
function tokenResolver(inventory, hearts, bossMasks, totalMasks) {
    const specials = specialTokenValues(hearts, bossMasks, totalMasks);

    return (token) => {
        if (Object.prototype.hasOwnProperty.call(specials, token)) return specials[token];

        const value = inventory[token];
        if (typeof value === "boolean") return value;
        if (typeof value === "number") return value;

        // An unknown token is not an error here — validateLogicTokens() has
        // already named it once at load, and the check simply stays unreachable.
        return false;
    };
}

// A check's element to its display name, for the docked panel's heading. Held
// rather than read back off the rendered row, so the panel does not depend on
// how that row is marked up.
const checkNames = new WeakMap();

// A check's element to the logic that gates it. Held here rather than on the
// element because a .region-group is moved into the map overlay and back, and a
// WeakMap follows the node wherever it goes.
const checkRequirements = new WeakMap();

// Region entry and the check's own logic are one requirement, not two lists: you
// need the region *and* the check, so they read as a single set of bullets.
// A pair rather than one joined string, so LogicParser parses and names each part
// on its own — a broken region string is reported once, not once per check.
function combinedLogic(regionLogic, checkLogic) {
    return [regionLogic, checkLogic];
}

// Names come from the item data, with config.logic_token_names covering the
// derived tokens that have no Items.json entry (hearts, bottle, and friends).
function tokenDisplayName(token) {
    const data = window.TrackerData;
    const item = data && data.items && data.items.find(entry => entry.id === token);
    if (item && item.name) return item.name;

    const names = (data && data.config && data.config.logic_token_names) || {};
    // Own properties only: a token like `constructor` would otherwise find
    // Object's and render its source. Falling back to the raw id keeps a typo
    // visible in the tooltip instead of rendering a blank bullet.
    const name = Object.prototype.hasOwnProperty.call(names, token) ? names[token] : "";
    return name || token;
}

// Inside onReady so this file does not depend on tooltip.js loading first.
window.TrackerData.onReady(() => {
    window.Tooltip.register(".region-check-item", (element, context) => {
        const logic = checkRequirements.get(element);
        const fragment = document.createDocumentFragment();

        // Docked at the bottom of the screen the panel is nowhere near the row it
        // describes, so it has to name it. On hover the pointer is already on it.
        const heading = document.createElement("div");
        heading.className = "tooltip-heading";
        heading.textContent = (context && context.pinned)
            ? checkNames.get(element) || "Items Required"
            : "Items Required";
        fragment.appendChild(heading);

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
        const resolve = tokenResolver(
            state.items, state.totalHearts, state.totalBossMasks, state.totalRegularMasks
        );

        const annotated = window.LogicParser.annotate(tree, resolve);
        fragment.appendChild(window.RequirementsView.render(annotated, tokenDisplayName, resolve));
        return fragment;
    });
});

// Structural helper parsing logic lines dynamically without keeping state duplicates
function canAccess(logic, inventory, hearts, bossMasks, totalMasks) {
    try {
        return window.LogicParser.evaluate(
            logic,
            tokenResolver(inventory, hearts, bossMasks, totalMasks)
        );
    } catch (error) {
        // A malformed logic string is a data bug, and this runs on every click,
        // so it reports unreachable rather than taking the whole sweep down.
        // LogicParser has already named it in the console.
        return false;
    }
}

// An unrecognized token resolves to false in canAccess() and stays that way, so
// the check never turns green and it reads as bad region logic rather than a typo.
//
// The progression hint is the part worth having: `sword` looks like it should work
// — it is the slot id — but the state only holds the stage ids, so you name the
// lowest stage you will accept. See ARCHITECTURE.md, "Logic strings".
function validateLogicTokens(regions, config) {
    const known = new Set(Object.keys(window.GameState ? window.GameState.items : {}));
    Object.keys(specialTokenValues(0, 0, 0)).forEach(token => known.add(token));

    const progressions = config.progressions || {};
    const unknown = new Map(); // token -> where it was seen

    const scan = (logic, where) => {
        if (typeof logic !== "string") return;
        (logic.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []).forEach(token => {
            if (known.has(token)) return;
            if (!unknown.has(token)) unknown.set(token, []);
            unknown.get(token).push(where);
        });
    };

    regions.forEach(region => {
        scan(region.logic, `${region.region_name} (region entry)`);
        (region.item_checks || []).forEach(check => {
            if (check) scan(check.logic, `${region.region_name} -> ${check.id}`);
        });
    });

    if (!unknown.size) return;

    console.warn(
        `locationTracker: ${unknown.size} logic token(s) match nothing in the item state. ` +
        `Every check using one of these will stay unreachable no matter what you collect.`
    );
    unknown.forEach((places, token) => {
        const chain = Object.prototype.hasOwnProperty.call(progressions, token) ? progressions[token] : null;
        const hint = Array.isArray(chain) && chain.length
            ? ` - "${token}" is a progression slot, not an item; name a stage instead, e.g. "${chain[0]}" for "any ${token}".`
            : "";
        console.warn(`  ${token}${hint}
    used by: ${places.join(", ")}`);
    });
}

// Two checks sharing an id are one location as far as the rest of the tracker is
// concerned — they tick off together and count once. That is what check_groups is
// for, and it is indistinguishable from a typo, which instead makes a check tick
// itself off somewhere else and quietly shrinks the total.
//
// Ids carry a per-region prefix by convention, so this should stay quiet.
function validateCheckIds(regions) {
    const usedBy = new Map(); // id -> region names using it
    const blank = [];

    regions.forEach(region => {
        (region.item_checks || []).forEach((check, index) => {
            const id = check && check.id;
            if (typeof id !== "string" || id === "") {
                blank.push(`${region.region_name} -> item_checks[${index}]`);
                return;
            }
            if (!usedBy.has(id)) usedBy.set(id, []);
            usedBy.get(id).push(region.region_name);
        });
    });

    if (blank.length) {
        console.warn(
            `locationTracker: ${blank.length} check(s) have no id. An id is what check_groups links ` +
            `on, so these cannot be grouped — and they all share one blank key, which counts every ` +
            `one of them as the same location in the progress box.`
        );
        blank.forEach(where => console.warn(`  ${where}`));
    }

    const duplicated = [...usedBy].filter(([, where]) => where.length > 1);
    if (!duplicated.length) return;

    console.warn(
        `locationTracker: ${duplicated.length} check id(s) are used more than once. Each set ticks ` +
        `off together and counts as a single location, exactly as a declared check_group would.`
    );
    duplicated.forEach(([id, where]) => console.warn(`  "${id}" — used by: ${where.join(", ")}`));
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
        const seen = new Set();

        regions.forEach(regionData => {
            const name = regionData.region_name;

            if (!name) {
                const count = Array.isArray(regionData.item_checks) ? regionData.item_checks.length : 0;
                rejected.push(`a region file with no region_name (${count} check${count === 1 ? "" : "s"})`);
                return;
            }
            if (seen.has(name)) {
                rejected.push(`"${name}" appears more than once`);
                return;
            }
            // An empty list is normal — a region whose checks aren't written yet
            // renders as an empty accordion. A missing one is not: it throws, and
            // takes every region after it down with the regionsRendered handoff.
            // Tested before seen.add(), so a good file can still claim the name.
            if (!Array.isArray(regionData.item_checks)) {
                rejected.push(`"${name}" has no item_checks list`);
                return;
            }

            seen.add(name);

            // Per region on purpose. Anything unexpected in one region file should
            // cost that region and nothing else; the outer catch stays for whatever
            // goes wrong outside the loop.
            try {
                renderRegionDropdown(regionData, regionContainer, CHECK_GROUPS);
                rendered.push(regionData);
            } catch (error) {
                rejected.push(`"${name}" could not be rendered (${error.message})`);
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
        // After GameState.init (itemTracker.js runs first), so there is item state
        // to check the tokens against.
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

        // Run evaluation sweep using initial baseline numbers immediately after files finish rendering
        if (window.GameState) {
            evaluateAllRegions(window.GameState.items, window.GameState.totalHearts, window.GameState.totalBossMasks, window.GameState.totalRegularMasks);
        }
    }
});

// Deduping is the caller's job: it has the whole list, so it can report what it
// rejected. Doing it here would mean matching on the rendered header text, which
// is the thing dataset.regionName exists to avoid.
function renderRegionDropdown(regionData, container, CHECK_GROUPS) {
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

    const itemDivs = [];
    const itemChecksRegistry = [];

    regionData.item_checks.forEach(check => {
        const itemDiv = document.createElement("div");
        itemDiv.classList.add("region-check-item");
        itemDiv.dataset.checkId = check.id;
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

        itemChecksRegistry.push({
            element: itemDiv,
            logic: check.logic
        });

        // The same expression the sweep evaluates, so the tooltip can never
        // explain a check by different rules than the ones that colored it.
        checkRequirements.set(itemDiv, combinedLogic(regionData.logic, check.logic));

        // Updates layout counts when items click / toggle states
        itemDiv.addEventListener("click", () => {
            const isCompleted = itemDiv.classList.toggle("completed");
            const currentId = itemDiv.dataset.checkId;

            // One location, however many rows show it: every row sharing this id,
            // and every id in a check_group with it. Queried globally because a
            // region's rows may be sitting in the map overlay.
            const linkedIds = new Set([currentId]);
            CHECK_GROUPS.forEach(group => {
                if (group.includes(currentId)) group.forEach(id => linkedIds.add(id));
            });
            linkedIds.forEach(linkedId => {
                document.querySelectorAll(`div.region-check-item[data-check-id="${CSS.escape(linkedId)}"]`)
                    .forEach(el => el.classList.toggle("completed", isCompleted));
            });

            // Re-evaluate entire map visibility rules dynamically to properly update current and adjacent regions
            if (window.GameState) {
                evaluateAllRegions(window.GameState.items, window.GameState.totalHearts, window.GameState.totalBossMasks, window.GameState.totalRegularMasks);
            } else {
                window.dispatchEvent(new CustomEvent("trackerChecksUpdated"));
            }
        });

        contentDiv.appendChild(itemDiv);
        itemDivs.push(itemDiv);
    });

    headerBtn.addEventListener("click", () => {
        const isOpen = contentDiv.classList.toggle("open");
        headerBtn.classList.toggle("expanded", isOpen);
        headerBtn.setAttribute("aria-expanded", String(isOpen));
    });

    groupDiv.appendChild(headerBtn);
    groupDiv.appendChild(contentDiv);
    container.appendChild(groupDiv);

    // Track layout nodes alongside regional scoping logic rules
    activeRegionTrackers.push({
        regionName: regionData.region_name,
        entryLogic: regionData.logic,
        headerBtn: headerBtn,
        countEl: countSpan,
        groupEl: groupDiv,
        itemDivs: itemDivs,
        itemChecks: itemChecksRegistry
    });
}

function determineRegionLocationAccessibility(region) {
    const headerBtn = region.headerBtn;
    let hasRed = false;
    let hasGreen = false;
    let hasPurple = false;

    // "How many can I go and do, out of how many are left here." A non-randomized
    // check is neither, so it counts toward neither side — the same call
    // locationStatsTracker.js makes.
    let accessibleCount = 0;
    let remainingCount = 0;

    region.itemDivs.forEach(check => {
        if (!check.classList.contains("completed")) {
            if (check.classList.contains("vanilla")) {
                hasPurple = true;
                return;
            }
            remainingCount++;
            if (check.classList.contains("inaccessible")) {
                hasRed = true;
            }
            if (check.classList.contains("accessible")) {
                hasGreen = true;
                accessibleCount++;
            }
        }
    });

    let newStatus;
    if (hasRed && hasGreen) {
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

    // Only touch the DOM if the status actually moved. Rewriting the classes for
    // every region on every state change forces a restyle across every check, which
    // reads as the text flickering on each click.
    //
    // data-status is both the contract locationMap.js mirrors onto its markers and
    // the record of which class was last applied, so neither file has to keep its
    // own list of status names.
    const counts = `(${accessibleCount}/${remainingCount})`;
    const statusMoved = headerBtn.dataset.status !== newStatus;
    const countsMoved = headerBtn.dataset.counts !== counts;

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
