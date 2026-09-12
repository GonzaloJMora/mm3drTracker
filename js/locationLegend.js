// locationLegend.js
// The legend box only: what each status color means. Entries and their order
// come from config.json's "legend"; the colors themselves are CSS, keyed off the
// same status class the region headers and map markers use.
//
// It builds its own box and hands it over on "locationLegendReady"; where that
// box sits is locationPanelLayout.js's problem.

(function () {
    let legendBoxEl = null;

    // Asked of CSS rather than checked against a list, so style.css stays the one
    // place status names live. An unpaired status would otherwise draw a blank
    // swatch beside a label that looks real. Stylesheets load before any script
    // runs, so the answer is already there.
    function isKnownStatus(status) {
        if (typeof status !== "string" || !/^[A-Za-z][\w-]*$/.test(status)) return false;

        const probe = document.createElement("span");
        probe.className = `location-legend-swatch ${status}`;
        probe.hidden = true;
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).getPropertyValue("--status-color").trim();
        probe.remove();
        return color !== "";
    }

    function createLegendBox(entries) {
        const box = document.createElement("div");
        box.id = "location-legend-box";

        const heading = document.createElement("h3");
        heading.textContent = "Legend";
        box.appendChild(heading);

        const list = document.createElement("div");
        list.id = "location-legend-content";

        entries.forEach(entry => {
            const row = document.createElement("div");
            row.className = "location-legend-row";

            // The status class is the whole contract: CSS colors the swatch from
            // the same custom property the markers and headers read.
            const swatch = document.createElement("span");
            swatch.className = `location-legend-swatch ${entry.status}`;
            row.appendChild(swatch);

            const label = document.createElement("span");
            label.className = "location-legend-label";
            label.textContent = entry.label;
            row.appendChild(label);

            list.appendChild(row);
        });

        box.appendChild(list);
        legendBoxEl = box;
    }

    window.TrackerData.onReady(({ config }) => {
        const entries = Array.isArray(config.legend) ? config.legend : [];

        // A tracker with no legend is usable; one that dies here is not.
        if (!entries.length) {
            console.warn(
                'locationLegend: config.json has no "legend" entries, so the ' +
                "legend box is not drawn."
            );
            return;
        }

        const usable = [];
        const rejected = [];
        entries.forEach((entry, index) => {
            if (!entry || !entry.status || !entry.label) {
                rejected.push(`legend[${index}] needs both a "status" and a "label"`);
            } else if (!isKnownStatus(entry.status)) {
                rejected.push(`legend[${index}] "${entry.status}" is not a status css/style.css pairs a color with`);
            } else {
                usable.push(entry);
            }
        });

        if (rejected.length) {
            console.warn(
                `locationLegend: ${rejected.length} legend ` +
                `${rejected.length === 1 ? "entry is" : "entries are"} not drawn.`
            );
            rejected.forEach(line => console.warn(`  ${line}`));
        }
        if (!usable.length) return;

        createLegendBox(usable);

        window.dispatchEvent(new CustomEvent("locationLegendReady", {
            detail: { box: legendBoxEl }
        }));
    });
})();
