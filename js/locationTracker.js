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
