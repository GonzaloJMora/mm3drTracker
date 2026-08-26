document.addEventListener("DOMContentLoaded", async () => {
    const itemContainer = document.getElementById("item-grid");
    const maskContainer = document.getElementById("mask-grid");
    const dungeonContainer = document.getElementById("dungeon-grid");
    const gearContainer = document.getElementById("gear-grid");

    try {
        // Fetch config and items in parallel
        const [configRes, itemsRes] = await Promise.all([
            fetch("data/config.json").then(res => res.json()),
            fetch("data/Items.json").then(res => res.json())
        ]);

        const itemMap = {};
        itemsRes.forEach(item => itemMap[item.id] = item.image);

        // Render grids using JSON data
        renderGrid(itemContainer, configRes.grids.item, itemMap, configRes.progressions);
        renderGrid(maskContainer, configRes.grids.mask, itemMap, configRes.progressions);
        renderGrid(dungeonContainer, configRes.grids.dungeon, itemMap, configRes.progressions);
        renderGrid(gearContainer, configRes.grids.gear, itemMap, configRes.progressions);

    } catch (error) {
        console.error("Error loading application config or items:", error);
    }
});

function renderGrid(container, gridOrder, itemMap, progressions) {
    container.innerHTML = ""; // Clear container

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

        const img = document.createElement("img");
        img.classList.add("item-image");
        img.draggable = false;
        slot.classList.add("dimmed");

        const isProgressive = progressions.hasOwnProperty(slotId);
        const itemChain = progressions[slotId] || [];
        
        if (isProgressive) {
            slot.dataset.stage = "-1";
            img.src = itemMap[itemChain[0]];
            slot.title = formatTooltip(itemChain[0]);
        } else {
            img.src = itemMap[slotId];
            slot.title = formatTooltip(slotId);
        }

        slot.appendChild(img);
        container.appendChild(slot);

        slot.addEventListener("click", (e) => {
            e.preventDefault();
            handleItemClick(slot, img, isProgressive, itemChain, itemMap, 1);
        });

        slot.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            handleItemClick(slot, img, isProgressive, itemChain, itemMap, -1);
        });
    });
}

function handleItemClick(slot, imgElement, isProgressive, chain, itemMap, direction) {
    if (!isProgressive) {
        slot.classList.toggle("dimmed");
        return;
    }
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
}

function formatTooltip(id) {
    return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
