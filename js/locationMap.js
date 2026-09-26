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

    // Percent of the map, so anything outside 0 to 100 lands off it. A marker
    // without both would be drawn at the map's top-left corner, looking placed.
    function hasUsableCoordinates(data) {
        const at = data.map_coordinates;
        const percent = value => typeof value === "number" && value >= 0 && value <= 100;
        return Boolean(at) && percent(at.xPercent) && percent(at.yPercent);
    }

    // A region with no usable map_coordinates gets no marker; the validator below
    // says so.
    function regionMarkerConfigs(regions) {
        return regions
            .filter(data => data && hasUsableCoordinates(data))
            .map(data => ({
                regionName: data.region_name,
                xPercent: data.map_coordinates.xPercent,
                yPercent: data.map_coordinates.yPercent
            }));
    }

    // Every region belongs on the map, so a missing or unusable map_coordinates is
    // always a mistake — and a silent one: the region still renders and still counts, but
    // with no marker and a display:none list, its checks can't be reached at all.
    //
    // Only regions that rendered are reported. One locationTracker.js already
    // rejected has been named there, and repeating it buries the line that
    // matters.
    function validateMarkerCoordinates(regions) {
        const missing = regions
            .filter(data => data && regionLookup.has(data.region_name) && !hasUsableCoordinates(data))
            .map(data => data.region_name);

        if (!missing.length) return;

        console.warn(
            `locationMap: ${missing.length} region(s) have no map_coordinates with an xPercent and yPercent ` +
            `from 0 to 100, so they get no marker. ` +
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
            // The hover tooltip is drawn by tooltip.js (registerMarkerTooltip);
            // aria-label is the accessible name, or a screen reader reads this as
            // just "button".
            marker.setAttribute("aria-label", regionName);
            // Not data-region-name — that means "a region's accordion", and the
            // map comes first in the DOM, so an unscoped query would find a
            // marker instead. Nothing reads this; it is for devtools.
            marker.dataset.markerRegion = regionName;

            marker.addEventListener("click", (e) => {
                if (e.shiftKey) return; // coordinate finder handles this instead
                // The overlay opens over the marker, which the pointer never
                // leaves, so the tooltip would stay up on top of it.
                if (window.Tooltip) window.Tooltip.hide();
                openOverlayFor(regionName);
            });

            markerLayerEl.appendChild(marker);
            markerEls.set(regionName, marker);
        });

        syncMarkerColors();
    }

    // The region's name and its live count. tooltip.js redraws an open tooltip when
    // the checks change, so the count is never stale. Registered once, and
    // delegated from document, so it survives the markers being rebuilt.
    function registerMarkerTooltip() {
        if (!window.Tooltip) return;
        window.Tooltip.register(".location-map-marker", (marker) => {
            const regionName = marker.dataset.markerRegion;
            const entry = regionLookup.get(regionName);
            if (!entry) return null;

            const box = document.createElement("div");
            box.className = "tooltip-heading";
            box.textContent = regionName;
            const counts = entry.headerBtn.dataset.counts;
            if (counts) {
                const count = document.createElement("span");
                count.className = "marker-tooltip-count";
                count.textContent = counts;
                box.appendChild(count);
            }
            return box;
        });
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

    // Where the overlay hangs from and the least it must cover, in document
    // coordinates so the scroll position can't change the size.
    function overlayBox() {
        const mapRect = mapContainerEl.getBoundingClientRect();
        const columnRect = mapContainerEl.parentElement.getBoundingClientRect();
        return {
            // How far the map sits below the column's top.
            lift: Math.max(0, mapRect.top - columnRect.top),
            // The overlay always covers at least the column and the map.
            floor: Math.max(mapRect.height, columnRect.height) + OVERLAY_BORDER * 2,
            top: columnRect.top + window.scrollY - OVERLAY_BORDER
        };
    }

    // How tall the overlay may get: a windowful measured down from the top of the
    // location column, which on its own keeps the overlay from ever making the page
    // scroll. clientHeight, because it is what scrollHeight is compared against.
    // Don't add the item grids' bottom edge as a second ceiling: it looks like what
    // holds the scrollbar off and isn't, and only costs text size. ARCHITECTURE.md,
    // *Fitting a region into the map overlay*.
    function overlayHeightBudget(box) {
        // Before layout settles this reads short or negative. Falling back to the
        // covered height costs text size, never a broken box.
        const available = document.documentElement.clientHeight - VIEWPORT_MARGIN - box.top;
        return available > box.floor ? available : box.floor;
    }

    // The ladder's sizes are for a map of map_overlay.base_map_width; on a bigger
    // one everything in the overlay grows with it, so the room is used.
    function overlayScale() {
        const base = (window.TrackerData.config.map_overlay || {}).base_map_width;
        if (!(base > 0)) return 1;
        const width = mapContainerEl.getBoundingClientRect().width;
        return Math.max(1, Math.round((width / base) * 100) / 100);
    }

    // config/map.json's text size ladder, read once. A rung whose values aren't
    // valid CSS would be dropped by the browser without a word, and would still
    // "fit", stopping the ladder there, so it's skipped and named instead. Each
    // value is tested the way applyTextSize() uses it, inside calc(): "0" and
    // "small" are valid alone and invalid there. With no rung left, the overlay is
    // fitted at the stylesheet's text size.
    let overlayTextSizes = [];

    const scaledBy = (value, scale) => `calc(${value} * ${scale})`;

    // A padding's parts, split on spaces outside parentheses, so a calc() with
    // spaces in it stays one part.
    function paddingParts(value) {
        const parts = [];
        let depth = 0;
        let part = "";
        for (const char of value.trim()) {
            if (char === "(") depth++;
            if (char === ")") depth--;
            if (/\s/.test(char) && depth === 0) {
                if (part) parts.push(part);
                part = "";
            } else {
                part += char;
            }
        }
        if (part) parts.push(part);
        return parts;
    }

    function readTextSizes(mapOverlay) {
        const sizes = mapOverlay && mapOverlay.text_sizes;
        if (!Array.isArray(sizes)) {
            console.warn(`locationMap: config/map.json has no "text_sizes" list, so the overlay keeps the stylesheet's text size.`);
            return [];
        }
        const text = value => typeof value === "string" && value.trim() !== "";
        const validFont = value => text(value) && CSS.supports("font-size", scaledBy(value, 1));
        const validPadding = value => {
            if (!text(value)) return false;
            const parts = paddingParts(value);
            return parts.length <= 4 && parts.every(part => CSS.supports("padding", scaledBy(part, 1)));
        };
        const bad = [];
        const usable = sizes.filter((size, index) => {
            if (size && validFont(size.font_size) && validPadding(size.padding)) return true;
            bad.push(index);
            return false;
        });
        if (bad.length) {
            console.warn(
                `locationMap: text_sizes ${bad.map(index => `[${index}]`).join(", ")} in config/map.json ` +
                `need a valid "font_size" and "padding", and are skipped.`
            );
        }
        if (!usable.length) {
            console.warn(`locationMap: config/map.json's "text_sizes" has no usable size, so the overlay keeps the stylesheet's text size.`);
        }
        return usable;
    }

    // A null size leaves the stylesheet's own.
    function applyTextSize(contentDiv, size) {
        if (!size) {
            contentDiv.style.removeProperty("--overlay-check-font");
            contentDiv.style.removeProperty("--overlay-check-padding");
            return;
        }
        const scaled = value => scaledBy(value, "var(--overlay-scale, 1)");
        contentDiv.style.setProperty("--overlay-check-font", scaled(size.font_size));
        contentDiv.style.setProperty("--overlay-check-padding", paddingParts(size.padding).map(scaled).join(" "));
    }

    function clearOverlayBox(overlay) {
        overlay.style.top = "";
        overlay.style.bottom = "";
        overlay.style.height = "";
    }

    // Walks config/map.json's map_overlay.text_sizes largest-first and stops at the
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
            clearOverlayBox(overlay);
            return;
        }

        // Without a ladder the fit still runs, once, so a region too big for the
        // box scrolls rather than being cut off.
        const sizes = overlayTextSizes.length ? overlayTextSizes : [null];

        const box = overlayBox();
        const budget = overlayHeightBudget(box);
        overlay.style.setProperty("--overlay-scale", String(overlayScale()));
        overlay.style.top = `${-(box.lift + OVERLAY_BORDER)}px`;
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
                clearOverlayBox(overlay);
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
        overlay.style.height = `${Math.max(box.floor, budget - unused)}px`;
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

        // The panel sizing uses the dimensions from config/map.json so it can run
        // immediately instead of waiting on the full-size image. Once the image is
        // actually here, confirm the two agree — if they ever drift apart the
        // markers creep off position, which is a miserable bug to track down.
        img.addEventListener("load", () => {
            if (img.naturalWidth !== mapConfig.width || img.naturalHeight !== mapConfig.height) {
                console.warn(
                    `locationMap: config/map.json says the map is ${mapConfig.width}x${mapConfig.height} ` +
                    `but ${mapConfig.image} is ${img.naturalWidth}x${img.naturalHeight}. ` +
                    `Update config/map.json or every marker will drift.`
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
        if (!mapConfig) return "config/map.json has no \"map\" block";
        if (!mapConfig.image) return "config/map.json's \"map\" block has no \"image\" path";
        if (!(mapConfig.width > 0) || !(mapConfig.height > 0)) {
            return "config/map.json's \"map\" block needs a positive \"width\" and \"height\"";
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
      // together — off one bad key in config/map.json.
      try {
        const problem = mapConfigProblem(config.map);
        if (problem) throw new Error(problem);

        createMapContainer(config.map);
        buildRegionLookup();
        overlayTextSizes = readTextSizes(config.map_overlay);

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
        registerMarkerTooltip();

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
