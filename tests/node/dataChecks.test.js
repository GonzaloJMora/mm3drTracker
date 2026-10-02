// Every rule in js/dataChecks.js, twice: the real data in data/ keeps it, and a
// small made-up data set with just that one mistake breaks it, which proves the
// check works. The made-up names mean no edit to the game's data can break the
// second half. A new rule needs an example in BROKEN, or the last test fails.
const { test, expect } = require("@playwright/test");
const { readData } = require("./readData.js");
require("../../js/logicParser.js");
const DataModel = require("../../js/dataModel.js");
const DataChecks = require("../../js/dataChecks.js");

// Every finding for a data set, as rule id -> lines. A string that fails to parse
// is reported by the parser through console.error; the rule says the same, so the
// parser's line is kept out of the test output.
function findingsOf(assembled) {
    const original = console.error;
    console.error = () => {};
    try {
        const context = DataChecks.context(assembled.data, { fileOf: assembled.fileOf });
        const byRule = {};
        assembled.findings.concat(DataChecks.run(context)).forEach(({ rule, lines }) => {
            byRule[rule] = (byRule[rule] || []).concat(lines);
        });
        return byRule;
    } finally {
        console.error = original;
    }
}

// A tiny world that keeps every rule: two regions, a flag, a helper, a token, a
// check group and a numeric dropdown.
function cleanWorld() {
    return {
        configParts: [
            { name: "grids.json", data: { grids: { main: ["sword", "bow", "heart_piece", "d1", "", ""] } } },
            { name: "inventory.json", data: {
                progressions: { sword: ["kokiri", "razor"] },
                item_counts: { heart_piece: 52 },
                item_groups: { blades: ["kokiri", "razor"] },
                digit_slots: { name: "Code digit", ids: ["d1"], max_value: 5 }
            } },
            { name: "logicTokens.json", data: { tokens: [
                { id: "hearts", name: "Hearts", kind: "sum", terms: [{ setting: "health" }, { item: "heart_piece", per: 4 }] },
                { id: "blade_count", name: "Blades", kind: "count", group: "blades" }
            ] } },
            { name: "checkGroups.json", data: { check_groups: [["a1", "b1"]] } }
        ],
        items: [{ id: "kokiri" }, { id: "razor" }, { id: "bow" }, { id: "heart_piece" }],
        regions: [
            { file: "A.json", data: { region_name: "A", logic: "", map_coordinates: { xPercent: 10, yPercent: 20 }, item_checks: [
                { id: "a1", name: "A one", logic: "bow", vanilla_when: true, vanilla_item: "bow" },
                { id: "a2", name: "A two", logic: "kokiri&flag_x&blade_count>=need" }
            ] } },
            { file: "B.json", data: { region_name: "B", logic: "razor", map_coordinates: { xPercent: 50, yPercent: 50 }, subregions: [
                { name: "Room", logic: "helper_y", item_checks: [{ id: "b1", name: "B one", vanilla_when: true, vanilla_item: "bow" }] }
            ] } }
        ],
        flags: [{ id: "flag_x", name: "Flag X", at: { check: "b1" } }],
        helpers: [{ id: "helper_y", name: "Helper Y", logic: "bow|kokiri" }],
        settings: { sections: [{ name: "S", groups: [{ name: "G", settings: [
            { id: "health", name: "Health", class: "number", default: 3, min: 3, max: 20 },
            { id: "need", name: "Need", class: "dropdown", default: "two",
                options: [{ id: "one", name: "1", value: 1 }, { id: "two", name: "2", value: 2 }] }
        ] }] }] }
    };
}

const part = (world, name) => world.configParts.find(entry => entry.name === name).data;
const region = (world, name) => world.regions.find(entry => entry.data.region_name === name).data;
const check = (world, id) => world.regions.flatMap(entry => entry.data.item_checks || []).find(c => c.id === id);

// One mistake per rule, made to the clean world.
const BROKEN = {
    "config-keys": w => w.configParts.push({ name: "extra.json", data: { grids: { other: [] } } }),
    "item-ids": w => w.items.push({ name: "No id" }),
    "check-group-shape": w => part(w, "checkGroups.json").check_groups.push(["a1"]),
    "region-names": w => { region(w, "A").region_name = "A "; },
    "region-trees": w => region(w, "B").subregions.push({ item_checks: [] }),
    "region-accepted": w => { region(w, "B").region_name = "A"; },
    "grid-slots": w => part(w, "grids.json").grids.main.push("not_an_item"),
    "digit-slots-named": w => { delete part(w, "inventory.json").digit_slots.name; },
    "progressions-or-counts": w => { part(w, "inventory.json").item_counts.sword = 2; },
    "logic-tokens-defined": w => part(w, "logicTokens.json").tokens.push({ id: "bow", name: "Bow", kind: "any", group: "blades" }),
    "logic-parses": w => { check(w, "a1").logic = "bow&"; },
    "logic-tokens-known": w => { check(w, "a1").logic = "no_such_item"; },
    "logic-counts": w => { check(w, "a1").logic = "heart_piece>=health"; },
    "logic-demanded-once": w => { check(w, "a2").logic = "kokiri&kokiri"; region(w, "A").logic = "kokiri"; },
    "flags-and-helpers": w => { w.flags[0].at = { check: "no_such_check" }; },
    "check-ids-unique": w => { check(w, "a2").id = "a1"; },
    "check-groups": w => part(w, "checkGroups.json").check_groups.push(["a2", "no_such_check"]),
    "check-names": w => { check(w, "a2").name = ""; },
    "vanilla-items": w => { check(w, "a1").vanilla_item = "not_an_item"; },
    "map-coordinates": w => { delete region(w, "A").map_coordinates; }
};

test.describe("Data checks: the real data", () => {
    let found;
    test.beforeAll(() => {
        found = findingsOf(readData());
    });

    for (const rule of DataChecks.RULES) {
        test(`${rule.id}: ${rule.title}`, () => {
            expect(found[rule.id] || [], `data/ breaks "${rule.id}"`).toEqual([]);
        });
    }
});

test.describe("Data checks: each catches its mistake", () => {
    test("the made-up world keeps every rule", () => {
        expect(findingsOf(DataModel.assemble(cleanWorld()))).toEqual({});
    });

    for (const rule of DataChecks.RULES) {
        test(`${rule.id} catches its mistake`, () => {
            expect(BROKEN[rule.id], `no broken example for "${rule.id}" in this file`).toBeTruthy();
            const world = cleanWorld();
            BROKEN[rule.id](world);
            const found = findingsOf(DataModel.assemble(world));
            expect(found[rule.id], `"${rule.id}" didn't catch its example`).toBeTruthy();
        });
    }

    test("every example is for a rule that exists", () => {
        const ids = DataChecks.RULES.map(rule => rule.id);
        expect(Object.keys(BROKEN).filter(id => !ids.includes(id))).toEqual([]);
    });
});
