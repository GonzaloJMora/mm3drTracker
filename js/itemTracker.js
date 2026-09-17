// The tracker's item grids: drawn by itemGrids.js from the starting state, then
// clicked through between each slot's floor and its top.
(function () {
    window.TrackerData.onReady(({ config, items }) => {
        const gridContainer = document.querySelector(".grid-container");

        try {
            const itemMap = window.ItemGrids.itemMap(items);

            // Before anything is drawn, so the diagnosis lands ahead of its symptom.
            // Guarded because it runs before GameState.init — a throw here would leave
            // the item state empty and make every logic token look unknown.
            try {
                window.ItemGrids.validate(config, itemMap);
            } catch (error) {
                console.error("itemTracker: could not validate the grid slots", error);
            }

            // A settings failure costs the starting items, not the grids: the tracker
            // still draws, just from empty.
            let startingState = {};
            try {
                startingState = window.SettingsState.startingItems();
            } catch (error) {
                console.error("itemTracker: could not read the starting items, so every slot starts empty", error);
            }

            // Not awaited: init() does no I/O. It must not swallow its own errors
            // either, or the catch below can never see one.
            window.GameState.init(items, config, startingState);

            window.ItemGrids.render(gridContainer, config, itemMap).forEach((view, slotId) => {
                const { kind, bottom, top } = window.GameState.slotRange(slotId);

                // Nothing to cycle through, so no click handler. Right-click is still
                // swallowed, or it would open the browser's menu over the grid.
                if (bottom === top) {
                    view.slot.classList.add("locked");
                    view.slot.addEventListener("contextmenu", (e) => e.preventDefault());
                    return;
                }

                const step = (direction) => {
                    const value = window.ItemGrids.nextValue(window.GameState.slotValue(slotId), direction, bottom, top);
                    window.ItemGrids.draw(view, value);
                    const counted = kind === "counter" || kind === "digit";
                    window.GameState.updateItemState(slotId, counted ? null : value, counted ? value : null);
                };

                view.slot.addEventListener("click", (e) => {
                    e.preventDefault();
                    step(1);
                });

                view.slot.addEventListener("contextmenu", (e) => {
                    e.preventDefault();
                    step(-1);
                });
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

    // Until the slot images load, the grids are a fraction of their real height, and
    // nothing else reliably says when they stop growing — so say it again once the
    // images settle. Here because these are this file's images; the listener is
    // idempotent. See ARCHITECTURE.md, *Map sizing*.
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
})();
