// Held at module scope so handleItemClick can read config values without
// threading them through renderGrid's already-long parameter list.
let trackerConfig = null;

window.TrackerData.onReady(({ config, items }) => {
    trackerConfig = config;
    const gridContainer = document.querySelector(".grid-container");

    try {
        const itemMap = {};
        items.forEach(item => {
            itemMap[item.id] = {
                image: item.image,
                name: item.name,
                notes_image: item.notes_image ?? ""
            };
        });

        // Before anything is drawn, so the diagnosis lands ahead of its symptom.
        // Guarded because it runs before GameState.init — a throw here would leave
        // the item state empty and make every logic token look unknown.
        try {
            validateGridSlots(config, itemMap);
        } catch (error) {
            console.error("itemTracker: could not validate the grid slots", error);
        }

        // Not awaited: init() does no I/O. It must not swallow its own errors
        // either, or the catch below can never see one.
        window.GameState.init(items, config);

        // One grid per key in config.grids, in the order they appear there —
        // adding or reordering a grid is a config.json edit, nothing else.
        gridContainer.innerHTML = "";
        Object.keys(config.grids).forEach(gridName => {
            // validateGridSlots() has already named this one; skipping keeps the
            // grids after it in config.grids order from going down with it.
            if (!Array.isArray(config.grids[gridName])) return;

            const gridEl = document.createElement("div");
            gridEl.className = "item-grid";
            gridEl.dataset.grid = gridName;
            gridContainer.appendChild(gridEl);
            renderGrid(gridEl, config.grids[gridName], itemMap, config.progressions, config.item_counts);
        });

    } catch (error) {
        console.error("Error rendering item grids:", error);
    } finally {
        // Says the grids are populated, not just that the data arrived —
        // locationPanelLayout.js sizes the map against their real height.
        //
        // In the finally on purpose: if anything above threw, the grids are short
        // and the map still has to re-measure, or it sizes itself against a
        // half-built grid and looks plausible while being wrong.
        window.dispatchEvent(new CustomEvent("itemGridsReady"));
        announceWhenImagesSettle();
    }
});

// The grids existing is not the same as the grids being their final size. Until
// the slot images load, .grid-container measures about 40% of its real height,
// and anything sizing against it locks that in.
//
// MIN_SANE_PX cannot catch it — the intermediate height is perfectly plausible,
// and that guard is there for zero. window.load does not cover it either: on a
// warm cache it fires before trackerDataReady, so it runs before these grids
// exist and is spent. That leaves only the ResizeObserver, which is frozen for a
// window that is not being painted — the case this codebase keeps designing
// around.
//
// So say it again once the images settle. It belongs here because these are this
// file's images; the alternative is the layout file reaching across to watch
// them. The listener is idempotent, so this costs nothing when the first
// announcement was already right.
function announceWhenImagesSettle() {
    const pending = Array.from(document.querySelectorAll(".item-image"))
        .filter(img => !img.complete);
    if (!pending.length) return;

    let outstanding = pending.length;
    const settled = () => {
        if (--outstanding > 0) return;
        window.dispatchEvent(new CustomEvent("itemGridsReady"));
    };

    // error as well as load: a slot whose image 404s still settles the layout,
    // and waiting on it forever would mean never re-announcing.
    pending.forEach(img => {
        img.addEventListener("load", settled, { once: true });
        img.addEventListener("error", settled, { once: true });
    });
}

function renderGrid(container, gridOrder, itemMap, progressions, item_counts) {
    container.innerHTML = "";

    gridOrder.forEach(slotId => {
        const slot = document.createElement("div");
        slot.classList.add("item-slot");
        slot.dataset.id = slotId;

        if (typeof slotId !== "string" || slotId === "") {
            slot.classList.add("empty-slot");
            container.appendChild(slot);
            return;
        }

        const isProgressive = progressions.hasOwnProperty(slotId);
        const hasItemCount = item_counts.hasOwnProperty(slotId);
        let itemChain = progressions[slotId] || [];

        const isBombersCodeDigit = slotId.startsWith("bombers_code_digit_");

        // An item not in Items.json would throw on the lookup below and take out
        // this grid and every one after it. Draw a hole instead — the cell still
        // occupies its column, and validateGridSlots() already named the id.
        const imageId = isProgressive ? itemChain[0] : slotId;
        if (!isBombersCodeDigit && !itemMap[imageId]) {
            slot.classList.add("empty-slot");
            container.appendChild(slot);
            return;
        }

        let img = null;
        if (!isBombersCodeDigit) {
            img = document.createElement("img");
            img.classList.add("item-image");
            img.draggable = false;
            slot.classList.add("dimmed");

            if (isProgressive) {
                slot.dataset.stage = "-1";
                img.src = itemMap[itemChain[0]].image;
                slot.title = itemMap[itemChain[0]].name;
            } else {
                img.src = itemMap[slotId].image;
                slot.title = itemMap[slotId].name;
            }

            slot.appendChild(img);
        } else {
            slot.classList.add("bombers-code-slot");
            slot.dataset.count = "0";
            slot.title = "Bomber's Code Digit " + slotId.at(-1);
        }

        const counterNode = document.createElement("div");
        counterNode.classList.add("slot-counter");
        
        if (isBombersCodeDigit) {
            counterNode.innerText = "0";
        }

        slot.appendChild(counterNode);

        if (hasItemCount && !isBombersCodeDigit) {
            itemChain = item_counts[slotId];
            if (Number.isInteger(itemChain)) {
                slot.dataset.count = "0";
            } else if (Array.isArray(itemChain)) {
                slot.dataset.stage = "-1";
            }
        }

        container.appendChild(slot);

        slot.addEventListener("click", (e) => {
            e.preventDefault();
            handleItemClick(slot, img, counterNode, isProgressive, hasItemCount, itemChain, itemMap, 1);
        });

        slot.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            handleItemClick(slot, img, counterNode, isProgressive, hasItemCount, itemChain, itemMap, -1);
        });
    });
}

