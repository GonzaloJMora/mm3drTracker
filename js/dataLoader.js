// dataLoader.js
// The single place anything reads out of data/, loaded before every other script.
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
    regions: [],   // region JSON objects, in manifest.json order
    failedRegions: [],  // manifest names that could not be read, if any
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
    function fetchJson(path) {
        return fetch(path).then(res => {
            if (!res.ok) throw new Error(`${path} responded ${res.status}`);
            return res.json();
        });
    }

    const domReady = new Promise(resolve => {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", resolve, { once: true });
        } else {
            resolve();
        }
    });

    const dataReady = (async () => {
        const [config, items, manifest] = await Promise.all([
            fetchJson("data/config.json"),
            fetchJson("data/Items.json"),
            fetchJson("data/manifest.json")
        ]);

        // Manifest order is the display order, and Promise.all preserves it
        // whichever fetch settles first — so don't sort here.
        //
        // One unreadable region file shouldn't take the tracker down, so it
        // resolves to null and is dropped. Named rather than counted: a dropped
        // region just has no marker, which is a quiet way to lose one.
        const failedRegions = [];
        const loaded = await Promise.all(
            manifest.map(fileName =>
                fetchJson(`data/${fileName}`).catch(err => {
                    console.error(`dataLoader: failed to load region file ${fileName}`, err);
                    failedRegions.push(fileName);
                    return null;
                })
            )
        );

        return {
            config,
            items,
            manifest,
            regions: loaded.filter(region => region !== null),
            failedRegions
        };
    })();

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

    function showLoadFailure(error) {
        const main = document.querySelector("main");
        if (!main) return;

        // Nothing else was going to draw in here anyway.
        main.innerHTML = "";

        const box = document.createElement("div");
        box.id = "tracker-load-error";
        box.appendChild(block("h2", null, "The tracker could not load its data"));
        box.appendChild(block("p", null,
            "One of the files the tracker needs before it can draw anything could not " +
            "be read, so the item grids, the locations and the map are all missing. " +
            "This normally means a file under data/ is absent, misnamed, or was not " +
            "deployed."));
        box.appendChild(block("p", "tracker-error-detail", [
            (error && error.message) || String(error),
            `page: ${window.location.href}`
        ].join("\n")));
        box.appendChild(block("p", null, "Copy the two lines above into a bug report."));

        main.appendChild(box);
    }

    function showRegionFailures(fileNames) {
        const main = document.querySelector("main");
        if (!main) return;

        const one = fileNames.length === 1;
        const note = document.createElement("div");
        note.id = "tracker-region-warning";
        note.appendChild(block("span", null,
            `${fileNames.length} region file${one ? "" : "s"} could not be read, so ` +
            `${one ? "that region is" : "those regions are"} missing from the list and ` +
            `the map. Everything else still works. `));
        note.appendChild(block("span", "tracker-error-detail", fileNames.join(", ")));

        main.insertBefore(note, main.firstChild);
    }

    // ---------- Init ----------

    Promise.all([dataReady, domReady])
        .then(([data]) => {
            Object.assign(window.TrackerData, data, { ready: true });
            if (data.failedRegions.length) showRegionFailures(data.failedRegions);
            window.dispatchEvent(new CustomEvent("trackerDataReady", { detail: window.TrackerData }));
        })
        .catch(error => {
            // config.json, Items.json or manifest.json failed — nothing downstream
            // can render meaningfully, so say so loudly rather than failing quietly
            // in four different places.
            console.error("dataLoader: could not load tracker data, nothing will render", error);
            // domReady rather than straight in: a fetch that rejects fast gets here
            // before DOMContentLoaded, and there is no <main> to write into yet.
            domReady.then(() => showLoadFailure(error));
        });
})();
