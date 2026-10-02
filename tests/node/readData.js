// Reads data/ from disk the way dataLoader.js reads it from the site, through the
// same DataModel.assemble(), for the checks that need no browser.
const fs = require("fs");
const path = require("path");
require("../../js/logicParser.js");
const DataModel = require("../../js/dataModel.js");

const DATA = path.join(__dirname, "..", "..", "data");
const readJson = name => JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8"));

function readData() {
    const index = readJson("config.json");
    const raw = {
        configParts: index.files.map(name => ({ name, data: readJson(name) })),
        items: readJson("Items.json"),
        regions: readJson("manifest.json").map(file => ({ file, data: readJson(file) })),
        flags: readJson("locationFlags.json").flags,
        helpers: readJson("logicHelpers.json").helpers,
        settings: readJson("settings.json")
    };
    return DataModel.assemble(raw);
}

module.exports = { readData };
