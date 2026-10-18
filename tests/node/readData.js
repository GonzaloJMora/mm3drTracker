// Reads a world's data/ folder from disk the way dataLoader.js reads it from the site,
// through the same DataModel.assemble(), for the checks that need no browser. The
// factory suite reads tests/environment/data; the game suite reads the repo's data/.
const fs = require("fs");
const path = require("path");
require("../../js/logicParser.js");
const DataModel = require("../../js/dataModel.js");

const ENVIRONMENT = path.join(__dirname, "..", "environment", "data");

function readData(folder) {
    const readJson = name => JSON.parse(fs.readFileSync(path.join(folder, name), "utf8"));
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

module.exports = { readData, ENVIRONMENT };