// A bad slot draws as an empty one rather than taking the grid down, but a hole
// with no explanation is its own puzzle — so say what is wrong, once, at load.
//
// Progression chains are walked in full on purpose: renderGrid only draws
// chain[0], so a typo in a later stage renders fine and then throws inside a
// click handler, where the slot just stops advancing with no clue why.
function validateGridSlots(config, itemMap) {
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
        `itemTracker: ${missing.length} grid slot(s) will not draw an item. ` +
        `Each one renders as an empty slot instead.`
    );
    missing.forEach(({ id, where }) => console.warn(`  "${id}" — ${where}`));
}

function handleItemClick(slot, imgElement, counterNode, isProgressive, hasItemCount, chain, itemMap, direction) {
    const slotId = slot.dataset.id;
    const isBombersCodeDigit = slotId.startsWith("bombers_code_digit_");

    counterNode.classList.remove("max-count");
    if (!isBombersCodeDigit) {
        counterNode.innerText = "";
    }

    if (isBombersCodeDigit) {
        let currentCount = parseInt(slot.dataset.count);
        const maxCount = trackerConfig.bombers_code.max_digit_value;

        if (direction === 1) {
            if (currentCount === maxCount) currentCount = 0;
            else currentCount++;
        } else if (direction === -1) {
            if (currentCount === 0) currentCount = maxCount;
            else currentCount--;
        }

        slot.dataset.count = currentCount;
        counterNode.innerText = currentCount;

        window.GameState.updateItemState(slotId, null, currentCount);
    }
    else if (isProgressive) {
        let currentStage = parseInt(slot.dataset.stage);
        const maxStages = chain.length;
        currentStage += direction;

        if (currentStage >= maxStages) currentStage = -1;
        else if (currentStage < -1) currentStage = maxStages - 1;

        slot.dataset.stage = currentStage;

        if (currentStage === -1) {
            slot.classList.add("dimmed");
            imgElement.src = itemMap[chain[0]].image;
            slot.title = itemMap[chain[0]].name;
        } else {
            slot.classList.remove("dimmed");
            const activeItemId = chain[currentStage];
            // Only chain[0] is guaranteed to exist, since that is the stage
            // renderGrid draws. Advance anyway and keep the previous artwork,
            // rather than throwing inside a click handler.
            if (itemMap[activeItemId]) {
                imgElement.src = itemMap[activeItemId].image;
                slot.title = itemMap[activeItemId].name;
            }
        }

        window.GameState.updateItemState(slotId, currentStage, null);
    }
    else if (hasItemCount) {
        if (Number.isInteger(chain)) {
            let currentCount = parseInt(slot.dataset.count);
            const maxCount = chain;

            if (direction === 1) {
                if (currentCount === maxCount) currentCount = 0;
                else currentCount++;
            } else if (direction === -1) {
                if (currentCount === 0) currentCount = maxCount;
                else currentCount--;
            }

            slot.dataset.count = currentCount;

            if (currentCount === 0) {
                slot.classList.add("dimmed");
            } else {
                slot.classList.remove("dimmed");
                counterNode.innerText = currentCount;
                if (currentCount === maxCount) {
                    counterNode.classList.add("max-count");
                }
            }

            window.GameState.updateItemState(slotId, null, currentCount);
        }
        else if (Array.isArray(chain)) {
            let currentStage = parseInt(slot.dataset.stage);
            const maxStages = chain.length;
            currentStage += direction;

            if (currentStage >= maxStages) currentStage = -1;
            else if (currentStage < -1) currentStage = maxStages - 1;

            slot.dataset.stage = currentStage;

            if (currentStage === -1) {
                slot.classList.add("dimmed");
            } else {
                slot.classList.remove("dimmed");
                counterNode.innerText = chain[currentStage];
                if (currentStage === maxStages - 1) {
                    counterNode.classList.add("max-count");
                }
            }

            window.GameState.updateItemState(slotId, currentStage, null);
        }
    }
    else {
        slot.classList.toggle("dimmed");
        const isDimmed = slot.classList.contains("dimmed");
        
        window.GameState.updateItemState(slotId, isDimmed ? -1 : 0, null);
    }
}
