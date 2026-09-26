// dataLoader.js
// The single place anything reads out of data/, loaded ahead of every script but
// launch.js.
// Nothing else may fetch: let each file load what it needs and the same files get
// pulled repeatedly, right inside the window where the panel sizing is trying to
// measure a settled layout.
//
// Everything lands in window.TrackerData once and is announced with a single
// "trackerDataReady". That event is held until DOMContentLoaded has also fired,
// so a consumer woken by it can touch the DOM without a second guard.
//
// Use TrackerData.onReady(fn) rather than the event directly — it covers the case
// where the data arrived before your file registered a listener.

window.TrackerData = {
    config: null,
    items: null,
    manifest: null,
    settings: null,
    regions: [],   // region JSON objects, in manifest.json order
    failedRegions: [],  // manifest names that could not be read, if any
    failedLogicFiles: [],  // locationFlags.json or logicHelpers.json, if either could not be used
    locationFlags: [],  // locationFlags.json's entries; empty on the settings page
    logicHelpers: [],   // logicHelpers.json's entries; empty on the settings page
    version: null,  // "x.y.z" from version.json; loaded on its own, so not covered by ready
    ready: false,

    // Race-free way to wait for the data: runs immediately if it's already here,
    // otherwise waits for the event.
    onReady(callback) {
        if (this.ready) {
            callback(this);
        } else {
            window.addEventListener("trackerDataReady", () => callback(window.TrackerData), { once: true });
        }
    }
};

