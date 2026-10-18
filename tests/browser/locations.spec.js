// The region list as a player reads it, ticking off locations, linked checks, and
// the two view toggles. The counts are held to the rows by
// tests/browser/logic.spec.js and to the README here.
const { test, expect, launchTracker, waitForTracker, settle, statusNumbers, slot, PHONE, REGIONS, toSwamp, tickWoodfallChests, backToStart, toEverything, clearMountainVillage, tickSouthClockTownRandomized, paint, legendPaint } = require("./fixtures");

const region = (page, name) => page.locator(`.region-group[data-region-name="${name}"]`);

// A region with an accessible, randomized check on the default settings.
async function openRegionWithAccessibleCheck(page) {
    const target = await page.evaluate(() => {
        const row = document.querySelector(".region-check-item.accessible:not(.vanilla)");
        return { region: row.closest(".region-group").dataset.regionName, check: row.dataset.checkId };
    });
    return target;
}

const check = (page, id) => page.locator(`.region-check-item[data-check-id="${id}"]`);

async function turnOnOnlyAccessible(page, picks) {
    await launchTracker(page, picks);
    await showLocations(page);
    await page.locator("#header-menu-button").click();
    await page.locator("#toggle-only-accessible").click();
    await page.keyboard.press("Escape");
}

async function showLocations(page) {
    const tab = page.locator('.tab-btn[data-tab="locations"]');
    if (await tab.isVisible()) await tab.click();
}

