document.addEventListener("DOMContentLoaded", async () => {
    const itemContainer = document.getElementById("item-grid");
    const maskContainer = document.getElementById("mask-grid");
    const dungeonContainer = document.getElementById("dungeon-grid");
    const gearContainer = document.getElementById("gear-grid");

    try {
        const [configRes, itemsRes] = await Promise.all([
            fetch("data/config.json").then(res => res.json()),
            fetch("data/Items.json").then(res => res.json())
        ]);

        const itemMap = {};
        itemsRes.forEach(item => itemMap[item.id] = item.image);

        await window.GameState.init(itemsRes, configRes);

        renderGrid(itemContainer, configRes.grids.item, itemMap, configRes.progressions, configRes.item_counts);
        renderGrid(maskContainer, configRes.grids.mask, itemMap, configRes.progressions, configRes.item_counts);
        renderGrid(dungeonContainer, configRes.grids.dungeon, itemMap, configRes.progressions, configRes.item_counts);
        renderGrid(gearContainer, configRes.grids.gear, itemMap, configRes.progressions, configRes.item_counts);

    } catch (error) {
        console.error("Error loading application config or items:", error);
    }
});

function renderGrid(container, gridOrder, itemMap, progressions, item_counts) {
    container.innerHTML = "";

    if (gridOrder.length === 5) {
        container.classList.add("row-5-items");
    }

    gridOrder.forEach(slotId => {
        const slot = document.createElement("div");
        slot.classList.add("item-slot");
        slot.dataset.id = slotId;

        if (slotId === "") {
            slot.classList.add("empty-slot");
            container.appendChild(slot);
            return;
        }

        const isProgressive = progressions.hasOwnProperty(slotId);
        const hasItemCount = item_counts.hasOwnProperty(slotId);
        let itemChain = progressions[slotId] || [];

        const isBombersCodeDigit = slotId.startsWith("bombers_code_digit_");

        let img = null;
        if (!isBombersCodeDigit) {
            img = document.createElement("img");
            img.classList.add("item-image");
            img.draggable = false;
            slot.classList.add("dimmed");

            if (isProgressive) {
                slot.dataset.stage = "-1";
                img.src = itemMap[itemChain[0]];
                slot.title = formatTooltip(itemChain[0]);
            } else {
                img.src = itemMap[slotId];
                slot.title = formatTooltip(slotId);
            }

            slot.appendChild(img);
        } else {
            slot.classList.add("bombers-code-slot");
            slot.dataset.count = "0";
            slot.title = formatTooltip(slotId);
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

function handleItemClick(slot, imgElement, counterNode, isProgressive, hasItemCount, chain, itemMap, direction) {
    const slotId = slot.dataset.id;
    const isBombersCodeDigit = slotId.startsWith("bombers_code_digit_");

    counterNode.classList.remove("max-count");
    if (!isBombersCodeDigit) {
        counterNode.innerText = "";
    }

    if (isBombersCodeDigit) {
        let currentCount = parseInt(slot.dataset.count);
        const maxCount = 5; // Limit defined by item_counts.bombers_code

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
            imgElement.src = itemMap[chain[0]];
            slot.title = formatTooltip(chain[0]);
        } else {
            slot.classList.remove("dimmed");
            const activeItemId = chain[currentStage];
            imgElement.src = itemMap[activeItemId];
            slot.title = formatTooltip(activeItemId);
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

function formatTooltip(id) {
    return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
