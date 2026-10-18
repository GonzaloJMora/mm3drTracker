// Every check in the game's data: what the requirements tooltip lists has to mean
// exactly what the check needs, so simplifying never changes a requirement. How each
// step simplifies is tests/node/requirementsView.test.js, on made-up strings.
const path = require("path");
const { test, expect } = require("@playwright/test");
const { readData } = require("../../node/readData.js");
const { differences } = require("../../node/simplifiedChains.js");

const DATA = path.join(__dirname, "..", "..", "..", "data");

test.describe("Requirements list: the game's data", () => {
    test("every check lists exactly what it needs", () => {
        const { checked, found } = differences(readData(DATA));
        expect(checked, "no check with a requirement was read").toBeGreaterThan(0);
        expect(found).toEqual([]);
    });
});
