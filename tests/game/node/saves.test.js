// The game's saves, without a browser: every released format's fixture still decodes
// to exactly what it held. How the codec reads and refuses codes is the factory
// suite's tests/node/saves.test.js. See SAVING.md.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const SaveCodec = require("../../../js/saveCodec.js");

const ROOT = path.join(__dirname, "..", "..", "..");
const FIXTURES = path.join(ROOT, "tests", "game", "fixtures", "saves");
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

// A decoded save as the tracker holds it once opened: a field appended to the layout
// since the save was made is missing from it, and takes what a new tracker starts
// with, as SettingsState and GameState give it.
const settingDefaults = new Map(readJson(path.join(ROOT, "data", "settings.json")).sections
    .flatMap(section => section.groups.flatMap(group => group.settings))
    .map(setting => [setting.id, setting.default]));

function asOpened({ snapshot, missing }) {
    const opened = { settings: { ...snapshot.settings }, slots: { ...snapshot.slots }, checks: [...snapshot.checks], view: { ...snapshot.view } };
    const field = (kind, id) => current.fields.find(entry => entry.kind === kind && entry.id === id);
    missing.settings.forEach(id => { opened.settings[id] = settingDefaults.get(id); });
    missing.slots.forEach(id => {
        const slot = field("slot", id);
        opened.slots[id] = Array.isArray(slot.options) ? slot.options[0] : (slot.min || 0);
    });
    missing.view.forEach(id => { opened.view[id] = false; });
    return opened;
}

const fixtures = fs.readdirSync(FIXTURES)
    .filter(name => /^format\d+\.json$/.test(name))
    .map(name => name.replace(/\.json$/, ""));

test.describe("Save fixtures", () => {
    test("there is a fixture for every released format", () => {
        for (let format = 1; format <= current.format; format++) {
            expect(fixtures, `no tests/game/fixtures/saves/format${format}.json`).toContain(`format${format}`);
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
            // SAVING.md: a field appended since is missing from the
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
            // Gone is dropped, or retired in place: the decoder skips a retired field's
            // bits without naming them, so its id is in neither list.
            const gone = (id, group) => result.dropped[group].includes(id) || !live.has(`${KINDS[group]}:${id}`);
            const kept = (list, group) => list.filter(id => !gone(id, group));
            const without = (values, group) => Object.fromEntries(Object.entries(values)
                .filter(([id]) => !gone(id, group)));
            const broke = group => `${name}'s ${group} no longer decode to what the save held, so players' saves broke. ` +
                "The fixture is frozen: fix the code or data/saveLayout.json, never the fixture (SAVING.md, *Save fixtures*).";
            expect(result.snapshot.settings, broke("settings")).toEqual(without(expected.snapshot.settings, "settings"));
            expect(result.snapshot.slots, broke("slots")).toEqual(without(expected.snapshot.slots, "slots"));
            expect(result.snapshot.view, broke("view toggles")).toEqual(without(expected.snapshot.view, "view"));
            // Checks come back in layout order; which ones is what matters.
            expect([...result.snapshot.checks].sort(), broke("checks")).toEqual(kept(expected.snapshot.checks, "checks").sort());
        });

        test(`${name} survives being saved again in the current format`, async () => {
            const save = readJson(path.join(FIXTURES, `${name}.json`));
            const first = await decode(SaveCodec.unwrap(save, current));
            const opened = asOpened(first);
            const { code, problems } = SaveCodec.encode(opened, current);
            expect(problems).toEqual([]);
            const again = await decode(code);
            expect(again.format).toBe(current.format);
            expect(again.snapshot).toEqual(opened);
        });
    }
});

test.describe("The game's save layout", () => {
    test("has no problems", () => {
        expect(SaveCodec.layoutProblems(current)).toEqual([]);
    });
});
