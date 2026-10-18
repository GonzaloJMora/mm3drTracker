// What every browser test shares: a failure on any console warning, error or
// uncaught exception, confirm() dialogs answered yes, and helpers that open the two
// pages the way a player does. Specs import { test, expect } from here, never from
// @playwright/test directly, or they lose the console check. The game suite's
// tests/game/browser/fixtures.js builds on this file.
const fs = require("fs");
const path = require("path");
const { test: base, expect } = require("@playwright/test");

const SETTINGS = "index.html";
const TRACKER = "tracker.html";

const test = base.extend({
    // A test that triggers a warning on purpose pushes a pattern for it here.
    allowConsole: async ({}, use) => {
        await use([]);
    },

    // Every confirm() and alert() is accepted, and its text kept for tests that
    // check what was asked. A test that wants "no" sets dialogs.answer = false.
    dialogs: async ({ context }, use) => {
        const dialogs = { messages: [], answer: true };
        const watch = page => page.on("dialog", dialog => {
            dialogs.messages.push(dialog.message());
            return dialogs.answer ? dialog.accept() : dialog.dismiss();
        });
        context.pages().forEach(watch);
        context.on("page", watch);
        await use(dialogs);
    },

    // Auto: on for every test, in every page the test opens.
    consoleCheck: [async ({ context, allowConsole, dialogs }, use) => {
        const problems = [];
        const watch = page => {
            page.on("console", message => {
                if (message.type() === "warning" || message.type() === "error") {
                    problems.push(`${message.type()}: ${message.text()}`);
                }
            });
            page.on("pageerror", error => problems.push(`uncaught exception: ${error.message}`));
        };
        context.pages().forEach(watch);
        context.on("page", watch);
        await use();
        // Lines the test harness causes, never the page: Playwright blocking the
        // offline worker, and Firefox noting that the harness's own script ("debugger
        // eval code") measured the page before it finished loading.
        const harness = /Service Worker registration blocked by Playwright|Layout was forced before the page was fully loaded.*debugger eval code/;
        const unexpected = problems.filter(line => !harness.test(line) && !allowConsole.some(pattern => pattern.test(line)));
        expect(unexpected, "the page printed warnings or errors, or threw").toEqual([]);
    }, { auto: true }]
});

// Hidden by CSS until every file has drawn from the data.
async function waitForPage(page) {
    await expect(page.locator("main")).not.toHaveClass(/awaiting-data/);
}

async function openSettings(page) {
    await page.goto(SETTINGS);
    await waitForPage(page);
    await expect(page.locator("#launch-new-tracker")).toBeEnabled();
}

async function waitForTracker(page) {
    await page.waitForURL(/tracker\.html/);
    await waitForPage(page);
    await expect(page.locator(".region-group").first()).toBeAttached();
    await expect(page.locator("#location-status-line")).not.toBeEmpty();
}

// The handoff the settings page's Launch New Tracker writes, without the clicks:
// for tests about the tracker rather than about launching it. picks is
// { settingId: value }; anything left out is the default.
async function launchTracker(page, picks = {}) {
    await openSettings(page);
    await page.evaluate(chosen => {
        window.TrackerLaunch.open(chosen, { runId: window.SaveStore.newRunId() });
    }, picks);
    await waitForTracker(page);
}

// Every check on the page with what the test needs to judge it, read in one go.
function readChecks(page) {
    return page.evaluate(() => [...document.querySelectorAll(".region-check-item")].map(row => ({
        id: row.dataset.checkId,
        region: row.closest(".region-group").dataset.regionName,
        accessible: row.classList.contains("accessible"),
        inaccessible: row.classList.contains("inaccessible"),
        completed: row.classList.contains("completed"),
        vanilla: row.classList.contains("vanilla")
    })));
}

// The three numbers of the progress line, as numbers.
async function statusNumbers(page) {
    const text = await page.locator("#location-status-line").textContent();
    const match = text.match(/(\d+) accessible \| (\d+) checked \| (\d+) remaining/);
    if (!match) throw new Error(`unexpected progress line: "${text}"`);
    return { accessible: Number(match[1]), checked: Number(match[2]), remaining: Number(match[3]) };
}

// Waits for the tracker's count updates, which run on a frame or a short timeout.
async function settle(page) {
    await page.evaluate(() => new Promise(resolve => {
        requestAnimationFrame(() => setTimeout(resolve, 300));
    }));
}

// A grid slot by its id.
function slot(page, id) {
    return page.locator(`.grid-container .item-slot[data-id="${id}"]`);
}

// Reads a file of the world a suite runs on, as the page receives it from data/.
function worldReader(dataFolder) {
    return file => JSON.parse(fs.readFileSync(path.join(dataFolder, file), "utf8"));
}

// This suite's world is tests/environment, never the game's data/, so it runs the same
// for any game or none.
const readWorld = worldReader(path.join(__dirname, "..", "environment", "data"));

const DESKTOP = { width: 1920, height: 1080 };
const PHONE = { width: 390, height: 844 };

