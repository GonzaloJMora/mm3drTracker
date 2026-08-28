window.GameState = {
    items: {},
    totalHearts: 3,
    totalBossMasks: 0,
    config: null,

    async init(itemsList, configData) {
        try {
            this.config = configData;

            itemsList.forEach(item => {
                this.items[item.id] = false;
            });

            Object.keys(this.config.progressions).forEach(slotId => {
                this.config.progressions[slotId].forEach(itemId => {
                    this.items[itemId] = false;
                });
            });

            Object.keys(this.config.item_counts).forEach(slotId => {
                const rule = this.config.item_counts[slotId];
                if (Array.isArray(rule)) {
                    this.items[slotId] = false; 
                    rule.forEach(val => { this.items[`${slotId}_${val}`] = false; });
                } else {
                    this.items[slotId] = 0;
                }
            });

            for (let i = 1; i <= 5; i++) {
                this.items[`bombers_code_digit_${i}`] = 0;
            }

            this.items["bombers_code"] = false;
            this.items["bombers_code_solved"] = false;

            this.calculateHearts();
            this.calculateBossMasks();
            this.calculateBombersCode();
            this.broadcastChange();
        } catch (e) {
            console.error("Failed to initialize game tracker state machine:", e);
        }
    },

    updateItemState(slotId, stageIndex, currentCount) {
        const isProgression = this.config.progressions.hasOwnProperty(slotId);
        const countRule = this.config.item_counts[slotId];

        if (isProgression) {
            const chain = this.config.progressions[slotId];
            chain.forEach(itemId => { this.items[itemId] = false; });
            
            for (let i = 0; i <= stageIndex; i++) {
                if (chain[i]) this.items[chain[i]] = true;
            }
        }
        else if (countRule && Array.isArray(countRule)) {
            this.items[slotId] = (stageIndex >= 0);
            countRule.forEach(val => { this.items[`${slotId}_${val}`] = false; });
            
            for (let i = 0; i <= stageIndex; i++) {
                this.items[`${slotId}_${countRule[i]}`] = true;
            }
        }
        else if ((countRule && Number.isInteger(countRule)) || (slotId && slotId.startsWith("bombers_code_digit_"))) {
            this.items[slotId] = currentCount;
            
            if (slotId === "heart_piece" || slotId === "heart_container") {
                this.calculateHearts();
            }
        }
        else {
            this.items[slotId] = (stageIndex !== -1);
        }

        const bossMaskIds = ["odolwa_remains", "goht_remains", "gyorg_remains", "twinmold_remains"];
        if (bossMaskIds.includes(slotId)) {
            this.calculateBossMasks();
        }

        if (slotId && slotId.startsWith("bombers_code_")) {
            this.calculateBombersCode();
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

    calculateBombersCode() {
        let digits = [];
        for (let i = 1; i <= 5; i++) {
            let val = this.items[`bombers_code_digit_${i}`] ?? 0;
            digits.push(parseInt(val, 10) || 0);
        }

        const hasZero = digits.includes(0);
        const allUnique = new Set(digits).size === digits.length;
        this.items["bombers_code"] = !hasZero && allUnique;
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

// Debug Overlay Panel (Draggable & Toggleable via F1)
(function createDebugPanel() {
    if (!document.body) {
        window.addEventListener('DOMContentLoaded', createDebugPanel);
        return;
    }

    if (document.getElementById('tracker-debug-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'tracker-debug-panel';
    panel.style.cssText = `
        position: fixed; bottom: 10px; left: 10px; width: 320px; max-height: 400px;
        overflow-y: auto; background: rgba(0, 0, 0, 0.9); color: #00ff00;
        font-family: monospace; font-size: 11px; padding: 10px;
        border: 2px solid #555; border-radius: 5px; z-index: 9999;
        box-shadow: 0 4px 20px rgba(0,0,0,0.8); display: none; user-select: none;
    `;

    const title = document.createElement('div');
    title.id = 'tracker-debug-title';
    title.style.cssText = 'cursor: move; padding-bottom: 4px;';
    title.innerHTML = '<strong>⚙️ LIVE STATE TRACKER DEBUG</strong> <span style="color:#666; font-size:9px; float:right;">[F1 to close]</span><hr style="border-color:#444; margin-top:4px;">';
    panel.appendChild(title);

    const content = document.createElement('div');
    content.id = 'debug-state-content';
    panel.appendChild(content);
    document.body.appendChild(panel);

    let isDragging = false;
    let startX, startY;

    title.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX - panel.offsetLeft;
        startY = e.clientY - panel.offsetTop;
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        panel.style.left = `${e.clientX - startX}px`;
        panel.style.top = `${e.clientY - startY}px`;
        panel.style.bottom = 'auto';
    });

    window.addEventListener('mouseup', () => { isDragging = false; });

    window.addEventListener("keydown", (e) => {
        if (e.key === "F1") {
            e.preventDefault(); 
            panel.style.display = panel.style.display === "none" ? "block" : "none";
        }
    });

    window.addEventListener('trackerStateUpdated', (e) => {
        const { items, totalHearts, totalBossMasks } = e.detail;
        let html = `<div><strong>Total Hearts:</strong> ${totalHearts} ❤️</div>`;
        html += `<div><strong>Boss Masks Count:</strong> ${totalBossMasks} 🎭</div>`;
        html += `<div><strong>Bombers Code Valid:</strong> ${items["bombers_code"] ? "YES ✅" : "NO ❌"}</div>`;
        html += `<div style="margin-top:8px; border-bottom:1px dashed #444; padding-bottom:4px;"><strong>Active Flags & Numbers:</strong></div>`;

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
