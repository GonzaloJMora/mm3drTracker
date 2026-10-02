// Both pages load clean, draw everything in the data, and fail in the ways
// ARCHITECTURE.md, *When the data is wrong*, describes.
const fs = require("fs");
const path = require("path");
const { test, expect, openSettings, launchTracker, waitForPage, PHONE } = require("./fixtures");

const ROOT = path.join(__dirname, "..", "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "manifest.json"), "utf8"));
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "version.json"), "utf8")).version;

test.describe("Loading", () => {
    test("the settings page loads clean", { tag: "@smoke" }, async ({ page }) => {
        await openSettings(page);
        await expect(page.locator("#settings-list .setting-row").first()).toBeVisible();
        await expect(page.locator("#app-version")).toContainText(version);
    });

    test("the tracker loads clean and draws every region and check in the data", { tag: "@smoke" }, async ({ page }) => {
        await launchTracker(page);
        const expected = await page.evaluate(() => ({
            regions: window.TrackerData.regions.length,
            checks: window.TrackerData.regions.reduce((sum, region) => sum + region.item_checks.length, 0),
            failed: window.TrackerData.failedRegions.length
        }));
        expect(expected.failed).toBe(0);
        expect(expected.regions).toBe(manifest.length);
        await expect(page.locator(".region-group")).toHaveCount(expected.regions);
        await expect(page.locator(".region-check-item")).toHaveCount(expected.checks);
        // Every check judged one way or the other by the first sweep.
        await expect(page.locator(".region-check-item:not(.accessible):not(.inaccessible)")).toHaveCount(0);
        await expect(page.locator("#app-version")).toContainText(version);
    });

    test("the tracker loads clean in the phone layout", { tag: "@smoke" }, async ({ page }) => {
        await page.setViewportSize(PHONE);
        await launchTracker(page);
        await expect(page.locator("#header-menu-button")).toBeVisible();
    });

    test("opening the tracker with nothing handed over goes back to settings", async ({ page }) => {
        await page.goto("tracker.html");
        await page.waitForURL(/index\.html/);
        await waitForPage(page);
    });

    test("tracker.html?defaults opens on the default settings", async ({ page }) => {
        await page.goto("tracker.html?defaults");
        await waitForPage(page);
        expect(await page.evaluate(() => Object.keys(window.SettingsState.picks()).length)).toBe(0);
    });

    test.describe("on an iPhone", () => {
        test.use({
            viewport: PHONE,
            userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1"
        });

        test("the Home Screen tip shows until Got It closes it for good", { tag: "@webkit" }, async ({ page }) => {
            await openSettings(page);
            const tip = page.locator("#home-screen-tip");
            await expect(tip).toBeVisible();
            await tip.getByRole("button").click();
            await expect(tip).toHaveCount(0);
            await page.reload();
            await waitForPage(page);
            await expect(page.locator("#home-screen-tip")).toHaveCount(0);
        });
    });

    // The rules themselves are tests/node/dataChecks.test.js; this is the page
    // printing them, on both pages.
    test("a data mistake is named on the page by its rule, and the page still works", async ({ page, allowConsole }) => {
        // The save layout check notices the made-up slot too, as it should.
        allowConsole.push(/Data check "grid-slots"/, /"not_an_item" — grids\./, /TrackerSave: .*saveLayout/, /slot "not_an_item" is not in it/);
        const warnings = [];
        page.on("console", message => { if (message.type() === "warning") warnings.push(message.text()); });
        await page.route("**/data/config/grids.json", async route => {
            const response = await route.fetch();
            const grids = await response.json();
            const first = Object.keys(grids.grids)[0];
            grids.grids[first] = grids.grids[first].concat(["not_an_item", "", "", "", "", ""]);
            await route.fulfill({ response, json: grids });
        });
        for (const address of ["index.html", "tracker.html?defaults"]) {
            warnings.length = 0;
            await page.goto(address);
            await waitForPage(page);
            expect(warnings.filter(text => text.startsWith('Data check "grid-slots"')), address).toHaveLength(1);
            await expect(page.locator('.item-slot[data-id="not_an_item"]')).toHaveClass(/empty-slot/);
        }
    });

    test("a core file that won't load shows the copyable error, not a blank page", async ({ page, allowConsole }) => {
        allowConsole.push(/./);
        await page.route("**/data/Items.json", route => route.fulfill({ status: 404, body: "" }));
        await page.goto("tracker.html?defaults");
        const error = page.locator("#tracker-load-error");
        await expect(error).toBeVisible();
        await expect(error).toContainText("Items.json");
        await expect(error).toContainText(version);
    });

    test("a region file that won't load costs only that region, with a banner", async ({ page, allowConsole }) => {
        allowConsole.push(/./);
        const broken = manifest[0];
        await page.route(`**/data/${broken}`, route => route.fulfill({ status: 404, body: "" }));
        await page.goto("tracker.html?defaults");
        await waitForPage(page);
        await expect(page.locator("#tracker-region-warning")).toBeVisible();
        await expect(page.locator(".region-group")).toHaveCount(manifest.length - 1);
    });
});
