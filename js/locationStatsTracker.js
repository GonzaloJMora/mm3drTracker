// locationStatsTracker.js
// The location-progress box only: counting checked / accessible / remaining,
// deduped via config.json's check_groups, and rendering them. It builds its own
// box and hands it over on "locationStatsBoxReady"; where that box sits is
// locationPanelLayout.js's problem.

(function () {
    let checkGroupsCache = [];
    let canonicalKeyMap = null;
    let statsBoxEl = null;
    let statsContentEl = null;
    let updateScheduled = false;

    // Maps an individual check id -> canonical group key.
    // Ids not in any check_group map to themselves (each is its own group).
    function buildCanonicalKeyMap(checkGroups) {
        const idToKey = new Map();
        checkGroups.forEach((group, idx) => {
            const key = `group_${idx}`;
            group.forEach(id => idToKey.set(id, key));
        });
        return idToKey;
    }

    // ---------- Stat computation ----------

    function computeStats() {
        // Built once - check_groups comes from config.json and never changes.
        if (!canonicalKeyMap) canonicalKeyMap = buildCanonicalKeyMap(checkGroupsCache);
        const idToKey = canonicalKeyMap;
        // Global, not scoped to #region-dropdown-container — a region's checks
        // may be sitting in the map overlay, and still have to count.
        const items = document.querySelectorAll(".region-check-item");

        // canonicalKey -> { completed: bool, accessible: bool }
        const canonical = new Map();
        // Read at count time rather than kept from an event, so it can't be stale
        // whichever order the listeners run in.
        const skipVanilla = Boolean(window.TrackerView && window.TrackerView.hidesNonRandomized());

        items.forEach(item => {
            if (skipVanilla && item.classList.contains("vanilla")) return;
            const checkId = item.dataset.checkId;
            const key = idToKey.get(checkId) || checkId;

            const completed = item.classList.contains("completed");
            const accessible = item.classList.contains("accessible");

            if (!canonical.has(key)) {
                canonical.set(key, { completed: false, accessible: false });
            }
            const entry = canonical.get(key);
            entry.completed = entry.completed || completed;
            entry.accessible = entry.accessible || accessible;
        });

        let checked = 0;
        let accessible = 0;
        canonical.forEach(entry => {
            if (entry.completed) {
                checked++;
            } else if (entry.accessible) {
                accessible++;
            }
        });

        const total = canonical.size;
        const remaining = total - checked;

        return { checked, accessible, remaining, total };
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
            <div class="location-stats-row">
                <span class="location-stats-label">Checked</span>
                <span class="location-stats-value">${stats.checked}</span>
            </div>
            <div class="location-stats-row">
                <span class="location-stats-label">Accessible</span>
                <span class="location-stats-value">${stats.accessible}</span>
            </div>
            <div class="location-stats-row">
                <span class="location-stats-label">Remaining</span>
                <span class="location-stats-value">${stats.remaining}</span>
            </div>
        `;
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

        const heading = document.createElement("h3");
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

    window.TrackerData.onReady(({ config }) => {
        checkGroupsCache = config.check_groups || [];

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
