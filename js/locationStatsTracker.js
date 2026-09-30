// locationStatsTracker.js
// The location progress numbers only: counting checked / accessible / remaining, one
// per location as ItemCheckState defines it, and rendering them. It builds its own
// box and hands it over on "locationStatsBoxReady"; where that box sits is
// locationPanelLayout.js's problem.

(function () {
    let statsBoxEl = null;
    let statsContentEl = null;
    let updateScheduled = false;

    // ---------- Stat computation ----------

    // Read at count time rather than kept from an event, so the hide choice can't be
    // stale whichever order the listeners run in.
    function computeStats() {
        return window.ItemCheckState.overall(Boolean(window.TrackerView && window.TrackerView.hidesNonRandomized()));
    }

    // ---------- Rendering ----------

    let lastRenderedStats = null;

    function renderStats(stats) {
        if (!statsContentEl) return;

        // Skip if nothing changed. Recreating these text nodes on every recount —
        // every click anywhere in the item tracker — forces a restyle that shows
        // up as a flicker elsewhere on the page, not just here.
        if (
            lastRenderedStats &&
            lastRenderedStats.checked === stats.checked &&
            lastRenderedStats.accessible === stats.accessible &&
            lastRenderedStats.remaining === stats.remaining
        ) {
            return;
        }
        lastRenderedStats = stats;

        statsContentEl.innerHTML = `
            <span class="location-stats-item"><span class="location-stats-value">${stats.accessible}</span> <span class="location-stats-label">accessible</span></span>
            <span class="location-stats-item"><span class="location-stats-value">${stats.checked}</span> <span class="location-stats-label">checked</span></span>
            <span class="location-stats-item"><span class="location-stats-value">${stats.remaining}</span> <span class="location-stats-label">remaining</span></span>
        `;

        // The same numbers as one line, which the phone layout's frozen bar shows in
        // place of the box.
        const line = document.getElementById("location-status-line");
        if (line) line.textContent = `${stats.accessible} accessible | ${stats.checked} checked | ${stats.remaining} remaining`;
    }

    // rAF while the window is drawing; the timeout is what makes it happen at all
    // when it isn't. A tracker sitting behind a game window is the normal case
    // here, and rAF callbacks are frozen for a window that isn't being painted —
    // without the timeout these numbers silently stop moving.
    function scheduleUpdate() {
        if (updateScheduled) return;
        updateScheduled = true;
        let ran = false;
        const run = () => {
            if (ran) return;
            ran = true;
            updateScheduled = false;
            renderStats(computeStats());
        };
        requestAnimationFrame(run);
        setTimeout(run, 250);
    }

    // ---------- Box creation ----------

    function createStatsBox() {
        const box = document.createElement("div");
        box.id = "location-stats-box";

        // For screen readers; on screen the numbers' own labels say enough.
        const heading = document.createElement("h3");
        heading.className = "visually-hidden";
        heading.textContent = "Location Progress";
        box.appendChild(heading);

        const content = document.createElement("div");
        content.id = "location-stats-content";
        box.appendChild(content);

        statsBoxEl = box;
        statsContentEl = content;
    }

    // ---------- Listening (stats content only, no layout/positioning) ----------

    // Not a MutationObserver — one wide enough to catch every check has to watch
    // document.body, so any unrelated DOM write triggers a full recount. The F1
    // panel redrawing on each item click would be enough. locationTracker.js owns
    // the check states and announces them instead.
    //
    // Moving a region in or out of the overlay deliberately does not recount: the
    // same checks are still on the page.
    function startListening() {
        window.addEventListener("trackerChecksUpdated", scheduleUpdate);
    }

    // ---------- Init ----------

    // locationTracker.js loads first, so its first sweep has filled ItemCheckState
    // by the time this counts.
    window.TrackerData.onReady(() => {
        createStatsBox();
        renderStats(computeStats());
        startListening();

        // Where the box sits is locationPanelLayout.js's business, so the element
        // is handed off on an event instead of placed here.
        window.dispatchEvent(new CustomEvent("locationStatsBoxReady", {
            detail: { box: statsBoxEl }
        }));
    });
})();
