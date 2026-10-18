// The save codec, without a browser, on a save of the test world: it reads back what
// it wrote, and refuses what it should. That the game's released saves still load is
// the game suite's tests/game/node/saves.test.js. See SAVING.md.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const SaveCodec = require("../../js/saveCodec.js");

const LAYOUT = path.join(__dirname, "..", "environment", "data", "saveLayout.json");
const current = JSON.parse(fs.readFileSync(LAYOUT, "utf8"));

// The test world has only ever had one format.
const decode = code => SaveCodec.decode(code, { layoutFor: async format => (format === current.format ? current : null), current });

// A run partway through the test world (its README's Swamp inventory, ticked a little),
// with every setting moved off its default where it can be.
const SNAPSHOT = {
    settings: {
        shuffle_songs: false, shuffle_shops: true, shuffle_bottles: false, item_pool: "plentiful", fairy_shuffle: "anywhere",
        remains_required: "one", starting_sword: "razor_sword", start_with_hookshot: true, starting_kit: "full",
        starting_health: 5, starting_heart_pieces: 7, start_with_bottle: true
    },
    slots: {
        sword: 1, bow: 0, hookshot: 0, magic: -1, empty_bottle: 1, red_potion: -1,
        deku_mask: 0, goron_mask: -1, bunny_hood: 0, stone_mask: -1, blast_mask: -1,
        ocarina_of_time: -1, song_of_time: -1, heart_piece: 6, heart_container: 0, woodfall_small_key: 1,
        odolwa_remains: -1, goht_remains: -1, code_digit_1: 1, code_digit_2: 0, code_digit_3: 3
    },
    checks: ["sct_clock_tower_chest", "sct_postbox", "nct_postbox", "wft_key_chest", "wft_side_chest"],
    view: { "toggle-non-randomized": true, "toggle-only-accessible": false }
};

test.describe("Save codec", () => {
    let code;
    test.beforeAll(() => {
        const result = SaveCodec.encode(SNAPSHOT, current);
        expect(result.problems).toEqual([]);
        code = result.code;
    });

    const reasonOf = async promise => {
        try {
            await promise;
        } catch (error) {
            expect(error).toBeInstanceOf(SaveCodec.SaveError);
            return error.reason;
        }
        throw new Error("the save was accepted");
    };

    test("the test world's layout has no problems", () => {
        expect(SaveCodec.layoutProblems(current)).toEqual([]);
    });

    test("a save reads back exactly as it was written", async () => {
        // A lost last field reads as unset, so only a save that sets it shows the loss.
        const last = current.fields[current.fields.length - 1];
        expect(SNAPSHOT.checks, "the save sets the layout's last field").toContain(last.id);
        const result = await decode(code);
        expect(result.format).toBe(current.format);
        expect(result.snapshot.settings).toEqual(SNAPSHOT.settings);
        expect(result.snapshot.slots).toEqual(SNAPSHOT.slots);
        expect(result.snapshot.view).toEqual(SNAPSHOT.view);
        expect([...result.snapshot.checks].sort()).toEqual([...SNAPSHOT.checks].sort());
    });

    test("a mistyped code is refused as damaged", async () => {
        const middle = Math.floor(code.length / 2);
        const typo = code.slice(0, middle) + (code[middle] === "A" ? "B" : "A") + code.slice(middle + 1);
        expect(await reasonOf(decode(typo))).toBe("damaged");
    });

    test("a code cut short is refused", async () => {
        // Which of the two depends on where the cut lands; either way nothing loads.
        for (const length of [code.length - 1, code.length - 4, code.length - 10, 6]) {
            expect(["damaged", "not-a-code"]).toContain(await reasonOf(decode(code.slice(0, length))));
        }
    });

    test("a save from a newer format is refused, never read partway", async () => {
        const newer = Object.assign({}, current, { format: current.format + 1 });
        const { code: future } = SaveCodec.encode({}, newer);
        expect(await reasonOf(decode(future))).toBe("newer");
    });

    test("a save from another tracker is refused", async () => {
        const wrapper = SaveCodec.wrap(code, Object.assign({}, current, { app: "someOtherTracker" }));
        expect(await reasonOf(Promise.resolve().then(() => SaveCodec.unwrap(wrapper, current)))).toBe("not-a-save");
        expect(await reasonOf(Promise.resolve().then(() => SaveCodec.unwrap("{ not json", current)))).toBe("not-a-save");
    });
});