test.describe("Locations", () => {
    test.use({ viewport: PHONE });

    test("tapping a check ticks it off and the counts follow; tapping again undoes it", { tag: "@smoke" }, async ({ page }) => {
        await launchTracker(page);
        await showLocations(page);
        const target = await openRegionWithAccessibleCheck(page);
        const group = region(page, target.region);
        await group.locator(".region-header").click();
        const row = group.locator(`.region-check-item[data-check-id="${target.check}"]`);
        // The info button sits inside the row, and only shows what the check needs.
        const info = row.locator(".region-check-info");
        await info.dispatchEvent("click");
        await expect(row).not.toHaveClass(/completed/);
        await info.dispatchEvent("click");
        const before = await statusNumbers(page);
        const header = await group.locator(".region-header").getAttribute("data-counts");
        const gray = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--status-completed").trim());
        const color = () => row.evaluate(el => getComputedStyle(el).getPropertyValue("--status-color").trim());

        await row.click();
        await expect(row).toHaveClass(/completed/);
        expect(await color()).toBe(gray);
        await settle(page);
        const after = await statusNumbers(page);
        expect(after.checked).toBe(before.checked + 1);
        expect(after.remaining).toBe(before.remaining - 1);
        await expect(group.locator(".region-header")).not.toHaveAttribute("data-counts", header);

        await row.click();
        await expect(row).not.toHaveClass(/completed/);
        expect(await color()).not.toBe(gray);
        await settle(page);
        expect(await statusNumbers(page)).toEqual(before);
    });

    // Back to Start as well as up to Swamp: a header that keeps its old color class or
    // its old count text looks right going up and wrong coming back down. Everything, a
    // cleared region and one left with only a non-randomized check bring in the three
    // colors Start and Swamp never reach.
    test("the region list reads in manifest order, each header showing its count in its color", async ({ page }) => {
        await launchTracker(page);
        await showLocations(page);
        const expectHeaders = async step => {
            const shown = await page.locator(".region-header").evaluateAll(buttons => buttons
                .map(button => ({ name: button.closest(".region-group").dataset.regionName, top: button.getBoundingClientRect().top }))
                .sort((a, b) => a.top - b.top).map(entry => entry.name));
            expect(shown, `${step}: top to bottom`).toEqual(REGIONS.map(r => r.name));
            for (const r of REGIONS) {
                const [count, label] = r[step];
                const button = region(page, r.name).locator(".region-header");
                if (count) await expect(button.locator(".region-count"), `${step}: ${r.name}'s count`).toHaveText(count);
                expect(await paint(button), `${step}: ${r.name}'s color`).toBe(await legendPaint(page, label));
            }
        };
        await expectHeaders("start");

        await toSwamp(page);
        await settle(page);
        await expectHeaders("swamp");

        // Red beside only non-randomized checks still reads partial; unticked, back to Swamp.
        await tickWoodfallChests(page);
        await settle(page);
        await expectHeaders("chests");
        await tickWoodfallChests(page);
        await settle(page);
        await expectHeaders("swamp");

        await backToStart(page);
        await settle(page);
        await expectHeaders("start");

        await toEverything(page);
        await settle(page);
        await expectHeaders("everything");

        await clearMountainVillage(page);
        await settle(page);
        await expectHeaders("cleared");

        await tickSouthClockTownRandomized(page);
        await settle(page);
        await expectHeaders("purple");
    });

    test("checks that are one location tick off together", async ({ page }) => {
        await launchTracker(page);
        const group = await page.evaluate(() => (window.TrackerData.config.check_groups || [])
            .find(ids => ids.filter(id => document.querySelector(`.region-check-item[data-check-id="${id}"]`)).length >= 2));
        expect(group, "no check_group has two checks on the page").toBeTruthy();
        const rows = group.map(id => page.locator(`.region-check-item[data-check-id="${id}"]`));

        await rows[0].first().dispatchEvent("click");
        for (const row of rows) await expect(row.first()).toHaveClass(/completed/);
        await rows.at(-1).first().dispatchEvent("click");
        for (const row of rows) await expect(row.first()).not.toHaveClass(/completed/);
    });

    test("Hide Non-Randomized Checks hides them, and is remembered", { tag: "@smoke" }, async ({ page }) => {
        await launchTracker(page);
        await showLocations(page);
        const vanilla = page.locator(".region-check-item.vanilla").first();
        const name = await vanilla.evaluate(row => row.closest(".region-group").dataset.regionName);
        await region(page, name).locator(".region-header").click();
        await expect(vanilla).toBeVisible();
        const before = await statusNumbers(page);

        await page.locator("#header-menu-button").click();
        const toggle = page.locator("#toggle-non-randomized");
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-pressed", "true");
        await expect(vanilla).toBeHidden();
        await settle(page);
        expect((await statusNumbers(page)).remaining).toBeLessThan(before.remaining);

        await page.reload();
        await waitForTracker(page);
        await expect(page.locator("body")).toHaveClass(/hide-non-randomized/);
        await expect(page.locator("#toggle-non-randomized")).toHaveAttribute("aria-pressed", "true");

        // A reload comes back through the tab's handoff; a new run starts from what
        // the browser remembers.
        await launchTracker(page);
        await expect(page.locator("body")).toHaveClass(/hide-non-randomized/);
        await expect(page.locator("#toggle-non-randomized")).toHaveAttribute("aria-pressed", "true");

        // Each toggle is remembered on its own, off as well as on.
        await page.locator("#header-menu-button").click();
        await page.locator("#toggle-non-randomized").click();
        await page.locator("#toggle-only-accessible").click();
        await page.keyboard.press("Escape");
        await launchTracker(page);
        await expect(page.locator("#toggle-non-randomized")).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator("#toggle-only-accessible")).toHaveAttribute("aria-pressed", "true");
    });

    // The test world's README, Expected answers: the Start column. Shuffle Songs off
    // makes Song Spot a red non-randomized row and moves nothing else.
    test("Show Only Accessible Checks hides red checks and regions with nothing to do", async ({ page }) => {
        await turnOnOnlyAccessible(page, { shuffle_songs: false });
        await expect(check(page, "sct_song_spot")).toHaveClass(/vanilla/);
        await expect(region(page, "Woodfall")).toBeHidden();
        await expect(region(page, "Mountain Village")).toBeHidden();
        for (const name of ["South Clock Town", "North Clock Town"]) {
            await expect(region(page, name)).toBeVisible();
            await region(page, name).locator(".region-header").click();
        }
        for (const id of ["sct_hookshot_ledge", "sct_song_spot", "sct_heart_door",
            "nct_target_practice", "nct_bottle_shop", "nct_odolwa_reward"]) {
            await expect(check(page, id)).toBeHidden();
        }
        for (const id of ["sct_clock_tower_chest", "sct_postbox", "sct_stray_fairy", "nct_postbox", "nct_guards_gift"]) {
            await expect(check(page, id)).toBeVisible();
        }

        // Woodfall's Entrance Chest needs only the Deku Mask, so getting it brings Woodfall back.
        await page.locator('.tab-btn[data-tab="items"]').click();
        await slot(page, "deku_mask").click();
        await showLocations(page);
        await expect(region(page, "Woodfall")).toBeVisible();
    });

    // A region whose every location is ticked has nothing left to do either.
    test("Show Only Accessible Checks hides a region with every location ticked", async ({ page }) => {
        await launchTracker(page);
        await showLocations(page);
        for (const id of ["nct_postbox", "nct_target_practice", "nct_guards_gift", "nct_bottle_shop", "nct_odolwa_reward"]) {
            await check(page, id).dispatchEvent("click");
            await expect(check(page, id)).toHaveClass(/completed/);
        }
        await check(page, "sct_clock_tower_chest").dispatchEvent("click");
        await page.locator("#header-menu-button").click();
        await page.locator("#toggle-only-accessible").click();
        await page.keyboard.press("Escape");
        await expect(region(page, "North Clock Town")).toBeHidden();
        // Its Postbox and Clock Tower Chest are ticked too, but the Stray Fairy is still
        // to do there: non-randomized, and reachable all the same.
        await expect(region(page, "South Clock Town")).toBeVisible();
    });

    test("Show Only Accessible Checks keeps what a tap ticked in view until its region closes", async ({ page }) => {
        await turnOnOnlyAccessible(page);
        const town = region(page, "South Clock Town");
        const header = town.locator(".region-header");
        await header.click();

        // Ticked, and kept in view so a mistaken tap can be undone...
        const chest = check(page, "sct_clock_tower_chest");
        await chest.click();
        await expect(chest).toHaveClass(/completed/);
        await expect(chest).toBeVisible();
        // ...whatever another region does...
        await region(page, "North Clock Town").locator(".region-header").click();
        await expect(chest).toBeVisible();
        // ...until its own region closes.
        await header.click();
        await header.click();
        await expect(chest).toBeHidden();

        // Ticking the region's last accessible checks keeps the region as well, and
        // the Postbox's other row in North Clock Town, open too, stays with it.
        await check(page, "sct_postbox").click();
        await check(page, "sct_stray_fairy").click();
        await expect(town).toBeVisible();
        await expect(check(page, "sct_postbox")).toBeVisible();
        await expect(check(page, "nct_postbox")).toHaveClass(/completed/);
        await expect(check(page, "nct_postbox")).toBeVisible();
        await expect(check(page, "sct_stray_fairy")).toBeVisible();
        await header.click();
        await expect(town).toBeHidden();
    });

    test("Show Only Accessible Checks is phone-only and hides nothing on desktop, and hides again when narrowed", async ({ page }) => {
        await launchTracker(page);
        await page.locator("#header-menu-button").click();
        await page.locator("#toggle-only-accessible").click();
        // 1500 is the first desktop width, where a mistyped breakpoint shows.
        for (const width of [1500, 1920]) {
            await page.setViewportSize({ width, height: 1080 });
            await expect(page.locator("#toggle-only-accessible")).toBeHidden();
            // On desktop the list is the map overlay's storage, so ask the CSS rules
            // for rows and regions rather than whether they are on screen.
            const hidden = await page.evaluate(() => {
                const none = selector => [...document.querySelectorAll(selector)].filter(el => getComputedStyle(el).display === "none").length;
                return { rows: none(".region-check-item"), regions: none(".region-group") };
            });
            expect(hidden, `at ${width}px`).toEqual({ rows: 0, regions: 0 });
        }

        // A tracker opened on desktop with the toggle on hides once the window narrows,
        // from the phone layout's widest.
        await launchTracker(page);
        await page.setViewportSize({ width: 1499, height: 900 });
        await showLocations(page);
        await expect(region(page, "Woodfall")).toBeHidden();
        await region(page, "South Clock Town").locator(".region-header").click();
        await expect(check(page, "sct_hookshot_ledge")).toBeHidden();
        await expect(check(page, "sct_clock_tower_chest")).toBeVisible();
    });
});
