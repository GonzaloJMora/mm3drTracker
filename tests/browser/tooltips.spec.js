// The requirements tooltip, on hover and pinned on a phone, and the item tooltip.
// Its chips have to agree with the check's color: "all met" exactly when green.
const { test, expect, launchTracker, slot, PHONE, readWorld } = require("./fixtures");

const tooltip = page => page.locator(".tracker-tooltip");

// Every check in the world: { id, name, region }.
function worldChecks() {
    const checks = [];
    readWorld("manifest.json").forEach(file => {
        const region = readWorld(file);
        const walk = node => {
            (node.item_checks || []).forEach(check => checks.push({ id: check.id, name: check.name, region: region.region_name }));
            (node.subregions || []).forEach(walk);
        };
        walk(region);
    });
    return checks;
}

const checkNamed = (region, name) => worldChecks().find(check => check.region === region && check.name === name);

// A token's display name, from the world's files.
function nameOf(id) {
    const entries = [...readWorld("Items.json"), ...readWorld("locationFlags.json").flags,
        ...readWorld("logicHelpers.json").helpers, ...readWorld("config/logicTokens.json").tokens];
    return entries.find(entry => entry.id === id).name;
}

// The tooltip table under Woodfall in tests/environment/README.md: what each check's
// tooltip lists, all of it, so anything else it lists is a layer it should leave out.
const TOOLTIP_TABLE = {
    sameRegion: [
        { region: "Woodfall", check: "Side Chest", lists: ["Hookshot", "Odolwa Defeated", "Ocarina of Time"] },
        { region: "Mountain Village", check: "Frog Choir", lists: ["Frog Found"] }
    ],
    elsewhere: [
        { region: "Woodfall", check: "Frog Pond", lists: ["Deku Mask", "Frog Found"] },
        { region: "North Clock Town", check: "Odolwa Reward", lists: ["Odolwa Defeated"] }
    ]
};

// README, *Expected answers*: Swamp adds these to Start.
const SWAMP = ["deku_mask", "bow", "woodfall_small_key"];

// What the tooltip lists, in order: a chip is [mark, text], an Any one of group is
// { label, anyOf: [[mark, text], ...] }, one per route.
function readPanel(locator) {
    return locator.evaluate(el => {
        const chip = node => [node.querySelector(".tooltip-mark").textContent, node.querySelector(".tooltip-chip-text").textContent];
        const items = [...el.querySelectorAll(".tooltip-chips > *")].map(node => node.classList.contains("tooltip-chip")
            ? chip(node)
            : { label: (node.querySelector(".tooltip-route-label") || {}).textContent, anyOf: [...node.querySelectorAll(".tooltip-chip")].map(chip) });
        return {
            heading: el.querySelector(".tooltip-heading").textContent,
            count: (el.querySelector(".tooltip-count") || {}).textContent,
            none: Boolean(el.querySelector(".tooltip-none")),
            vanilla: (el.querySelector(".tooltip-vanilla") || {}).textContent,
            items
        };
    });
}

// Short when a chip is ✗, or a group has no route marked ✓.
const missingIn = items => items.filter(item => item.anyOf ? !item.anyOf.some(([mark]) => mark === "✓") : item[0] === "✗").length;

