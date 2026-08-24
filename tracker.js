document.addEventListener("DOMContentLoaded", async () => {
    const itemContainer = document.getElementById("item-grid");
    const maskContainer = document.getElementById("mask-grid");
    const dungeonContainer = document.getElementById("dungeon-grid");
    const gearContainer = document.getElementById("gear-grid");
    const regionContainer = document.getElementById("region-dropdown-container");

    let CHECK_GROUPS = [];

    try {
        // Fetch config and items in parallel
        const [configRes, itemsRes] = await Promise.all([
            fetch("data/config.json").then(res => res.json()),
            fetch("data/Items.json").then(res => res.json())
        ]);

        CHECK_GROUPS = configRes.check_groups;

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

    // Load region manifest and region files
    fetch("data/manifest.json")
        .then(response => response.json())
        .then(fileNames => {
            const validFiles = fileNames.filter(file => file !== "Items.json");

            validFiles.forEach(fileName => {
                fetch(`data/${fileName}`)
                    .then(res => res.json())
                    .then(regionData => {
                        renderRegionDropdown(regionData, regionContainer, CHECK_GROUPS);
                    })
                    .catch(err => console.error(`Error loading region file ${fileName}:`, err));
            });
        })
        .catch(error => console.error("Error loading region manifest:", error));
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

function renderRegionDropdown(regionData, container, CHECK_GROUPS) {
    const groupDiv = document.createElement("div");
    groupDiv.classList.add("region-group");

    const headerBtn = document.createElement("button");
    headerBtn.classList.add("region-header");
    headerBtn.innerHTML = `<span>${regionData.region_name}</span> <span>▼</span>`;

    const contentDiv = document.createElement("div");
    contentDiv.classList.add("region-content");

    regionData.item_checks.forEach(check => {
        // Created as a clickable div item instead of a checkbox/label
        const itemDiv = document.createElement("div");
        itemDiv.classList.add("region-check-item");
        itemDiv.dataset.checkId = check.id;
        itemDiv.textContent = check.name;

        // --- CLICK TOGGLE & SYNC LOGIC ---
        itemDiv.addEventListener("click", () => {
            const isCompleted = itemDiv.classList.toggle("completed");
            const currentId = itemDiv.dataset.checkId;

            // Find any group this check belongs to and sync across the page
            CHECK_GROUPS.forEach(group => {
                if (group.includes(currentId)) {
                    group.forEach(linkedId => {
                        const matchingElements = document.querySelectorAll(`div.region-check-item[data-check-id="${linkedId}"]`);
                        matchingElements.forEach(el => {
                            if (isCompleted) {
                                el.classList.add("completed");
                            } else {
                                el.classList.remove("completed");
                            }
                        });
                    });
                }
            });
        });

        contentDiv.appendChild(itemDiv);
    });

    headerBtn.addEventListener("click", () => {
        contentDiv.classList.toggle("open");
        const arrow = headerBtn.querySelector("span:last-child");
        arrow.textContent = contentDiv.classList.contains("open") ? "▲" : "▼";
    });

    groupDiv.appendChild(headerBtn);
    groupDiv.appendChild(contentDiv);
    container.appendChild(groupDiv);
}