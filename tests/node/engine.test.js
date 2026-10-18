// The engine on the test world: whether each check is reachable, the tokens, logic
// helpers and location flags behind that, and which checks are non-randomized. Every
// expected answer is copied from tests/environment/README.md, where it was worked out
// by hand, so a mistake in the engine can't hide by agreeing with itself. The page
// runs the same functions (DataModel.tokenValue, DataModel.resolver); the browser
// tests check that it draws what they decide.
const { test, expect } = require("@playwright/test");
const { readData, ENVIRONMENT } = require("./readData.js");
const LogicParser = require("../../js/logicParser.js");
const DataModel = require("../../js/dataModel.js");
const SettingsModel = require("../../js/settingsModel.js");
const DataChecks = require("../../js/dataChecks.js");

// The test world read the way the page reads it: tokens, flags, helpers, settings.
const assembled = readData(ENVIRONMENT);
const world = DataChecks.context(assembled.data, { fileOf: assembled.fileOf });

// The settings the README's tables assume: every default, Health 3. remains_required
// is the dropdown whose options stand for numbers (Two 2, One 1, Zero 0).
const REMAINS = { two: 2, one: 1, zero: 0 };

// Inventories as GameState holds them: a progression stage marks every stage up to it
// owned, a counter or digit is its number, anything else is true when owned.
const START = { kokiri_sword: true };
const SWAMP = Object.assign({}, START, { deku_mask: true, bow: true, woodfall_small_key: 1 });
const ODOLWA = Object.assign({}, SWAMP, { woodfall_small_key: 2, song_of_time: true });
const EVERYTHING = {
    kokiri_sword: true, razor_sword: true, bow: true, bow_large_quiver: true, hookshot: true,
    magic_meter: true, magic_meter_double: true, empty_bottle: 2, red_potion: true,
    deku_mask: true, goron_mask: true, bunny_hood: true, stone_mask: true, blast_mask: true,
    ocarina_of_time: true, song_of_time: true, heart_piece: 8, heart_container: 2, woodfall_small_key: 2,
    odolwa_remains: true, goht_remains: true, code_digit_1: 1, code_digit_2: 2, code_digit_3: 3
};

// Everything the engine says for one inventory and set of settings.
function run(have, { health = 3, remains = "two" } = {}) {
    const items = Object.assign({}, world.itemState, have);
    const settingValue = id => (id === "starting_health" ? health : undefined);
    const tokens = {};
    world.tokens.sources.forEach(({ def, ids }) => { tokens[def.id] = DataModel.tokenValue(def, ids, items, settingValue); });
    const resolve = DataModel.resolver({
        items, tokens, named: world.named,
        numberOf: id => (id === "remains_required" ? REMAINS[remains] : undefined)
    });
    const checks = new Map();
    world.regions.forEach(region => region.item_checks.forEach(check => {
        checks.set(check.id, { region, check });
    }));
    return {
        tokens,
        // Whether a bare name in a logic string is met: a helper or a flag.
        met: name => Boolean(LogicParser.evaluate(name, resolve)),
        // What a name is worth to logic: a token's value as a logic string sees it.
        value: name => resolve(name),
        // Whether a check is reachable: its region's entry, every room above it, itself.
        open: id => {
            const { region, check } = checks.get(id);
            return LogicParser.evaluate([region.logic, ...(check.group_logic || []), check.logic], resolve);
        }
    };
}

// The README's *Expected answers*, row for row: Start, Swamp, Odolwa, Everything.
const EXPECTED = [
    ["sct_clock_tower_chest", "✓✓✓✓"],
    ["sct_hookshot_ledge", "✗✗✗✓"],
    ["sct_song_spot", "✗✗✗✓"],
    ["sct_postbox", "✓✓✓✓"],
    ["nct_postbox", "✓✓✓✓"],
    ["sct_stray_fairy", "✓✓✓✓"],
    ["sct_heart_door", "✗✗✗✓"],
    ["nct_target_practice", "✗✓✓✓"],
    ["nct_guards_gift", "✓✓✓✓"],
    ["nct_bottle_shop", "✗✗✗✓"],
    ["nct_odolwa_reward", "✗✗✓✓"],
    ["wf_entrance_chest", "✗✓✓✓"],
    ["wft_entrance_fairy", "✗✓✓✓"],
    ["wft_map_chest", "✗✓✓✓"],
    ["wft_inner_fairy", "✗✓✓✓"],
    ["wft_key_chest", "✗✓✓✓"],
    ["wft_odolwa_remains", "✗✗✓✓"],
    ["wft_side_chest", "✗✗✗✓"],
    ["wf_frog_pond", "✗✗✗✓"],
    ["mv_moon_gate", "✗✗✗✓"],
    ["mv_mask_collector", "✗✗✗✓"],
    ["mv_bombers_door", "✗✗✗✓"],
    ["mv_frog_choir", "✗✗✗✓"]
];
const STEPS = [["Start", START], ["Swamp", SWAMP], ["Odolwa", ODOLWA], ["Everything", EVERYTHING]];

