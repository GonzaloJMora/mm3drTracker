// Logic on the real data. Nothing here says what any check should need: the page is
// held to what its own logic strings say, under many inventories, so editing a
// check's logic can't break these. Whether the data matches the randomizer is a
// review, not a test. The grammar itself is tests/node/logicParser.test.js.
const fs = require("fs");
const path = require("path");
const { test, expect, launchTracker, settle, statusNumbers, slot, gameFacts } = require("./fixtures");

const ROOT = path.join(__dirname, "..", "..");
const readJson = file => JSON.parse(fs.readFileSync(path.join(ROOT, "data", file), "utf8"));
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
    test("every check's color and every count match the data's own logic, across many inventories", { tag: "@smoke" }, async ({ page }) => {
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
                const text = fs.readFileSync(path.join(ROOT, "data", file), "utf8");
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
        // One pick from each setting that can grant the capped slot, more than the cap.
        const picks = {};
        allSettings.forEach(setting => {
            if (Object.keys(picks).length > cap) return;
            if (setting.class === "toggle" && setting.grants && capped in setting.grants) picks[setting.id] = true;
            const option = (setting.options || []).find(entry => entry.grants && capped in entry.grants);
            if (option) picks[setting.id] = option.id;
        });
        expect(Object.keys(picks).length, `fewer than ${cap + 1} settings grant ${capped}`).toBeGreaterThan(cap);
        await launchTracker(page, picks);
        expect(await page.evaluate(id => window.GameState.slotValue(id), capped)).toBe(cap);
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

    test("no implied layers beyond the ones kept on purpose", async ({ page }) => {
        await launchTracker(page);
        const found = await page.evaluate(() => window.TrackerDebug.impliedLayers()
            .map(entry => ({ region: entry.region, check: entry.check, implied: entry.implied })));
        const allowed = gameFacts.implied_layers.allowed;
        const same = (a, b) => a.region === b.region && a.check === b.check && a.implied === b.implied;
        const added = found.filter(entry => !allowed.some(other => same(entry, other)));
        const gone = allowed.filter(entry => !found.some(other => same(entry, other)));

        expect(added, "A new implied layer: the rest of this check's requirement already covers it, so for this " +
            "check it can never change anything. Usually the check belongs beside that group, not inside it. " +
            "If it's deliberate, add this to implied_layers.allowed in tests/fixtures/majorasMask.json:\n" +
            added.map(entry => JSON.stringify(entry)).join(",\n")).toEqual([]);
        expect(gone, "Listed in tests/fixtures/majorasMask.json as implied, but no longer is: remove these lines.")
            .toEqual([]);
    });
});