// Clicking an open region's marker closes it, so close any overlay first. Returns
// where the pointer is: hover() puts it in the middle of the row.
async function hoverCheck(page, check) {
    const close = page.locator(".location-map-overlay-close");
    if (await close.isVisible()) await close.click();
    await page.locator(`.location-map-marker[data-marker-region="${check.region}"]`).dispatchEvent("click");
    const row = page.locator(`.location-map-overlay .region-check-item[data-check-id="${check.id}"]`);
    await row.hover();
    await expect(tooltip(page)).toBeVisible();
    const box = await row.boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// How far the box is from a point, along each axis: 0 when the point is inside it.
const gap = (box, point) => ({
    x: Math.max(box.x - point.x, point.x - (box.x + box.width), 0),
    y: Math.max(box.y - point.y, point.y - (box.y + box.height), 0)
});

async function expectListed(page, rows) {
    for (const row of rows) {
        await hoverCheck(page, checkNamed(row.region, row.check));
        const listed = await tooltip(page).locator(".tooltip-chip-text").allInnerTexts();
        expect(listed.sort(), `${row.check}'s tooltip`).toEqual([...row.lists].sort());
        await page.keyboard.press("Escape");
    }
}

test.describe("Tooltips", () => {
    test("hovering a check in the map overlay shows what it needs", { tag: "@smoke" }, async ({ page }) => {
        // At Swamp, from README's region logic and its tooltip tables. Odolwa's
        // Remains asks for 1 key in the Inner Room and 2 in the Boss Room, and with
        // one owned only the 2 is short.
        const sorted = items => [...items].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        const expected = {
            "Odolwa's Remains": { count: "1 missing", items: [["✓", nameOf("deku_mask")], ["✓", nameOf("projectile")],
                ["✗", `${nameOf("woodfall_small_key")} 1/2`], ["✓", nameOf("bow")], ["✓", nameOf("fighting")]] },
            "Hookshot Ledge": { count: "1 missing", items: [{ label: "Any one of", anyOf: [["✗", nameOf("hookshot")], ["✗", `${nameOf("bow")} and ${nameOf("magic_meter")}`]] }] },
            "Entrance Chest": { count: "all met", items: [["✓", nameOf("deku_mask")]] }
        };
        const inside = (box, width, height) => box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height;
        await launchTracker(page);
        for (const id of SWAMP) await slot(page, id).click();
        for (const width of [1920, 1500]) {
            await page.setViewportSize({ width, height: 1080 });
            for (const [name, want] of Object.entries(expected)) {
                const check = worldChecks().find(entry => entry.name === name);
                const pointer = await hoverCheck(page, check);
                const panel = await readPanel(tooltip(page));
                expect(panel.heading, `${name} at ${width}`).toBe(`Items Required${want.count}`);
                expect(sorted(panel.items), `${name} at ${width}`).toEqual(sorted(want.items));
                const box = await tooltip(page).boundingBox();
                expect(inside(box, width, 1080), `${name} at ${width}: the tooltip sits inside the window`).toBe(true);
                // TOOLTIPS.md: the tooltip shows at the cursor. 40px is room for a gap.
                const off = gap(box, pointer);
                expect(off.x <= 40 && off.y <= 40, `${name} at ${width}: the tooltip sits by the pointer, ${off.x}px and ${off.y}px off`).toBe(true);
                await page.keyboard.press("Escape");
                await expect(tooltip(page), "Esc closes the hover tooltip").toBeHidden();
            }
            await hoverCheck(page, checkNamed("South Clock Town", "Heart Door"));
            await page.mouse.move(width / 2, 5);
            await expect(tooltip(page), `at ${width}: the pointer leaving the row closes the tooltip`).toBeHidden();
        }

        // Near the bottom of the window the tooltip goes above the pointer. The page
        // is scrolled so the lowest item slot ends at the window's bottom edge.
        await page.setViewportSize({ width: 1920, height: 300 });
        const lowest = await page.evaluate(() => {
            const slots = [...document.querySelectorAll(".item-slot")].map(el => el.getBoundingClientRect());
            const low = slots.reduce((a, b) => (b.bottom > a.bottom ? b : a));
            return { x: low.x + low.width / 2, bottom: low.bottom + scrollY };
        });
        // Waits for the scroll event: arriving after the pointer, it would close the
        // tooltip that hover just started.
        await page.evaluate(top => new Promise(done => {
            window.addEventListener("scroll", () => requestAnimationFrame(done), { once: true, capture: true });
            window.scrollTo(0, top);
        }), lowest.bottom - 300 + 2);
        const point = { x: lowest.x, y: 300 - 6 };
        expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y).closest(".item-slot")), point),
            "the point near the bottom edge is on an item slot").toBe(true);
        await page.mouse.move(point.x, point.y);
        await expect(tooltip(page)).toBeVisible();
        const low = await tooltip(page).boundingBox();
        expect(inside(low, 1920, 300) && low.y + low.height <= point.y,
            `at the bottom edge the tooltip sits above the pointer, inside the window: ${JSON.stringify(low)}`).toBe(true);
        await page.mouse.move(1, 1);

        // TOOLTIPS.md: a mouse in a narrow window hovers as it would on desktop, so the
        // phone layout's region list shows the same tooltip. Heart Door at Swamp.
        await page.setViewportSize({ width: 1920, height: 1080 });
        const close = page.locator(".location-map-overlay-close");
        if (await close.isVisible()) await close.click();
        for (const width of [1366, 1499]) {
            await page.setViewportSize({ width, height: 768 });
            await page.locator('.tab-btn[data-tab="locations"]').click();
            const header = page.locator('.region-group[data-region-name="South Clock Town"] .region-header');
            if (!/(^|\s)expanded(\s|$)/.test(await header.getAttribute("class"))) await header.click();
            await page.locator('#region-dropdown-container .region-check-item[data-check-id="sct_heart_door"] .region-check-name').hover();
            await expect(tooltip(page), `at ${width} a hover in the list shows the tooltip`).toBeVisible();
            const listed = await readPanel(tooltip(page));
            expect(listed.heading, `Heart Door at ${width}`).toBe("Items Required1 missing");
            expect(listed.items, `Heart Door at ${width}`).toEqual([["✗", `${nameOf("hearts")} 3/4`]]);
            await page.keyboard.press("Escape");
        }

        // README's either/or table: with the Hookshot from the start, its route meets
        // Hookshot Ledge and the other is gray, short but not needed.
        await launchTracker(page, { start_with_hookshot: true });
        await page.setViewportSize({ width: 1920, height: 1080 });
        await hoverCheck(page, checkNamed("South Clock Town", "Hookshot Ledge"));
        const met = await readPanel(tooltip(page));
        expect(met.heading, "Hookshot Ledge with the Hookshot").toBe("Items Requiredall met");
        expect(met.items, "Hookshot Ledge with the Hookshot")
            .toEqual([{ label: "Any one of", anyOf: [["✓", nameOf("hookshot")], ["✗", `${nameOf("bow")} and ${nameOf("magic_meter")}`]] }]);
        await expect(tooltip(page).locator(".tooltip-group .tooltip-chip").nth(1), "the route not needed is gray").toHaveClass(/tooltip-chip-spare/);
    });

    // README: the fairies hold "Stray Fairy"; Song Spot holds song_of_time, an
    // Items.json id, only once Shuffle Songs is off.
    test("a non-randomized check names what it holds", async ({ page }) => {
        const vanillaLine = tooltip(page).locator(".tooltip-vanilla");
        await launchTracker(page);
        await hoverCheck(page, checkNamed("Woodfall", "Entrance Fairy"));
        await expect(vanillaLine).toHaveText("Vanilla: Stray Fairy");
        await hoverCheck(page, checkNamed("South Clock Town", "Song Spot"));
        await expect(vanillaLine, "a randomized check holds nothing yet").toHaveCount(0);

        await launchTracker(page, { shuffle_songs: false });
        await hoverCheck(page, checkNamed("South Clock Town", "Song Spot"));
        await expect(vanillaLine).toHaveText(`Vanilla: ${nameOf("song_of_time")}`);
    });

    // Side Chest's flag is earned at a check two rooms away, Frog Choir's at its region.
    test("a flag earned in the check's own region stands in for the way in they share", async ({ page }) => {
        await launchTracker(page);
        await expectListed(page, TOOLTIP_TABLE.sameRegion);
    });

    // Frog Pond is in a gated region, Odolwa Reward in one with no entry logic.
    test("a flag earned in another region leaves the way in listed", async ({ page }) => {
        await launchTracker(page);
        await expectListed(page, TOOLTIP_TABLE.elsewhere);
    });

    // README: the Sword starts as the Kokiri Sword and steps to the Razor Sword. A
    // song's notes show only once it is owned.
    test("hovering an item names it, and a click while it is open redraws it", async ({ page }) => {
        const title = tooltip(page).locator(".tooltip-title");
        const notes = tooltip(page).locator(".tooltip-notes");
        await launchTracker(page);
        await slot(page, "sword").hover();
        await expect(title).toHaveText(nameOf("kokiri_sword"));
        await slot(page, "sword").click();
        await expect(title).toHaveText(nameOf("razor_sword"));
        await slot(page, "sword").click({ button: "right" });
        await expect(title, "a right-click redraws it too").toHaveText(nameOf("kokiri_sword"));

        await slot(page, "song_of_time").hover();
        await expect(title).toHaveText(nameOf("song_of_time"));
        await expect(notes, "no notes while the song is missing").toHaveCount(0);
        await slot(page, "song_of_time").click();
        await expect(notes).toHaveCount(1);
    });

    test.describe("on a phone", () => {
        test.use({ viewport: PHONE, hasTouch: true });

        test("the info button pins the panel, and its chips agree with the check's color", { tag: "@webkit" }, async ({ page }) => {
            // README's token table, Start column: a met chip on a green row, and two
            // unmet ones, one a count a single heart short.
            const atStart = {
                "Guard's Gift": [["✓", nameOf("fighting")]],
                "Heart Door": [["✗", `${nameOf("hearts")} 3/4`]],
                "Target Practice": [["✗", nameOf("projectile")]]
            };
            // README, *Expected answers*: the checks non-randomized on defaults, each
            // holding "Stray Fairy".
            const nonRandomized = ["Stray Fairy", "Entrance Fairy", "Inner Fairy"];
            await launchTracker(page);
            await page.locator('.tab-btn[data-tab="locations"]').click();
            const seen = new Set();
            for (const check of worldChecks()) {
                const where = `${check.region}, ${check.name}`;
                const group = page.locator(`.region-group[data-region-name="${check.region}"]`);
                const header = group.locator(".region-header");
                if (!/(^|\s)expanded(\s|$)/.test(await header.getAttribute("class"))) await header.click();
                const row = group.locator(`.region-check-item[data-check-id="${check.id}"]`);
                const green = /(^|\s)accessible(\s|$)/.test(await row.getAttribute("class"));
                const info = row.locator(".region-check-info");
                await info.click();
                await expect(tooltip(page)).toHaveClass(/docked/);
                await expect(info, `${where}: the button says its panel is up`).toHaveAttribute("aria-expanded", "true");
                const panel = await readPanel(tooltip(page));
                expect(panel.heading.startsWith(check.name), `${where}: the pinned heading names the check`).toBe(true);
                expect(panel.vanilla, `${where}: the Vanilla line`)
                    .toBe(nonRandomized.includes(check.name) ? "Vanilla: Stray Fairy" : undefined);
                if (!panel.items.length) {
                    // A check with no requirements shows "None" and no chips.
                    expect(panel.none && green, `${where}: no chips, so "None" on a green row`).toBe(true);
                } else {
                    const missing = missingIn(panel.items);
                    panel.items.flatMap(item => item.anyOf || [item])
                        .forEach(([mark]) => expect(["✓", "✗"], `${where}: every chip is marked`).toContain(mark));
                    expect(missing === 0, `${where}: ${missing} requirements marked short, row is ${green ? "green" : "red"}`).toBe(green);
                    expect(panel.count, `${where}: the heading's count`).toBe(green ? "all met" : `${missing} missing`);
                }
                if (atStart[check.name]) {
                    expect(panel.items, `${where}: its chips at Start`).toEqual(atStart[check.name]);
                    seen.add(check.name);
                }
                await info.click();
                await expect(tooltip(page)).not.toHaveClass(/docked/);
                await expect(info, `${where}: and that it is down`).toHaveAttribute("aria-expanded", "false");
            }
            expect([...seen].sort()).toEqual(Object.keys(atStart).sort());

            // TOOLTIPS.md: another check's button moves the panel to it in one tap.
            const heartDoor = page.locator('.region-check-item[data-check-id="sct_heart_door"] .region-check-info');
            const ledge = page.locator('.region-check-item[data-check-id="sct_hookshot_ledge"] .region-check-info');
            await heartDoor.click();
            await expect(tooltip(page)).toHaveClass(/docked/);
            await ledge.click();
            await expect(tooltip(page), "another check's button keeps the panel up").toHaveClass(/docked/);
            expect((await readPanel(tooltip(page))).heading.startsWith("Hookshot Ledge"), "and moves it to that check").toBe(true);
            await expect(heartDoor).toHaveAttribute("aria-expanded", "false");
            await expect(ledge).toHaveAttribute("aria-expanded", "true");
        });

        test("a tap anywhere else, Esc or widening to desktop puts the pinned panel away; a tap on it, scrolling or the URL bar doesn't", async ({ page }) => {
            const bodyDocked = () => page.evaluate(() => document.body.classList.contains("tooltip-docked"));
            const pin = async () => {
                await info.click();
                await expect(tooltip(page)).toHaveClass(/docked/);
                expect(await bodyDocked(), "the page knows the panel is up").toBe(true);
            };
            // Hidden, not just undocked, and the page lets go of it (the back-to-top
            // button stands down while the panel is up).
            const putAway = async how => {
                await expect(tooltip(page), how).toBeHidden();
                expect(await bodyDocked(), `${how}: the page lets go of the panel`).toBe(false);
            };
            // Waits for the page to have handled what just happened, so a panel that
            // should stay up is read after the page had its chance to close it.
            const settled = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));

            await launchTracker(page);
            await page.locator('.tab-btn[data-tab="locations"]').click();
            for (const group of await page.locator(".region-group .region-header").all()) await group.click();
            const info = page.locator('.region-check-item[data-check-id="sct_heart_door"] .region-check-info');
            const postbox = page.locator('.region-group[data-region-name="South Clock Town"] .region-check-item').filter({ hasText: "Postbox" });

            // TOOLTIPS.md: touch never reaches the hover path. The hover tooltip shows
            // after a short delay, so this waits well past it.
            const chest = page.locator('.region-check-item[data-check-id="sct_clock_tower_chest"]');
            await chest.locator(".region-check-name").tap();
            await expect(chest, "a tap ticks the check").toHaveClass(/completed/);
            await page.waitForTimeout(500);
            await expect(tooltip(page), "and shows no hover tooltip on touch").toBeHidden();

            await pin();
            const panel = await tooltip(page).boundingBox();
            await page.touchscreen.tap(panel.x + panel.width / 2, panel.y + 10);
            await settled();
            await expect(tooltip(page), "a tap on the panel itself leaves it up").toHaveClass(/docked/);
            await page.keyboard.press("Escape");
            await putAway("Esc, after a tap on the panel");

            await pin();
            await postbox.locator(".region-check-name").click();
            await putAway("a tap on another check");
            await expect(postbox, "and the tap still ticks it").toHaveClass(/completed/);

            await pin();
            await page.locator("header img").click();
            await putAway("a tap on the logo");

            await pin();
            await page.keyboard.press("Escape");
            await putAway("Esc");

            await page.setViewportSize({ width: PHONE.width, height: 500 });
            await pin();
            expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), "the list can scroll").toBe(true);
            await page.evaluate(() => new Promise(done => {
                window.addEventListener("scroll", () => requestAnimationFrame(done), { once: true, capture: true });
                window.scrollBy(0, 150);
            }));
            await expect(tooltip(page), "scrolling leaves the panel up").toHaveClass(/docked/);
            await page.setViewportSize({ width: PHONE.width, height: 440 });
            await settled();
            await expect(tooltip(page), "a shorter window (the URL bar) leaves the panel up").toHaveClass(/docked/);
            await expect(tooltip(page)).toBeVisible();

            // TOOLTIPS.md: it closes on crossing to desktop, where its button is hidden.
            await page.setViewportSize({ width: 1920, height: 1080 });
            await putAway("widening to desktop");
        });
    });
});
