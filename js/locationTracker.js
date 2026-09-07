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
            let finalLogic = "";
            const regionLogic = region.entryLogic ? region.entryLogic.trim() : "";
            const checkLogic = checkObj.logic ? checkObj.logic.trim() : "";

            if (regionLogic !== "" && checkLogic !== "") {
                finalLogic = `(${regionLogic}) & (${checkLogic})`;
            } else if (regionLogic !== "") {
                finalLogic = regionLogic;
            } else {
                finalLogic = checkLogic;
            }

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

// Structural helper parsing logic lines dynamically without keeping state duplicates
function canAccess(logicString, inventory, hearts, bossMasks, totalMasks) {
    if (!logicString || logicString.trim() === "") return true;

    // Normalizing custom logic gate characters to raw native JavaScript statements
    let executableLogic = logicString
        .replace(/&/g, " && ")
        .replace(/\|/g, " || ");

    // Must accept the same characters as validateLogicTokens(). If it doesn't, a
    // token the validator names is left untouched here and reaches Function() as a
    // bare identifier, throwing on every sweep — that is, on every click.
    const tokenRegex = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;

    const specials = specialTokenValues(hearts, bossMasks, totalMasks);

    executableLogic = executableLogic.replace(tokenRegex, (match) => {
        if (Object.prototype.hasOwnProperty.call(specials, match)) return specials[match];

        const value = inventory[match];
        if (typeof value === "boolean") return value ? "true" : "false";
        if (typeof value === "number") return value; 
        return "false";
    });

    try {
        return Function(`"use strict"; return (${executableLogic});`)();
    } catch (error) {
        console.error(`Logic expression translation error: "${logicString}" translated into "${executableLogic}"`, error);
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
        if (!logic) return;
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
        const chain = progressions[token];
        const hint = chain && chain.length
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

    // Node by node rather than innerHTML: region_name is data, and everywhere else
    // a data string reaches the page it is set as text.
    const nameSpan = document.createElement("span");
    nameSpan.textContent = regionData.region_name;
    headerBtn.appendChild(nameSpan);
    headerBtn.appendChild(document.createTextNode(" "));

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
        itemDiv.textContent = check.name;

        itemChecksRegistry.push({
            element: itemDiv,
            logic: check.logic
        });

        // Updates layout counts when items click / toggle states
        itemDiv.addEventListener("click", () => {
            const isCompleted = itemDiv.classList.toggle("completed");
            const currentId = itemDiv.dataset.checkId;

            CHECK_GROUPS.forEach(group => {
                if (group.includes(currentId)) {
                    group.forEach(linkedId => {
                        const matchingElements = document.querySelectorAll(`div.region-check-item[data-check-id="${linkedId}"]`);
                        matchingElements.forEach(el => {
                            if (isCompleted) {
                                el.classList.add("completed");
                            } else {
                                el.classList.remove("completed");
                            }
                        });
                    });
                }
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

    region.itemDivs.forEach(check => {
        if (!check.classList.contains("completed")) {
            if (check.classList.contains("inaccessible")) {
                hasRed = true;
            }
            if (check.classList.contains("accessible")) {
                hasGreen = true;
            }
            if (check.classList.contains("vanilla")) {
                hasPurple = true;
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
    if (headerBtn.dataset.status !== newStatus) {
        if (headerBtn.dataset.status) headerBtn.classList.remove(headerBtn.dataset.status);
        headerBtn.dataset.status = newStatus;
        headerBtn.classList.add(newStatus);

        // Announced rather than watched for: the region whose marker was just
        // clicked has been moved out into the overlay, where a watcher on the
        // container could not see it, and its marker would hold a stale color.
        window.dispatchEvent(new CustomEvent("regionStatusChanged", {
            detail: { regionName: region.regionName, status: newStatus }
        }));
    }
}
