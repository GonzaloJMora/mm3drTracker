// Logic on the test world, in the page: every check is drawn the color the engine
// gives it, the counts follow, and settings reach the engine. Whether the engine's
// answers are right is tests/node/engine.test.js, against the test world's README; the
// grammar is tests/node/logicParser.test.js.
const { test, expect, launchTracker, settle, statusNumbers, slot, readWorld } = require("./fixtures");

const readJson = readWorld;
const settingsFile = readJson("settings.json");
const allSettings = settingsFile.sections.flatMap(section => section.groups.flatMap(group => group.settings));
const tokens = readJson("config/logicTokens.json").tokens;

// Every row's color against the engine's answer for its own logic, every region
// header's counts and color against the rows under it, and the progress numbers
// against every row, each worked out here from the rows and config.check_groups
// rather than read back from ItemCheckState.
function audit(page) {
    return page.evaluate(() => {
        const data = window.TrackerData;
        const hide = window.TrackerView.hidesNonRandomized();

        const keyOf = new Map();
        const find = id => (keyOf.has(id) && keyOf.get(id) !== id ? find(keyOf.get(id)) : id);
        (data.config.check_groups || []).forEach(group => group.forEach(id => {
            const from = find(id);
            const into = find(group[0]);
            if (from !== into) keyOf.set(from, into);
        }));

        const checksOf = new Map(data.regions.map(region => [region.region_name,
            new Map(region.item_checks.map(check => [check.id, [region.logic, ...(check.group_logic || []), check.logic]]))]));

        const problems = [];
        const tally = rows => {
            const locations = new Map();
            rows.forEach(row => {
                if (hide && row.classList.contains("vanilla")) return;
                const key = find(row.dataset.checkId);
                const seen = locations.get(key) || { accessible: false, vanilla: false, completed: false };
                locations.set(key, {
                    accessible: seen.accessible || row.classList.contains("accessible"),
                    vanilla: seen.vanilla || row.classList.contains("vanilla"),
                    completed: seen.completed || row.classList.contains("completed")
                });
            });
            const list = [...locations.values()];
            const open = list.filter(location => !location.completed);
            return {
                list,
                accessible: open.filter(location => location.accessible).length,
                remaining: open.length,
                checked: list.length - open.length
            };
        };

        document.querySelectorAll(".region-group").forEach(group => {
            const regionName = group.dataset.regionName;
            const rows = [...group.querySelectorAll(".region-check-item")];
            rows.forEach(row => {
                const logic = checksOf.get(regionName).get(row.dataset.checkId);
                const expected = window.TrackerDebug.canAccess(logic);
                const shown = row.classList.contains("accessible") ? true : row.classList.contains("inaccessible") ? false : null;
                if (shown !== expected) problems.push(`${regionName} / ${row.dataset.checkId}: drawn ${shown === null ? "unjudged" : shown ? "accessible" : "inaccessible"}, logic says ${expected ? "accessible" : "inaccessible"}`);
            });

            const counts = tally(rows);
            const header = group.querySelector(".region-header");
            const wanted = `(${counts.accessible}/${counts.remaining})`;
            if (header.dataset.counts !== wanted) problems.push(`${regionName}: header counts ${header.dataset.counts}, rows give ${wanted}`);

            const open = counts.list.filter(location => !location.completed);
            const red = open.some(location => !location.accessible);
            const green = open.some(location => location.accessible && !location.vanilla);
            const purple = open.some(location => location.accessible && location.vanilla);
            const status = red && (green || purple) ? "partialCompletion" : red ? "inaccessible"
                : green ? "fullClear" : purple ? "vanilla" : "completed";
            if (header.dataset.status !== status) problems.push(`${regionName}: header status ${header.dataset.status}, rows give ${status}`);
        });

        const overall = tally([...document.querySelectorAll(".region-check-item")]);
        return { problems, overall: { accessible: overall.accessible, checked: overall.checked, remaining: overall.remaining } };
    });
}

// A repeatable spread of inventories: each slot somewhere in its range.
function setInventory(page, seed) {
    return page.evaluate(start => {
        let state = start;
        const random = () => {
            state = (state * 1103515245 + 12345) % 2147483648;
            return state / 2147483648;
        };
        window.GameState.gridSlots().forEach(id => {
            const { bottom, top } = window.GameState.slotRange(id);
            if (top === bottom) return;
            const value = start === 0 ? top : bottom + Math.floor(random() * (top - bottom + 1));
            window.GameState.setSlot(id, value);
        });
    }, seed);
}

