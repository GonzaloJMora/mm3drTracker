// The phone layout's header bar on both pages: the ≡ menu and the two-part switch.
// The phone layout is any window under the breakpoint, desktop keyboards included,
// so Esc is tested too.
const { test, expect, launchTracker, openSettings, PHONE } = require("./fixtures");

const header = page => page.locator("header");

test.describe("Phone header", () => {
    test.use({ viewport: PHONE });

    test("≡ opens the menu; a view toggle keeps it open; a tap outside, Esc or another button closes it", { tag: "@webkit" }, async ({ page }) => {
        await launchTracker(page);
        const menu = page.locator("#header-menu-button");
        await expect(page.locator("#tracker-toolbar")).toBeHidden();

        await menu.click();
        await expect(header(page)).toHaveClass(/menu-open/);
        await expect(menu).toHaveAttribute("aria-expanded", "true");
        await expect(page.locator("#tracker-toolbar")).toBeVisible();

        await page.locator("#toggle-non-randomized").click();
        await expect(header(page)).toHaveClass(/menu-open/);

        await page.locator("main").click({ position: { x: 20, y: 300 } });
        await expect(header(page)).not.toHaveClass(/menu-open/);

        await menu.click();
        await page.keyboard.press("Escape");
        await expect(header(page)).not.toHaveClass(/menu-open/);
        await expect(menu).toHaveAttribute("aria-expanded", "false");

        await menu.click();
        await page.locator("#export-tracker").click();
        await expect(header(page)).not.toHaveClass(/menu-open/);
        await expect(page.locator("#export-dialog")).toBeVisible();
    });

    test("the switch moves between items and locations", { tag: "@webkit" }, async ({ page }) => {
        await launchTracker(page);
        await expect(page.locator("#item-section")).toBeVisible();
        await expect(page.locator("#location-section")).toBeHidden();
        await page.locator('.tab-btn[data-tab="locations"]').click();
        await expect(page.locator("#location-section")).toBeVisible();
        await expect(page.locator("#item-section")).toBeHidden();
        await expect(page.locator('.tab-btn[data-tab="locations"]')).toHaveClass(/active/);
        await page.locator('.tab-btn[data-tab="items"]').click();
        await expect(page.locator("#item-section")).toBeVisible();
    });

    test("the settings page has the same bar, switch and menu", async ({ page }) => {
        await openSettings(page);
        await page.locator('.tab-btn[data-tab="starting"]').click();
        await expect(page.locator("#starting-section")).toBeVisible();
        await expect(page.locator("#settings-section")).toBeHidden();
        await page.locator('.tab-btn[data-tab="settings"]').click();
        await expect(page.locator("#settings-section")).toBeVisible();

        await page.locator("#header-menu-button").click();
        await expect(page.locator("#launch-new-tracker")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator("#launch-new-tracker")).toBeHidden();
    });

    test("on desktop the toolbar is out in the header and there is no ≡", async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        await launchTracker(page);
        await expect(page.locator("#header-menu-button")).toBeHidden();
        await expect(page.locator("#tracker-toolbar")).toBeVisible();
        await expect(page.locator(".mobile-tabs")).toBeHidden();
    });
});
