document.addEventListener("DOMContentLoaded", async () => {
    const regionContainer = document.getElementById("region-dropdown-container");

    let CHECK_GROUPS = [];

    try {
        const [configRes] = await Promise.all([
            fetch("data/config.json").then(res => res.json())
        ]);

        CHECK_GROUPS = configRes.check_groups;

    } catch (error) {
        console.error("Error loading application config:", error);
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

function renderRegionDropdown(regionData, container, CHECK_GROUPS) {
    const groupDiv = document.createElement("div");
    groupDiv.classList.add("region-group");

    const headerBtn = document.createElement("button");
    headerBtn.classList.add("region-header");
    headerBtn.innerHTML = `<span>${regionData.region_name}</span> <span>▼</span>`;

    const contentDiv = document.createElement("div");
    contentDiv.classList.add("region-content");

    const itemDivs = [];

    regionData.item_checks.forEach(check => {
        const itemDiv = document.createElement("div");
        itemDiv.classList.add("region-check-item");
        itemDiv.dataset.checkId = check.id;
        itemDiv.textContent = check.name;

        // TODO: REMOVE TESTING CODE ONCE LOCATION COLORING BASED OFF OBTAINED ITEMS
        const testList = ["inaccessible", "accessible", "vanilla"];
        itemDiv.classList.add(testList[Math.floor(Math.random() * testList.length)]);

        itemDiv.addEventListener("click", () => {
            const isCompleted = itemDiv.classList.toggle("completed");
            const currentId = itemDiv.dataset.checkId;

            // Sync equivalent checks (example: the three Clock Town Postbox checks count as the same check)
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

            // Update headers for all regions affected (or recalculate this one)
            determineRegionLocationAccessibility(headerBtn, itemDivs);
        });

        contentDiv.appendChild(itemDiv);
        itemDivs.push(itemDiv);
    });

    headerBtn.addEventListener("click", () => {
        contentDiv.classList.toggle("open");
        const arrow = headerBtn.querySelector("span:last-child");
        arrow.textContent = contentDiv.classList.contains("open") ? "▲" : "▼";
    });

    groupDiv.appendChild(headerBtn);
    groupDiv.appendChild(contentDiv);
    container.appendChild(groupDiv);

    determineRegionLocationAccessibility(headerBtn, itemDivs);
}

function determineRegionLocationAccessibility(headerBtn, itemDivs) {
    let hasRed = false;
    let hasGreen = false;
    let hasPurple = false;

    itemDivs.forEach(check => {
        if (!check.classList.contains("completed")) {
            if (check.classList.contains("inaccessible")) {
                hasRed = true;
            }
            if (check.classList.contains("accessible")) {
                hasGreen = true;
            }
            if (check.classList.contains("vanilla")) {
                hasPurple = true;
            }
        }
    });

    headerBtn.classList.remove("inaccessible", "partialCompletion", "fullClear", "vanilla", "completed");

    if (hasRed && hasGreen) {
        headerBtn.classList.add("partialCompletion");
    }
    else if (hasRed) {
        headerBtn.classList.add("inaccessible");
    }
    else if (hasGreen) {
        headerBtn.classList.add("fullClear");
    }
    else if (hasPurple) {
        headerBtn.classList.add("vanilla");
    }
    else {
        headerBtn.classList.add("completed");
    }
}