// The desktop map: a marker per region in its region's color and count, and the
// overlay that borrows a region from the list and has to give it back where it
// was, closed. See LAYOUT.md, *Desktop vs mobile*.
const { test, expect, launchTracker, settle, readWorld, PHONE, REGIONS, toSwamp, tickWoodfallChests, backToStart, toEverything,
    clearMountainVillage, tickSouthClockTownRandomized, paint, legendPaint } = require("./fixtures");

// By its accessible name, which is all a screen reader has to tell markers apart.
const marker = (page, name) => page.locator("#location-map-marker-layer").getByRole("button", { name, exact: true });
const header = (page, name) => page.locator(`.region-group[data-region-name="${name}"] .region-header`);
const listOrder = page => page.locator("#region-dropdown-container > .region-group")
    .evaluateAll(groups => groups.map(group => group.dataset.regionName));

// Where each region's file puts its marker, as a share of the map.
const coordinates = new Map(readWorld("manifest.json").map(file => {
    const region = readWorld(file);
    return [region.region_name, region.map_coordinates];
}));

// Every marker against the README at one step: placed where its file says, painted
// the color of its Legend label, and showing its accessible count, or nothing at 0,
// where the README gives one.
async function expectMarkers(page, step) {
    const map = await page.locator("#location-map-container").boundingBox();
    for (const region of REGIONS) {
        const [count, label] = region[step];
        const pin = marker(page, region.name);
        await expect(pin, `${step}: ${region.name}`).toBeVisible();
        expect(await paint(pin), `${step}: ${region.name}'s color`).toBe(await legendPaint(page, label));
        if (count) {
            const accessible = count.match(/^\((\d+)\//)[1];
            await expect(pin, `${step}: ${region.name}'s count`).toHaveText(accessible === "0" ? "" : accessible);
        }

        const box = await pin.boundingBox();
        const x = (box.x + box.width / 2 - map.x) / map.width * 100;
        const y = (box.y + box.height / 2 - map.y) / map.height * 100;
        const want = coordinates.get(region.name);
        expect(Math.abs(x - want.xPercent), `${region.name}'s marker across`).toBeLessThan(0.5);
        expect(Math.abs(y - want.yPercent), `${region.name}'s marker down`).toBeLessThan(0.5);
    }
}

test.describe("Map", () => {
    // Back to Start as well as up to Swamp: a marker that keeps its old color class
    // looks right going up and wrong coming back down. Everything, a cleared region and
    // one left with only a non-randomized check bring in the three colors Start and
    // Swamp never reach.
    test("one marker per region, in its region's place, color and count", { tag: "@smoke" }, async ({ page }) => {
        await launchTracker(page);
        await expect(page.locator(".location-map-marker")).toHaveCount(REGIONS.length);
        await expectMarkers(page, "start");

        await toSwamp(page);
        await settle(page);
        await expectMarkers(page, "swamp");

        // Red beside only non-randomized checks still reads partial; unticked, back to Swamp.
        await tickWoodfallChests(page);
        await settle(page);
        await expectMarkers(page, "chests");
        await tickWoodfallChests(page);
        await settle(page);
        await expectMarkers(page, "swamp");

        await backToStart(page);
        await settle(page);
        await expectMarkers(page, "start");

        await toEverything(page);
        await settle(page);
        await expectMarkers(page, "everything");

        await clearMountainVillage(page);
        await settle(page);
        await expectMarkers(page, "cleared");

        await tickSouthClockTownRandomized(page);
        await settle(page);
        await expectMarkers(page, "purple");
    });

    test("every marker opens its own region, and closing puts it back where it was, closed", async ({ page }) => {
        await launchTracker(page);
        const order = () => listOrder(page);
        const before = await order();
        const overlay = page.locator(".location-map-overlay");

        // Expanded in the list first, which the overlay has to undo on its way out.
        await header(page, before[0]).evaluate(button => button.click());

        for (const [index, name] of before.entries()) {
            await marker(page, name).dispatchEvent("click");
            await expect(overlay.locator(".location-map-overlay-title")).toHaveText(name);
            await expect(overlay.locator(`.region-group[data-region-name="${name}"] .region-content`)).toHaveClass(/open/);
            // The titlebar stands in for the region's own header, which would collapse it.
            await expect(overlay.locator(".region-header")).toBeHidden();
            // The × once, the rest of the titlebar after.
            await overlay.locator(index === 0 ? ".location-map-overlay-close" : ".location-map-overlay-titlebar").click();
            await expect(overlay).toHaveCount(0);
            expect(await order(), `after closing ${name}`).toEqual(before);
        }

        // Another marker while one is open swaps the region in the one overlay.
        const [first, second] = before;
        await marker(page, first).dispatchEvent("click");
        await marker(page, second).dispatchEvent("click");
        await expect(overlay).toHaveCount(1);
        await expect(overlay.locator(".location-map-overlay-title")).toHaveText(second);
        expect(await order(), `with ${second} open over ${first}`).toEqual(before.filter(name => name !== second));
        await overlay.locator(".location-map-overlay-titlebar").click();
        await expect(overlay).toHaveCount(0);
        expect(await order(), `after closing ${second}`).toEqual(before);

        await expect(page.locator(".region-content.open")).toHaveCount(0);
        await expect(page.locator(".region-header.expanded")).toHaveCount(0);
        await expect(page.locator('.region-header[aria-expanded="true"]')).toHaveCount(0);
    });

    test("ticking a check in the overlay updates its marker and titlebar, and nothing else does", async ({ page }) => {
        await launchTracker(page);
        const name = "South Clock Town";
        await marker(page, name).dispatchEvent("click");
        const overlay = page.locator(".location-map-overlay");
        const count = overlay.locator(".location-map-overlay-count");
        await expect(count).toHaveText("(3/6)");

        await overlay.locator('.region-check-item[data-check-id="sct_clock_tower_chest"]').click();
        await settle(page);
        await expect(count).toHaveText("(2/5)");
        await expect(marker(page, name)).toHaveText("2");

        // The Deku Mask opens Woodfall and leaves South Clock Town as it is.
        await page.evaluate(() => window.GameState.setSlot("deku_mask", 1));
        await settle(page);
        await expect(header(page, "Woodfall")).not.toHaveAttribute("data-counts", "(0/8)");
        await expect(count).toHaveText("(2/5)");

        // The same marker again closes it.
        await marker(page, name).dispatchEvent("click");
        await expect(overlay).toHaveCount(0);
    });

    // The map is hidden in the phone layout, so a region left in the overlay would be
    // missing from the only list the player can see.
    test("narrowing into the phone layout with a region open hands it back to the list, closed", async ({ page }) => {
        await launchTracker(page);
        await marker(page, "Woodfall").dispatchEvent("click");
        await expect(page.locator(".location-map-overlay")).toHaveCount(1);

        await page.setViewportSize(PHONE);
        await expect(page.locator(".location-map-overlay")).toHaveCount(0);
        expect(await listOrder(page)).toEqual(REGIONS.map(region => region.name));
        await expect(page.locator('.region-group[data-region-name="Woodfall"] .region-content')).not.toHaveClass(/open/);
    });
});
