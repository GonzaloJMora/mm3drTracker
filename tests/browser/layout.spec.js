// Both pages at every size the layout has to hold: phones, a tablet, either side of
// the breakpoint, desktop, ultrawide and a window wide enough to scale up, plus the
// largest text a browser offers. Measured, never screenshots: fonts differ between
// machines, boxes that overlap or overflow don't. Each size loads fresh.
const { test, expect, launchTracker, openSettings, settle } = require("./fixtures");

const SIZES = [
    { width: 320, height: 640, why: "smallest phone" },
    { width: 390, height: 844, why: "typical phone" },
    { width: 768, height: 1024, why: "tablet, phone layout" },
    { width: 1499, height: 900, why: "just under the breakpoint" },
    { width: 1500, height: 900, why: "at the breakpoint" },
    { width: 1920, height: 1080, why: "desktop" },
    { width: 2560, height: 1080, why: "ultrawide 21:9" },
    { width: 3440, height: 1440, why: "wide enough to scale up" }
];
const BREAKPOINT = 1500;

// The browser's largest text setting, simulated before load: rem-sized text follows
// the root, and buttons that never set a size follow the browser's control text.
// Injected at the top of <head>, so every rule the page sets on a button still wins.
const LARGE_TEXT = "<style>html{font-size:72px}button{font-size:60px}</style>";

async function useLargeText(page) {
    await page.route(/\/(index|tracker)\.html/, async route => {
        const response = await route.fetch();
        const html = (await response.text()).replace("<head>", `<head>${LARGE_TEXT}`);
        await route.fulfill({ response, body: html });
    });
}

const rootTextSize = page => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);

// Waits for the slot images and the layout passes that follow them.
async function settled(page) {
    await page.waitForLoadState("load");
    await settle(page);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 200)));
}

// Problems shared by both pages: sideways scroll, and the layout PhoneLayout reports.
function pageProblems(page, phone) {
    return page.evaluate(expectPhone => {
        const problems = [];
        const root = document.documentElement;
        if (root.scrollWidth > root.clientWidth) problems.push(`scrolls sideways: ${root.scrollWidth} wide in ${root.clientWidth}`);
        if (window.PhoneLayout.active !== expectPhone) problems.push(`phone layout is ${window.PhoneLayout.active}, expected ${expectPhone}`);
        return problems;
    }, phone);
}

function trackerProblems(page) {
    return page.evaluate(() => {
        const problems = [];
        const box = element => element.getBoundingClientRect();
        const inside = (inner, outer, slack = 1) => inner.left >= outer.left - slack && inner.right <= outer.right + slack &&
            inner.top >= outer.top - slack && inner.bottom <= outer.bottom + slack;
        const overlap = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

        if (window.PhoneLayout.active) {
            const header = document.querySelector("header");
            if (!header.checkVisibility()) problems.push("the header bar is hidden");
            // The counts sit inside their headers, at any text size.
            document.querySelectorAll(".region-header").forEach(button => {
                const count = button.querySelector(".region-count");
                if (count && count.textContent && !inside(box(count), box(button))) {
                    problems.push(`${button.closest(".region-group").dataset.regionName}: count outside its header`);
                }
            });
            return problems;
        }

        const map = document.getElementById("location-map-container");
        const mapBox = box(map);
        if (mapBox.width < 100 || mapBox.height < 100) problems.push(`map is ${mapBox.width}x${mapBox.height}`);
        if (mapBox.right > window.innerWidth + 1) problems.push(`map runs ${mapBox.right - window.innerWidth}px off the window`);
        const grids = box(document.querySelector("#item-section .grid-container"));
        if (overlap(grids, mapBox)) problems.push("the item grids overlap the map");
        document.querySelectorAll(".location-map-marker").forEach(marker => {
            const r = box(marker);
            const x = (r.left + r.right) / 2;
            const y = (r.top + r.bottom) / 2;
            if (x < mapBox.left || x > mapBox.right || y < mapBox.top || y > mapBox.bottom) {
                problems.push(`marker ${marker.dataset.markerRegion} sits off the map`);
            }
        });
        const summary = document.getElementById("location-summary-row");
        if (summary && !document.querySelector("header").contains(summary)) problems.push("the summary row is not in the header");
        return problems;
    });
}

// Opens the region with the most checks in the map overlay: every row has to sit
// inside the box, or the box has to scroll.
async function overlayProblems(page) {
    const name = await page.evaluate(() => [...document.querySelectorAll(".region-group")]
        .sort((a, b) => b.querySelectorAll(".region-check-item").length - a.querySelectorAll(".region-check-item").length)[0]
        .dataset.regionName);
    await page.locator(`.location-map-marker[data-marker-region="${name}"]`).dispatchEvent("click");
    await settle(page);
    return page.evaluate(regionName => {
        const problems = [];
        const body = document.querySelector(".location-map-overlay-body");
        const content = body.querySelector(".region-content");
        const outer = body.getBoundingClientRect();
        const scrolls = ["auto", "scroll"].includes(getComputedStyle(content).overflowY) && content.scrollHeight > content.clientHeight;
        content.querySelectorAll(".region-check-item").forEach(row => {
            const r = row.getBoundingClientRect();
            if (r.left < outer.left - 1 || r.right > outer.right + 1) problems.push(`${regionName}: ${row.dataset.checkId} sticks out sideways`);
            if (!scrolls && (r.top < outer.top - 1 || r.bottom > outer.bottom + 1)) problems.push(`${regionName}: ${row.dataset.checkId} is cut off`);
        });
        return problems;
    }, name);
}

