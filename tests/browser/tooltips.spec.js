// The requirements tooltip, on hover and pinned on a phone, and the item tooltip.
// Its chips have to agree with the check's color: "all met" exactly when green.
const { test, expect, launchTracker, slot, PHONE } = require("./fixtures");

const tooltip = page => page.locator(".tracker-tooltip");

test.describe("Tooltips", () => {
    test("hovering a check in the map overlay shows what it needs", { tag: "@smoke" }, async ({ page }) => {
        await launchTracker(page);
        const name = await page.evaluate(() => document.querySelector(".region-check-item.inaccessible")
            .closest(".region-group").dataset.regionName);
        await page.locator(`.location-map-marker[data-marker-region="${name}"]`).dispatchEvent("click");
        const row = page.locator(".location-map-overlay .region-check-item.inaccessible").first();
        await row.hover();
        await expect(tooltip(page)).toBeVisible();
        await expect(tooltip(page)).toContainText("Items Required");
        await expect(tooltip(page)).toContainText("missing");
        await expect(tooltip(page).locator(".tooltip-chip").first()).toBeVisible();
    });

    test("a non-randomized check names what it holds", async ({ page }) => {
        await launchTracker(page);
        const name = await page.evaluate(() => document.querySelector(".region-check-item.vanilla")
            .closest(".region-group").dataset.regionName);
        await page.locator(`.location-map-marker[data-marker-region="${name}"]`).dispatchEvent("click");
        await page.locator(".location-map-overlay .region-check-item.vanilla").first().hover();
        await expect(tooltip(page)).toContainText("Vanilla:");
    });

    test("hovering an item names it", async ({ page }) => {
        await launchTracker(page);
        const id = await page.evaluate(() => window.GameState.gridSlots()[0]);
        await slot(page, id).hover();
        await expect(tooltip(page)).toBeVisible();
        await expect(tooltip(page).locator(".tooltip-title")).not.toBeEmpty();
    });

    test.describe("on a phone", () => {
        test.use({ viewport: PHONE, hasTouch: true });

        test("the info button pins the panel, and its chips agree with the check's color", { tag: "@webkit" }, async ({ page }) => {
            await launchTracker(page);
            await page.locator('.tab-btn[data-tab="locations"]').click();
            // A few regions' worth, green and red alike.
            const names = await page.locator(".region-group").evaluateAll(groups =>
                groups.filter((group, index) => index % 6 === 0).map(group => group.dataset.regionName));
            for (const name of names) {
                const group = page.locator(`.region-group[data-region-name="${name}"]`);
                await group.locator(".region-header").click();
                const rows = group.locator(".region-check-item");
                const total = Math.min(await rows.count(), 4);
                for (let index = 0; index < total; index++) {
                    const row = rows.nth(index);
                    const green = /(^|\s)accessible(\s|$)/.test(await row.getAttribute("class"));
                    await row.locator(".region-check-info").click();
                    await expect(tooltip(page)).toHaveClass(/docked/);
                    // A check with no requirements shows "None" and no chips.
                    const missing = await tooltip(page).evaluate(panel => {
                        const chips = panel.querySelector(".tooltip-chips");
                        return chips ? Number(chips.dataset.missing) : 0;
                    });
                    expect(missing === 0, `${name}, check ${index + 1}: chips say ${missing} missing, row is ${green ? "green" : "red"}`).toBe(green);
                    await row.locator(".region-check-info").click();
                    await expect(tooltip(page)).not.toHaveClass(/docked/);
                }
                await group.locator(".region-header").click();
            }
        });

        test("a tap anywhere else, or Esc, puts the pinned panel away", async ({ page }) => {
            await launchTracker(page);
            await page.locator('.tab-btn[data-tab="locations"]').click();
            const group = page.locator(".region-group").first();
            await group.locator(".region-header").click();
            const info = group.locator(".region-check-info").first();

            await info.click();
            await expect(tooltip(page)).toHaveClass(/docked/);
            await page.locator("header img").click();
            await expect(tooltip(page)).not.toHaveClass(/docked/);

            await info.click();
            await expect(tooltip(page)).toHaveClass(/docked/);
            await page.keyboard.press("Escape");
            await expect(tooltip(page)).not.toHaveClass(/docked/);
        });
    });
});
