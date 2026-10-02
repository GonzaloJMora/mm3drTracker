// The data files are readable everywhere, and the generated ones are up to date,
// by asking the scripts that write them (both have a --check mode that changes
// nothing).
const { test, expect } = require("@playwright/test");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PYTHON = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");

function check(script) {
    const run = spawnSync(PYTHON, [path.join("scripts", script), "--check"], { cwd: ROOT, encoding: "utf8" });
    if (run.error) throw new Error(`could not run ${PYTHON}: ${run.error.message}`);
    return { status: run.status, output: `${run.stdout}${run.stderr}`.trim() };
}

// Every file under data/, however deep.
function dataFiles(dir = path.join(ROOT, "data")) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory() ? dataFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}

test.describe("Data files", () => {
    // Windows PowerShell 5.1 starts the files it writes with a byte-order mark,
    // which Python's json module refuses, so the scripts under scripts/ would fail.
    test("no data file starts with a byte-order mark", () => {
        const marked = dataFiles()
            .filter(file => fs.readFileSync(file).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
            .map(file => path.relative(ROOT, file));
        expect(marked, "Save these as UTF-8 without a byte-order mark.").toEqual([]);
    });
});

test.describe("Generated data files", () => {
    test("data/saveLayout.json covers every setting, slot and check", () => {
        const { status, output } = check("updateSaveLayout.py");
        expect(status, `${output}\n\nRun scripts/updateSaveLayout.py and commit data/saveLayout.json.`).toBe(0);
    });

    test("data/offline.json lists every file the site needs", () => {
        const { status, output } = check("updateOfflineFiles.py");
        expect(status, `${output}\n\nRun scripts/updateOfflineFiles.py and commit data/offline.json.`).toBe(0);
    });
});