test.describe("Engine: the answer table", () => {
    test("the table has a row for every check in the test world, and no other", () => {
        const ids = world.regions.flatMap(region => region.item_checks.map(check => check.id)).sort();
        expect(EXPECTED.map(([id]) => id).sort()).toEqual(ids);
    });

    STEPS.forEach(([name, have], step) => {
        test(`every check on the ${name} inventory`, () => {
            const engine = run(have);
            const expected = Object.fromEntries(EXPECTED.map(([id, row]) => [id, row[step]]));
            const got = Object.fromEntries(EXPECTED.map(([id]) => [id, engine.open(id) ? "✓" : "✗"]));
            expect(got).toEqual(expected);
        });
    });

    test("the tokens, helpers and flags at each step", () => {
        // The README's token table, then fighting, projectile, odolwa_defeated, frog_found.
        const table = {
            Start: { hearts: 3, boss_count: 0, masks: 0, bottle: false, code: false, fighting: true, projectile: false, odolwa_defeated: false, frog_found: false },
            Swamp: { hearts: 3, boss_count: 0, masks: 0, bottle: false, code: false, fighting: true, projectile: true, odolwa_defeated: false, frog_found: false },
            Odolwa: { hearts: 3, boss_count: 0, masks: 0, bottle: false, code: false, fighting: true, projectile: true, odolwa_defeated: true, frog_found: false },
            Everything: { hearts: 7, boss_count: 2, masks: 3, bottle: true, code: true, fighting: true, projectile: true, odolwa_defeated: true, frog_found: true }
        };
        STEPS.forEach(([name, have]) => {
            const engine = run(have);
            // Read the way a logic string reads them, through the resolver.
            const got = {
                hearts: engine.value("hearts"), boss_count: engine.value("boss_count"), masks: engine.value("masks"),
                bottle: engine.value("bottle"), code: engine.value("code"),
                fighting: engine.met("fighting"), projectile: engine.met("projectile"),
                odolwa_defeated: engine.met("odolwa_defeated"), frog_found: engine.met("frog_found")
            };
            expect(got, name).toEqual(table[name]);
        });
    });
});

