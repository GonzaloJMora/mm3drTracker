// The tracker's item grids: clicking up and right-clicking back through every
// slot, starting items as a floor, logic following the items, and a stress run of
// everything at once that must leave the page working.
const { test, expect, launchTracker, readChecks, statusNumbers, settle, slot } = require("./fixtures");

// Every grid slot with the values clicking moves it through.
function slotRanges(page) {
    return page.evaluate(() => window.GameState.gridSlots().map(id => Object.assign({ id }, window.GameState.slotRange(id))));
}

const slotValue = (page, id) => page.evaluate(slotId => window.GameState.slotValue(slotId), id);

test.describe("Item grids", () => {
    test("click steps a slot up through its whole range and wraps; right-click steps back", { tag: "@smoke" }, async ({ page }) => {
        await launchTracker(page);
        const ranges = await slotRanges(page);
        const progression = ranges.find(range => range.kind === "progression" && range.top - range.bottom >= 2);
        const target = slot(page, progression.id);

        for (let value = progression.bottom + 1; value <= progression.top; value++) {
            await target.click();
            expect(await slotValue(page, progression.id)).toBe(value);
        }
        await expect(target).not.toHaveClass(/dimmed/);
        await target.click();
        expect(await slotValue(page, progression.id)).toBe(progression.bottom);

        await target.click({ button: "right" });
        expect(await slotValue(page, progression.id)).toBe(progression.top);
        await target.click({ button: "right" });
        expect(await slotValue(page, progression.id)).toBe(progression.top - 1);
    });

    test("a counter shows its count, green at its top", async ({ page }) => {
        await launchTracker(page);
        const counter = (await slotRanges(page)).find(range => range.kind === "counter" && range.top >= 2 && range.bottom === 0);
        const target = slot(page, counter.id);
        await target.click();
        await target.click();
        await expect(target.locator(".slot-counter")).toHaveText("2");
        await target.click({ button: "right" });
        await expect(target.locator(".slot-counter")).toHaveText("1");
        await target.click({ button: "right" });
        await expect(target).toHaveClass(/dimmed/);
        await target.click({ button: "right" });
        await expect(target.locator(".slot-counter")).toHaveText(String(counter.top));
        await expect(target.locator(".slot-counter")).toHaveClass(/max-count/);
    });

    test("a starting item is a floor that clicking never goes below", async ({ page }) => {
        // The first slot a setting controls on its own, picked at its top choice.
        await page.goto("index.html");
        const pick = await page.evaluate(() => new Promise(resolve => window.TrackerData.onReady(() => {
            for (const entry of window.SettingsState.list()) {
                const description = window.SettingsState.describe(entry.id);
                if (description.slot && description.slotChoices.length && !entry.forced) {
                    resolve({ id: description.id, slot: description.slot, value: description.slotChoices.at(-1) });
                    return;
                }
            }
            resolve(null);
        })));
        expect(pick, "no setting controls a slot").not.toBeNull();
        await launchTracker(page, { [pick.id]: pick.value });

        const { bottom, top } = await page.evaluate(id => window.GameState.slotRange(id), pick.slot);
        expect(await slotValue(page, pick.slot)).toBe(bottom);
        const target = slot(page, pick.slot);
        if (bottom === top) {
            await expect(target).toHaveClass(/locked/);
        }
        for (let i = 0; i < top - bottom + 2; i++) {
            await target.click({ button: "right" });
            expect(await slotValue(page, pick.slot)).toBeGreaterThanOrEqual(bottom);
        }
    });

    test("owning an item turns a check it gates from red to green", { tag: "@smoke" }, async ({ page }) => {
        await launchTracker(page);
        // A check gated by one item alone that clicking a slot gives, worked out from the data.
        const gated = await page.evaluate(() => {
            const slots = new Set(window.GameState.gridSlots());
            for (const region of window.TrackerData.regions) {
                if ((region.logic || "").trim()) continue;
                for (const check of region.item_checks) {
                    const own = (check.logic || "").trim();
                    if ((check.group_logic || []).some(part => (part || "").trim())) continue;
                    if (!/^[a-z0-9_]+$/.test(own) || !slots.has(own)) continue;
                    if (window.GameState.slotValue(own) >= 0) continue;
                    return { check: check.id, item: own, region: region.region_name };
                }
            }
            return null;
        });
        expect(gated, "no check is gated by a single item slot").not.toBeNull();
        const row = page.locator(`.region-group[data-region-name="${gated.region}"] .region-check-item[data-check-id="${gated.check}"]`);
        await expect(row).toHaveClass(/inaccessible/);
        await slot(page, gated.item).click();
        await expect(row).toHaveClass(/(^|\s)accessible/);
        await slot(page, gated.item).click({ button: "right" });
        await expect(row).toHaveClass(/inaccessible/);
    });

    // Another MM3D tracker crashes on a right-click, and once enough items are owned.
    // Every slot is run through its whole range both ways, then everything is owned
    // and every check ticked; the console check fails the test on any error.
    test("stress: every slot both ways, everything owned, every check ticked, and the page still works", { tag: "@webkit" }, async ({ page }) => {
        await launchTracker(page);
        const ranges = (await slotRanges(page)).filter(range => range.top > range.bottom);

        // The slots' own handlers, fired in the page: a few thousand real clicks
        // would take minutes and test the same code.
        await page.evaluate(list => {
            const fire = (id, type) => document.querySelector(`.grid-container .item-slot[data-id="${id}"]`)
                .dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: type === "contextmenu" ? 2 : 0 }));
            list.forEach(({ id, bottom, top }) => {
                const steps = top - bottom + 1;
                for (let i = 0; i < steps * 2; i++) fire(id, "contextmenu");
                for (let i = 0; i < steps * 2; i++) fire(id, "click");
            });
            // Everything owned: each slot clicked up to its top.
            list.forEach(({ id, top }) => {
                let guard = 200;
                while (window.GameState.slotValue(id) !== top && guard-- > 0) fire(id, "click");
            });
        }, ranges);
        for (const { id, top } of ranges) expect(await slotValue(page, id), id).toBe(top);

        await page.evaluate(() => document.querySelectorAll(".region-check-item:not(.completed)").forEach(row => {
            if (!row.classList.contains("completed")) row.click();
        }));
        await settle(page);
        const checks = await readChecks(page);
        expect(checks.filter(check => !check.completed).map(check => check.id)).toEqual([]);
        const done = await statusNumbers(page);
        expect(done.remaining).toBe(0);
        expect(done.accessible).toBe(0);

        // Still answering: an untick counts, a slot still clicks, and the autosave
        // holds what the page holds.
        await page.evaluate(() => document.querySelector(".region-check-item").click());
        await settle(page);
        expect((await statusNumbers(page)).remaining).toBe(1);
        const first = ranges[0];
        await slot(page, first.id).click({ button: "right" });
        expect(await slotValue(page, first.id)).toBe(first.top - 1);

        await expect.poll(() => page.evaluate(() => {
            const stored = JSON.parse(window.localStorage.getItem(window.StorageKeys.key("autosave")) || "null");
            return stored && stored.code === window.TrackerDebug.saveCode();
        }), { timeout: 5000 }).toBe(true);
    });
});
