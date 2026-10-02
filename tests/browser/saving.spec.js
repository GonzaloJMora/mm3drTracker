// Saving and loading: the autosave and a reload, Export and Load From File in both
// forms, the previous run, two tabs, refused saves, and the format-1 fixture
// through the real page. The codec itself is tests/node/saves.test.js.
const fs = require("fs");
const path = require("path");
const { test, expect, launchTracker, openSettings, waitForTracker, settle, slot, PHONE } = require("./fixtures");

const FIXTURES = path.join(__dirname, "..", "fixtures", "saves");

const snapshot = page => page.evaluate(() => window.TrackerSave.snapshot());
const sortedChecks = state => Object.assign({}, state, { checks: [...state.checks].sort() });

// Settles once the stored autosave holds exactly what the page holds.
async function autosaved(page) {
    await expect.poll(() => page.evaluate(() => {
        const stored = JSON.parse(window.localStorage.getItem(window.StorageKeys.key("autosave")) || "null");
        return Boolean(stored) && stored.code === window.TrackerDebug.saveCode();
    }), { timeout: 5000 }).toBe(true);
}

const stored = (page, name) => page.evaluate(slotName =>
    JSON.parse(window.localStorage.getItem(window.StorageKeys.key(slotName)) || "null"), name);

// Some progress: an item, two ticked locations and a view toggle.
async function makeProgress(page) {
    const id = await page.evaluate(() => window.GameState.gridSlots().find(slotId => {
        const range = window.GameState.slotRange(slotId);
        return range.top > range.bottom && window.GameState.slotValue(slotId) === range.bottom;
    }));
    await slot(page, id).click();
    await page.evaluate(() => [...document.querySelectorAll(".region-check-item:not(.completed)")]
        .slice(0, 2).forEach(row => row.click()));
    const menu = page.locator("#header-menu-button");
    const inMenu = await menu.isVisible();
    if (inMenu) await menu.click();
    await page.locator("#toggle-non-randomized").click();
    if (inMenu) await page.keyboard.press("Escape");
    await settle(page);
}

async function exportCode(page) {
    if (await page.locator("#header-menu-button").isVisible()) await page.locator("#header-menu-button").click();
    await page.locator("#export-tracker").click();
    const code = await page.locator("#export-dialog textarea").inputValue();
    await page.locator("#export-dialog .save-dialog-close").click();
    return code;
}

async function pasteCode(page, code) {
    if (await page.locator("#header-menu-button").isVisible()) await page.locator("#header-menu-button").click();
    await page.locator("#load-file").click();
    await page.locator("#load-file-dialog textarea").fill(code);
    await page.locator("#load-file-dialog").getByRole("button", { name: "Load Code" }).click();
}

const message = page => page.locator("#save-load-message");

async function resume(page) {
    await page.locator("#resume-tracker").click();
    await waitForTracker(page);
}