async function expectConsistent(page, label) {
    await settle(page);
    const { problems, overall } = await audit(page);
    expect(problems, `${label}: the page disagrees with the data's own logic`).toEqual([]);
    expect(await statusNumbers(page), `${label}: progress numbers`).toEqual(overall);
}

const ownEverything = page => page.evaluate(() => window.GameState.gridSlots().forEach(id =>
    window.GameState.setSlot(id, window.GameState.slotRange(id).top)));

test.describe("Logic", () => {
    test("every check is drawn the color the engine gives it, and every count matches, across many inventories", { tag: "@smoke" }, async ({ page }) => {
        await launchTracker(page);
        await expectConsistent(page, "the starting items");

        await setInventory(page, 0);
        await expectConsistent(page, "everything owned");

        for (const seed of [7, 1234, 98765]) {
            await setInventory(page, seed);
            await expectConsistent(page, `random inventory ${seed}`);
        }

        // Some locations ticked, then non-randomized checks hidden: both move the counts.
        await page.evaluate(() => document.querySelectorAll(".region-check-item").forEach((row, index) => {
            if (index % 3 === 0 && !row.classList.contains("completed")) row.click();
        }));
        await expectConsistent(page, "a third of the checks ticked");

        // README, Region color: a region with every location ticked reads completed.
        const southClockTown = page.locator('.region-group[data-region-name="South Clock Town"]');
        await southClockTown.evaluate(group => group.querySelectorAll(".region-check-item").forEach(row => {
            if (!row.classList.contains("completed")) row.click();
        }));
        await expectConsistent(page, "every South Clock Town check ticked");
        await expect(southClockTown.locator(".region-header")).toHaveAttribute("data-status", "completed");

        await page.locator("#toggle-non-randomized").click();
        await expectConsistent(page, "non-randomized checks hidden");
    });

    test("the same holds on settings far from the defaults", async ({ page }) => {
        // Every setting at its last choice or highest number, which turns most
        // shuffles on and starts with most items.
        const picks = {};
        allSettings.forEach(setting => {
            if (setting.class === "toggle") picks[setting.id] = true;
            if (setting.class === "dropdown") picks[setting.id] = setting.options.at(-1).id;
            if (setting.class === "number") picks[setting.id] = setting.max;
        });
        await launchTracker(page, picks);
        await expectConsistent(page, "maximum settings");
        await setInventory(page, 42);
        await expectConsistent(page, "maximum settings, random inventory");
    });

    test("a setting after >= moves what the check needs", async ({ page }) => {
        // A check written `token>=setting`, where the token counts an item group.
        const found = (() => {
            for (const file of readJson("manifest.json")) {
                const text = JSON.stringify(readJson(file));
                for (const [, left, right] of text.matchAll(/([a-z0-9_]+)\s*>=\s*([a-z_][a-z0-9_]*)/g)) {
                    const token = tokens.find(entry => entry.id === left && entry.kind === "count" && entry.group);
                    const setting = allSettings.find(entry => entry.id === right);
                    if (token && setting) return { token, setting };
                }
            }
            return null;
        })();
        expect(found, "no logic compares a counted group against a setting").not.toBeNull();
        const { token, setting } = found;
        const members = readJson("config/inventory.json").item_groups[token.group];
        const option = setting.options.filter(entry => typeof entry.value === "number" && entry.value > 0 && entry.value < members.length)[0];

        await launchTracker(page, { [setting.id]: option.id });
        const gatedRows = await page.evaluate(({ left, right }) => {
            const pattern = new RegExp(`\\b${left}\\s*>=\\s*${right}\\b`);
            const ids = [];
            window.TrackerData.regions.forEach(region => region.item_checks.forEach(check => {
                const chain = [region.logic, ...(check.group_logic || []), check.logic].join(" & ");
                if (pattern.test(chain)) ids.push(check.id);
            }));
            return ids;
        }, { left: token.id, right: setting.id });
        expect(gatedRows.length).toBeGreaterThan(0);

        const gatedRow = page.locator(`.region-check-item[data-check-id="${gatedRows[0]}"]`).first();
        await ownEverything(page);
        await expect(gatedRow).toHaveClass(/(^|\s)accessible/);

        // Taking the group's items away one at a time: the check holds while the
        // count meets the setting, and goes red the moment it doesn't.
        for (const member of members) {
            await page.evaluate(id => window.GameState.setSlot(id, window.GameState.slotRange(id).bottom), member);
            const count = await page.evaluate(id => window.GameState.tokens[id], token.id);
            if (count >= option.value) await expect(gatedRow).toHaveClass(/(^|\s)accessible/);
            else {
                await expect(gatedRow).toHaveClass(/inaccessible/);
                break;
            }
        }
        await expectConsistent(page, `${setting.id} at ${option.id}`);
    });

    test("vanilla_when follows the settings", async ({ page }) => {
        // A check made non-randomized by one setting at one value.
        const found = (() => {
            for (const file of readJson("manifest.json")) {
                const region = readJson(file);
                const walk = node => {
                    for (const check of node.item_checks || []) {
                        const clause = check.vanilla_when;
                        if (clause && typeof clause === "object" && !Array.isArray(clause) && Object.keys(clause).length === 1) {
                            const [id, value] = Object.entries(clause)[0];
                            if (!Array.isArray(value)) return { check: check.id, id, value };
                        }
                    }
                    for (const child of node.subregions || []) {
                        const hit = walk(child);
                        if (hit) return hit;
                    }
                    return null;
                };
                const hit = walk(region);
                if (hit) return hit;
            }
            return null;
        })();
        expect(found, "no check has a one-setting vanilla_when").not.toBeNull();
        const setting = allSettings.find(entry => entry.id === found.id);
        const other = setting.class === "toggle" ? !found.value
            : setting.options.map(option => option.id).find(id => id !== found.value);
        const row = page.locator(`.region-check-item[data-check-id="${found.check}"]`).first();

        await launchTracker(page, { [found.id]: found.value });
        await expect(row).toHaveClass(/vanilla/);
        await launchTracker(page, { [found.id]: other });
        await expect(row).not.toHaveClass(/vanilla/);
    });

    test("a lock's forced value decides which checks are non-randomized", async ({ page }) => {
        // A locked setting that a one-setting vanilla_when names, where the pick
        // matches the clause and the forced value doesn't.
        // Every check such a clause covers: a room's vanilla_when reaches every check
        // under it that doesn't set its own.
        const coveredBy = lock => {
            const covered = [];
            let pick;
            const walk = (node, inherited) => {
                const own = node.vanilla_when !== undefined ? node.vanilla_when : inherited;
                (node.item_checks || []).forEach(check => {
                    const clause = check.vanilla_when !== undefined ? check.vanilla_when : own;
                    if (!clause || typeof clause !== "object" || Array.isArray(clause)) return;
                    const values = [].concat(clause[lock.setting.id]);
                    if (Object.keys(clause).length !== 1 || values[0] === undefined || values.includes(lock.value)) return;
                    if (pick === undefined) pick = values[0];
                    if (values.includes(pick)) covered.push(check);
                });
                (node.subregions || []).forEach(child => walk(child, own));
            };
            readJson("manifest.json").forEach(file => walk(readJson(file), undefined));
            return { lock, covered, pick };
        };
        const found = allSettings
            .filter(setting => setting.forced)
            .flatMap(setting => setting.forced.map(rule => ({ setting, when: rule.when, value: rule.value })))
            .filter(rule => !Array.isArray(rule.when))
            .map(coveredBy)
            .find(entry => entry.covered.length);
        expect(found, "no lock forces a setting a vanilla_when names").toBeTruthy();
        const { lock, covered, pick } = found;
        const id = lock.setting.id;
        // README, Settings that change the answers: "Item Pool Plentiful".
        expect(covered.map(check => check.name).sort()).toEqual(["Entrance Fairy", "Inner Fairy", "Stray Fairy"]);

        const rows = page.locator(covered.map(check => `.region-check-item[data-check-id="${check.id}"]`).join(", "));
        await launchTracker(page, { [id]: pick });
        await expect(rows).toHaveCount(covered.length);
        for (const row of await rows.all()) await expect(row).toHaveClass(/vanilla/);

        await launchTracker(page, Object.assign({ [id]: pick }, lock.when));
        await expect(rows).toHaveCount(covered.length);
        for (const row of await rows.all()) await expect(row).not.toHaveClass(/vanilla/);
    });

    test("a lock's forced value reaches the tracker, grants included", async ({ page }) => {
        const lock = allSettings
            .filter(setting => setting.forced && setting.grants)
            .flatMap(setting => setting.forced.map(rule => ({ setting, when: rule.when, value: rule.value })))
            .find(rule => rule.value === true && Object.values(rule.when).every(wanted => !Array.isArray(wanted)));
        expect(lock, "no lock forces a setting that grants items").toBeTruthy();

        await launchTracker(page, lock.when);
        expect(await page.evaluate(id => window.SettingsState.get(id), lock.setting.id)).toBe(true);
        for (const granted of Object.keys(lock.setting.grants)) {
            await expect(slot(page, granted)).not.toHaveClass(/dimmed/);
        }
    });

    test("a number setting's grant passes its number on", async ({ page }) => {
        const setting = allSettings.find(entry => entry.class === "number" && entry.grants &&
            Object.values(entry.grants).includes("value"));
        const target = Object.keys(setting.grants).find(id => setting.grants[id] === "value");
        const wanted = Math.min(setting.max, 5);
        await launchTracker(page, { [setting.id]: wanted });
        expect(await page.evaluate(id => window.GameState.slotValue(id), target)).toBe(wanted);
        expect((await page.evaluate(id => window.GameState.slotRange(id), target)).bottom).toBe(wanted);
    });

    test("starting_max caps a counter however many settings grant it", async ({ page }) => {
        const [capped, cap] = Object.entries(settingsFile.starting_max)[0];
        // Every setting that can grant the capped counter, picked at its largest grant;
        // together they have to grant more than the cap for the cap to show.
        const picks = {};
        let granted = 0;
        allSettings.forEach(setting => {
            const amount = grants => (grants && capped in grants ? grants[capped] : undefined);
            if (setting.class === "toggle" && amount(setting.grants) !== undefined) {
                picks[setting.id] = true;
                granted += amount(setting.grants);
            } else if (setting.class === "number" && amount(setting.grants) === "value") {
                picks[setting.id] = setting.max;
                granted += setting.max;
            } else if (setting.class === "dropdown") {
                const best = (setting.options || []).filter(option => typeof amount(option.grants) === "number")
                    .sort((a, b) => amount(b.grants) - amount(a.grants))[0];
                if (best) {
                    picks[setting.id] = best.id;
                    granted += amount(best.grants);
                }
            }
        });
        expect(granted, `the settings together grant only ${granted} ${capped}, not more than the cap of ${cap}`).toBeGreaterThan(cap);
        await launchTracker(page, picks);
        expect(await page.evaluate(id => window.GameState.slotValue(id), capped)).toBe(cap);
    });

    test("the desktop progress numbers match the progress line", async ({ page }) => {
        // The line is the one the other tests hold to the README; the desktop box is
        // drawn separately beside it.
        const boxNumbers = async () => {
            const text = (await page.locator("#location-stats-content").textContent()).replace(/\s+/g, " ").trim();
            const match = text.match(/^(\d+) accessible (\d+) checked (\d+) remaining$/);
            if (!match) throw new Error(`unexpected desktop progress numbers: "${text}"`);
            return { accessible: Number(match[1]), checked: Number(match[2]), remaining: Number(match[3]) };
        };
        await launchTracker(page);
        await expect(page.locator("#location-stats-box")).toBeVisible();
        expect(await boxNumbers(), "the starting items").toEqual(await statusNumbers(page));
        await ownEverything(page);
        await settle(page);
        expect(await boxNumbers(), "everything owned").toEqual(await statusNumbers(page));
    });

    test("a setting that is a term of a token moves the token", async ({ page }) => {
        const token = tokens.find(entry => entry.kind === "sum" && entry.terms.some(term => term.setting));
        const settingId = token.terms.find(term => term.setting).setting;
        const setting = allSettings.find(entry => entry.id === settingId);
        await launchTracker(page);
        const before = await page.evaluate(id => window.GameState.tokens[id], token.id);
        await launchTracker(page, { [settingId]: setting.max });
        const after = await page.evaluate(id => window.GameState.tokens[id], token.id);
        expect(after - before).toBe(setting.max - setting.default);
        await expectConsistent(page, `${settingId} at ${setting.max}`);
    });
});
