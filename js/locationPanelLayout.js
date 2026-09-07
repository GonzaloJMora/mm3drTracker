// locationPanelLayout.js
// Positions the stats box and the map container, and keeps the desktop map sized
// to the item grid's height. Both pieces arrive here via events — the tracking
// logic, the stats numbers and the map itself belong to other files.

(function () {
    // Read from css/style.css so JS and CSS can't disagree about where mobile
    // starts. The literal is a fallback for a stylesheet that failed to load.
    const MOBILE_BREAKPOINT = `(max-width: ${
        getComputedStyle(document.documentElement)
            .getPropertyValue("--mobile-breakpoint").trim() || "1499px"
    })`;

    let statsBoxEl = null;
    let mapContainerEl = null;

    // ---------- Positioning ----------

    function placeStatsBox() {
        if (!statsBoxEl) return;

        const isMobile = window.matchMedia(MOBILE_BREAKPOINT).matches;

        if (isMobile) {
            // Above the tab buttons, so it shows on both tabs.
            const main = document.querySelector("main");
            const mobileTabs = document.querySelector(".mobile-tabs");
            if (main && mobileTabs && statsBoxEl.nextSibling !== mobileTabs) {
                main.insertBefore(statsBoxEl, mobileTabs);
            } else if (main && !mobileTabs && statsBoxEl.parentElement !== main) {
                main.insertBefore(statsBoxEl, main.firstChild);
            }
        } else {
            const locationSection = document.getElementById("location-section");
            if (locationSection && locationSection.firstChild !== statsBoxEl) {
                locationSection.insertBefore(statsBoxEl, locationSection.firstChild);
            }
        }
    }

    function placeMapContainer() {
        if (!mapContainerEl || !statsBoxEl) return;

        const locationSection = document.getElementById("location-section");
        if (!locationSection) return;

        const isMobile = window.matchMedia(MOBILE_BREAKPOINT).matches;

        if (isMobile) {
            // Hidden by CSS here; just keep it somewhere valid. Don't assume
            // statsBoxEl is a sibling — on mobile it lives in <main>.
            if (mapContainerEl.parentElement !== locationSection) {
                locationSection.appendChild(mapContainerEl);
            }
            return;
        }

        // Desktop: right after the stats box.
        if (statsBoxEl.nextSibling !== mapContainerEl) {
            locationSection.insertBefore(mapContainerEl, statsBoxEl.nextSibling);
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

    function syncPanelHeight() {
        const isMobile = window.matchMedia(MOBILE_BREAKPOINT).matches;

        if (isMobile) {
            if (mapContainerEl) {
                mapContainerEl.style.height = "";
                mapContainerEl.style.width = "";
            }
            // Mobile width comes from CSS; drop any desktop width we set.
            if (statsBoxEl) statsBoxEl.style.width = "";
            lastMapWidth = lastMapHeight = null;
            return;
        }

        const gridContainer = document.querySelector(".grid-container");
        const locationSection = document.getElementById("location-section");
        if (!gridContainer || !statsBoxEl || !mapContainerEl || !locationSection) return;
        if (!mapAspectRatio) return;

        // Read the gap off the element rather than mirroring the CSS value.
        const gap = parseFloat(getComputedStyle(locationSection).rowGap) || 0;
        const totalTarget = gridContainer.getBoundingClientRect().height;
        const maxWidth = locationSection.getBoundingClientRect().width;

        // See MIN_SANE_PX.
        if (totalTarget < MIN_SANE_PX || maxWidth < MIN_SANE_PX) return;

        const statsBoxHeight = statsBoxEl.getBoundingClientRect().height;
        const maxHeight = Math.max(totalTarget - statsBoxHeight - gap, MIN_SANE_PX);

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

        // Skip redundant writes so the ResizeObserver can't feed back into itself.
        if (mapWidth === lastMapWidth && mapHeight === lastMapHeight) return;
        lastMapWidth = mapWidth;
        lastMapHeight = mapHeight;

        mapContainerEl.style.width = `${mapWidth}px`;
        mapContainerEl.style.height = `${mapHeight}px`;

        // Keep the stats box no wider than the map so the two read as one unit —
        // on 21:9 the column is much wider than the map.
        statsBoxEl.style.width = `${mapWidth}px`;

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
    // settling. This is the signal that the grid's height actually changed.
    function observeGridContainer() {
        if (typeof ResizeObserver === "undefined") return;
        const gridContainer = document.querySelector(".grid-container");
        if (!gridContainer) return;
        new ResizeObserver(scheduleHeightSync).observe(gridContainer);
    }

    // ---------- Init ----------

    window.addEventListener("locationStatsBoxReady", (event) => {
        statsBoxEl = event.detail.box;
        placeStatsBox();
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
            placeStatsBox();
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
        observeGridContainer();
    });
})();