test.describe("Engine: one piece at a time", () => {
    test("Odolwa Reward closes when any one piece of the flag's chain is missing", () => {
        expect(run(ODOLWA).open("nct_odolwa_reward")).toBe(true);
        const without = {
            "the Deku Mask": Object.assign({}, ODOLWA, { deku_mask: false }),
            "the second key": Object.assign({}, ODOLWA, { woodfall_small_key: 1 }),
            // The Bow is the projectile too, so the Hookshot stands in for that.
            "the Bow": Object.assign({}, ODOLWA, { bow: false, hookshot: true }),
            "the Sword, Odolwa's Remains' own logic": Object.assign({}, ODOLWA, { kokiri_sword: false }),
            "the Song of Time, the flag's own logic": Object.assign({}, ODOLWA, { song_of_time: false })
        };
        Object.entries(without).forEach(([piece, have]) => {
            expect(run(have).open("nct_odolwa_reward"), `without ${piece}`).toBe(false);
        });
    });

    test("Key Chest closes without the first key", () => {
        // Odolwa's Remains can't show this: losing the first key loses the second too.
        expect(run(SWAMP).open("wft_key_chest")).toBe(true);
        expect(run(Object.assign({}, SWAMP, { woodfall_small_key: 0 })).open("wft_key_chest")).toBe(false);
    });

    test("projectile is the Bow, the Hookshot, or the Deku Mask with Magic", () => {
        const cases = [
            [{ bow: true }, true], [{ hookshot: true }, true], [{ deku_mask: true, magic_meter: true }, true],
            [{ deku_mask: true }, false], [{ magic_meter: true }, false], [{}, false]
        ];
        cases.forEach(([have, expected]) => expect(run(have).met("projectile"), JSON.stringify(have)).toBe(expected));
    });

    test("fighting is either sword or the Goron Mask", () => {
        const cases = [[{ kokiri_sword: true }, true], [{ razor_sword: true }, true], [{ goron_mask: true }, true], [{ deku_mask: true }, false], [{}, false]];
        cases.forEach(([have, expected]) => expect(run(have).met("fighting"), JSON.stringify(have)).toBe(expected));
    });

    test("hearts adds Health, every 4 Heart Pieces and each Heart Container", () => {
        expect(run({ heart_piece: 3 }).tokens.hearts).toBe(3);
        expect(run({ heart_piece: 4 }).tokens.hearts).toBe(4);
        expect(run({ heart_piece: 8 }).tokens.hearts).toBe(5);
        expect(run({ heart_container: 1 }).tokens.hearts).toBe(4);
        expect(run({}, { health: 4 }).tokens.hearts).toBe(4);
        expect(run({}, { health: 4 }).open("sct_heart_door")).toBe(true);
        expect(run({ heart_piece: 3 }).open("sct_heart_door")).toBe(false);
    });

    test("code needs all three digits set and no two the same", () => {
        const code = digits => run({ code_digit_1: digits[0], code_digit_2: digits[1], code_digit_3: digits[2] }).tokens.code;
        expect(code([1, 2, 3])).toBe(true);
        expect(code([3, 1, 2])).toBe(true);
        expect(code([1, 1, 2])).toBe(false);
        expect(code([0, 1, 2])).toBe(false);
        expect(code([3, 3, 3])).toBe(false);
    });

    test("masks counts only the tagged masks", () => {
        expect(run({ bunny_hood: true, stone_mask: true }).tokens.masks).toBe(2);
        expect(run({ deku_mask: true, goron_mask: true }).tokens.masks).toBe(0);
        expect(run(Object.assign({}, ODOLWA, { bunny_hood: true, stone_mask: true })).open("mv_mask_collector")).toBe(false);
        expect(run(Object.assign({}, ODOLWA, { bunny_hood: true, stone_mask: true, blast_mask: true })).open("mv_mask_collector")).toBe(true);
    });

    test("bottle is any of its group", () => {
        expect(run({ red_potion: true }).tokens.bottle).toBe(true);
        expect(run({ empty_bottle: 1 }).tokens.bottle).toBe(true);
        expect(run({ empty_bottle: 0 }).tokens.bottle).toBe(false);
        expect(run({ red_potion: true }).open("nct_bottle_shop")).toBe(true);
    });

    test("boss_count against Remains Required moves with the setting", () => {
        const withRemains = Object.assign({}, ODOLWA, { odolwa_remains: true });
        expect(run(withRemains).tokens.boss_count).toBe(1);
        expect(run(withRemains, { remains: "two" }).open("mv_moon_gate")).toBe(false);
        expect(run(withRemains, { remains: "one" }).open("mv_moon_gate")).toBe(true);
        expect(run(ODOLWA, { remains: "zero" }).open("mv_moon_gate")).toBe(true);
        expect(run(ODOLWA, { remains: "one" }).open("mv_moon_gate")).toBe(false);
    });

    test("frog_found needs Mountain Village's way in and the Bunny Hood", () => {
        expect(run(Object.assign({}, ODOLWA, { bunny_hood: true })).met("frog_found")).toBe(true);
        expect(run(Object.assign({}, ODOLWA, { bunny_hood: true })).open("mv_frog_choir")).toBe(true);
        expect(run(Object.assign({}, ODOLWA, { bunny_hood: true })).open("wf_frog_pond")).toBe(true);
        expect(run(Object.assign({}, START, { bunny_hood: true })).met("frog_found")).toBe(false);
        expect(run(ODOLWA).met("frog_found")).toBe(false);
    });

    test("Side Chest needs its own room, the flag and the Ocarina", () => {
        const all = Object.assign({}, ODOLWA, { hookshot: true, ocarina_of_time: true });
        expect(run(all).open("wft_side_chest")).toBe(true);
        expect(run(Object.assign({}, all, { hookshot: false })).open("wft_side_chest")).toBe(false);
        expect(run(Object.assign({}, all, { ocarina_of_time: false })).open("wft_side_chest")).toBe(false);
        expect(run(Object.assign({}, all, { woodfall_small_key: 1 })).open("wft_side_chest")).toBe(false);
    });
});

