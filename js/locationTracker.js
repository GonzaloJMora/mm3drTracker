// Global memory registry to track active nodes for global real-time re-scans
const activeRegionTrackers = [];

// Reusable master execution sweep
function evaluateAllRegions(inventory, hearts, bossMasks) {
    activeRegionTrackers.forEach(region => {
        region.itemChecks.forEach(checkObj => {
            // Combine regional route requirements with individual item checks
            let finalLogic = "";
            const regionLogic = region.entryLogic ? region.entryLogic.trim() : "";
            const checkLogic = checkObj.logic ? checkObj.logic.trim() : "";

            if (regionLogic !== "" && checkLogic !== "") {
                finalLogic = `(${regionLogic}) & (${checkLogic})`;
            } else if (regionLogic !== "") {
                finalLogic = regionLogic;
            } else {
                finalLogic = checkLogic;
            }

            const isAvailable = canAccess(finalLogic, inventory, hearts, bossMasks);
            
            // Toggle visual availability styles
            checkObj.element.classList.toggle("accessible", isAvailable);
            checkObj.element.classList.toggle("inaccessible", !isAvailable);
        });

        // Trigger dynamic header coloration update functions across regions
        determineRegionLocationAccessibility(region.headerBtn, region.itemDivs);
    });
}

// Listen for updates dispatched by stateManager.js
window.addEventListener("trackerStateUpdated", (event) => {
    evaluateAllRegions(event.detail.items, event.detail.totalHearts, event.detail.totalBossMasks);
});

// Structural helper parsing logic lines dynamically without keeping state duplicates
function canAccess(logicString, inventory, hearts, bossMasks) {
    if (!logicString || logicString.trim() === "") return true;

    // Normalizing custom logic gate characters to raw native JavaScript statements
    let executableLogic = logicString
        .replace(/&/g, " && ")
        .replace(/\|/g, " || ");

    // Token extractor identifying alphanumeric sequences while omitting numerical boundary values
    const tokenRegex = /\b[a-z_][a-z0-9_]*\b/g;

    executableLogic = executableLogic.replace(tokenRegex, (match) => {
        if (match === "hearts") return hearts;
        if (match === "boss_masks") return bossMasks;

        const value = inventory[match];
        if (typeof value === "boolean") return value ? "true" : "false";
        if (typeof value === "number") return value; 
        return "false";
    });

    try {
        return Function(`"use strict"; return (${executableLogic});`)();
    } catch (error) {
        console.error(`Logic expression translation error: "${logicString}" translated into "${executableLogic}"`, error);
        return false;
    }
}

// Intercept DOM load actions to construct checking structures cleanly
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

    try {
        const response = await fetch("data/manifest.json");
        const fileNames = await response.json();
        
        // Sort the manifest file strings alphabetically before fetching the data structures
        const validSortedFiles = fileNames
            .filter(file => file !== "Items.json")
            .sort((a, b) => a.localeCompare(b));

        // Fetch the sorted files sequentially or map them out safely
        const rawRegionDataList = await Promise.all(validSortedFiles.map(async (fileName) => {
            try {
                const res = await fetch(`data/${fileName}`);
                return await res.json();
            } catch (err) {
                console.error(`Error loading region file ${fileName}:`, err);
                return null;
            }
        }));

        // Render the pre-sorted array entries smoothly into your display UI
        rawRegionDataList.forEach(regionData => {
            if (regionData !== null) {
                renderRegionDropdown(regionData, regionContainer, CHECK_GROUPS);
            }
        });

        // Run evaluation sweep using initial baseline numbers immediately after files finish rendering
        if (window.GameState) {
            evaluateAllRegions(window.GameState.items, window.GameState.totalHearts, window.GameState.totalBossMasks);
        }

    } catch (error) {
        console.error("Error loading region manifest:", error);
    }
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
    const itemChecksRegistry = [];

    regionData.item_checks.forEach(check => {
        const itemDiv = document.createElement("div");
        itemDiv.classList.add("region-check-item");
        itemDiv.dataset.checkId = check.id;
        itemDiv.textContent = check.name;

        itemChecksRegistry.push({
            element: itemDiv,
            logic: check.logic
        });

        // Updates layout counts when items click / toggle states
        itemDiv.addEventListener("click", () => {
            const isCompleted = itemDiv.classList.toggle("completed");
            const currentId = itemDiv.dataset.checkId;

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

            // Re-evaluate entire map visibility rules dynamically to properly update current and adjacent regions
            if (window.GameState) {
                evaluateAllRegions(window.GameState.items, window.GameState.totalHearts, window.GameState.totalBossMasks);
            }
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

    // Track layout nodes alongside regional scoping logic rules
    activeRegionTrackers.push({
        entryLogic: regionData.logic, 
        headerBtn: headerBtn,
        itemDivs: itemDivs,
        itemChecks: itemChecksRegistry
    });
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
