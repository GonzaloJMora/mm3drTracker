// locationPanelLayout.js
// Positions the summary row (stats box + legend) and the map container, and keeps
// the desktop map sized to the item grid's height. Every piece arrives here via
// events — the tracking logic, the stats numbers, the legend and the map itself
// belong to other files.

(function () {
    // Read from css/style.css so JS and CSS can't disagree about where mobile
    // starts. The literal is a fallback for a stylesheet that failed to load.
    const MOBILE_BREAKPOINT = `(max-width: ${
        getComputedStyle(document.documentElement)
            .getPropertyValue("--mobile-breakpoint").trim() || "1499px"
    })`;

    let statsBoxEl = null;
    let legendBoxEl = null;
    let mapContainerEl = null;
    let summaryRowEl = null;
    let resizeObserver = null;

    // The stats box and the legend sit side by side, and the map sits under the
    // pair. Owning the row here keeps both of those files free of any knowledge
    // of the other.
    function ensureSummaryRow() {
        if (summaryRowEl) return summaryRowEl;
        summaryRowEl = document.createElement("div");
        summaryRowEl.id = "location-summary-row";
        if (resizeObserver) resizeObserver.observe(summaryRowEl);
        return summaryRowEl;
    }

    // Either box can arrive first, and a missing legend is not fatal, so the row
    // is filled in whatever order the events land.
    function fillSummaryRow() {
        const row = ensureSummaryRow();
        if (statsBoxEl && statsBoxEl.parentElement !== row) row.appendChild(statsBoxEl);
        if (legendBoxEl && legendBoxEl.parentElement !== row) row.appendChild(legendBoxEl);
    }

    // Stacks the two boxes when they do not fit side by side even shrunk, which
    // only large text causes. Side by side is tried first every time, so a row
    // that stacked goes back once there is room again.
    function fitSummaryRow() {
        const row = summaryRowEl;
        row.classList.remove("stacked");
        const rowRect = row.getBoundingClientRect();
        const overflows = [statsBoxEl, legendBoxEl].some(box => {
            if (!box || box.parentElement !== row) return false;
            const rect = box.getBoundingClientRect();
            return rect.left < rowRect.left - 0.5 || rect.right > rowRect.right + 0.5;
        });
        row.classList.toggle("stacked", overflows);
    }

    // ---------- Positioning ----------

    function placeSummaryRow() {
        if (!statsBoxEl) return;
        fillSummaryRow();
        const row = summaryRowEl;

        const isMobile = window.matchMedia(MOBILE_BREAKPOINT).matches;

        if (isMobile) {
            // Above the tab buttons, so it shows on both tabs.
            const main = document.querySelector("main");
            const mobileTabs = document.querySelector(".mobile-tabs");
            if (main && mobileTabs && row.nextSibling !== mobileTabs) {
                main.insertBefore(row, mobileTabs);
            } else if (main && !mobileTabs && row.parentElement !== main) {
                main.insertBefore(row, main.firstChild);
            }
        } else {
            const locationSection = document.getElementById("location-section");
            if (locationSection && locationSection.firstChild !== row) {
                locationSection.insertBefore(row, locationSection.firstChild);
            }
        }
    }

    function placeMapContainer() {
        if (!mapContainerEl || !summaryRowEl) return;

        const locationSection = document.getElementById("location-section");
        if (!locationSection) return;

        const isMobile = window.matchMedia(MOBILE_BREAKPOINT).matches;

        if (isMobile) {
            // Hidden by CSS here; just keep it somewhere valid. Don't assume the
            // summary row is a sibling — on mobile it lives in <main>.
            if (mapContainerEl.parentElement !== locationSection) {
                locationSection.appendChild(mapContainerEl);
            }
            return;
        }

        // Desktop: right after the summary row.
        if (summaryRowEl.nextSibling !== mapContainerEl) {
            locationSection.insertBefore(mapContainerEl, summaryRowEl.nextSibling);
        }
    }

    // ---------- Panel height sync (desktop only) ----------

    // Floor for the two measurements below. Both read as 0 or some intermediate
    // value while layout is still settling, and sizing from those locks in a tiny
    // map. Under this we bail and wait to be called again.
    const MIN_SANE_PX = 200;

    let lastMapWidth = null;
    let lastMapHeight = null;

    // Handed over with the container on locationMapReady. Keeps this file free of
    // any data dependency, so it can never be left waiting on a fetch.
    let mapAspectRatio = null;

    // The reserve is kept by hand in locationPanelLayout.css, so check it the
    // first time the page is at the default text size: a restyled row that
    // outgrows it is named instead of quietly moving the map off the grid's edge.
    let reserveChecked = false;
    function checkReserve(reserve) {
        if (reserveChecked || summaryRowEl.classList.contains("stacked")) return;
        if (getComputedStyle(document.documentElement).fontSize !== "16px") return;
        reserveChecked = true;

        const actual = summaryRowEl.getBoundingClientRect().height;
        if (Math.abs(actual - reserve) > 2) {
            console.warn(
                `locationPanelLayout: the summary row is ${Math.round(actual)}px tall at the ` +
                `default text size, but --summary-row-reserve in css/locationPanelLayout.css ` +
                `is ${reserve}px. Set it to match, or the map's bottom edge drifts off the item grid's.`
            );
        }
    }

    function syncPanelHeight() {
        const isMobile = window.matchMedia(MOBILE_BREAKPOINT).matches;

        if (isMobile) {
            if (mapContainerEl) {
                mapContainerEl.style.height = "";
                mapContainerEl.style.width = "";
            }
            // Mobile width comes from CSS; drop any desktop width we set.
            if (summaryRowEl) {
                summaryRowEl.style.width = "";
                fitSummaryRow();
            }
            lastMapWidth = lastMapHeight = null;
            return;
        }

        const gridContainer = document.querySelector(".grid-container");
        const locationSection = document.getElementById("location-section");
        if (!gridContainer || !summaryRowEl || !locationSection) return;

        // No map to size against, but the row still has to fit its text.
        if (!mapContainerEl || !mapAspectRatio) {
            fitSummaryRow();
            return;
        }

        // Read the gap off the element rather than mirroring the CSS value.
        const gap = parseFloat(getComputedStyle(locationSection).rowGap) || 0;
        const totalTarget = gridContainer.getBoundingClientRect().height;
        const maxWidth = locationSection.getBoundingClientRect().width;

        // See MIN_SANE_PX.
        if (totalTarget < MIN_SANE_PX || maxWidth < MIN_SANE_PX) return;

        // Sized against the row's reserved height, not its measured one: larger
        // text makes the row taller, and that pushes the map down the page rather
        // than shrinking it. Measured only if the stylesheet did not load.
        const reserve = parseFloat(
            getComputedStyle(summaryRowEl).getPropertyValue("--summary-row-reserve")
        ) || summaryRowEl.getBoundingClientRect().height;
        const maxHeight = Math.max(totalTarget - reserve - gap, MIN_SANE_PX);

        // Fit the map's aspect ratio inside (maxWidth x maxHeight). Both
        // dimensions are set explicitly because CSS aspect-ratio doesn't resolve
        // exactly at every width, and a box even slightly off ratio drifts every
        // percent-positioned marker — worst on ultrawide.
        let mapWidth = maxHeight * mapAspectRatio;
        let mapHeight = maxHeight;
        if (mapWidth > maxWidth) {
            mapWidth = maxWidth;
            mapHeight = maxWidth / mapAspectRatio;
        }

        // Keep the summary row no wider than the map so the two read as one unit
        // — on 21:9 the column is much wider than the map. Ahead of the guard
        // below, because the row re-fits its text even when the map has not moved.
        summaryRowEl.style.width = `${mapWidth}px`;
        fitSummaryRow();
        checkReserve(reserve);

        // Skip redundant writes so the ResizeObserver can't feed back into itself.
        if (mapWidth === lastMapWidth && mapHeight === lastMapHeight) return;
        lastMapWidth = mapWidth;
        lastMapHeight = mapHeight;

        mapContainerEl.style.width = `${mapWidth}px`;
        mapContainerEl.style.height = `${mapHeight}px`;

        // Tell anything laid out against the map, rather than letting it race us
        // on its own resize listener — and the map can resize with no window
        // resize at all, via the ResizeObserver below.
        window.dispatchEvent(new CustomEvent("locationMapResized", {
            detail: { mapContainer: mapContainerEl, width: mapWidth, height: mapHeight }
        }));
    }

    let syncScheduled = false;
    function scheduleHeightSync() {
        if (syncScheduled) return;
        syncScheduled = true;
        let ran = false;
        const run = () => {
            if (ran) return;
            ran = true;
            syncScheduled = false;
            syncPanelHeight();
        };
        // rAF while painting, setTimeout when not — rAF callbacks are frozen for
        // a window that isn't being painted, and the map would stay wrong.
        requestAnimationFrame(run);
        setTimeout(run, 250);
    }

    // The "ready" events are one-shot and can fire while layout is still
    // settling. These are the signals that something the layout depends on
    // actually changed: the item grid's height, which the map is sized against,
    // and the summary row's size, which follows the browser's text size and
    // decides whether the row has to stack.
    function observeLayout() {
        if (typeof ResizeObserver === "undefined") return;
        resizeObserver = new ResizeObserver(scheduleHeightSync);
        const gridContainer = document.querySelector(".grid-container");
        if (gridContainer) resizeObserver.observe(gridContainer);
        if (summaryRowEl) resizeObserver.observe(summaryRowEl);
    }

    // ---------- Init ----------

    window.addEventListener("locationStatsBoxReady", (event) => {
        statsBoxEl = event.detail.box;
        placeSummaryRow();
        placeMapContainer();
        syncPanelHeight();
    });

    // Optional: a config with no legend entries never fires this, and the row is
    // then just the stats box.
    window.addEventListener("locationLegendReady", (event) => {
        legendBoxEl = event.detail.box;
        placeSummaryRow();
        placeMapContainer();
        syncPanelHeight();
    });

    window.addEventListener("locationMapReady", (event) => {
        mapContainerEl = event.detail.mapContainer;
        mapAspectRatio = event.detail.aspectRatio;
        placeMapContainer();
        syncPanelHeight();
    });

    // The grids can finish rendering after the two events above already ran, so
    // re-run against the grid's real height.
    window.addEventListener("itemGridsReady", () => {
        syncPanelHeight();
    });

    // Fires regardless of tab visibility — but it is not the backstop it looks
    // like. On a warm cache "load" beats trackerDataReady, so it runs before the
    // grids exist and bails on MIN_SANE_PX. The cover for that case is
    // itemTracker.js re-announcing itemGridsReady once its images settle.
    window.addEventListener("load", syncPanelHeight);

    document.addEventListener("DOMContentLoaded", () => {
        const mql = window.matchMedia(MOBILE_BREAKPOINT);
        const onBreakpointChange = () => {
            placeSummaryRow();
            placeMapContainer();
            syncPanelHeight();
        };
        if (mql.addEventListener) {
            mql.addEventListener("change", onBreakpointChange);
        } else {
            // Safari <14 fallback
            mql.addListener(onBreakpointChange);
        }

        window.addEventListener("resize", scheduleHeightSync);
        observeLayout();
    });
})();
