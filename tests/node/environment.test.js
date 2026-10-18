// The test world in tests/environment stands on its own: its files are readable, the
// ones scripts write are up to date, and every picture the pages or its data ask for
// is in its own images/, so it keeps working with the game's images/ gone. That it
// keeps every data rule is tests/node/dataChecks.test.js.
const { test, expect } = require("@playwright/test");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const WORLD = path.join(ROOT, "tests", "environment");
const PYTHON = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");

function run(script, args) {
    const result = spawnSync(PYTHON, [path.join("scripts", "data", script), ...args, "--check"], { cwd: ROOT, encoding: "utf8" });
    if (result.error) throw new Error(`could not run ${PYTHON}: ${result.error.message}`);
    return { status: result.status, output: `${result.stdout}${result.stderr}`.trim() };
}

function filesUnder(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory() ? filesUnder(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}

// Every images/ address written in a file, as the page would ask for it.
const imagesNamedIn = text => [...text.matchAll(/images\/[A-Za-z0-9_./-]+\.(?:png|ico|svg|jpg)/g)].map(match => match[0]);

test.describe("Test world", () => {
    test("no file in it starts with a byte-order mark", () => {
        const marked = filesUnder(path.join(WORLD, "data"))
            .filter(file => fs.readFileSync(file).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
            .map(file => path.relative(ROOT, file));
        expect(marked, "Save these as UTF-8 without a byte-order mark.").toEqual([]);
    });

    test("its saveLayout.json covers every setting, slot and check", () => {
        const { status, output } = run("updateSaveLayout.py", ["--data", "tests/environment/data"]);
        expect(status, `${output}\n\nRun scripts/data/updateSaveLayout.py --data tests/environment/data.`).toBe(0);
    });

    test("its offline.json lists every file it serves", () => {
        const { status, output } = run("updateOfflineFiles.py", ["--site", "tests/environment"]);
        expect(status, `${output}\n\nRun scripts/data/updateOfflineFiles.py --site tests/environment.`).toBe(0);
    });

    test("every picture the pages and its data ask for is in its own images/", () => {
        const sources = [
            ...["index.html", "tracker.html", "site.webmanifest"].map(file => path.join(ROOT, file)),
            ...filesUnder(path.join(ROOT, "css")),
            ...filesUnder(path.join(WORLD, "data")).filter(file => file.endsWith(".json"))
        ];
        const named = [...new Set(sources.flatMap(file => imagesNamedIn(fs.readFileSync(file, "utf8"))))];
        expect(named.length, "found no images/ address to check").toBeGreaterThan(20);
        expect(named.filter(address => !fs.existsSync(path.join(WORLD, address)))).toEqual([]);
    });
});
