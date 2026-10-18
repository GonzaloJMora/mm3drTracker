// This game's own data/ in the real pages: both load clean and draw every region and
// check, and every released save format still loads through the page. How the tracker itself behaves is the
// factory suite's, on the test world.
const fs = require("fs");
const path = require("path");
const { test, expect, openSettings, launchTracker, waitForTracker, readWorld, SAVE_FIXTURES } = require("./fixtures");

const manifest = readWorld("manifest.json");
const version = readWorld("version.json").version;
// Counted from the files themselves rather than from what the page assembled, so a
// check lost on the way in can't lower the answer with it.
const countChecks = node => (node.item_checks || []).length +
    (node.subregions || []).reduce((sum, sub) => sum + countChecks(sub), 0);
const checksInFiles = manifest.reduce((sum, file) => sum + countChecks(readWorld(file)), 0);

test.describe("Game data", () => {
    test("the settings page loads clean", { tag: "@smoke" }, async ({ page }) => {
        await openSettings(page);
        await expect(page.locator("#settings-list .setting-row").first()).toBeVisible();
        await expect(page.locator("#app-version")).toContainText(version);
    });

    test("the tracker loads clean and draws every region and check in the data", { tag: "@smoke" }, async ({ page }) => {
        await launchTracker(page);
        expect(await page.evaluate(() => window.TrackerData.failedRegions.length)).toBe(0);
        await expect(page.locator(".region-group")).toHaveCount(manifest.length);
        await expect(page.locator(".region-check-item")).toHaveCount(checksInFiles);
        // Every check judged one way or the other by the first sweep.
        await expect(page.locator(".region-check-item:not(.accessible):not(.inaccessible)")).toHaveCount(0);
        await expect(page.locator("#app-version")).toContainText(version);
    });

    test("the format-1 fixture loads through the page and resumes as it was saved", { tag: "@webkit" }, async ({ page }) => {
        const expected = JSON.parse(fs.readFileSync(path.join(SAVE_FIXTURES, "format1.expected.json"), "utf8")).snapshot;
        await openSettings(page);
        await page.locator("#load-file").click();
        await page.locator("#load-file-dialog input[type=file]").setInputFiles(path.join(SAVE_FIXTURES, "format1.json"));
        await expect(page.locator("#save-load-message")).toContainText("Loaded the file");
        await page.locator("#resume-tracker").click();
        await waitForTracker(page);
        const state = await page.evaluate(() => window.TrackerSave.snapshot());
        // toMatchObject: a setting or slot added since the fixture takes its default.
        expect(state.settings).toMatchObject(expected.settings);
        expect(state.slots).toMatchObject(expected.slots);
        expect(state.view).toEqual(expected.view);
        expect([...state.checks].sort()).toEqual([...expected.checks].sort());
    });
});
