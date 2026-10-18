// The game's own data/ held to every rule in js/dataChecks.js. That each rule catches
// its mistake is proven in the factory suite, tests/node/dataChecks.test.js.
const path = require("path");
const { test, expect } = require("@playwright/test");
const { readData } = require("../../node/readData.js");
const { findingsOf } = require("../../node/findings.js");
const DataChecks = require("../../../js/dataChecks.js");

const DATA = path.join(__dirname, "..", "..", "..", "data");

test.describe("Data checks: the game's data", () => {
    let found;
    test.beforeAll(() => {
        found = findingsOf(readData(DATA));
    });

    for (const rule of DataChecks.RULES) {
        test(`${rule.id}: ${rule.title}`, () => {
            expect(found[rule.id] || [], `data/ breaks "${rule.id}"`).toEqual([]);
        });
    }
});