test.describe("Saving", () => {
    test("the autosave keeps up, and a reload carries on where it was", { tag: "@smoke" }, async ({ page }) => {
        await launchTracker(page);
        await makeProgress(page);
        await autosaved(page);
        const before = await snapshot(page);
        await page.reload();
        await waitForTracker(page);
        expect(sortedChecks(await snapshot(page))).toEqual(sortedChecks(before));
    });

    test("an exported code, pasted into Load From File and resumed, is the same run, phone to desktop", { tag: "@smoke" }, async ({ page }) => {
        await page.setViewportSize(PHONE);
        await launchTracker(page);
        await makeProgress(page);
        const before = await snapshot(page);
        const code = await exportCode(page);
        expect(code).toBe(await page.evaluate(() => window.TrackerDebug.saveCode()));

        await page.setViewportSize({ width: 1920, height: 1080 });
        await openSettings(page);
        await pasteCode(page, code);
        await expect(message(page)).toContainText("Loaded the pasted code");
        await resume(page);
        expect(sortedChecks(await snapshot(page))).toEqual(sortedChecks(before));
    });

    test("Download File saves a file that Load From File reads back", async ({ page }) => {
        await launchTracker(page);
        await makeProgress(page);
        const before = await snapshot(page);
        await page.locator("#export-tracker").click();
        const [download] = await Promise.all([
            page.waitForEvent("download"),
            page.locator("#export-dialog").getByRole("button", { name: "Download File" }).click()
        ]);
        expect(download.suggestedFilename()).toMatch(/^mm3drTracker-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
        const file = await download.path();

        await openSettings(page);
        await page.locator("#load-file").click();
        await page.locator("#load-file-dialog input[type=file]").setInputFiles(file);
        await expect(message(page)).toContainText("Loaded the file");
        await resume(page);
        expect(sortedChecks(await snapshot(page))).toEqual(sortedChecks(before));
    });

    test("Load From Autosave locks the save's settings until it's let go", async ({ page }) => {
        await openSettings(page);
        await launchTracker(page, { [await firstFreeToggle(page)]: true });
        await makeProgress(page);
        await autosaved(page);
        await page.locator("#back-to-settings").click();
        await page.waitForURL(/index\.html/);
        await openSettings(page);

        await page.locator("#load-autosave").click();
        await expect(message(page)).toContainText("Loaded the current run");
        await expect(page.locator("#resume-tracker")).toBeVisible();
        expect(await page.locator("#settings-list .setting-row input:enabled, #settings-list .setting-row select:enabled").count()).toBe(0);

        await page.locator("#reset-settings").click();
        await expect(page.locator("#resume-tracker")).toBeHidden();
        expect(await page.locator("#settings-list .setting-row select:enabled").count()).toBeGreaterThan(0);
    });

    test("Launch New Tracker keeps the old run as the previous run", async ({ page, dialogs }) => {
        await launchTracker(page);
        await makeProgress(page);
        await autosaved(page);
        const oldRun = (await stored(page, "autosave")).runId;

        await openSettings(page);
        await page.locator("#launch-new-tracker").click();
        expect(dialogs.messages.at(-1)).toContain("previous run");
        await waitForTracker(page);
        expect((await stored(page, "previousRun")).runId).toBe(oldRun);

        await openSettings(page);
        await page.locator("#load-autosave").click();
        const chooser = page.locator("#autosave-chooser");
        await expect(chooser).toContainText("The current run");
        await expect(chooser).toContainText("The previous run");
        await chooser.locator(".save-dialog-row", { hasText: "The previous run" }).getByRole("button", { name: "Load" }).click();
        await expect(message(page)).toContainText("Loaded the previous run");
    });

    test("a second tab on another run stops autosaving and says so, until it takes over", async ({ page, context }) => {
        await launchTracker(page);
        await makeProgress(page);
        await autosaved(page);

        // A new run started in another tab takes the autosave, the way a player does it.
        const other = await context.newPage();
        await other.setViewportSize({ width: 1920, height: 1080 });
        await openSettings(other);
        await other.locator("#launch-new-tracker").click();
        await waitForTracker(other);
        await autosaved(other);

        const banner = page.locator("#autosave-warning");
        await expect(banner).toBeVisible();
        await expect(banner).toContainText("isn't autosaving");
        await banner.getByRole("button", { name: "Autosave This Tab" }).click();
        await autosaved(page);
        await expect(other.locator("#autosave-warning")).toBeVisible();
    });

    test("damaged, newer and foreign saves are refused, naming why", async ({ page }) => {
        await launchTracker(page);
        const code = await page.evaluate(() => window.TrackerDebug.saveCode());
        await openSettings(page);

        const middle = Math.floor(code.length / 2);
        await pasteCode(page, code.slice(0, middle) + (code[middle] === "A" ? "B" : "A") + code.slice(middle + 1));
        await expect(message(page)).toContainText("is damaged");
        await expect(page.locator("#resume-tracker")).toBeHidden();

        const newer = await page.evaluate(() => {
            const layout = Object.assign({}, window.TrackerData.saveLayout, { format: window.TrackerData.saveLayout.format + 1 });
            return window.SaveCodec.encode({}, layout).code;
        });
        await pasteCode(page, newer);
        await expect(message(page)).toContainText("newer version");

        await pasteCode(page, JSON.stringify({ app: "someOtherTracker", code }));
        await expect(message(page)).toContainText("isn't a save from this tracker");
        await expect(page.locator("#resume-tracker")).toBeHidden();
    });

    test("the format-1 fixture loads through the page and resumes as it was saved", { tag: "@webkit" }, async ({ page }) => {
        const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, "format1.expected.json"), "utf8")).snapshot;
        await openSettings(page);
        await page.locator("#load-file").click();
        await page.locator("#load-file-dialog input[type=file]").setInputFiles(path.join(FIXTURES, "format1.json"));
        await expect(message(page)).toContainText("Loaded the file");
        await resume(page);
        const state = await snapshot(page);
        // toMatchObject: a setting or slot added since the fixture takes its default.
        expect(state.settings).toMatchObject(expected.settings);
        expect(state.slots).toMatchObject(expected.slots);
        expect(state.view).toEqual(expected.view);
        expect([...state.checks].sort()).toEqual([...expected.checks].sort());
    });
});

// A toggle the save will hold, so the lock is visible on a row.
function firstFreeToggle(page) {
    return page.evaluate(() => new Promise(resolve => window.TrackerData.onReady(() => {
        const found = window.SettingsState.list().find(entry => {
            const description = window.SettingsState.describe(entry.id);
            return description.class === "toggle" && !description.slot && !entry.forced;
        });
        resolve(found.id);
    })));
}
