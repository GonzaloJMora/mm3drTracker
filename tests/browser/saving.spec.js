// Saving and loading: the autosave and a reload, Export and Load From File in both
// forms, the previous run, two tabs, and refused saves. The codec itself is
// tests/node/saves.test.js; the game's released saves are the game suite's.
const { test, expect, launchTracker, openSettings, waitForTracker, settle, slot, PHONE } = require("./fixtures");

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
        await page.locator("#export-dialog .save-dialog-close").click();

        // The run moves on in the autosave, so resuming the file has to bring back the
        // file's state, not the newer copy of the same run.
        await page.evaluate(() => document.querySelector(".region-check-item:not(.completed)").click());
        await settle(page);
        await autosaved(page);

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
        // Cancel launches nothing and leaves both slots as they were.
        dialogs.answer = false;
        await page.locator("#launch-new-tracker").click();
        expect(dialogs.messages.at(-1)).toContain("previous run");
        await expect(page).toHaveURL(/index\.html$/);
        expect((await stored(page, "autosave")).runId).toBe(oldRun);
        expect(await stored(page, "previousRun")).toBeNull();

        dialogs.answer = true;
        await page.locator("#launch-new-tracker").click();
        await waitForTracker(page);
        expect((await stored(page, "previousRun")).runId).toBe(oldRun);

        await openSettings(page);
        await page.locator("#load-autosave").click();
        const chooser = page.locator("#autosave-chooser");
        await expect(chooser).toContainText("The current run");
        await expect(chooser).toContainText("The previous run");
        await chooser.locator(".save-dialog-row", { hasText: "The previous run" }).getByRole("button", { name: "Load" }).click();
        await expect(message(page)).toContainText("Loaded the previous run");

        // Resuming it opens the old run, and the two runs trade slots.
        const newRun = (await stored(page, "autosave")).runId;
        await resume(page);
        expect(await page.evaluate(() => window.TrackerLaunch.readRunId())).toBe(oldRun);
        expect((await stored(page, "autosave")).runId).toBe(oldRun);
        expect((await stored(page, "previousRun")).runId).toBe(newRun);
    });

    test("a second tab on another run stops autosaving and says so, until it takes over", async ({ page, context }) => {
        await launchTracker(page);
        await makeProgress(page);
        await autosaved(page);
        const ownRun = (await stored(page, "autosave")).runId;

        // A new run started in another tab takes the autosave, the way a player does it.
        const other = await context.newPage();
        await other.setViewportSize({ width: 1920, height: 1080 });
        await openSettings(other);
        await other.locator("#launch-new-tracker").click();
        await waitForTracker(other);
        await autosaved(other);
        const otherRun = (await stored(other, "autosave")).runId;

        const banner = page.locator("#autosave-warning");
        await expect(banner).toBeVisible();
        await expect(banner).toContainText("isn't autosaving");

        // Progress made here after that, and the reload's page-hide write, reach this
        // tab's handoff only, never the other run in the autosave.
        await page.evaluate(() => document.querySelector(".region-check-item:not(.completed)").click());
        await settle(page);
        const before = await snapshot(page);
        await page.reload();
        await waitForTracker(page);
        expect(sortedChecks(await snapshot(page))).toEqual(sortedChecks(before));
        await expect(banner).toContainText("isn't autosaving");
        expect((await stored(page, "autosave")).runId).toBe(otherRun);

        // Taking over keeps the other run as the previous run.
        await banner.getByRole("button", { name: "Autosave This Tab" }).click();
        await autosaved(page);
        expect((await stored(page, "autosave")).runId).toBe(ownRun);
        expect((await stored(page, "previousRun")).runId).toBe(otherRun);
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
