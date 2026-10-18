// What the requirements tooltip lists: RequirementsView.simplify() on made-up strings,
// each step at its edge, with every answer written by hand; then every check in the
// test world, where what is listed has to mean exactly the check's requirement.
// The game's checks are held to the same in tests/game/node/simplifiedChains.test.js.
const { test, expect } = require("@playwright/test");
const LogicParser = require("../../js/logicParser.js");
const RequirementsView = require("../../js/requirementsView.js");
const { readData, ENVIRONMENT } = require("./readData.js");
const { differences } = require("./simplifiedChains.js");

// A term written back as logic, so expected answers read like the data.
function written(node, parent) {
    if (node.type === "token") return node.id;
    if (node.type === "compare") return `${node.left.id}>=${node.right.type === "number" ? node.right.value : node.right.id}`;
    const text = node.children.map(child => written(child, node.type)).join(node.type === "and" ? "&" : "|");
    return parent && parent !== node.type ? `(${text})` : text;
}

// The terms listed for a string, with settings standing for the numbers given.
const listed = (logic, settings = {}) => RequirementsView
    .simplify(LogicParser.parse(logic), (token, kind) => (kind === "setting" ? settings[token] : undefined))
    .map(term => written(term));

test.describe("Requirements list", () => {
    test("each term is listed once, and nested & becomes separate terms", () => {
        expect(listed("a&(b&c)")).toEqual(["a", "b", "c"]);
        expect(listed("a&b&a")).toEqual(["a", "b"]);
    });

    test("a count asked for outright covers any lower count of the item, and the bare item", () => {
        expect(listed("key>=2&key>=3")).toEqual(["key>=3"]);
        expect(listed("key&key>=2")).toEqual(["key>=2"]);
        expect(listed("key>=3&(key>=2|bow)")).toEqual(["key>=3"]);
        expect(listed("key>=3&(key>=3|bow)")).toEqual(["key>=3"]);
        // A higher count isn't met by a lower one.
        expect(listed("key>=2&(key>=3|bow)")).toEqual(["key>=2", "key>=3|bow"]);
        // A way in loses the part already given, and keeps the rest.
        expect(listed("key>=2&(bow|(key>=1&stick))")).toEqual(["key>=2", "bow|stick"]);
    });

    test("a count against a setting is weighed at the setting's number", () => {
        expect(listed("masks>=needed&masks>=2", { needed: 3 })).toEqual(["masks>=needed"]);
        expect(listed("masks>=needed&masks>=2", { needed: 1 })).toEqual(["masks>=2"]);
        // A setting with no number is never met, so nothing beside it can stand in for it.
        expect(listed("masks>=needed&masks>=2")).toEqual(["masks>=needed"]);
    });

    test("a term the others already cover goes", () => {
        expect(listed("(bow|bomb|goron)&(bomb|goron)")).toEqual(["bomb|goron"]);
        expect(listed("((magic&goron)|hookshot)&hookshot")).toEqual(["hookshot"]);
        // A count covers a count of the same item at its own number.
        expect(listed("(key>=2|bow)&(key>=2|bow|hookshot)")).toEqual(["key>=2|bow"]);
        // Two terms that cover each other: the first stays.
        expect(listed("(a|b)&(b|a)")).toEqual(["a|b"]);
        // Neither covers the other, so both stay.
        expect(listed("(bow|bomb)&(bomb|goron)")).toEqual(["bow|bomb", "bomb|goron"]);
    });

    test("in an either/or, a way in asking for more than another goes", () => {
        expect(listed("goron|(goron&lullaby)|bow")).toEqual(["goron|bow"]);
        expect(listed("goron|(bow&lullaby)")).toEqual(["goron|(bow&lullaby)"]);
    });

    test("in an either/or, an item every way in asks for is its own term", () => {
        expect(listed("(a&m)|(b&c&m)")).toEqual(["m", "a|(b&c)"]);
        // Once pulled out, the item is given to the other terms too.
        expect(listed("((a&m)|(b&m))&(c|(m&d))")).toEqual(["m", "a|b", "c|d"]);
        // Not every way in needs it, so it stays in the routes that do.
        expect(listed("light|((bomb|(blast&shield))&mirror)")).toEqual(["light|((bomb|(blast&shield))&mirror)"]);
    });

    test("every check in the test world lists exactly what it needs", () => {
        const { checked, found } = differences(readData(ENVIRONMENT));
        // The README's 23 checks, less the four with no requirement at all (Clock Tower
        // Chest, both Postboxes, Stray Fairy).
        expect(checked).toBe(19);
        expect(found).toEqual([]);
    });
});
