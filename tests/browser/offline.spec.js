// The offline copy: the worker stores the site on the first visit, both pages and a
// run carry on with the network gone, and data/offline.json's off switch removes it
// all. Chromium only: Playwright can't take WebKit offline on every platform.
const { test, expect, launchTracker, openSettings, waitForTracker, waitForPage, settle, slot, readWorld } = require("./fixtures");

test.use({ serviceWorkers: "allow" });

const LISTED = readWorld("offline.json").files;

// Until the worker controls the page and has stored every file on the list, each by
// its own address: the cache also holds the worker's refresh timestamp, so a count
// would pass with one file missing.
async function stored(page) {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(async listed => {
        const scope = (await navigator.serviceWorker.ready).scope;
        const cache = await caches.open(`offline:${scope}`);
        const keys = (await cache.keys()).map(request => request.url);
        return listed.filter(file => !keys.includes(new URL(file, scope).href));
    }, LISTED), { timeout: 30_000 }).toEqual([]);
}

test.describe("Offline", () => {
    test.skip(({ browserName }) => browserName !== "chromium", "offline is emulated in Chromium only");

    test("with the network gone, both pages load and a run carries on", { tag: "@built" }, async ({ page, context }) => {
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

        // The bare address, which a Home Screen app opens, and which nothing here opened
        // online: only the worker's own first visit stored it.
        await page.goto("./");
        await waitForPage(page);
        await expect(page.locator("#settings-list .setting-row").first()).toBeVisible();
        await context.setOffline(false);
    });

    // Script addresses are stamped with the version on the live site, and each
    // release must replace a file's stored copy, not add one beside it.
    test("a file asked for under a version stamp is stored once, without the stamp", { tag: "@built" }, async ({ page }) => {
        await openSettings(page);
        await stored(page);
        const keys = () => page.evaluate(async () => {
            const cache = await caches.open(`offline:${(await navigator.serviceWorker.ready).scope}`);
            return (await cache.keys()).map(request => request.url);
        });
        const before = (await keys()).length;
        await page.evaluate(() => Promise.all(["one", "two"].map(stampValue => fetch(`js/storageKeys.js?v=${stampValue}`))));
        await expect.poll(async () => (await keys()).filter(url => url.includes("?"))).toEqual([]);
        expect((await keys()).length).toBe(before);
    });

    // v0.15.0's worker stored addresses with their query, in the same cache. Left in
    // place, such an entry answers ahead of the fresh copy of its file once offline.
    test("an entry stored under an address with a query is gone once a new worker takes over", async ({ page, context, allowConsole }) => {
        allowConsole.push(/offline copy could not be set up/, /404/);
        // No worker yet, so the cache holds only what an earlier one left.
        await context.route("**/offlineWorker.js", route => route.fulfill({ status: 404, body: "" }));
        await openSettings(page);
        await page.evaluate(async () => {
            const scope = new URL("./", location.href).href;
            const cache = await caches.open(`offline:${scope}`);
            await cache.put(`${scope}tracker.html?defaults`, new Response("OLD", { headers: { "content-type": "text/html" } }));
            await cache.put(`${scope}js/storageKeys.js?v=old`, new Response("// OLD", { headers: { "content-type": "text/javascript" } }));
        });
        await context.unroute("**/offlineWorker.js");
        await page.reload();
        await waitForPage(page);
        await stored(page);

        const keys = await page.evaluate(async () => {
            const cache = await caches.open(`offline:${(await navigator.serviceWorker.ready).scope}`);
            return (await cache.keys()).map(request => request.url);
        });
        expect(keys.filter(url => url.includes("?"))).toEqual([]);
        await context.setOffline(true);
        const answers = await page.evaluate(addresses => Promise.all(addresses.map(address =>
            fetch(address).then(response => response.text()).then(text => text.includes("OLD")))),
            ["tracker.html", "tracker.html?defaults", "js/storageKeys.js"]);
        await context.setOffline(false);
        expect(answers).toEqual([false, false, false]);
    });

    // A page only loads its own files, so after a release the files neither page loaded
    // online are brought up to date by the worker's background refresh alone.
    test("a file no page loaded is refreshed in the background once the refresh is due", async ({ page, context }) => {
        await openSettings(page);
        await stored(page);

        // Every stored entry that isn't a listed file goes, the refresh timestamp with
        // it, so the refresh is due.
        await page.evaluate(async listed => {
            const scope = (await navigator.serviceWorker.ready).scope;
            const cache = await caches.open(`offline:${scope}`);
            const files = listed.map(file => new URL(file, scope).href);
            for (const request of await cache.keys()) {
                if (!files.includes(request.url)) await cache.delete(request);
            }
        }, LISTED);

        // A release changes a region file, which the settings page never loads.
        const region = `data/${readWorld("manifest.json")[0]}`;
        await context.route(`**/${region}`, async route => {
            const response = await route.fetch();
            await route.fulfill({ response, json: Object.assign(await response.json(), { released: "next" }) });
        });
        await page.reload();
        await waitForPage(page);
        await expect.poll(() => page.evaluate(async file => {
            const cache = await caches.open(`offline:${(await navigator.serviceWorker.ready).scope}`);
            const copy = await cache.match(file);
            return copy ? (await copy.json()).released : undefined;
        }, region), { timeout: 15_000 }).toBe("next");
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
