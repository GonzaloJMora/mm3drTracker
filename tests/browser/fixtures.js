// What every browser test shares: a failure on any console warning, error or
// uncaught exception, confirm() dialogs answered yes, and helpers that open the two
// pages the way a player does. Specs import { test, expect } from here, never from
// @playwright/test directly, or they lose the console check.
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

// The facts the tests can't work out from the data: tests/fixtures/majorasMask.json.
const gameFacts = require("../fixtures/majorasMask.json");

const DESKTOP = { width: 1920, height: 1080 };
const PHONE = { width: 390, height: 844 };

module.exports = {
    test, expect,
    openSettings, launchTracker, waitForTracker, waitForPage,
    readChecks, statusNumbers, settle, slot,
    gameFacts, DESKTOP, PHONE, SETTINGS, TRACKER
};
