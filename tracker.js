document.addEventListener("DOMContentLoaded", () => {
    const itemContainer = document.getElementById("item-grid");
    const maskContainer = document.getElementById("mask-grid");

    const ITEM_GRID_ORDER = [
        "sword", "shield", "bow", "fire_arrow", "ice_arrow", "light_arrow",
        "magic_meter", "bomb", "bombchu", "deku_stick", "deku_nut", "magic_bean",
        "wallet", "powder_keg", "pictograph_box", "lens_of_truth", "hookshot", "great_fairy_sword",
        "red_potion", "gold_dust", "milk", "chateau_romani", "mystery_milk", "empty_bottle"
    ];

    const MASK_GRID_ORDER = [
        "postman_hat", "all_night_mask", "blast_mask", "stone_mask", "great_fairy_mask", "deku_mask",
        "keaton_mask", "bremen_mask", "bunny_hood", "don_gero_mask", "mask_of_scents", "goron_mask",
        "romani_mask", "troupe_leader_mask", "kafei_mask", "couples_mask", "mask_of_truth", "zora_mask",
        "kamaro_mask", "gibdo_mask", "garo_mask", "captains_hat", "giants_mask", "fierce_deity_mask"
    ];

    const PROGRESSIONS = {
        "sword": ["kokiri_sword", "razor_sword", "guilded_sword"],
        "shield": ["termina_shield", "mirror_shield"],
        "wallet": ["wallet", "adults_wallet", "giants_wallet"],
        "magic_meter": ["magic_meter", "magic_meter_double"]
    };

    fetch("data/Items.json")
        .then(response => response.json())
        .then(itemsArray => {
            const itemMap = {};
            itemsArray.forEach(item => itemMap[item.id] = item.image);

            renderGrid(itemContainer, ITEM_GRID_ORDER, itemMap, PROGRESSIONS);
            renderGrid(maskContainer, MASK_GRID_ORDER, itemMap, PROGRESSIONS);
        })
        .catch(error => console.error("Error loading items layout:", error));
});

// Reusable Grid Renderer
function renderGrid(container, gridOrder, itemMap, progressions) {
    gridOrder.forEach(slotId => {
        const slot = document.createElement("div");
        slot.classList.add("item-slot");
        slot.dataset.id = slotId;
        const img = document.createElement("img");
        img.classList.add("item-image");
        img.draggable = false;
        slot.classList.add("dimmed");

        const isProgressive = progressions.hasOwnProperty(slotId);
        
        if (isProgressive) {
            slot.dataset.stage = "-1";
            img.src = itemMap[progressions[slotId][0]];
            slot.title = formatTooltip(progressions[slotId][0]);
        } else {
            img.src = itemMap[slotId];
            slot.title = formatTooltip(slotId);
        }

        slot.appendChild(img);
        container.appendChild(slot);

        const itemChain = progressions[slotId] || [];

        slot.addEventListener("click", (e) => {
            e.preventDefault(); // Stops any default browser hangups on fast clicks
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
