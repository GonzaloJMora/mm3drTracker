// The settings page: every kind of control, locks, the Starting Items slots, Reset
// to Defaults and Launch New Tracker. Which settings it uses is read from
// data/settings.json, so editing that file can't break these.
const fs = require("fs");
const path = require("path");
const { test, expect, openSettings, waitForTracker, slot, PHONE } = require("./fixtures");

const settingsFile = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "data", "settings.json"), "utf8"));
const allSettings = settingsFile.sections.flatMap(section => section.groups.flatMap(group => group.settings));
const lockedIds = allSettings.filter(setting => setting.forced).map(setting => setting.id);
// Settings a lock depends on: changing one of these could lock something else.
const lockCauses = allSettings.flatMap(setting => (setting.forced || []).flatMap(rule => Object.keys(rule.when)));

// The row for a setting, found by its name, which the page shows.
async function rowFor(page, id) {
    const name = await page.evaluate(settingId => window.SettingsState.describe(settingId).name, id);
    return page.locator(".setting-row").filter({ has: page.locator(".setting-name", { hasText: new RegExp(`^${escape(name)}$`) }) });
}

function escape(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Settings of a class that nothing locks and that lock nothing, shown as rows.
function freeSettings(page, className) {
    const avoid = [...lockedIds, ...lockCauses];
    return page.evaluate(({ wanted, avoid }) => window.SettingsState.list()
        .map(entry => window.SettingsState.describe(entry.id))
        .filter(description => description.class === wanted && !description.slot && !avoid.includes(description.id))
        .map(description => description.id), { wanted: className, avoid });
}

const value = (page, id) => page.evaluate(settingId => window.SettingsState.get(settingId), id);

test.describe("Settings page", () => {
    test("a toggle, a dropdown and a number each change their setting", { tag: "@smoke" }, async ({ page }) => {
        await openSettings(page);

        const [toggle] = await freeSettings(page, "toggle");
        const before = await value(page, toggle);
        await (await rowFor(page, toggle)).locator(".setting-switch").click();
        expect(await value(page, toggle)).toBe(!before);
        await expect(await rowFor(page, toggle)).toHaveClass(/changed/);

        const [dropdown] = await freeSettings(page, "dropdown");
        const options = await page.evaluate(id => window.SettingsState.describe(id).options.map(option => option.id), dropdown);
        const other = options.find(option => option !== options[0] && option !== "vanilla") || options[1];
        // force: WebKit reports these dropdowns' computed visibility as the hidden
        // they had while the page loaded, though they draw and take clicks.
        await (await rowFor(page, dropdown)).locator("select").selectOption(other, { force: true });
        expect(await value(page, dropdown)).toBe(other);

        const [number] = await freeSettings(page, "number");
        const { max } = await page.evaluate(id => window.SettingsState.describe(id), number);
        const field = (await rowFor(page, number)).locator("input[type=number]");
        await field.fill(String(max + 100));
        await field.press("Enter");
        await field.blur();
        // Out of range is clamped to the top, never handed on as typed.
        expect(await value(page, number)).toBe(max);
        await expect(field).toHaveValue(String(max));

        await expect(page.locator("#settings-panel-title .settings-count")).not.toHaveText("0 changed");
    });

    test("a lock forces its setting and disables the control", async ({ page }) => {
        await openSettings(page);
        const lock = allSettings
            .flatMap(setting => (setting.forced || []).map(rule => ({ id: setting.id, when: rule.when, value: rule.value })))
            .find(rule => Object.values(rule.when).every(wanted => !Array.isArray(wanted)));
        expect(lock, "settings.json has no lock to test").toBeTruthy();

        const row = await rowFor(page, lock.id);
        const control = row.locator("input, select");
        await page.evaluate(when => Object.entries(when).forEach(([id, wanted]) => window.SettingsState.set(id, wanted)), lock.when);
        expect(await value(page, lock.id)).toEqual(lock.value);
        await expect(control).toBeDisabled();
        await expect(row.locator(".setting-lock-note")).toContainText("Locked by");
    });

    test("a Starting Items slot steps the setting behind it, both ways", async ({ page }) => {
        await openSettings(page);
        const target = page.locator(".grid-container .item-slot.starting-choice:not(.locked-on)").first();
        const id = await target.getAttribute("data-id");
        const controller = await page.evaluate(slotId => window.SettingsState.slotSettings(slotId).controller, id);
        const start = await value(page, controller);

        await target.click();
        const stepped = await value(page, controller);
        expect(stepped).not.toEqual(start);
        await expect(slot(page, id)).not.toHaveClass(/dimmed/);

        await target.click({ button: "right" });
        expect(await value(page, controller)).toEqual(start);
    });

    test("Reset to Defaults puts every setting back", async ({ page, dialogs }) => {
        await openSettings(page);
        const [toggle] = await freeSettings(page, "toggle");
        await (await rowFor(page, toggle)).locator(".setting-switch").click();
        await page.locator(".grid-container .item-slot.starting-choice:not(.locked-on)").first().click();
        expect(Object.keys(await page.evaluate(() => window.SettingsState.picks())).length).toBeGreaterThan(0);

        await page.locator("#reset-settings").click();
        expect(dialogs.messages.at(-1)).toContain("Reset every setting");
        expect(await page.evaluate(() => window.SettingsState.picks())).toEqual({});
        await expect(page.locator(".setting-row.changed")).toHaveCount(0);
    });

    test("Launch New Tracker opens the tracker on the settings picked", { tag: "@smoke" }, async ({ page }) => {
        await openSettings(page);
        // A starting item picked through its slot, and a free toggle.
        const target = page.locator(".grid-container .item-slot.starting-choice.dimmed:not(.locked-on)").first();
        const slotId = await target.getAttribute("data-id");
        await target.click();
        const [toggle] = await freeSettings(page, "toggle");
        await (await rowFor(page, toggle)).locator(".setting-switch").click();
        const picks = await page.evaluate(() => window.SettingsState.picks());
        const startingValue = await page.evaluate(id => window.GameState.slotValue(id), slotId);

        await page.locator("#launch-new-tracker").click();
        await waitForTracker(page);

        expect(await page.evaluate(() => window.SettingsState.picks())).toEqual(picks);
        await expect(slot(page, slotId)).not.toHaveClass(/dimmed/);
        expect(await page.evaluate(id => window.GameState.slotValue(id), slotId)).toBe(startingValue);
        // A starting item is a floor: clicking can't take it away.
        const range = await page.evaluate(id => window.GameState.slotRange(id), slotId);
        expect(range.bottom).toBe(startingValue);
    });

    test("the inventory options move under the grids in the phone layout", async ({ page }) => {
        await openSettings(page);
        const inPanel = page.locator("#settings-list #starting-extras, #settings-list .settings-block").last();
        await expect(page.locator("#starting-extras .settings-block")).toHaveCount(0);
        await page.setViewportSize(PHONE);
        await expect(page.locator("#starting-extras .settings-block")).toHaveCount(1);
        await page.setViewportSize({ width: 1920, height: 1080 });
        await expect(page.locator("#starting-extras .settings-block")).toHaveCount(0);
        await expect(inPanel).toBeAttached();
    });
});
