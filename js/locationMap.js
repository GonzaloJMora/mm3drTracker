// locationMap.js
// Desktop map view. One marker per region, placed from that region's
// map_coordinates and matched to the accordion locationTracker.js built by its
// data-region-name. Clicking a marker opens an overlay over the map with that
// region's checks; only one is open at a time.
//
// The checks inside are a CSS grid whose column and row counts are computed in
// fitOverlayContent(), because CSS cannot count children. See ARCHITECTURE.md,
// "Fitting a region into the map overlay".
//
// Shift+click the map with the F1 panel open to copy a map_coordinates snippet
// for that point — it is how the numbers in the region files were found.

(function () {
    // Read from css/style.css so JS and CSS can't disagree about where mobile
    // starts. The literal is a fallback for a stylesheet that failed to load.
    const MOBILE_BREAKPOINT = `(max-width: ${
        getComputedStyle(document.documentElement)
            .getPropertyValue("--mobile-breakpoint").trim() || "1499px"
    })`;

    // A region with no map_coordinates gets no marker; the validator below
    // says so.
    function regionMarkerConfigs(regions) {
        return regions
            .filter(data => data && data.map_coordinates)
            .map(data => ({
                regionName: data.region_name,
                xPercent: data.map_coordinates.xPercent,
                yPercent: data.map_coordinates.yPercent
            }));
    }

    // Every region belongs on the map, so a missing map_coordinates is always a
    // mistake — and a silent one: the region still renders and still counts, but
    // with no marker and a display:none list, its checks can't be reached at all.
    //
    // Only regions that rendered are reported. One locationTracker.js already
    // rejected has been named there, and repeating it buries the line that
    // matters.
    function validateMarkerCoordinates(regions) {
        const missing = regions
            .filter(data => data && regionLookup.has(data.region_name) && !data.map_coordinates)
            .map(data => data.region_name);

        if (!missing.length) return;

        console.warn(
            `locationMap: ${missing.length} region(s) have no map_coordinates, so they get no marker. ` +
            `On desktop that leaves their checks unreachable — the accordion list is mobile-only.`
        );
        missing.forEach(name => console.warn(`  ${name}`));
    }

    // The overlay sits this far outside the container so its border covers the
    // container's — see .location-map-overlay in the CSS.
    const OVERLAY_BORDER = 2;

    let mapContainerEl = null;
    let markerLayerEl = null;
    let regionLookup = new Map(); // regionName -> { headerBtn, groupEl }
    let markerEls = new Map();    // regionName -> marker element

    // ---------- Region lookup ----------

    function buildRegionLookup() {
        // Additive only. A region's node is a valid reference wherever it lives,
        // so rebuilding from a re-scan would drop whichever region is currently
        // checked out into the overlay and strand its marker gray.
        const container = document.getElementById("region-dropdown-container");
        if (!container) return;

        container.querySelectorAll(".region-group").forEach(groupEl => {
            const headerBtn = groupEl.querySelector(".region-header");
            const regionName = groupEl.dataset.regionName;
            if (!headerBtn || !regionName) return;
            if (!regionLookup.has(regionName)) {
                regionLookup.set(regionName, { headerBtn, groupEl });
            }
        });
    }

    // ---------- Marker rendering ----------

    function createMarkers(regionMarkers) {
        markerLayerEl.innerHTML = "";
        markerEls = new Map();

        // One marker per rendered accordion. A region that failed to render has
        // nothing to open, and a duplicate region_name would put a second marker
        // somewhere else on the map opening the first region's checks.
        const placed = new Set();

        regionMarkers.forEach(({ regionName, xPercent, yPercent }) => {
            if (!regionLookup.has(regionName) || placed.has(regionName)) return;
            placed.add(regionName);

            const marker = document.createElement("button");
            marker.type = "button";
            marker.className = "location-map-marker";
            marker.style.left = `${xPercent}%`;
            marker.style.top = `${yPercent}%`;
            // title is the hover tooltip; aria-label is the accessible name, or
            // a screen reader reads this as just "button".
            marker.title = regionName;
            marker.setAttribute("aria-label", regionName);
            // Not data-region-name — that means "a region's accordion", and the
            // map comes first in the DOM, so an unscoped query would find a
            // marker instead. Nothing reads this; it is for devtools.
            marker.dataset.markerRegion = regionName;

            marker.addEventListener("click", (e) => {
                if (e.shiftKey) return; // coordinate finder handles this instead
                openOverlayFor(regionName);
            });

            markerLayerEl.appendChild(marker);
            markerEls.set(regionName, marker);
        });

        syncMarkerColors();
    }

    // Full pass, used when the markers are first built. Ongoing updates arrive
    // one region at a time on the "regionStatusChanged" event instead.
    function syncMarkerColors() {
        // Mirror the status locationTracker.js recorded, rather than keeping our
        // own list of status names in step with it.
        markerEls.forEach((marker, regionName) => {
            const entry = regionLookup.get(regionName);
            const headerBtn = entry && entry.headerBtn;
            applyMarkerStatus(
                marker,
                headerBtn ? (headerBtn.dataset.status || "") : "",
                headerBtn ? Number(headerBtn.dataset.accessible) : 0
            );
        });
    }

    // Keyed off the count, not the status: accessible > 0 is exactly the yellow,
    // green and purple markers, so neither this file nor its CSS lists status names.
    function applyMarkerStatus(marker, status, accessible) {
        if (!marker) return;

        if (marker.dataset.status !== status) {
            if (marker.dataset.status) marker.classList.remove(marker.dataset.status);
            marker.dataset.status = status;
            if (status) marker.classList.add(status);
        }

        const label = accessible > 0 ? String(accessible) : "";
        if (marker.textContent !== label) marker.textContent = label;
        marker.classList.toggle("has-count", label !== "");
        // Two digits need a smaller type size to sit inside a shape that tapers.
        marker.classList.toggle("wide-count", label.length > 1);
    }

    // ---------- Coordinate finder (shift+click, debug-panel-gated) ----------

    function isDebugPanelOpen() {
        const panel = document.getElementById("tracker-debug-panel");
        return !!panel && panel.style.display !== "none";
    }

    function setupCoordinateFinder() {
        markerLayerEl.addEventListener("click", (e) => {
            if (!e.shiftKey) return;
            // Gated behind the F1 panel so a player can't stumble into it.
            if (!isDebugPanelOpen()) return;

            const rect = markerLayerEl.getBoundingClientRect();
            const xPercent = ((e.clientX - rect.left) / rect.width * 100).toFixed(1);
            const yPercent = ((e.clientY - rect.top) / rect.height * 100).toFixed(1);
            const snippet = `"map_coordinates": { "xPercent": ${xPercent}, "yPercent": ${yPercent} },`;

            console.log("locationMap coordinate finder:", snippet);
            if (navigator.clipboard) {
                navigator.clipboard.writeText(snippet).catch(() => {});
            }

            const crosshair = document.createElement("div");
            crosshair.className = "location-map-crosshair";
            crosshair.style.left = `${xPercent}%`;
            crosshair.style.top = `${yPercent}%`;
            markerLayerEl.appendChild(crosshair);
            setTimeout(() => crosshair.remove(), 1500);
        });
    }

    // ---------- Overlay (single, fixed over the map — no dragging) ----------

    let currentOverlayRegion = null;
    let overlayEl = null;
    // Where the checked-out region sat in the list, so it can go back there.
    let overlayReturnAnchor = null;

    function openOverlayFor(regionName) {
        if (currentOverlayRegion === regionName) {
            closeOverlay(); // clicking the same marker again closes it
            return;
        }
        if (currentOverlayRegion) closeOverlay(); // only one overlay at a time

        const entry = regionLookup.get(regionName);
        if (!entry) return;

        overlayEl = document.createElement("div");
        overlayEl.className = "location-map-overlay";

        const titlebar = document.createElement("div");
        titlebar.className = "location-map-overlay-titlebar";

        const titleText = document.createElement("span");
        titleText.className = "location-map-overlay-title";
        titleText.textContent = regionName;
        titlebar.appendChild(titleText);

        // The moved-in region's own header is hidden in here, so the titlebar is
        // the only place its counts can show.
        const titleCount = document.createElement("span");
        titleCount.className = "location-map-overlay-count";
        titleCount.textContent = entry.headerBtn.dataset.counts || "";
        titlebar.appendChild(titleCount);

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "location-map-overlay-close";
        closeBtn.textContent = "\u00D7";
        closeBtn.setAttribute("aria-label", `Close ${regionName}`);
        closeBtn.addEventListener("click", () => closeOverlay());
        titlebar.appendChild(closeBtn);

        // The whole titlebar closes it, so you don't have to aim at the corner.
        // The X still works — its click bubbles up to here.
        titlebar.addEventListener("click", () => closeOverlay());

        const body = document.createElement("div");
        body.className = "location-map-overlay-body";
        // Remember the neighbor it is lifted out from in front of. Appending on
        // the way back would drop it at the end of the list — invisible on
        // desktop, obvious the moment you narrow to mobile.
        overlayReturnAnchor = entry.groupEl.nextElementSibling;
        body.appendChild(entry.groupEl); // move, not clone — keeps live bindings

        // Its own header is hidden by CSS in here, so force the content open —
        // the overlay itself says the region is open.
        const contentDiv = entry.groupEl.querySelector(".region-content");
        if (contentDiv) contentDiv.classList.add("open");

        overlayEl.appendChild(titlebar);
        overlayEl.appendChild(body);
        mapContainerEl.appendChild(overlayEl);

        if (contentDiv) fitOverlayContent(overlayEl, contentDiv);

        currentOverlayRegion = regionName;
    }

    // ---------- Fitting a region into the overlay ----------

    // Gap between the overlay's bottom edge and the bottom of the window.
    const VIEWPORT_MARGIN = 12;

    // How tall the overlay may get. It starts on the map and is allowed to use
    // the empty page below it, which is what keeps the text readable.
    //
    // One ceiling — a windowful measured from the top of the page — and it alone
    // guarantees the overlay never makes the page scroll: its bottom lands at
    // clientHeight minus the margin, and scrollHeight is never below
    // clientHeight, so it always sits inside the height the page already had.
    //
    // Do not add the item grids' bottom edge back as a second ceiling. It looks
    // like the thing holding the scrollbar off and it isn't; all it does is cost
    // the overlay a couple of rungs of the text ladder.
    //
    // clientHeight rather than innerHeight, because clientHeight is what
    // scrollHeight is compared against. Document coordinates rather than
    // viewport, so the budget can't change with scroll position — otherwise the
    // same region renders at a different size depending on where you were when
    // you clicked, and one opened while scrolled down hides checks below the fold
    // when you scroll back up.
    function overlayHeightBudget() {
        const mapRect = mapContainerEl.getBoundingClientRect();
        const mapHeight = mapRect.height + OVERLAY_BORDER * 2;
        const overlayTop = mapRect.top + window.scrollY - OVERLAY_BORDER;

        // Before layout settles this reads short or negative. Falling back to the
        // map's own height costs text size, never a broken box.
        const available = document.documentElement.clientHeight - VIEWPORT_MARGIN - overlayTop;
        return available > mapHeight ? available : mapHeight;
    }

    function applyTextSize(contentDiv, size) {
        contentDiv.style.setProperty("--overlay-check-font", size.font_size);
        contentDiv.style.setProperty("--overlay-check-padding", size.padding);
    }

    // Walks config.json's map_overlay.text_sizes largest-first and stops at the
    // first that fits, so only the regions that need it shrink. Column count
    // comes from the width, row count from the item count — CSS can do neither,
    // because it cannot count children.
    function fitOverlayContent(overlay, contentDiv) {
        // Only the checks actually drawn. A hidden one takes no grid cell and
        // measures zero: counted, it plans rows nobody sees, and as the first check
        // it reads as nothing measurable at all.
        const items = Array.from(contentDiv.children).filter(el => el.getClientRects().length > 0);
        if (!items.length) {
            // Nothing shown: drop the last fit, so the box covers just the map again.
            contentDiv.style.gridTemplateColumns = "";
            contentDiv.style.gridTemplateRows = "";
            contentDiv.style.overflowY = "";
            overlay.style.bottom = "";
            overlay.style.height = "";
            return;
        }

        const sizes = (window.TrackerData.config.map_overlay || {}).text_sizes || [];
        if (!sizes.length) return;

        const budget = overlayHeightBudget();
        overlay.style.bottom = "auto";
        overlay.style.height = `${budget}px`;

        const styles = getComputedStyle(contentDiv);
        const columnGap = parseFloat(styles.columnGap) || 0;
        const rowGap = parseFloat(styles.rowGap) || 0;
        const padX = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
        const padY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);

        let chosen = null;

        // Measure unwrapped, whatever the labels may do once laid out. A
        // wrappable label reports a min-content width of its longest word, which
        // would make every check measure far narrower than it is and hand every
        // region too many columns. Cleared before the real template goes on.
        contentDiv.style.setProperty("--overlay-check-wrap", "nowrap");

        for (const size of sizes) {
            applyTextSize(contentDiv, size);

            // A single max-content column, so each check reports its natural
            // width instead of the stretched column width.
            contentDiv.style.gridTemplateColumns = "max-content";
            contentDiv.style.gridTemplateRows = "";

            const itemWidth = Math.max(...items.map(el => el.getBoundingClientRect().width));
            const itemHeight = items[0].getBoundingClientRect().height;
            const availableWidth = contentDiv.clientWidth - padX;
            const availableHeight = contentDiv.clientHeight - padY;

            // Nothing measurable. The content is mid-measurement here, which is
            // scaffolding rather than a layout, so put a plain scrollable column
            // back before leaving instead of showing it like this.
            if (!(itemWidth > 0) || !(itemHeight > 0) || !(availableWidth > 0)) {
                contentDiv.style.removeProperty("--overlay-check-wrap");
                contentDiv.style.gridTemplateColumns = "minmax(0, 1fr)";
                contentDiv.style.gridTemplateRows = `repeat(${items.length}, auto)`;
                contentDiv.style.overflowY = "auto";
                overlay.style.bottom = "";
                overlay.style.height = "";
                return;
            }

            const columns = Math.max(1, Math.floor((availableWidth + columnGap) / (itemWidth + columnGap)));
            const rows = Math.ceil(items.length / columns);
            const needed = rows * itemHeight + (rows - 1) * rowGap;

            chosen = { columns, rows, needed, availableHeight };
            if (needed <= availableHeight) break;
        }

        contentDiv.style.removeProperty("--overlay-check-wrap");
        contentDiv.style.gridTemplateColumns = `repeat(${chosen.columns}, minmax(0, 1fr))`;
        contentDiv.style.gridTemplateRows = `repeat(${chosen.rows}, auto)`;

        // Re-read rather than trust the estimate: chosen.needed assumes every row
        // is one line, and a wrapped label makes its row taller. Both decisions
        // below would then run on a number that is too small, and the overlay
        // would be shrunk past its own content with no scrollbar to reveal it.
        const padTop = parseFloat(styles.paddingTop) || 0;
        const contentTop = contentDiv.getBoundingClientRect().top + padTop;
        const lowest = Math.max(...items.map(el => el.getBoundingClientRect().bottom));
        const actualNeeded = lowest - contentTop;

        // Nothing in the ladder fit. Scroll rather than clip — a check behind a
        // scrollbar is recoverable, one silently cut off is not.
        contentDiv.style.overflowY = actualNeeded > chosen.availableHeight ? "auto" : "";

        // Give back the unused budget, so a small region still sits on the map
        // rather than in an oversized box.
        const unused = Math.max(0, chosen.availableHeight - actualNeeded);
        const mapHeight = mapContainerEl.getBoundingClientRect().height + OVERLAY_BORDER * 2;
        const finalHeight = Math.max(mapHeight, budget - unused);

        if (finalHeight <= mapHeight) {
            // Back to exactly covering the map — let the CSS inset do it.
            overlay.style.bottom = "";
            overlay.style.height = "";
        } else {
            overlay.style.height = `${finalHeight}px`;
        }
    }

    function closeOverlay() {
        if (!currentOverlayRegion) return;

        const entry = regionLookup.get(currentOverlayRegion);
        if (entry) {
            // Back to a closed accordion, or it shows up stuck open in the
            // mobile list.
            const contentDiv = entry.groupEl.querySelector(".region-content");
            if (contentDiv) {
                contentDiv.classList.remove("open");
                // Drop everything fitOverlayContent set; the mobile list sizes
                // itself and must not inherit a map-shaped grid.
                contentDiv.style.gridTemplateColumns = "";
                contentDiv.style.gridTemplateRows = "";
                contentDiv.style.overflowY = "";
                contentDiv.style.removeProperty("--overlay-check-font");
                contentDiv.style.removeProperty("--overlay-check-padding");
                contentDiv.style.removeProperty("--overlay-check-wrap");
            }
            entry.headerBtn.classList.remove("expanded");
            // The state as well as the class, or a region expanded in the mobile
            // list beforehand comes back collapsed but still reading as expanded.
            entry.headerBtn.setAttribute("aria-expanded", "false");

            const container = document.getElementById("region-dropdown-container");
            if (container) {
                // insertBefore(node, null) appends, which is right for a region
                // that was last in the list to begin with.
                const anchor = overlayReturnAnchor && overlayReturnAnchor.parentElement === container
                    ? overlayReturnAnchor
                    : null;
                container.insertBefore(entry.groupEl, anchor);
            }
        }
        overlayReturnAnchor = null;

        if (overlayEl) overlayEl.remove();
        overlayEl = null;
        const closedRegion = currentOverlayRegion;
        currentOverlayRegion = null;

        // Closing here closes the region as much as its header does, and
        // locationTracker.js lets that region's kept rows go on it.
        window.dispatchEvent(new CustomEvent("regionOverlayClosed", {
            detail: { regionName: closedRegion }
        }));
    }


    // ---------- Container creation ----------

    function createMapContainer(mapConfig) {
        mapContainerEl = document.createElement("div");
        mapContainerEl.id = "location-map-container";

        const img = document.createElement("img");
        img.id = "location-map-image";
        img.src = mapConfig.image;
        img.alt = mapConfig.alt;
        img.draggable = false;

        // The panel sizing uses the dimensions from config.json so it can run
        // immediately instead of waiting on the full-size image. Once the image is
        // actually here, confirm the two agree — if they ever drift apart the
        // markers creep off position, which is a miserable bug to track down.
        img.addEventListener("load", () => {
            if (img.naturalWidth !== mapConfig.width || img.naturalHeight !== mapConfig.height) {
                console.warn(
                    `locationMap: config.json says the map is ${mapConfig.width}x${mapConfig.height} ` +
                    `but ${mapConfig.image} is ${img.naturalWidth}x${img.naturalHeight}. ` +
                    `Update config.json or every marker will drift.`
                );
            }
        }, { once: true });

        markerLayerEl = document.createElement("div");
        markerLayerEl.id = "location-map-marker-layer";

        mapContainerEl.appendChild(img);
        mapContainerEl.appendChild(markerLayerEl);
    }

    // config.map drives the container, the image and the aspect ratio the whole
    // panel is sized from, so there is no partial version of this worth drawing.
    function mapConfigProblem(mapConfig) {
        if (!mapConfig) return "config.json has no \"map\" block";
        if (!mapConfig.image) return "config.json's \"map\" block has no \"image\" path";
        if (!(mapConfig.width > 0) || !(mapConfig.height > 0)) {
            return "config.json's \"map\" block needs a positive \"width\" and \"height\"";
        }
        return null;
    }

    // Losing the map is the whole desktop location panel gone, with the region
    // list still hidden behind it — so this goes on the page rather than the
    // console, like dataLoader.js's failures. Styled by the same rule in
    // css/style.css.
    function showMapFailure(detail) {
        const main = document.querySelector("main");
        if (!main || document.getElementById("tracker-map-warning")) return;

        const note = document.createElement("div");
        note.id = "tracker-map-warning";

        const lead = document.createElement("span");
        lead.textContent =
            "The map could not be built, so the desktop location view is missing. " +
            "The item tracker still works, and the region list is still there below " +
            "the mobile breakpoint. ";
        note.appendChild(lead);

        const why = document.createElement("span");
        why.className = "tracker-error-detail";
        why.textContent = detail;
        note.appendChild(why);

        main.insertBefore(note, main.firstChild);
    }

    // ---------- Init ----------

    let markerConfigs = [];

    window.TrackerData.onReady(({ config, regions }) => {
      // Anything thrown in here lands before locationMapReady is dispatched, so
      // the container, the markers and every listener below would be lost
      // together — off one bad key in config.json.
      try {
        const problem = mapConfigProblem(config.map);
        if (problem) throw new Error(problem);

        createMapContainer(config.map);
        buildRegionLookup();

        // Its own try/catch, so a diagnostic can't be the thing that stops the
        // markers. After buildRegionLookup(), which tells it what rendered.
        try {
            validateMarkerCoordinates(regions);
        } catch (error) {
            console.error("locationMap: could not validate the marker coordinates", error);
        }

        // Handed over as soon as the container exists, not after the markers are
        // built. The aspect ratio rides along so locationPanelLayout.js needs no
        // data of its own.
        window.dispatchEvent(new CustomEvent("locationMapReady", {
            detail: {
                mapContainer: mapContainerEl,
                aspectRatio: config.map.width / config.map.height
            }
        }));

        markerConfigs = regionMarkerConfigs(regions);
        createMarkers(markerConfigs);
        setupCoordinateFinder();

        // An announcement rather than a watcher, because it has to reach the open
        // region too — and that node has been moved out into the overlay, where a
        // watcher on the container could not see it.
        window.addEventListener("regionStatusChanged", (event) => {
            const { regionName, status, accessible } = event.detail;
            applyMarkerStatus(markerEls.get(regionName), status, accessible);

            if (overlayEl && currentOverlayRegion === regionName) {
                const countEl = overlayEl.querySelector(".location-map-overlay-count");
                const entry = regionLookup.get(regionName);
                if (countEl && entry) countEl.textContent = entry.headerBtn.dataset.counts || "";
            }
        });

        // locationTracker.js is loaded first, so this has normally already fired
        // by now; the listener covers it ever stopping being true.
        window.addEventListener("regionsRendered", () => {
            buildRegionLookup();
            // Rebuilt rather than recolored — a marker only exists for a region
            // with an accordion, so a late one would otherwise never get one.
            createMarkers(markerConfigs);
        });

        // An open overlay was measured against the map's old size, so it has to be
        // fitted again. Three triggers:
        //   - locationMapResized, once locationPanelLayout.js has written the new
        //     size. Listening for that rather than racing it on "resize" makes
        //     this correct whichever file registered first, and it is the only
        //     signal when the ResizeObserver resizes the map with no window resize.
        //   - resize, because the height budget reads the viewport: a height-only
        //     change moves the budget while the map stays put, so nothing would be
        //     announced.
        //   - trackerViewChanged, because hiding non-randomized checks changes how
        //     many rows the open region has to fit.
        // Not scroll — the budget is in document coordinates so it can't move with
        // the page, and refitting mid-scroll would resize text under the reader.
        // The guard collapses triggers that coincide into one refit.
        let refitScheduled = false;
        function scheduleRefit() {
            if (refitScheduled) return;
            refitScheduled = true;
            let ran = false;
            const run = () => {
                if (ran) return;
                ran = true;
                refitScheduled = false;
                if (!overlayEl) return;
                const contentDiv = overlayEl.querySelector(".region-content");
                if (contentDiv) fitOverlayContent(overlayEl, contentDiv);
            };
            requestAnimationFrame(run);
            setTimeout(run, 250);
        }
        window.addEventListener("resize", scheduleRefit);
        window.addEventListener("locationMapResized", scheduleRefit);
        window.addEventListener("trackerViewChanged", scheduleRefit);

        const mql = window.matchMedia(MOBILE_BREAKPOINT);
        const onBreakpointChange = () => {
            if (mql.matches) closeOverlay(); // hand the region back to the mobile list
        };
        mql.addEventListener("change", onBreakpointChange);
      } catch (error) {
        // No locationMapReady on this path, on purpose — a half-built container is
        // worse than none, and locationPanelLayout.js already handles none.
        console.error("locationMap: could not build the map", error);
        showMapFailure((error && error.message) || String(error));
      }
    });
})();
