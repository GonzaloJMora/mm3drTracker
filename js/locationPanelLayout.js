// locationPanelLayout.js
// Positions the summary row (progress numbers + legend) and the map container, keeps the
// desktop map sized to the item grid's height, and scales the desktop grids up on
// windows that have room. Every piece arrives here via events — the tracking
// logic, the stats numbers, the legend and the map itself belong to other files.

(function () {
    let statsBoxEl = null;
    let legendBoxEl = null;
    let mapContainerEl = null;
    let summaryRowEl = null;

    // The progress numbers and the legend share one row in the header on desktop. On
    // a phone the row is hidden and the legend moves into the header's menu. Owning
    // the row here keeps both of those files free of any knowledge of the other.
    function ensureSummaryRow() {
        if (summaryRowEl) return summaryRowEl;
        summaryRowEl = document.createElement("div");
        summaryRowEl.id = "location-summary-row";
        return summaryRowEl;
    }

    // Either box can arrive first, and either can be missing, so the row is filled
    // with whatever has landed.
    function fillSummaryRow() {
        const row = ensureSummaryRow();
        if (statsBoxEl && statsBoxEl.parentElement !== row) row.appendChild(statsBoxEl);
        if (legendBoxEl && legendBoxEl.parentElement !== row) row.appendChild(legendBoxEl);
    }

    // ---------- Positioning ----------

    function placeSummaryRow() {
        if (!statsBoxEl && !legendBoxEl) return;
        fillSummaryRow();
        const row = summaryRowEl;

        const isMobile = window.PhoneLayout.active;

        if (isMobile) {
            // The frozen bar shows the progress numbers as a line, so the row itself is
            // hidden here (CSS), and the legend goes to the end of the header's menu.
            const main = document.querySelector("main");
            if (main && row.parentElement !== main) main.insertBefore(row, main.firstChild);
            const toolbar = document.getElementById("tracker-toolbar");
            if (toolbar && legendBoxEl && legendBoxEl.parentElement !== toolbar) toolbar.appendChild(legendBoxEl);
        } else {
            // In the header, under the toolbar and over the map (locationPanelLayout.css),
            // which leaves the map the whole location column.
            const header = document.querySelector("header");
            if (header && row.parentElement !== header) header.appendChild(row);
        }
    }

    // Needs nothing from the summary row: progress numbers that failed to build must
    // not cost the map as well.
    function placeMapContainer() {
        if (!mapContainerEl) return;

        const locationSection = document.getElementById("location-section");
        if (!locationSection) return;

        const isMobile = window.PhoneLayout.active;

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
    // css/common.css), and the map, sized against the grids' height, follows.
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
        const footer = document.getElementById("app-footer");
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
        const isMobile = window.PhoneLayout.active;

        if (isMobile) {
            writeScale(1, 0);
            if (mapContainerEl) {
                mapContainerEl.style.height = "";
                mapContainerEl.style.width = "";
            }
            lastMapWidth = lastMapHeight = null;
            return;
        }

        const gridContainer = document.querySelector(".grid-container");
        const locationSection = document.getElementById("location-section");
        if (!gridContainer || !locationSection) return;

        if (!mapContainerEl || !mapAspectRatio) return;

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

        // Skip redundant writes so the ResizeObserver can't feed back into itself.
        if (mapWidth !== lastMapWidth || mapHeight !== lastMapHeight) {
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

        alignSummaryRow();
    }

    // Starts the header's summary row where the map starts. Measured rather than
    // worked out, because the map is centered in its column and its width is floored.
    // Only the row's left edge moves, never the header's height, so this cannot feed
    // back into the sizing above.
    let lastInset = null;
    function alignSummaryRow() {
        const header = document.querySelector("header");
        if (!header || !mapContainerEl) return;
        const inset = Math.round(mapContainerEl.getBoundingClientRect().left - header.getBoundingClientRect().left);
        if (inset === lastInset) return;
        lastInset = inset;
        header.style.setProperty("--summary-inset", `${inset}px`);
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
    // settling. This is the signal that something the layout depends on actually
    // changed: the item grid's height, which the map is sized against.
    function observeLayout() {
        if (typeof ResizeObserver === "undefined") return;
        const resizeObserver = new ResizeObserver(scheduleHeightSync);
        const gridContainer = document.querySelector(".grid-container");
        if (gridContainer) resizeObserver.observe(gridContainer);
    }

    // ---------- Init ----------

    window.addEventListener("locationStatsBoxReady", (event) => {
        statsBoxEl = event.detail.box;
        placeSummaryRow();
        placeMapContainer();
        syncPanelHeight();
    });

    // Optional: a config with no legend entries never fires this, and the row is
    // then just the progress numbers.
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
        window.PhoneLayout.onChange(onBreakpointChange);

        window.addEventListener("resize", scheduleHeightSync);
        observeLayout();
    });
})();
