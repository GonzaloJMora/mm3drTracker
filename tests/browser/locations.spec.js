// Ticking off locations, linked checks, and the two view toggles. The counts
// themselves are held to the rows by tests/browser/logic.spec.js; this is about
// what a tap does.
const { test, expect, launchTracker, settle, statusNumbers, PHONE } = require("./fixtures");

const region = (page, name) => page.locator(`.region-group[data-region-name="${name}"]`);

// A region with an accessible, randomized check on the default settings.
async function openRegionWithAccessibleCheck(page) {
    const target = await page.evaluate(() => {
        const row = document.querySelector(".region-check-item.accessible:not(.vanilla)");
        return { region: row.closest(".region-group").dataset.regionName, check: row.dataset.checkId };
    });
    return target;
}

async function showLocations(page) {
    const tab = page.locator('.tab-btn[data-tab="locations"]');
    if (await tab.isVisible()) await tab.click();
}

test.describe("Locations", () => {
    test.use({ viewport: PHONE });

    test("tapping a check ticks it off and the counts follow; tapping again undoes it", { tag: "@smoke" }, async ({ page }) => {
        await launchTracker(page);
        await showLocations(page);
        const target = await openRegionWithAccessibleCheck(page);
        const group = region(page, target.region);
        await group.locator(".region-header").click();
        const row = group.locator(`.region-check-item[data-check-id="${target.check}"]`);
        const before = await statusNumbers(page);
        const header = await group.locator(".region-header").getAttribute("data-counts");

        await row.click();
        await expect(row).toHaveClass(/completed/);
        await settle(page);
        const after = await statusNumbers(page);
        expect(after.checked).toBe(before.checked + 1);
        expect(after.remaining).toBe(before.remaining - 1);
        await expect(group.locator(".region-header")).not.toHaveAttribute("data-counts", header);

        await row.click();
        await expect(row).not.toHaveClass(/completed/);
        await settle(page);
        expect(await statusNumbers(page)).toEqual(before);
    });

    test("checks that are one location tick off together", async ({ page }) => {
        await launchTracker(page);
        const group = await page.evaluate(() => (window.TrackerData.config.check_groups || [])
            .find(ids => ids.filter(id => document.querySelector(`.region-check-item[data-check-id="${id}"]`)).length >= 2));
        expect(group, "no check_group has two checks on the page").toBeTruthy();
        const rows = group.map(id => page.locator(`.region-check-item[data-check-id="${id}"]`));

        await rows[0].first().dispatchEvent("click");
        for (const row of rows) await expect(row.first()).toHaveClass(/completed/);
        await rows.at(-1).first().dispatchEvent("click");
        for (const row of rows) await expect(row.first()).not.toHaveClass(/completed/);
    });

    test("Hide Non-Randomized Checks hides them, and is remembered", { tag: "@smoke" }, async ({ page }) => {
        await launchTracker(page);
        await showLocations(page);
        const vanilla = page.locator(".region-check-item.vanilla").first();
        const name = await vanilla.evaluate(row => row.closest(".region-group").dataset.regionName);
        await region(page, name).locator(".region-header").click();
        await expect(vanilla).toBeVisible();
        const before = await statusNumbers(page);

        await page.locator("#header-menu-button").click();
        const toggle = page.locator("#toggle-non-randomized");
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-pressed", "true");
        await expect(vanilla).toBeHidden();
        await settle(page);
        expect((await statusNumbers(page)).remaining).toBeLessThan(before.remaining);

        await page.reload();
        await expect(page.locator("body")).toHaveClass(/hide-non-randomized/);
        await expect(page.locator("#toggle-non-randomized")).toHaveAttribute("aria-pressed", "true");
    });

    test("Show Only Accessible Checks hides red and ticked checks, but not one just tapped", async ({ page }) => {
        await launchTracker(page);
        await showLocations(page);
        await page.locator("#header-menu-button").click();
        await page.locator("#toggle-only-accessible").click();
        await page.keyboard.press("Escape");

        // Every red check is hidden, and so is every region with nothing to do.
        const redShown = await page.evaluate(() => [...document.querySelectorAll(".region-check-item.inaccessible")]
            .filter(row => row.checkVisibility()).length);
        expect(redShown).toBe(0);
        const emptyShown = await page.evaluate(() => [...document.querySelectorAll(".region-group.nothing-accessible")]
            .filter(group => group.checkVisibility()).length);
        expect(emptyShown).toBe(0);

        const target = await openRegionWithAccessibleCheck(page);
        const group = region(page, target.region);
        await group.locator(".region-header").click();
        const row = group.locator(`.region-check-item[data-check-id="${target.check}"]`);
        await row.click();
        // Ticked, and kept in view so a mistaken tap can be undone...
        await expect(row).toHaveClass(/completed/);
        await expect(row).toBeVisible();
        // ...until its region closes.
        await group.locator(".region-header").click();
        await group.locator(".region-header").click();
        await expect(row).toBeHidden();
    });

    test("Show Only Accessible Checks is phone-only and hides nothing on desktop", async ({ page }) => {
        await launchTracker(page);
        await page.locator("#header-menu-button").click();
        await page.locator("#toggle-only-accessible").click();
        await page.setViewportSize({ width: 1920, height: 1080 });
        await expect(page.locator("#toggle-only-accessible")).toBeHidden();
        const hidden = await page.evaluate(() => {
            // On desktop the list is the map overlay's storage, so ask the CSS rules
            // for rows rather than whether they are on screen.
            return [...document.querySelectorAll(".region-check-item")].filter(row => getComputedStyle(row).display === "none").length;
        });
        expect(hidden).toBe(0);
    });
});
