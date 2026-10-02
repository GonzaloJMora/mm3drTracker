// dataLoader.js
// The single place anything reads out of data/, loaded ahead of every script but
// trackerLaunch.js.
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
    saveLayout: null,  // saveLayout.json, what a save code holds; null if it could not be used
    offline: null,  // offline.json, the offline copy's file list and off switch; null if it could not be read
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
    // file. Kept by DataModel rather than on the region, so no consumer mistakes it
    // for a field the file can set.
    let regionFileOf = () => null;
    window.TrackerData.regionFile = region => regionFileOf(region);

    // Every failure names the path: the browser's own messages for a failed fetch
    // or a parse error never do, and they end up in the load-error report.
    //
    // Every file is asked of the site rather than taken from the browser's cache,
    // which can hold one for minutes after a release: the settings page loads some
    // files and not others, so the tracker could get old ones beside new ones.
    function fetchJson(path) {
        return fetch(path, { cache: "no-cache" })
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
    // Their keys merge into one object (DataModel.mergeConfig), so every consumer
    // reads the keys it always has. Any unreadable file fails the whole load, as
    // config.json itself would.
    async function loadConfig() {
        const index = await fetchJson("data/config.json");
        if (!index || !Array.isArray(index.files) || !index.files.every(name => typeof name === "string")) {
            throw new Error('data/config.json needs a "files" list of file names');
        }

        const parts = await Promise.all(index.files.map(name => fetchJson(`data/${name}`)));
        parts.forEach((part, i) => {
            if (!isObject(part)) throw new Error(`data/${index.files[i]} needs to hold an object of config keys`);
        });
        return parts.map((data, i) => ({ name: index.files[i], data }));
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

        // Not a core file either: without it the tracker works and only saving is off.
        const saveLayoutReady = fetchJson("data/saveLayout.json")
            .then(layout => {
                if (isObject(layout) && Array.isArray(layout.fields)) return layout;
                throw new Error('data/saveLayout.json has no "fields" list');
            })
            .catch(error => {
                console.error("dataLoader: failed to load data/saveLayout.json, so saving and loading are off", error);
                return null;
            });

        // Only offline.js reads it, and without it the offline copy is left as it is.
        const offlineReady = fetchJson("data/offline.json")
            .then(offline => (isObject(offline) ? offline : null))
            .catch(error => {
                console.warn("dataLoader: failed to load data/offline.json, so the offline copy is left as it is", error);
                return null;
            });

        const [configParts, rawItems, manifest, settings] = await Promise.all([
            loadConfig(),
            fetchJson("data/Items.json"),
            fetchJson("data/manifest.json"),
            fetchJson("data/settings.json")
        ]);
        if (!Array.isArray(manifest)) throw new Error("data/manifest.json needs to be a list of region file names");
        if (!isObject(settings) || !Array.isArray(settings.sections)) {
            throw new Error('data/settings.json needs a "sections" list');
        }
        if (!Array.isArray(rawItems)) throw new Error("data/Items.json needs to be a list of items");

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
                        return { file: fileName, data: region };
                    })
                    .catch(err => {
                        console.error(`dataLoader: failed to load region file ${fileName}`, err);
                        failedRegions.push(fileName);
                        return null;
                    })
            )
        );

        const logicLists = await Promise.all([flagsReady, helpersReady]);
        const failedLogicFiles = logicFiles.filter((path, i) => logicLists[i] === null);
        const [locationFlags, logicHelpers] = logicLists.map(list => list || []);
        const saveLayout = await saveLayoutReady;
        const offline = await offlineReady;

        // Merged, read and flattened by the same code the tests use, then held to
        // every rule in dataChecks.js. Its findings are the page's warnings about the
        // data; a check that throws is reported and never stops the load.
        const read = window.DataModel.assemble({
            configParts,
            items: rawItems,
            regions: loaded.filter(region => region !== null),
            flags: locationFlags,
            helpers: logicHelpers,
            settings
        });
        regionFileOf = read.fileOf;
        read.treeErrors.forEach(({ region, error }) => console.error(`dataLoader: could not read the checks of "${region}"`, error));
        try {
            const checks = window.DataChecks;
            const context = checks.context(read.data, { fileOf: read.fileOf, regions: !skipsRegions, failedLogicFiles });
            checks.print(read.findings.concat(checks.run(context)), (...args) => console.warn(...args), context);
        } catch (error) {
            console.error("dataLoader: could not check the data", error);
        }

        return {
            config: read.data.config,
            items: read.data.items,
            manifest,
            settings,
            regions: read.data.regions,
            failedRegions,
            failedLogicFiles,
            locationFlags,
            logicHelpers,
            saveLayout,
            offline
        };
    })();

    // The layout an older save was written with, kept under data/saveLayouts/ once
    // the format moves on. Fetched only when such a save is loaded; null if there is
    // none. See ARCHITECTURE.md, *Saving*.
    window.TrackerData.saveLayoutFor = format => {
        const current = window.TrackerData.saveLayout;
        if (current && current.format === format) return Promise.resolve(current);
        if (!Number.isInteger(format) || format < 1) return Promise.resolve(null);
        return fetchJson(`data/saveLayouts/format${format}.json`).catch(error => {
            console.error(`dataLoader: no layout for save format ${format}`, error);
            return null;
        });
    };

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

    // Nothing else on the page would say why saving and loading don't work.
    function showSaveLayoutFailure() {
        const main = document.querySelector("main");
        if (!main) return;

        const note = document.createElement("div");
        note.id = "tracker-save-warning";
        note.appendChild(block("span", null,
            "The save layout could not be loaded, so saving and loading are off. Everything else " +
            "still works. "));
        note.appendChild(block("span", "tracker-error-detail", "saveLayout.json"));

        main.insertBefore(note, main.firstChild);
    }

    // ---------- Init ----------

    // <main> starts hidden (common.css, *Loading*). Every consumer draws inside its
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
            if (!data.saveLayout) showSaveLayoutFailure();
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
