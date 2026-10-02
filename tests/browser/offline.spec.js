// The offline copy: the worker stores the site on the first visit, both pages and a
// run carry on with the network gone, and data/offline.json's off switch removes it
// all. Chromium only: Playwright can't take WebKit offline on every platform.
const { test, expect, launchTracker, openSettings, waitForTracker, waitForPage, settle, slot } = require("./fixtures");

test.use({ serviceWorkers: "allow" });

// Until the worker controls the page and has stored every file on the list.
async function stored(page) {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(async () => {
        const list = await fetch("data/offline.json", { cache: "no-store" }).then(response => response.json());
        const cache = await caches.open(`offline:${(await navigator.serviceWorker.ready).scope}`);
        return (await cache.keys()).length >= list.files.length;
    }), { timeout: 30_000 }).toBe(true);
}

test.describe("Offline", () => {
    test.skip(({ browserName }) => browserName !== "chromium", "offline is emulated in Chromium only");

    test("with the network gone, both pages load and a run carries on", async ({ page, context }) => {
        await openSettings(page);
        await stored(page);
        await launchTracker(page);
        const id = await page.evaluate(() => window.GameState.gridSlots().find(slotId => {
            const range = window.GameState.slotRange(slotId);
            return range.top > range.bottom;
        }));
        await slot(page, id).click();
        await page.evaluate(() => document.querySelector(".region-check-item").click());
        await settle(page);
        const before = await page.evaluate(() => window.TrackerDebug.saveCode());
        await expect.poll(() => page.evaluate(() =>
            JSON.parse(window.localStorage.getItem(window.StorageKeys.key("autosave")) || "{}").code)).toBe(before);

        await context.setOffline(true);
        await page.reload();
        await waitForTracker(page);
        expect(await page.evaluate(() => window.TrackerDebug.saveCode())).toBe(before);
        await expect(page.locator(".region-group")).toHaveCount(await page.evaluate(() => window.TrackerData.regions.length));

        await page.goto("index.html");
        await waitForPage(page);
        await expect(page.locator("#settings-list .setting-row").first()).toBeVisible();
        await context.setOffline(false);
    });

    test("the off switch in data/offline.json removes the worker and the stored copy", async ({ page, context }) => {
        await openSettings(page);
        await stored(page);

        // On the context: the worker fetches it now, and a page route never sees that.
        await context.route("**/data/offline.json", async route => {
            const response = await route.fetch();
            const list = await response.json();
            await route.fulfill({ response, json: Object.assign(list, { enabled: false }) });
        });
        await page.reload();
        await waitForPage(page);
        await expect.poll(() => page.evaluate(async () => ({
            workers: (await navigator.serviceWorker.getRegistrations()).length,
            stored: (await caches.keys()).filter(name => name.startsWith("offline:")).length
        })), { timeout: 15_000 }).toEqual({ workers: 0, stored: 0 });
    });
});
