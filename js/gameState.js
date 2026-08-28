// stateManager.js
window.GameState = {
    items: {},
    totalHearts: 3,
    totalBossMasks: 0,
    config: null,

    async init(itemsList, configData) {
        try {
            this.config = configData;

            // Set all basic raw item IDs to false
            itemsList.forEach(item => {
                this.items[item.id] = false;
            });

            // Initialize structural progressive elements
            Object.keys(this.config.progressions).forEach(slotId => {
                this.config.progressions[slotId].forEach(itemId => {
                    this.items[itemId] = false;
                });
            });

            // Initialize count structures
            Object.keys(this.config.item_counts).forEach(slotId => {
                const rule = this.config.item_counts[slotId];
                if (Array.isArray(rule)) {
                    this.items[slotId] = false; 
                    rule.forEach(val => { this.items[`${slotId}_${val}`] = false; });
                } else {
                    this.items[slotId] = 0;
                }
            });

            this.calculateHearts();
            this.calculateBossMasks();
            this.broadcastChange();
        } catch (e) {
            console.error("Failed to initialize game tracker state machine:", e);
        }
    },

    updateItemState(slotId, stageIndex, currentCount) {
        const isProgression = this.config.progressions.hasOwnProperty(slotId);
        const countRule = this.config.item_counts[slotId];

        // Case A: Pure Progressions (Swords, Shields, Wallets, Magic)
        if (isProgression) {
            const chain = this.config.progressions[slotId];
            chain.forEach(itemId => { this.items[itemId] = false; });
            
            // Tier cascade: upgrading means all lower base-items evaluate to true
            for (let i = 0; i <= stageIndex; i++) {
                if (chain[i]) this.items[chain[i]] = true;
            }
        }
        // Case B: Array Count Progressions (Bow & Bombs)
        else if (countRule && Array.isArray(countRule)) {
            this.items[slotId] = (stageIndex >= 0);
            countRule.forEach(val => { this.items[`${slotId}_${val}`] = false; });
            
            for (let i = 0; i <= stageIndex; i++) {
                this.items[`${slotId}_${countRule[i]}`] = true;
            }
        }
        // Case C: Quantities & Counters (Tokens, Bottles, Keys, Hearts)
        else if (countRule && Number.isInteger(countRule)) {
            this.items[slotId] = currentCount;
            
            if (slotId === "heart_piece" || slotId === "heart_container") {
                this.calculateHearts();
            }
        }
        // Case D: Standard Item Toggles & Masks
        else {
            this.items[slotId] = (stageIndex !== -1);
        }

        // Used since player can set required boss masks to get to moon/Majora fight to any value 0-4
        const bossMaskIds = ["odolwa_remains", "goht_remains", "gyorg_remains", "twinmold_remains"];
        if (bossMaskIds.includes(slotId)) {
            this.calculateBossMasks();
        }

        this.broadcastChange();
    },

    calculateHearts() {
        const pieces = this.items["heart_piece"] || 0;
        const containers = this.items["heart_container"] || 0;
        this.totalHearts = 3 + Math.floor(pieces / 4) + containers;
    },

    calculateBossMasks() {
        let count = 0;
        const targetMasks = ["odolwa_remains", "goht_remains", "gyorg_remains", "twinmold_remains"];
        targetMasks.forEach(maskId => {
            if (this.items[maskId] === true) {
                count++;
            }
        });
        this.totalBossMasks = count;
    },

    broadcastChange() {
        window.dispatchEvent(new CustomEvent("trackerStateUpdated", {
            detail: {
                items: { ...this.items },
                totalHearts: this.totalHearts,
                totalBossMasks: this.totalBossMasks
            }
        }));
    }
};

// Debug Overlay Panel (Hidden by default, toggles on F1 keypress)
(function createDebugPanel() {
    if (!document.body) {
        window.addEventListener('DOMContentLoaded', createDebugPanel);
        return;
    }

    const panel = document.createElement('div');
    panel.id = 'tracker-debug-panel';
    panel.style.cssText = `
        position: fixed; 
        bottom: 10px; 
        left: 10px; 
        width: 320px; 
        max-height: 400px;
        overflow-y: auto; 
        background: rgba(0, 0, 0, 0.9); 
        color: #00ff00;
        font-family: monospace; 
        font-size: 11px; 
        padding: 10px;
        border: 2px solid #555; 
        border-radius: 5px; 
        z-index: 9999;
        box-shadow: 0 4px 20px rgba(0,0,0,0.8);
        display: none; /* RULE MET: Default hidden */
    `;

    const title = document.createElement('div');
    title.innerHTML = '<strong>⚙️ LIVE STATE TRACKER DEBUG</strong> <span style="color:#666; font-size:9px; float:right;">[F1 to close]</span><hr style="border-color:#444; margin-top:4px;">';
    panel.appendChild(title);

    const content = document.createElement('div');
    content.id = 'debug-state-content';
    panel.appendChild(content);
    document.body.appendChild(panel);

    // Hotkey Event Handling for the F1 key
    window.addEventListener("keydown", (e) => {
        if (e.key === "F1") {
            e.preventDefault(); // Prevents the browser's default help screen from taking over
            
            const isHidden = panel.style.display === "none";
            panel.style.display = isHidden ? "block" : "none";
        }
    });

    // State broadcast update listener block
    window.addEventListener('trackerStateUpdated', (e) => {
        const { items, totalHearts, totalBossMasks } = e.detail;
        let html = `<div><strong>Total Hearts:</strong> ${totalHearts} ❤️</div>`;
        html += `<div><strong>Boss Masks Count:</strong> ${totalBossMasks} 🎭</div>`;
        html += `<div style="margin-top:8px; border-bottom:1px dashed #444; padding-bottom:4px;"><strong>Active Flags:</strong></div>`;

        const activeItems = Object.entries(items).filter(([_, val]) => val !== false && val !== 0);

        if (activeItems.length === 0) {
            html += `<div style="color:#888;">(Inventory Empty)</div>`;
        } else {
            activeItems.sort().forEach(([key, value]) => {
                html += `<div style="display:flex; justify-content:space-between;">
                    <span style="color:#aaa;">${key}:</span>
                    <span style="color:#55ff55; font-weight:bold;">${value}</span>
                </div>`;
            });
        }
        content.innerHTML = html;
    });
})();