test.describe("Engine: rooms and non-randomized checks", () => {
    const check = id => world.regions.flatMap(region => region.item_checks).find(entry => entry.id === id);

    test("a check's rooms add up, from the region down", () => {
        const region = world.regions.find(entry => entry.region_name === "Woodfall");
        expect(region.logic).toBe("deku_mask");
        expect(check("wft_odolwa_remains").group_logic).toEqual(["projectile", "woodfall_small_key>=1", "woodfall_small_key>=2&bow"]);
        expect(check("wft_side_chest").group_logic).toEqual(["projectile", "hookshot"]);
        expect(check("wft_entrance_fairy").group_logic).toEqual(["projectile"]);
        expect(check("wf_entrance_chest").group_logic).toEqual([]);
    });

    // Which checks a set of picks makes non-randomized, the default for the rest.
    const DEFAULTS = { shuffle_songs: true, shuffle_shops: true, shuffle_bottles: true, item_pool: "normal", fairy_shuffle: "vanilla" };
    function nonRandomized(picks = {}) {
        const values = Object.assign({}, DEFAULTS, picks);
        return world.regions.flatMap(region => region.item_checks)
            .filter(entry => entry.vanilla_when !== undefined && SettingsModel.matches(world.settings, entry.vanilla_when, id => values[id]))
            .map(entry => entry.id).sort();
    }

    test("on the defaults, the three fairies are non-randomized and nothing else", () => {
        expect(nonRandomized()).toEqual(["sct_stray_fairy", "wft_entrance_fairy", "wft_inner_fairy"]);
    });

    test("each setting the README lists moves exactly the checks it names", () => {
        const fairies = ["sct_stray_fairy", "wft_entrance_fairy", "wft_inner_fairy"];
        expect(nonRandomized({ shuffle_songs: false })).toEqual([...fairies, "sct_song_spot"].sort());
        // Song Spot's one clause names two settings, and needs both. Plentiful locks
        // Fairy Shuffle to Anywhere, written out here since this reads picks, not locks.
        expect(nonRandomized({ shuffle_songs: false, item_pool: "plentiful", fairy_shuffle: "anywhere" })).toEqual([]);
        expect(nonRandomized({ fairy_shuffle: "anywhere" })).toEqual([]);
        expect(nonRandomized({ shuffle_shops: false })).toEqual([...fairies, "nct_bottle_shop"].sort());
        expect(nonRandomized({ shuffle_bottles: false })).toEqual([...fairies, "nct_bottle_shop"].sort());
        expect(nonRandomized({ shuffle_shops: false, shuffle_bottles: false })).toEqual([...fairies, "nct_bottle_shop"].sort());
    });

    test("a room's rule and item reach every check under it that doesn't opt out", () => {
        expect(check("wft_entrance_fairy").vanilla_when).toEqual({ fairy_shuffle: "vanilla" });
        expect(check("wft_entrance_fairy").vanilla_item).toBe("Stray Fairy");
        expect(check("wft_inner_fairy").vanilla_when).toEqual({ fairy_shuffle: "vanilla" });
        expect(check("wft_inner_fairy").vanilla_item).toBe("Stray Fairy");
        ["wft_map_chest", "wft_key_chest", "wft_side_chest", "wft_odolwa_remains"].forEach(id => {
            expect(check(id).vanilla_when, `${id} opts out`).toBeUndefined();
            expect(check(id).vanilla_item, `${id} drops the room's item`).toBeUndefined();
        });
        expect(check("nct_bottle_shop").vanilla_item).toBe("empty_bottle");
        expect(check("sct_song_spot").vanilla_item).toBe("song_of_time");
    });
});

// Cases the test world can't hold, since it keeps every data rule: written here on
// names the world doesn't have.
test.describe("Engine: what the data rules would name", () => {
    const resolveWith = (named, items = {}, numberOf = () => undefined) =>
        DataModel.resolver({ items, tokens: {}, named: new Map(Object.entries(named)), numberOf });
    const met = (resolve, logic) => LogicParser.evaluate(logic, resolve);

    test("a flag that leads back to itself reads false instead of looping", () => {
        // Counts reads of the item inside the loop: once round, then stopped. Without
        // the guard it goes round until the stack runs out, which also reads false.
        let reads = 0;
        const items = new Proxy({ lamp_oil: true }, { get: (target, id) => { if (id === "lamp_oil") reads++; return target[id]; } });
        const resolve = resolveWith({ loop_a: { chain: ["lamp_oil&loop_b"] }, loop_b: { chain: ["loop_a"] } }, items);
        expect(met(resolve, "loop_a")).toBe(false);
        expect(reads).toBe(1);
    });

    test("a flag whose region failed to load reads false", () => {
        expect(met(resolveWith({ lost_flag: { chain: null } }), "lost_flag")).toBe(false);
    });

    test("a name nothing defines reads false", () => {
        expect(met(resolveWith({}), "no_such_item")).toBe(false);
    });

    test("a setting with no number leaves its comparison unmet", () => {
        expect(met(resolveWith({}, { lamp_oil: 5 }), "lamp_oil>=needed")).toBe(false);
        expect(met(resolveWith({}, { lamp_oil: 5 }, id => (id === "needed" ? 5 : undefined)), "lamp_oil>=needed")).toBe(true);
    });

    test("a name after >= is a setting even when an item has that name", () => {
        // The item named "needed" would let it through; the setting doesn't.
        const resolve = resolveWith({}, { lamp_oil: 5, needed: 1 }, id => (id === "needed" ? 9 : undefined));
        expect(met(resolve, "lamp_oil>=needed")).toBe(false);
    });
});