function settingsProblems(page) {
    return page.evaluate(() => {
        const problems = [];
        const list = document.getElementById("settings-list");
        if (!list.checkVisibility()) return problems;
        const outer = list.getBoundingClientRect();
        list.querySelectorAll("input, select").forEach(control => {
            const r = control.getBoundingClientRect();
            if (r.width && (r.right > outer.right + 1 || r.left < outer.left - 1)) {
                problems.push(`${control.closest(".setting-row").querySelector(".setting-name").textContent}: control runs out of the settings list`);
            }
        });
        return problems;
    });
}

// The footer at the bottom of the page: on desktop one line, the version left and
// the feedback links right; on a phone both centered, and clear of the fixed
// back-to-top button however far the page is scrolled.
async function footerProblems(page, phone) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    return page.evaluate(expectPhone => {
        const problems = [];
        const box = element => element.getBoundingClientRect();
        const footer = box(document.getElementById("app-footer"));
        const version = box(document.getElementById("app-version"));
        const links = [...document.querySelectorAll("#app-footer a")].map(box);
        const linkRow = box(document.querySelector(".feedback-links"));
        if (footer.left < -1 || footer.right > window.innerWidth + 1) problems.push("the footer runs off the window");
        if (!version.width) problems.push("the version is empty");
        if (expectPhone) {
            const center = (footer.left + footer.right) / 2;
            [["version", version], ["links", linkRow]].forEach(([name, r]) => {
                if (Math.abs((r.left + r.right) / 2 - center) > 2) problems.push(`the ${name} are not centered`);
            });
            const button = box(document.getElementById("back-to-top"));
            links.forEach((r, i) => {
                if (r.left < button.right && button.left < r.right && r.top < button.bottom && button.top < r.bottom) {
                    problems.push(`back to top covers link ${i + 1}`);
                }
            });
        } else {
            if (Math.abs(version.top - linkRow.top) > 4) problems.push("the version and the links are not on one line");
            if (Math.abs(linkRow.right - footer.right) > 1) problems.push("the links are not at the right");
        }
        return problems;
    }, phone);
}

test.describe("Layout", () => {
    for (const size of SIZES) {
        const phone = size.width < BREAKPOINT;
        const label = `${size.width}x${size.height} (${size.why})`;

        test(`tracker at ${label}`, async ({ page }) => {
            await page.setViewportSize(size);
            await launchTracker(page);
            await settled(page);
            expect(await pageProblems(page, phone)).toEqual([]);
            if (phone) await page.locator('.tab-btn[data-tab="locations"]').click();
            expect(await trackerProblems(page)).toEqual([]);
            if (!phone) expect(await overlayProblems(page)).toEqual([]);
            expect(await footerProblems(page, phone)).toEqual([]);
        });

        test(`settings page at ${label}`, async ({ page }) => {
            await page.setViewportSize(size);
            await openSettings(page);
            await settled(page);
            expect(await pageProblems(page, phone)).toEqual([]);
            expect(await settingsProblems(page)).toEqual([]);
            expect(await footerProblems(page, phone)).toEqual([]);
        });
    }

    for (const size of [{ width: 390, height: 844 }, { width: 1920, height: 1080 }]) {
        const phone = size.width < BREAKPOINT;
        const label = `${size.width}x${size.height} with the largest text`;

        test(`tracker at ${label}`, async ({ page }) => {
            await page.setViewportSize(size);
            let normalMap = null;
            if (!phone) {
                await launchTracker(page);
                await settled(page);
                normalMap = await page.locator("#location-map-container").boundingBox();
            }
            await useLargeText(page);
            await launchTracker(page);
            await settled(page);
            expect(await rootTextSize(page)).toBe("72px");
            expect(await pageProblems(page, phone)).toEqual([]);
            if (phone) await page.locator('.tab-btn[data-tab="locations"]').click();
            expect(await trackerProblems(page)).toEqual([]);
            if (!phone) {
                // The header grows around the summary row; the map keeps its size.
                const largeMap = await page.locator("#location-map-container").boundingBox();
                expect(Math.abs(largeMap.width - normalMap.width)).toBeLessThanOrEqual(1);
                expect(Math.abs(largeMap.height - normalMap.height)).toBeLessThanOrEqual(1);
            }
            expect(await footerProblems(page, phone)).toEqual([]);
        });

        test(`settings page at ${label}`, async ({ page }) => {
            await page.setViewportSize(size);
            await useLargeText(page);
            await openSettings(page);
            await settled(page);
            expect(await rootTextSize(page)).toBe("72px");
            expect(await pageProblems(page, phone)).toEqual([]);
            expect(await settingsProblems(page)).toEqual([]);
            expect(await footerProblems(page, phone)).toEqual([]);
        });
    }
});