// The test world's regions in display order, each with its count and the Legend
// label of its color at each step, from tests/environment/README.md: the region
// count and region color tables in the README's *Expected answers* (`chests` is its
// Swamp, chests ticked column), and `purple`, the cleared step with South Clock
// Town's randomized checks ticked too. The README gives
// no counts for Everything, or for Mountain Village with every location ticked
// (`cleared`, which reads Checked whatever the inventory), so those are null.
const REGIONS = [
    { name: "South Clock Town", start: ["(3/6)", "Partially Accessible"], swamp: ["(3/6)", "Partially Accessible"],
        chests: ["(3/6)", "Partially Accessible"], everything: [null, "Accessible"], cleared: [null, "Accessible"], purple: ["(1/1)", "Not Randomized"] },
    { name: "North Clock Town", start: ["(2/5)", "Partially Accessible"], swamp: ["(3/5)", "Partially Accessible"],
        chests: ["(3/5)", "Partially Accessible"], everything: [null, "Accessible"], cleared: [null, "Accessible"], purple: [null, "Accessible"] },
    { name: "Woodfall", start: ["(0/8)", "Inaccessible"], swamp: ["(5/8)", "Partially Accessible"],
        chests: ["(2/5)", "Partially Accessible"], everything: [null, "Accessible"], cleared: [null, "Accessible"], purple: [null, "Accessible"] },
    { name: "Mountain Village", start: ["(0/4)", "Inaccessible"], swamp: ["(0/4)", "Inaccessible"],
        chests: ["(0/4)", "Inaccessible"], everything: [null, "Accessible"], cleared: [null, "Checked"], purple: [null, "Checked"] }
];

// The README's Swamp column adds these to Start; Start takes them away again.
const SWAMP_ITEMS = ["deku_mask", "bow", "woodfall_small_key"];
const toSwamp = page => page.evaluate(ids => ids.forEach(id => window.GameState.setSlot(id, 1)), SWAMP_ITEMS);
const backToStart = page => page.evaluate(ids => ids.forEach(id =>
    window.GameState.setSlot(id, window.GameState.slotRange(id).bottom)), SWAMP_ITEMS);
// The README's Everything column: every slot at its top, and the digits 1, 2, 3 (all
// three at their top would be the same digit, which no code allows).
const toEverything = page => page.evaluate(() => {
    const { config } = window.TrackerData;
    let digit = 0;
    window.GameState.gridSlots().forEach(id => window.GameState.setSlot(id,
        window.GameState.slotKind(config, id) === "digit" ? ++digit : window.GameState.slotRange(id).top));
});
// Ticks, or unticks, Woodfall's three chests reachable at Swamp: the `chests` step.
const WOODFALL_CHESTS = ["wf_entrance_chest", "wft_map_chest", "wft_key_chest"];
const tickWoodfallChests = page => page.evaluate(ids => ids.forEach(id => document
    .querySelector(`.region-group[data-region-name="Woodfall"] .region-check-item[data-check-id="${id}"]`)
    .dispatchEvent(new MouseEvent("click", { bubbles: true }))), WOODFALL_CHESTS);
// Ticks every location in Mountain Village, the `cleared` step of REGIONS.
const clearMountainVillage = page => page.evaluate(() => document
    .querySelectorAll('.region-group[data-region-name="Mountain Village"] .region-check-item')
    .forEach(row => row.dispatchEvent(new MouseEvent("click", { bubbles: true }))));
// Ticks South Clock Town's randomized checks, the README's list, for the `purple` step.
const SOUTH_CLOCK_TOWN_RANDOMIZED = ["sct_clock_tower_chest", "sct_hookshot_ledge", "sct_song_spot", "sct_postbox", "sct_heart_door"];
const tickSouthClockTownRandomized = page => page.evaluate(ids => ids.forEach(id => document
    .querySelector(`.region-group[data-region-name="South Clock Town"] .region-check-item[data-check-id="${id}"]`)
    .dispatchEvent(new MouseEvent("click", { bubbles: true }))), SOUTH_CLOCK_TOWN_RANDOMIZED);

// The color an element draws, and the color the Legend row with this label draws: a
// marker's fill, a header's text, a swatch's fill. Not --status-color itself, which
// stays set when the rule that draws with it stops reading it.
const paint = locator => locator.evaluate(el => {
    if (el.matches(".location-map-marker")) return getComputedStyle(el, "::before").backgroundColor;
    if (el.matches(".region-header")) return getComputedStyle(el).color;
    return getComputedStyle(el).backgroundColor;
});
const legendPaint = (page, label) => paint(page.locator(".location-legend-row")
    .filter({ has: page.locator(".location-legend-label", { hasText: new RegExp(`^${label}$`) }) })
    .locator(".location-legend-swatch"));

module.exports = {
    test, expect,
    openSettings, launchTracker, waitForTracker, waitForPage,
    readChecks, statusNumbers, settle, slot,
    readWorld, worldReader, DESKTOP, PHONE, SETTINGS, TRACKER,
    REGIONS, toSwamp, tickWoodfallChests, backToStart, toEverything, clearMountainVillage, tickSouthClockTownRandomized, paint, legendPaint
};
