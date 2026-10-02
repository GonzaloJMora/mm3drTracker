// Saves, without a browser: every released format's fixture still decodes to exactly
// what it held, and the codec refuses what it should. See ARCHITECTURE.md, *Saving*.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const SaveCodec = require("../../js/saveCodec.js");

const ROOT = path.join(__dirname, "..", "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures", "saves");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));

const current = readJson(path.join(ROOT, "data", "saveLayout.json"));

// What TrackerData.saveLayoutFor does in the page, from the files on disk.
async function layoutFor(format) {
    if (format === current.format) return current;
    const file = path.join(ROOT, "data", "saveLayouts", `format${format}.json`);
    return fs.existsSync(file) ? readJson(file) : null;
}

const decode = code => SaveCodec.decode(code, { layoutFor, current });

// Snapshot group -> field kind.
const KINDS = { settings: "setting", slots: "slot", checks: "check", view: "view" };
const keyOf = field => `${field.kind}:${field.id}`;

// The fields a code holds: its own format's layout, as far as the field count in
// its header (the second 16 bits) reaches.
async function heldFields(code, format) {
    const bytes = Buffer.from(code, "base64url");
    const count = bytes[2] * 256 + bytes[3];
    const own = await layoutFor(format);
    return new Set(own.fields.slice(0, count).filter(field => field.kind !== "retired").map(keyOf));
}

const fixtures = fs.readdirSync(FIXTURES)
    .filter(name => /^format\d+\.json$/.test(name))
    .map(name => name.replace(/\.json$/, ""));

test.describe("Save fixtures", () => {
    test("there is a fixture for every released format", () => {
        for (let format = 1; format <= current.format; format++) {
            expect(fixtures, `no tests/fixtures/saves/format${format}.json`).toContain(`format${format}`);
        }
    });

    for (const name of fixtures) {
        test(`${name} decodes to exactly what it held`, async () => {
            const save = readJson(path.join(FIXTURES, `${name}.json`));
            const expected = readJson(path.join(FIXTURES, `${name}.expected.json`));
            const code = SaveCodec.unwrap(save, current);
            const result = await decode(code);
            expect(result.format).toBe(expected.format);

            // The layout moves on after a format ships, within the rules in
            // ARCHITECTURE.md, *Saving*: a field appended since is missing from the
            // save, and one retired since is dropped from it. Nothing else may change.
            const held = await heldFields(code, result.format);
            const live = new Set(current.fields.filter(field => field.kind !== "retired").map(keyOf));
            for (const [group, kind] of Object.entries(KINDS)) {
                const extraMissing = result.missing[group].filter(id => !expected.missing[group].includes(id));
                expect(extraMissing.filter(id => held.has(`${kind}:${id}`)), `${group} the save holds, reported missing`).toEqual([]);
                expect(result.missing[group]).toEqual(expect.arrayContaining(expected.missing[group]));
                const extraDropped = result.dropped[group].filter(id => !expected.dropped[group].includes(id));
                expect(extraDropped.filter(id => live.has(`${kind}:${id}`)), `${group} still in the layout, reported dropped`).toEqual([]);
            }
            const kept = (list, group) => list.filter(id => !result.dropped[group].includes(id));
            const without = (values, group) => Object.fromEntries(Object.entries(values)
                .filter(([id]) => !result.dropped[group].includes(id)));
            expect(result.snapshot.settings).toEqual(without(expected.snapshot.settings, "settings"));
            expect(result.snapshot.slots).toEqual(without(expected.snapshot.slots, "slots"));
            expect(result.snapshot.view).toEqual(without(expected.snapshot.view, "view"));
            // Checks come back in layout order; which ones is what matters.
            expect([...result.snapshot.checks].sort()).toEqual(kept(expected.snapshot.checks, "checks").sort());
        });

        test(`${name} survives being saved again in the current format`, async () => {
            const save = readJson(path.join(FIXTURES, `${name}.json`));
            const first = await decode(SaveCodec.unwrap(save, current));
            const { code, problems } = SaveCodec.encode(first.snapshot, current);
            expect(problems).toEqual([]);
            const again = await decode(code);
            expect(again.format).toBe(current.format);
            expect(again.snapshot).toEqual(first.snapshot);
        });
    }
});

test.describe("Save codec", () => {
    let code;
    test.beforeAll(async () => {
        const save = readJson(path.join(FIXTURES, "format1.json"));
        code = SaveCodec.encode((await decode(SaveCodec.unwrap(save, current))).snapshot, current).code;
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

    test("the current layout has no problems", () => {
        expect(SaveCodec.layoutProblems(current)).toEqual([]);
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
