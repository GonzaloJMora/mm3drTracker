// The desktop map: a marker per region in its region's color and count, and the
// overlay that borrows a region from the list and has to give it back where it
// was, closed. See CLAUDE.md, *Desktop vs mobile*.
const { test, expect, launchTracker, settle } = require("./fixtures");

const marker = (page, name) => page.locator(`.location-map-marker[data-marker-region="${name}"]`);

// Each marker against its region's header: same status, and the accessible count
// shown exactly when there is one.
function markerMismatches(page) {
    return page.evaluate(() => [...document.querySelectorAll(".region-group")].flatMap(group => {
        const name = group.dataset.regionName;
        const header = group.querySelector(".region-header");
        const pin = document.querySelector(`.location-map-marker[data-marker-region="${CSS.escape(name)}"]`);
        if (!pin) return [`${name}: no marker`];
        const accessible = Number(header.dataset.accessible);
        const label = accessible > 0 ? String(accessible) : "";
        const problems = [];
        if (pin.dataset.status !== header.dataset.status) problems.push(`${name}: marker ${pin.dataset.status}, region ${header.dataset.status}`);
        if (pin.textContent !== label) problems.push(`${name}: marker reads "${pin.textContent}", region has ${accessible} accessible`);
        return problems;
    }));
}

test.describe("Map", () => {
    test("one marker per region, in its region's color and count", { tag: "@smoke" }, async ({ page }) => {
        await launchTracker(page);
        await expect(page.locator(".location-map-marker")).toHaveCount(await page.locator(".region-group").count());
        expect(await markerMismatches(page)).toEqual([]);

        await page.evaluate(() => window.GameState.gridSlots().forEach(id =>
            window.GameState.setSlot(id, window.GameState.slotRange(id).top)));
        await settle(page);
        expect(await markerMismatches(page)).toEqual([]);
    });

    test("every marker opens its own region, and closing puts it back where it was, closed", async ({ page }) => {
        await launchTracker(page);
        const names = await page.locator(".region-group").evaluateAll(groups => groups.map(group => group.dataset.regionName));
        const order = () => page.locator("#region-dropdown-container > .region-group")
            .evaluateAll(groups => groups.map(group => group.dataset.regionName));
        const before = await order();

        for (const name of names) {
            await marker(page, name).dispatchEvent("click");
            const overlay = page.locator(".location-map-overlay");
            await expect(overlay.locator(".location-map-overlay-title")).toHaveText(name);
            await expect(overlay.locator(`.region-group[data-region-name="${name}"] .region-content`)).toHaveClass(/open/);
            await overlay.locator(".location-map-overlay-titlebar").click();
            await expect(overlay).toHaveCount(0);
        }

        expect(await order()).toEqual(before);
        await expect(page.locator(".region-content.open")).toHaveCount(0);
        await expect(page.locator('.region-header[aria-expanded="true"]')).toHaveCount(0);
    });

    test("ticking a check in the overlay updates its marker and titlebar", async ({ page }) => {
        await launchTracker(page);
        const name = await page.evaluate(() => document.querySelector(".region-header[data-accessible]:not([data-accessible='0'])")
            .closest(".region-group").dataset.regionName);
        await marker(page, name).click();
        const overlay = page.locator(".location-map-overlay");
        const count = overlay.locator(".location-map-overlay-count");
        const before = { marker: await marker(page, name).textContent(), title: await count.textContent() };

        await overlay.locator(".region-check-item.accessible").first().click();
        await settle(page);
        await expect(count).not.toHaveText(before.title);
        await expect(marker(page, name)).not.toHaveText(before.marker);
        expect(await markerMismatches(page)).toEqual([]);

        // The same marker again closes it.
        await marker(page, name).dispatchEvent("click");
        await expect(overlay).toHaveCount(0);
    });
});
