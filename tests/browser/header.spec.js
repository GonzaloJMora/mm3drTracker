// The phone layout's header bar on both pages: the ≡ menu and the two-part switch.
// The phone layout is any window under the breakpoint, desktop keyboards included,
// so Esc is tested too.
const { test, expect, launchTracker, openSettings, PHONE } = require("./fixtures");

const header = page => page.locator("header");

// The background each half of the switch is painted, beside --active-green resolved on a probe.
// The pointer moves off first, so a hover color can't pass for it.
async function paintedHalves(page) {
    await page.mouse.move(0, 0);
    return page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.backgroundColor = "var(--active-green)";
        document.body.appendChild(probe);
        const painted = { green: getComputedStyle(probe).backgroundColor };
        probe.remove();
        document.querySelectorAll(".tab-btn").forEach(tab => { painted[tab.dataset.tab] = getComputedStyle(tab).backgroundColor; });
        return painted;
    });
}

// A frozen bar has to hide what scrolls under it.
const headerBackground = page => header(page).evaluate(h => getComputedStyle(h).backgroundColor);

// Points every 8px inside the open menu that belong to something else on the page.
const showingThrough = page => page.evaluate(() => {
    const menu = document.getElementById("tracker-toolbar"), box = menu.getBoundingClientRect();
    let found = 0;
    for (let x = box.left + 12; x < box.right - 12; x += 8)
        for (let y = box.top + 12; y < box.bottom - 12; y += 8)
            if (!menu.contains(document.elementFromPoint(x, y))) found++;
    return found;
});

// What the frozen bar holds has to stay in it, or it scrolls away while the bar stays.
async function expectInsideHeader(page, selector) {
    const bar = await header(page).boundingBox(), box = await page.locator(selector).boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(bar.y);
    expect(box.y + box.height).toBeLessThanOrEqual(bar.y + bar.height);
}

