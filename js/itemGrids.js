// The item grids: one .item-grid per key in config.grids, in config order, every
// slot drawn from GameState. The tracker and the settings page both draw them here
// and each adds its own clicks, so the settings page shows exactly the grids the
// tracker opens with.
(function () {
    "use strict";

    function itemMapOf(items) {
        const itemMap = {};
        items.forEach(item => {
            itemMap[item.id] = {
                image: item.image,
                name: item.name,
                notes_image: item.notes_image ?? ""
            };
        });
        return itemMap;
    }

    // The slot's hover text and, for songs, the notes image that goes with it.
    // A progressive slot changes identity as it is cycled, so draw() calls this
    // on every change rather than only at render.
    //
    // aria-label rather than title: title would draw the browser's own tooltip on
    // top of ours, a second later and in a different place.
    function setSlotTooltip(slot, item, showNotes) {
        slot.dataset.tooltipName = item.name;
        slot.setAttribute("aria-label", item.name);

        if (showNotes && item.notes_image) {
            slot.dataset.tooltipImage = item.notes_image;
        } else {
            delete slot.dataset.tooltipImage;
        }
    }

    // Draws every grid into container and returns a view per drawable slot, keyed
    // by slot id, for the caller to attach clicks to and redraw through draw().
    // GameState has to be initialized first: each slot starts at its value there.
    // options.notes false leaves the song notes out of the slot tooltips.
    function render(container, config, itemMap, options = {}) {
        const showNotes = options.notes !== false;
        container.innerHTML = "";
        const views = new Map();

        Object.keys(config.grids).forEach(gridName => {
            // validate() has already named this one; skipping keeps the grids after
            // it in config.grids order from going down with it.
            if (!Array.isArray(config.grids[gridName])) return;

            const gridEl = document.createElement("div");
            gridEl.className = "item-grid";
            gridEl.dataset.grid = gridName;
            container.appendChild(gridEl);

            config.grids[gridName].forEach(slotId => {
                const view = renderSlot(gridEl, slotId, config, itemMap, showNotes);
                if (view) views.set(slotId, view);
            });
        });

        return views;
    }

    function renderSlot(container, slotId, config, itemMap, showNotes) {
        const slot = document.createElement("div");
        slot.classList.add("item-slot");
        slot.dataset.id = slotId;
        container.appendChild(slot);

        if (typeof slotId !== "string" || slotId === "") {
            slot.classList.add("empty-slot");
            return null;
        }

        const kind = window.GameState.slotKind(config, slotId);
        const chain = kind === "progression" ? config.progressions[slotId] : null;

        // An item not in Items.json would throw on the lookup below and take out
        // this grid and every one after it. Draw a hole instead — the cell still
        // occupies its column, and validate() already named the id.
        const imageId = chain ? chain[0] : slotId;
        if (kind !== "digit" && !itemMap[imageId]) {
            slot.classList.add("empty-slot");
            return null;
        }

        let img = null;
        if (kind === "digit") {
            slot.classList.add("bombers-code-slot");
            setSlotTooltip(slot, { name: "Bomber's Code Digit " + slotId.at(-1) }, showNotes);
        } else {
            img = document.createElement("img");
            img.classList.add("item-image");
            img.draggable = false;
            slot.classList.add("dimmed");
            img.src = itemMap[imageId].image;
            setSlotTooltip(slot, itemMap[imageId], showNotes);
            slot.appendChild(img);
        }

        const counterNode = document.createElement("div");
        counterNode.classList.add("slot-counter");
        slot.appendChild(counterNode);

        const view = {
            slot, img, counterNode, kind, chain, itemMap, showNotes,
            sizes: kind === "capacity" ? config.item_counts[slotId] : null,
            max: kind === "counter" ? config.item_counts[slotId] : null
        };
        draw(view, window.GameState.slotValue(slotId));
        return view;
    }

    // Left-click moves up and right-click down, wrapping at both ends. The bottom
    // is a starting item's floor when it has one, so wrapping never lands below it.
    function nextValue(value, direction, bottom, top) {
        const next = value + direction;
        if (next > top) return bottom;
        if (next < bottom) return top;
        return next;
    }

    // Draws a slot at a value: a progression's stage artwork and name, the number
    // for anything counted, and faded when it is not owned.
    function draw(view, value) {
        const { slot, img, counterNode, kind, chain, itemMap } = view;
        counterNode.classList.remove("max-count");

        if (kind === "digit") {
            slot.dataset.count = value;
            counterNode.innerText = value;
            return;
        }

        const owned = kind === "counter" ? value > 0 : value >= 0;
        slot.classList.toggle("dimmed", !owned);
        counterNode.innerText = "";

        if (kind === "progression") {
            slot.dataset.stage = value;
            // Only chain[0] is sure to have artwork. A later stage without any keeps
            // what is already drawn, and validate() has named it.
            const item = itemMap[chain[Math.max(value, 0)]];
            if (item) {
                if (img.getAttribute("src") !== item.image) img.src = item.image;
                setSlotTooltip(slot, item, view.showNotes);
            }
        } else if (kind === "capacity") {
            slot.dataset.stage = value;
            if (owned) {
                counterNode.innerText = view.sizes[value];
                if (value === view.sizes.length - 1) counterNode.classList.add("max-count");
            }
        } else if (kind === "counter") {
            slot.dataset.count = value;
            if (owned) {
                counterNode.innerText = value;
                if (value === view.max) counterNode.classList.add("max-count");
            }
        }
    }

    // A bad slot draws as an empty one rather than taking the grid down, but a hole
    // with no explanation is its own puzzle — so say what is wrong, once, at load.
    //
    // Progression chains are walked in full on purpose: a typo in a later stage
    // draws fine at load and only shows once the slot is clicked up to it, as a
    // stage that keeps the previous stage's artwork.
    function validate(config, itemMap) {
        const missing = [];

        Object.keys(config.grids).forEach(gridName => {
            const slots = config.grids[gridName];

            if (!Array.isArray(slots)) {
                missing.push({ id: gridName, where: `grids.${gridName} is not a list of slot ids — the whole grid is skipped` });
                return;
            }

            slots.forEach((slotId, index) => {
                if (typeof slotId !== "string") {
                    missing.push({ id: String(slotId), where: `grids.${gridName}[${index}] is not a slot id` });
                    return;
                }
                if (slotId === "") return;
                if (slotId.startsWith("bombers_code_digit_")) return;

                const at = `grids.${gridName}[${index}]`;
                const chain = config.progressions[slotId];

                if (!chain) {
                    if (!itemMap[slotId]) missing.push({ id: slotId, where: at });
                    return;
                }

                if (!chain.length) {
                    missing.push({ id: slotId, where: `${at} — progressions.${slotId} is an empty chain` });
                    return;
                }

                chain.forEach((stageId, stageIndex) => {
                    if (!itemMap[stageId]) {
                        missing.push({
                            id: stageId,
                            where: `${at} — progressions.${slotId} stage ${stageIndex + 1}`
                        });
                    }
                });
            });
        });

        if (!missing.length) return;

        console.warn(
            `ItemGrids: ${missing.length} grid slot(s) will not draw an item. ` +
            `Each one renders as an empty slot instead.`
        );
        missing.forEach(({ id, where }) => console.warn(`  "${id}" — ${where}`));
    }

    // Inside onReady so this file does not depend on tooltip.js loading first.
    // A page can add a line under the name through data-tooltip-note.
    window.TrackerData.onReady(() => {
        window.Tooltip.register(".item-slot", (slot) => {
            const name = slot.dataset.tooltipName;
            if (!name) return null;

            const fragment = document.createDocumentFragment();

            const title = document.createElement("div");
            title.className = "tooltip-title";
            title.textContent = name;
            fragment.appendChild(title);

            if (slot.dataset.tooltipNote) {
                const note = document.createElement("div");
                note.className = "tooltip-note";
                note.textContent = slot.dataset.tooltipNote;
                fragment.appendChild(note);
            }

            if (slot.dataset.tooltipImage) {
                const notes = document.createElement("img");
                // Not .item-image — itemTracker.js counts those to decide when the
                // grids have stopped growing, and the map sizes itself off it.
                notes.className = "tooltip-notes";
                notes.src = slot.dataset.tooltipImage;
                notes.alt = "";
                // The image has no height until it loads, so the first placement
                // measures a box the wrong size and can leave the notes hanging off
                // the bottom.
                notes.addEventListener("load", () => window.Tooltip.reposition(), { once: true });
                // A missing notes image drops to name-only rather than drawing the
                // browser's broken-image glyph.
                notes.addEventListener("error", () => notes.remove(), { once: true });
                fragment.appendChild(notes);
            }

            return fragment;
        });
    });

    window.ItemGrids = { itemMap: itemMapOf, render, draw, nextValue, validate };
})();