(function () {
    // The settings page marks this script with data-skip-regions: it needs the
    // settings, not the region files. currentScript is only set while this runs.
    const skipsRegions = Boolean(document.currentScript && document.currentScript.hasAttribute("data-skip-regions"));

    const isObject = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);

    // The manifest file each region came from. A region is otherwise known only by
    // its region_name, and when the name is the problem that can't lead back to the
    // file. Kept in a map rather than on the region, so no consumer mistakes it for
    // a field the file can set.
    const regionFiles = new WeakMap();
    window.TrackerData.regionFile = region => regionFiles.get(region) || null;

    // Names more than one loaded region uses, filled in by flattenRegions().
    let sharedRegionNames = new Set();

    // How a warning names a region: its name, with its file when another region
    // shares the name, or just its file when the name is unusable.
    function regionLabel(region) {
        const name = region.region_name;
        const file = regionFiles.get(region) || "a region file";
        if (typeof name !== "string" || name === "") return file;
        return sharedRegionNames.has(name) ? `${name} (${file})` : name;
    }

    // Items.json is read by the grids, the game state and every region's tooltip
    // text, and an entry without an id throws in each of them. It is dropped here
    // instead, and a grid slot naming it draws empty (itemGrids.js, validate()).
    function readItems(items) {
        if (!Array.isArray(items)) throw new Error("data/Items.json needs to be a list of items");
        const bad = [];
        const kept = items.filter((item, index) => {
            if (isObject(item) && typeof item.id === "string" && item.id !== "") return true;
            bad.push(index);
            return false;
        });
        if (bad.length) {
            console.warn(`dataLoader: Items.json entries ${bad.map(index => `[${index}]`).join(", ")} have no "id", and are dropped.`);
        }
        return kept;
    }

    // Every failure names the path: the browser's own messages for a failed fetch
    // or a parse error never do, and they end up in the load-error report.
    function fetchJson(path) {
        return fetch(path)
            .catch(error => {
                throw new Error(`${path} could not be fetched (${error.message})`);
            })
            .then(res => {
                if (!res.ok) throw new Error(`${path} responded ${res.status}`);
                return res.json().catch(error => {
                    throw new Error(`${path} is not valid JSON (${error.message})`);
                });
            });
    }

    // config.json only lists the files that make up the config, relative to data/.
    // Their keys merge into one object, so every consumer reads the keys it always
    // has. Any unreadable file fails the whole load, as config.json itself would.
    async function loadConfig() {
        const index = await fetchJson("data/config.json");
        if (!index || !Array.isArray(index.files) || !index.files.every(name => typeof name === "string")) {
            throw new Error('data/config.json needs a "files" list of file names');
        }

        const parts = await Promise.all(index.files.map(name => fetchJson(`data/${name}`)));
        parts.forEach((part, i) => {
            if (!isObject(part)) throw new Error(`data/${index.files[i]} needs to hold an object of config keys`);
        });
        const config = {};
        parts.forEach((part, i) => {
            Object.keys(part).forEach(key => {
                if (Object.prototype.hasOwnProperty.call(config, key)) {
                    console.warn(`dataLoader: "${key}" is in more than one config file (again in ${index.files[i]}), so the later one wins.`);
                }
                config[key] = part[key];
            });
        });
        return config;
    }

    // Three files read check_groups raw (the check click, the progress count and
    // a validator), and one bad group throws in all of them, taking the progress
    // box down. So a group is checked once here and dropped if it can't be used.
    // Whether its ids match real checks can only be asked once the regions have
    // rendered: locationTracker.js, validateCheckGroups().
    function readCheckGroups(config) {
        if (!Object.prototype.hasOwnProperty.call(config, "check_groups")) return;
        const groups = config.check_groups;
        if (!Array.isArray(groups)) {
            console.warn('dataLoader: config/checkGroups.json\'s "check_groups" is not a list, so no checks are linked.');
            config.check_groups = [];
            return;
        }

        const problems = [];
        config.check_groups = groups.filter((group, index) => {
            const where = `check_groups[${index}]`;
            if (!Array.isArray(group)) {
                problems.push(`${where} is not a list of check ids`);
            } else if (!group.every(id => typeof id === "string" && id.trim() !== "")) {
                problems.push(`${where} has an entry that is not a check id`);
            } else if (group.length < 2) {
                problems.push(`${where} links fewer than two checks`);
            } else {
                return true;
            }
            return false;
        });

        if (!problems.length) return;
        console.warn(`dataLoader: ${problems.length} group(s) in config/checkGroups.json are dropped, so their checks are not linked.`);
        problems.forEach(line => console.warn(`  ${line}`));
    }

    // ---------- Sub-regions ----------

    // A region file may nest its checks in sub-regions, so checks sharing a
    // requirement write it once. Flattening to one item_checks list here is what
    // lets every other file go on reading the list it has always read.
    //
    // `logic` accumulates the whole way down: you pass through every area to reach
    // a check. `vanilla_when` and `vanilla_item` instead come from the nearest node
    // that sets one and replace rather than merge, because whether a check is
    // randomized is a property of that one check, not something it collects on the
    // way in. See ARCHITECTURE.md, *Sub-regions*.
    function has(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    }

    function resolveRegion(region) {
        const problems = [];
        const checks = [];

        function addCheck(check, path, carried) {
            const where = [regionLabel(region), ...path, check.id].join(" -> ");
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
            // rather than becoming a second spelling every validator has to know. An
            // item it only inherited goes with it; one it names itself is a mistake.
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
            const where = [regionLabel(region), ...path].join(" -> ");
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
                    if (!check || typeof check !== "object" || Array.isArray(check)) {
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
                if (!sub || typeof sub !== "object" || Array.isArray(sub)) {
                    problems.push(`${where}: subregions[${index}] is not a sub-region`);
                    return;
                }
                // The name is never rendered. It earns its place by naming the node in
                // every warning here, which is the only way to find the one group that
                // put a wrong value on thirty checks.
                const named = typeof sub.name === "string" && sub.name.trim() !== "";
                if (!named) problems.push(`${where}: subregions[${index}] has no name`);
                const childPath = path.concat(named ? sub.name.trim() : `subregions[${index}]`);

                const holdsChecks = Array.isArray(sub.item_checks) && sub.item_checks.length;
                const holdsGroups = Array.isArray(sub.subregions) && sub.subregions.length;
                if (!holdsChecks && !holdsGroups) {
                    problems.push(`${[regionLabel(region), ...childPath].join(" -> ")}: has no checks and no sub-regions, so it does nothing`);
                }

                walk(sub, childPath, carried, false);
            });
        }

        walk(region, [], { logic: [], when: undefined, whenFrom: null, item: undefined, itemFrom: null }, true);
        return { checks, problems };
    }

    // Flat regions go through the same walk as nested ones, so a region's own
    // vanilla_when and vanilla_item, and the false and null escape hatches, mean
    // the same in every file.
    //
    // A region whose tree can't be walked keeps whatever checks it listed rather
    // than costing the whole tracker, the way an unreadable region file does.
    function flattenRegions(regions) {
        const problems = [];
        const seenNames = new Set();
        sharedRegionNames = new Set();
        regions.forEach(({ region_name: name }) => {
            if (typeof name !== "string" || name === "") return;
            if (seenNames.has(name)) sharedRegionNames.add(name);
            seenNames.add(name);
        });

        regions.forEach(region => {
            // With neither list there is nothing to walk. locationTracker.js
            // rejects a region with no item_checks, and names it there.
            if (!Array.isArray(region.item_checks) && !Array.isArray(region.subregions)) {
                if (has(region, "subregions")) {
                    problems.push(`${regionLabel(region)}: subregions is not a list, so its checks are dropped`);
                }
                return;
            }
            try {
                const resolved = resolveRegion(region);
                region.item_checks = resolved.checks;
                problems.push(...resolved.problems);
            } catch (error) {
                console.error(`dataLoader: could not read the checks of "${regionLabel(region)}"`, error);
            }
        });

        if (!problems.length) return;
        console.warn(`dataLoader: ${problems.length} problem(s) in the region files' checks.`);
        problems.forEach(line => console.warn(`  ${line}`));
    }


    const domReady = new Promise(resolve => {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", resolve, { once: true });
        } else {
            resolve();
        }
    });

    const dataReady = (async () => {
        // Not core files: without one every flag or helper reads false and the
        // tracker still runs, so each fails the way one region file does rather
        // than the way the config files do: named in a banner, the rest still up.
        // Started now and awaited last, since nothing here needs them and they need
        // nothing here.
        // Resolves to null for a file that failed, so the failures can be listed in
        // a fixed order rather than the order the fetches happened to settle in.
        const loadLogicFile = (path, key, what) => skipsRegions ? [] : fetchJson(path)
            .then(data => {
                if (data && Array.isArray(data[key])) return data[key];
                throw new Error(`${path} has no "${key}" list`);
            })
            .catch(error => {
                console.error(`dataLoader: failed to load ${path}, so every ${what} reads false`, error);
                return null;
            });
        const logicFiles = ["data/locationFlags.json", "data/logicHelpers.json"];
        const flagsReady = loadLogicFile(logicFiles[0], "flags", "location flag");
        const helpersReady = loadLogicFile(logicFiles[1], "helpers", "logic helper");

        const [config, rawItems, manifest, settings] = await Promise.all([
            loadConfig(),
            fetchJson("data/Items.json"),
            fetchJson("data/manifest.json"),
            fetchJson("data/settings.json")
        ]);
        if (!Array.isArray(manifest)) throw new Error("data/manifest.json needs to be a list of region file names");
        if (!isObject(settings) || !Array.isArray(settings.sections)) {
            throw new Error('data/settings.json needs a "sections" list');
        }
        const items = readItems(rawItems);
        readCheckGroups(config);

        // Manifest order is the display order, and Promise.all preserves it
        // whichever fetch settles first — so don't sort here.
        //
        // One unreadable region file shouldn't take the tracker down, so it
        // resolves to null and is dropped. Named rather than counted: a dropped
        // region just has no marker, which is a quiet way to lose one.
        const failedRegions = [];
        const loaded = skipsRegions ? [] : await Promise.all(
            manifest.map(fileName =>
                fetchJson(`data/${fileName}`)
                    // Valid JSON can still be no region at all (a file holding
                    // null), and it has to be named like one that can't be read.
                    .then(region => {
                        if (!isObject(region)) throw new Error(`${fileName} does not hold a region object`);
                        regionFiles.set(region, fileName);
                        // Trimmed before anything reads it, or "Name " and "Name" pass
                        // as two regions and render as one name twice. A blank name is
                        // left empty for locationTracker.js to reject.
                        const name = region.region_name;
                        if (typeof name === "string" && name !== name.trim()) {
                            region.region_name = name.trim();
                            if (region.region_name) {
                                console.warn(`dataLoader: ${fileName}'s region_name has spaces around it, and is read as "${region.region_name}".`);
                            }
                        }
                        return region;
                    })
                    .catch(err => {
                        console.error(`dataLoader: failed to load region file ${fileName}`, err);
                        failedRegions.push(fileName);
                        return null;
                    })
            )
        );

        const regions = loaded.filter(region => region !== null);
        flattenRegions(regions);

        const logicLists = await Promise.all([flagsReady, helpersReady]);
        const failedLogicFiles = logicFiles.filter((path, i) => logicLists[i] === null);
        const [locationFlags, logicHelpers] = logicLists.map(list => list || []);

        return {
            config,
            items,
            manifest,
            settings,
            regions,
            failedRegions,
            failedLogicFiles,
            locationFlags,
            logicHelpers
        };
    })();

    // Kept apart from dataReady: a report that the core files failed to load is
    // exactly the one that needs the version, so it can't depend on them.
    const versionReady = fetchJson("data/version.json")
        .then(data => {
            const version = data && data.version;
            if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
                throw new Error('data/version.json needs a "version" of the form x.y.z');
            }
            return version;
        })
        .catch(error => {
            console.warn("dataLoader: no version to show, so the footer stays empty.", error);
            return null;
        });

    // ---------- Reporting a failure to the person looking at the page ----------

    // The console is the wrong audience on a deployed page, where a missing file
    // otherwise just reads as "the tracker is broken". Both of these are meant to
    // be copied into a bug report, which is why they opt out of the page-wide
    // user-select: none.
    function block(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    function showLoadFailure(error, version) {
        const main = document.querySelector("main");
        if (!main) return;

        // Nothing else was going to draw in here anyway.
        main.innerHTML = "";

        const box = document.createElement("div");
        box.id = "tracker-load-error";
        box.appendChild(block("h2", null, "The tracker could not load its data"));
        box.appendChild(block("p", null,
            "One of the files the tracker needs before it can draw anything could not " +
            "be read, so nothing on this page can be shown. " +
            "This normally means a file under data/ is absent, misnamed, not valid " +
            "JSON, not shaped the way the tracker expects, or was not deployed."));
        box.appendChild(block("p", "tracker-error-detail", [
            (error && error.message) || String(error),
            `version: ${version ? `v${version}` : "unknown"}`,
            `page: ${window.location.href}`
        ].join("\n")));
        box.appendChild(block("p", null, "Copy the lines above into a bug report."));

        main.appendChild(box);
    }

    function showRegionFailures(fileNames) {
        const main = document.querySelector("main");
        if (!main) return;

        const one = fileNames.length === 1;
        const note = document.createElement("div");
        note.id = "tracker-region-warning";
        note.appendChild(block("span", null,
            `${fileNames.length} region file${one ? "" : "s"} could not be loaded, so ` +
            `${one ? "that region is" : "those regions are"} missing from the list and ` +
            `the map. Everything else still works. `));
        note.appendChild(block("span", "tracker-error-detail", fileNames.join(", ")));

        main.insertBefore(note, main.firstChild);
    }

    // Flags and helpers are named in logic rather than drawn, so without this the
    // only sign of a missing file is checks that never turn green.
    function showLogicFailures(paths) {
        const main = document.querySelector("main");
        if (!main) return;

        const note = document.createElement("div");
        note.id = "tracker-logic-warning";
        note.appendChild(block("span", null,
            `${paths.length === 1 ? "A logic file" : `${paths.length} logic files`} could not be loaded, so every ` +
            `check that depends on ${paths.length === 1 ? "it" : "them"} reads unreachable. Everything ` +
            `else still works. `));
        note.appendChild(block("span", "tracker-error-detail", paths.map(path => path.replace(/^data\//, "")).join(", ")));

        main.insertBefore(note, main.firstChild);
    }

    // ---------- Init ----------

    // <main> starts hidden (style.css, *Loading*). Every consumer draws inside its
    // trackerDataReady listener, so once the event has been dispatched there is
    // something to show.
    function revealMain() {
        const main = document.querySelector("main");
        if (main) main.classList.remove("awaiting-data");
    }

    Promise.all([versionReady, domReady]).then(([version]) => {
        window.TrackerData.version = version;
        const footer = document.getElementById("app-version");
        if (footer && version) footer.textContent = `v${version}`;
    });

    Promise.all([dataReady, domReady])
        .then(([data]) => {
            Object.assign(window.TrackerData, data, { ready: true });
            if (data.failedRegions.length) showRegionFailures(data.failedRegions);
            if (data.failedLogicFiles.length) showLogicFailures(data.failedLogicFiles);
            window.dispatchEvent(new CustomEvent("trackerDataReady", { detail: window.TrackerData }));
            revealMain();
        })
        .catch(error => {
            // the config files, Items.json, manifest.json or settings.json failed — nothing
            // downstream can render meaningfully, so say so loudly rather than let
            // every file fail quietly on its own.
            console.error("dataLoader: could not load tracker data, nothing will render", error);
            // Waits for domReady rather than going straight in: a fetch that rejects
            // fast gets here before DOMContentLoaded, and there is no <main> to write
            // into yet. The version is waited for too, since it is part of the report.
            Promise.all([versionReady, domReady]).then(([version]) => {
                revealMain();
                showLoadFailure(error, version);
            });
        });
})();