test.describe("Phone header", () => {
    // A touch screen, so the browser reports hover: none the way a phone does.
    test.use({ viewport: PHONE, hasTouch: true });

    test("≡ opens and closes the menu; a view toggle keeps it open; a tap outside, Esc or another button closes it", { tag: "@webkit" }, async ({ page }) => {
        await launchTracker(page);
        const menu = page.locator("#header-menu-button");
        await expect(page.locator("#tracker-toolbar")).toBeHidden();

        await menu.click();
        await expect(header(page)).toHaveClass(/menu-open/);
        await expect(menu).toHaveAttribute("aria-expanded", "true");
        await expect(page.locator("#tracker-toolbar")).toBeVisible();
        // Drawn over the page: no part of the page shows through anywhere inside it.
        expect(await showingThrough(page)).toBe(0);
        await menu.click();
        await expect(header(page)).not.toHaveClass(/menu-open/);
        await menu.click();

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
        await page.keyboard.press("Escape");
        await expect(page.locator("#export-dialog")).toBeHidden();

        // A phone held sideways, scrolled: the menu reaches down to Back to top and still wins.
        await page.setViewportSize({ width: PHONE.height, height: PHONE.width });
        await page.locator('.tab-btn[data-tab="locations"]').click();
        await page.locator("#region-dropdown-container .region-header").first().click();
        // Opening it partway down leaves the page where it was.
        await page.evaluate(() => window.scrollTo(0, 100));
        await menu.click();
        await expect(header(page)).toHaveClass(/menu-open/);
        expect(await page.evaluate(() => window.scrollY)).toBe(100);
        await menu.click();
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect(page.locator("#back-to-top")).toHaveClass(/visible/);
        await menu.click();
        expect(await showingThrough(page)).toBe(0);
    });

    test("the switch moves between items and locations", { tag: "@webkit" }, async ({ page }) => {
        await launchTracker(page);
        await expect(page.locator("#item-section")).toBeVisible();
        await expect(page.locator("#location-section")).toBeHidden();
        await expect(page.locator('.tab-btn[data-tab="items"]')).toHaveClass(/active/);
        await expect(page.locator('.tab-btn[data-tab="locations"]')).not.toHaveClass(/active/);
        // A half not seen yet opens at its top, whatever the other half was scrolled to.
        await page.setViewportSize({ width: PHONE.width, height: 500 });
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
        await page.locator('.tab-btn[data-tab="locations"]').click();
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        await expect(page.locator("#location-section")).toBeVisible();
        await expect(page.locator("#item-section")).toBeHidden();
        await expect(page.locator('.tab-btn[data-tab="locations"]')).toHaveClass(/active/);
        await expect(page.locator('.tab-btn[data-tab="items"]')).not.toHaveClass(/active/);
        // The class is only half of it: the half that is on has to be painted --active-green.
        const painted = await paintedHalves(page);
        expect(painted.green).not.toBe("rgba(0, 0, 0, 0)");
        expect(painted.locations).toBe(painted.green);
        expect(painted.items).not.toBe(painted.green);
        await page.locator('.tab-btn[data-tab="items"]').click();
        await expect(page.locator("#item-section")).toBeVisible();

        // Each half keeps its place: Locations scrolled down comes back where it was left.
        await page.locator('.tab-btn[data-tab="locations"]').click();
        await page.locator("#region-dropdown-container .region-header").first().click();
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const leftAt = await page.evaluate(() => window.scrollY);
        expect(leftAt).toBeGreaterThan(100);
        await page.locator('.tab-btn[data-tab="items"]').click();
        await page.locator('.tab-btn[data-tab="locations"]').click();
        expect(await page.evaluate(() => window.scrollY)).toBe(leftAt);
    });

    test("the settings page has the same bar, switch and menu", async ({ page }) => {
        await openSettings(page);
        await expect(page.locator('.tab-btn[data-tab="settings"]')).toHaveClass(/active/);
        await expect(page.locator('.tab-btn[data-tab="starting"]')).not.toHaveClass(/active/);
        await page.locator('.tab-btn[data-tab="starting"]').click();
        await expect(page.locator("#starting-section")).toBeVisible();
        await expect(page.locator("#settings-section")).toBeHidden();
        const painted = await paintedHalves(page);
        expect(painted.starting).toBe(painted.green);
        expect(painted.settings).not.toBe(painted.green);
        await page.locator('.tab-btn[data-tab="settings"]').click();
        await expect(page.locator("#settings-section")).toBeVisible();

        await page.locator("#header-menu-button").click();
        await expect(page.locator("#launch-new-tracker")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator("#launch-new-tracker")).toBeHidden();
    });

    test("the bar stays at the top as the page scrolls, and Resume Tracker stays out of the menu", async ({ page }) => {
        await launchTracker(page);
        // Short enough that both pages scroll, tall enough that the bar stays frozen.
        await page.setViewportSize({ width: PHONE.width, height: 500 });
        await page.locator('.tab-btn[data-tab="locations"]').click();
        await page.locator("#region-dropdown-container .region-header").first().click();
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
        expect((await header(page).boundingBox()).y).toBe(0);
        expect(await headerBackground(page)).toMatch(/^rgb\(/);
        await expectInsideHeader(page, "#header-menu-button");
        await expectInsideHeader(page, ".mobile-tabs");

        await openSettings(page);
        await page.locator('.tab-btn[data-tab="starting"]').click();
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
        expect((await header(page).boundingBox()).y).toBe(0);
        expect(await headerBackground(page)).toMatch(/^rgb\(/);
        await expectInsideHeader(page, "#header-menu-button");
        await expectInsideHeader(page, ".mobile-tabs");

        await page.locator("#header-menu-button").click();
        await page.locator("#load-autosave").click();
        await expect(header(page)).not.toHaveClass(/menu-open/);
        await expect(page.locator("#resume-tracker")).toBeVisible();
    });

    // Both sides of the breakpoint: the last phone width is --mobile-breakpoint.
    test("from one pixel past the breakpoint the toolbar is out in the header and there is no ≡ or switch", async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 900 });
        await launchTracker(page);
        const lastPhone = await page.evaluate(() => parseInt(getComputedStyle(document.documentElement).getPropertyValue("--mobile-breakpoint"), 10));
        await page.setViewportSize({ width: lastPhone + 1, height: 900 });
        await expect(page.locator("#header-menu-button")).toBeHidden();
        await expect(page.locator("#tracker-toolbar")).toBeVisible();
        await expect(page.locator(".mobile-tabs")).toBeHidden();
        // Visible isn't enough: the toolbar has to sit inside the header, not float off it.
        const bar = await header(page).boundingBox(), toolbar = await page.locator("#tracker-toolbar").boundingBox();
        expect(toolbar.y).toBeGreaterThanOrEqual(bar.y);
        expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(bar.y + bar.height);
        expect(toolbar.x).toBeGreaterThanOrEqual(bar.x);
        expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(bar.x + bar.width);
        // A row of buttons, not the phone menu's column.
        const tops = await page.locator("#tracker-toolbar .toolbar-btn").evaluateAll(buttons =>
            buttons.filter(b => b.offsetParent).map(b => Math.round(b.getBoundingClientRect().top)));
        expect(tops.length).toBeGreaterThan(1);
        expect(new Set(tops).size).toBe(1);
        // Nor is the header a frozen bar: it scrolls away with the page.
        await page.setViewportSize({ width: lastPhone + 1, height: 400 });
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
        expect((await header(page).boundingBox()).y).toBeLessThan(0);

        await page.setViewportSize({ width: lastPhone, height: 900 });
        await expect(page.locator("#header-menu-button")).toBeVisible();
        await expect(page.locator("#tracker-toolbar")).toBeHidden();
        await expect(page.locator(".mobile-tabs")).toBeVisible();
    });
});
