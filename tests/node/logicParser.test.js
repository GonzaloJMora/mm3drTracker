// The logic grammar on made-up names, so no edit to the game's data can break these.
// See ARCHITECTURE.md, *Logic strings*.
const { test, expect } = require("@playwright/test");
const LogicParser = require("../../js/logicParser.js");

// Items owned are true or a count; settings are numbers looked up as settings.
function resolver(have, settings = {}) {
    return (token, kind) => (kind === "setting" ? settings[token] : have[token] ?? false);
}

const evaluate = (logic, have, settings) => LogicParser.evaluate(logic, resolver(have, settings));

// The parser names a bad string through console.error; that's expected here.
function parseError(logic) {
    const original = console.error;
    console.error = () => {};
    try {
        LogicParser.parse(logic);
    } catch (error) {
        return error.message;
    } finally {
        console.error = original;
    }
    return null;
}

test.describe("Logic parser", () => {
    test("empty logic is always reachable", () => {
        expect(evaluate("", {})).toBe(true);
        expect(evaluate("   ", {})).toBe(true);
        expect(evaluate(undefined, {})).toBe(true);
        expect(evaluate([], {})).toBe(true);
    });

    test("a bare token is whether you have it", () => {
        expect(evaluate("lamp", { lamp: true })).toBe(true);
        expect(evaluate("lamp", {})).toBe(false);
    });

    test("& needs both, | needs either", () => {
        expect(evaluate("lamp&rope", { lamp: true })).toBe(false);
        expect(evaluate("lamp&rope", { lamp: true, rope: true })).toBe(true);
        expect(evaluate("lamp|rope", { rope: true })).toBe(true);
        expect(evaluate("lamp|rope", {})).toBe(false);
    });

    test("| binds looser than &", () => {
        // a | (b & c), not (a | b) & c
        expect(evaluate("a|b&c", { a: true })).toBe(true);
        expect(evaluate("a|b&c", { b: true })).toBe(false);
        expect(evaluate("a&b|c", { c: true })).toBe(true);
    });

    test("parentheses group", () => {
        expect(evaluate("(a|b)&c", { a: true })).toBe(false);
        expect(evaluate("(a|b)&c", { b: true, c: true })).toBe(true);
        expect(evaluate("a&(b|(c&d))", { a: true, c: true, d: true })).toBe(true);
    });

    test("whitespace doesn't matter", () => {
        expect(evaluate(" a  &\n( b | c ) ", { a: true, c: true })).toBe(true);
    });

    test(">= a number compares a count", () => {
        expect(evaluate("key>=2", { key: 1 })).toBe(false);
        expect(evaluate("key>=2", { key: 2 })).toBe(true);
        expect(evaluate("key >= 2", { key: 3 })).toBe(true);
    });

    test(">= a name compares against a setting, never an item", () => {
        // An item with the setting's name must not be read in its place.
        expect(evaluate("masks>=needed", { masks: 2, needed: 9 }, { needed: 3 })).toBe(false);
        expect(evaluate("masks>=needed", { masks: 3 }, { needed: 3 })).toBe(true);
        // A setting with no number leaves the comparison unmet.
        expect(evaluate("masks>=needed", { masks: 99 }, {})).toBe(false);
    });

    test("a comparison binds tighter than & and |", () => {
        expect(evaluate("a|key>=2&b", { key: 2, b: true })).toBe(true);
        expect(evaluate("a|key>=2&b", { key: 1, b: true })).toBe(false);
    });

    test("a list of strings is joined by &", () => {
        expect(evaluate(["a|b", "c"], { b: true, c: true })).toBe(true);
        expect(evaluate(["a|b", "c"], { b: true })).toBe(false);
        expect(evaluate(["", "c", null], { c: true })).toBe(true);
    });

    test("anything an additive tracker can't mean is a parse error", () => {
        const bad = [
            "!lamp",        // no negation
            "key<=2",       // no other comparison
            "key>2",
            "3",            // a number on its own
            "a&3",
            "2>=key",       // the count goes on the right
            "(a|b)>=2",     // only a token on the left
            "key>=",        // nothing to compare with
            "a&",           // ends early
            "(a|b",         // unclosed
            "a|b)",         // stray close
            "a b",          // two tokens with no operator
            "a&&b"
        ];
        bad.forEach(logic => expect(parseError(logic), `"${logic}" should not parse`).not.toBeNull());
    });

    test("a bad string fails the same way every time", () => {
        const first = parseError("!lamp");
        expect(parseError("!lamp")).toBe(first);
    });

    test("annotate marks what blocks and what an alternative already covers", () => {
        const tree = LogicParser.parse("a&(b|c)");
        const annotated = LogicParser.annotate(tree, resolver({ a: true, b: true }));
        expect(annotated.state).toBe("satisfied");
        const [a, either] = annotated.children;
        expect(a.state).toBe("satisfied");
        expect(either.children.map(child => child.state)).toEqual(["satisfied", "optional"]);

        const missing = LogicParser.annotate(tree, resolver({ b: true }));
        expect(missing.state).toBe("blocking");
        expect(missing.children[0].state).toBe("blocking");
    });
});
