// The game suite's browser fixtures: everything the factory suite's
// tests/browser/fixtures.js offers, console check included, with readWorld reading this
// game's own data/ and its released saves.
const path = require("path");
const base = require("../../browser/fixtures");

const ROOT = path.join(__dirname, "..", "..", "..");

module.exports = Object.assign({}, base, {
    readWorld: base.worldReader(path.join(ROOT, "data")),
    SAVE_FIXTURES: path.join(__dirname, "..", "fixtures", "saves")
});
