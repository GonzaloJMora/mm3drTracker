// locationPanelLayout.js
// Positions the summary row (stats box + legend) and the map container, keeps the
// desktop map sized to the item grid's height, and scales the desktop grids up on
// windows that have room. Every piece arrives here via events — the tracking
// logic, the stats numbers, the legend and the map itself belong to other files.

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

    // The stats box and the legend sit side by side, in the header on desktop and
    // above the tabs on a phone. Owning the row here keeps both of those files free
    // of any knowledge of the other.
    function ensureSummaryRow() {
        if (summaryRowEl) return summaryRowEl;
        summaryRowEl = document.createElement("div");
        summaryRowEl.id = "location-summary-row";
        if (resizeObserver) resizeObserver.observe(summaryRowEl);
        return summaryRowEl;
    }

    // Either box can arrive first, and either can be missing, so the row is filled
    // with whatever has landed.
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
        if (!row) return;
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
        if (!statsBoxEl && !legendBoxEl) return;
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
            // Between the logo and the toolbar, which leaves the map the whole
            // location column.
            const header = document.querySelector("header");
            const toolbar = document.getElementById("tracker-toolbar");
            if (header && toolbar && row.parentElement !== header) {
                header.insertBefore(row, toolbar);
            }
        }
    }

    // Needs nothing from the summary row: a progress box that failed to build must
    // not cost the map as well.
    function placeMapContainer() {
        if (!mapContainerEl) return;

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

        // Desktop: first in the column.
        if (locationSection.firstChild !== mapContainerEl) {
            locationSection.insertBefore(mapContainerEl, locationSection.firstChild);
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

    // ---------- Scale (desktop only) ----------

    // The grids are drawn this many times their base size (--ui-scale in
    // css/style.css), and the map, sized against the grids' height, follows.
    let appliedScale = 1;

    function writeScale(scale, layoutWidth) {
        const root = document.documentElement;
        if (scale !== appliedScale) {
            appliedScale = scale;
            root.style.setProperty("--ui-scale", String(scale));
        }
        if (layoutWidth) root.style.setProperty("--layout-max-width", `${Math.ceil(layoutWidth)}px`);
        else root.style.removeProperty("--layout-max-width");
    }

    // Only the logo counts: its height is fixed, while the rest of the header grows
    // with the browser's text size and wraps with its width, which this scale sets,
    // so measuring all of it would feed the scale back into itself. Large text
    // pushes the map down the page instead.
    function headerHeightForScale(header) {
        const logo = header.querySelector("img");
        const height = logo ? logo.getBoundingClientRect().height : 0;
        return height > 0 ? height : header.getBoundingClientRect().height;
    }

    // The largest scale, from 1 up, at which the grids and a full-height map fit
    // the window side by side and the page does not need to scroll. False when the
    // grids are not measurable yet.
    //
    // Part of the grids doesn't scale (their slot borders stay 1px), so their size
    // is a fixed part plus a scaled part. Both are read by measuring at scale 1 and
    // 2 rather than divided down from the current scale, which would make the answer
    // depend on the size the window was resized from. The real scale goes back in
    // the same script, so neither reading is ever painted.
    function applyScale(gridContainer) {
        const root = document.documentElement;
        const sizeAt = scale => {
            root.style.setProperty("--ui-scale", String(scale));
            return gridContainer.getBoundingClientRect();
        };
        const one = sizeAt(1);
        const two = sizeAt(2);
        root.style.setProperty("--ui-scale", String(appliedScale));

        if (one.width < MIN_SANE_PX || one.height < MIN_SANE_PX) return false;
        const grid = {
            width: { per: two.width - one.width, fixed: 2 * one.width - two.width },
            height: { per: two.height - one.height, fixed: 2 * one.height - two.height }
        };
        if (!(grid.width.per > 0) || !(grid.height.per > 0)) return false;

        const px = (style, name) => parseFloat(style[name]) || 0;
        const body = getComputedStyle(document.body);
        const header = document.querySelector("header");
        const footer = document.getElementById("app-version");
        const wrapper = document.querySelector(".tracker-layout-wrapper");
        const gap = wrapper ? px(getComputedStyle(wrapper), "columnGap") : 0;

        const availableWidth = document.body.clientWidth - px(body, "paddingLeft") - px(body, "paddingRight");
        const above = header ? headerHeightForScale(header) + px(getComputedStyle(header), "marginBottom") : 0;
        const below = footer ? footer.getBoundingClientRect().height + px(getComputedStyle(footer), "marginTop") : 0;
        const availableHeight = document.documentElement.clientHeight
            - px(body, "paddingTop") - px(body, "paddingBottom") - px(body, "marginTop") - px(body, "marginBottom")
            - above - below;

        // The map is as tall as the grids, so its width follows their height.
        const layoutWidth = s => grid.width.fixed + grid.width.per * s
            + (grid.height.fixed + grid.height.per * s) * mapAspectRatio + gap;
        const byWidth = (availableWidth - layoutWidth(0)) / (grid.width.per + grid.height.per * mapAspectRatio);
        const byHeight = (availableHeight - grid.height.fixed) / grid.height.per;
        // Floored to two places: a scale that moves by a hair on every pass would
        // keep the observers below firing.
        const scale = Math.max(1, Math.floor(Math.min(byWidth, byHeight) * 100) / 100);

        writeScale(scale, layoutWidth(scale));
        return true;
    }

    // A change in what the page needs can add or remove the vertical scrollbar
    // partway through a pass, which changes the width every measurement above was
    // taken against. One more pass settles it.
    function syncPanelHeight() {
        const startWidth = document.documentElement.clientWidth;
        fitPanels();
        if (document.documentElement.clientWidth !== startWidth) scheduleHeightSync();
    }

    function fitPanels() {
        const isMobile = window.matchMedia(MOBILE_BREAKPOINT).matches;

        if (isMobile) {
            writeScale(1, 0);
            if (mapContainerEl) {
                mapContainerEl.style.height = "";
                mapContainerEl.style.width = "";
            }
            fitSummaryRow();
            lastMapWidth = lastMapHeight = null;
            return;
        }

        const gridContainer = document.querySelector(".grid-container");
        const locationSection = document.getElementById("location-section");
        if (!gridContainer || !locationSection) return;

        // No map to size against, but the row still has to fit its text.
        if (!mapContainerEl || !mapAspectRatio) {
            fitSummaryRow();
            return;
        }

        if (!applyScale(gridContainer)) return;

        const totalTarget = gridContainer.getBoundingClientRect().height;
        const maxWidth = locationSection.getBoundingClientRect().width;

        // See MIN_SANE_PX.
        if (totalTarget < MIN_SANE_PX || maxWidth < MIN_SANE_PX) return;

        // The summary row is in the header, so the map gets the item grids' whole
        // height.
        const maxHeight = Math.max(totalTarget, MIN_SANE_PX);

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

        // Ahead of the guard below, because the row re-fits its text even when the
        // map has not moved.
        fitSummaryRow();

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
        const onBreakpointChange = () => {
            placeSummaryRow();
            placeMapContainer();
            syncPanelHeight();
        };
        window.matchMedia(MOBILE_BREAKPOINT).addEventListener("change", onBreakpointChange);

        window.addEventListener("resize", scheduleHeightSync);
        observeLayout();
    });
})();
