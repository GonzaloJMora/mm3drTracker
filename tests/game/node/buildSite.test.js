// The site that gets published, built into a temporary folder: everything the
// pages need and nothing else, with every script and stylesheet address stamped.
// See scripts/release/buildSite.py.
const { test, expect } = require("@playwright/test");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const PYTHON = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const readJson = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));

function filesUnder(dir, base = dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? filesUnder(full, base) : [path.relative(base, full).split(path.sep).join("/")];
    });
}

test.describe("Built site", () => {
    let out;

    test.beforeAll(() => {
        out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "built-site-")), "site");
        const run = spawnSync(PYTHON, [path.join("scripts", "release", "buildSite.py"), "--out", out], { cwd: ROOT, encoding: "utf8" });
        if (run.error) throw new Error(`could not run ${PYTHON}: ${run.error.message}`);
        if (run.status !== 0) throw new Error(`the build failed:\n${run.stdout}${run.stderr}`);
    });

    test.afterAll(() => {
        fs.rmSync(path.dirname(out), { recursive: true, force: true });
    });

    // A broken copy prints nothing in a browser (a damaged image just doesn't show), so
    // the built pass can't see it; only the bytes can.
    test("holds exactly what data/offline.json lists, plus the offline worker, each the repo's file", () => {
        const expected = readJson("data/offline.json").files.filter(file => file !== "./").concat("offlineWorker.js").sort();
        expect(filesUnder(out).sort()).toEqual(expected);

        const stamp = new RegExp(`\\?v=${readJson("data/version.json").version.replace(/\./g, "\\.")}`, "g");
        const changed = expected.filter(file => {
            const repo = fs.readFileSync(path.join(ROOT, file));
            const built = fs.readFileSync(path.join(out, file));
            return file.endsWith(".html") ? built.toString("utf8").replace(stamp, "") !== repo.toString("utf8") : !built.equals(repo);
        });
        expect(changed, "built files that differ from the repo's (the pages apart from their stamps)").toEqual([]);
    });

    // Every <script src> and stylesheet <link href>, however it is quoted or written, so
    // one the build's own pattern misses is missed here too.
    test("stamps every script and stylesheet the pages load, and each points at a real file", () => {
        const { version } = readJson("data/version.json");
        const attribute = (tag, name) => (tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")) || []).slice(1).find(Boolean);
        for (const page of ["index.html", "tracker.html"]) {
            const html = fs.readFileSync(path.join(out, page), "utf8");
            const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map(([tag]) => attribute(tag, "src"));
            const sheets = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => tag)
                .filter(tag => /^stylesheet$/i.test(attribute(tag, "rel") || "")).map(tag => attribute(tag, "href"));
            const assets = scripts.concat(sheets).filter(address => address && !/^(?:[a-z]+:)?\/\//i.test(address));
            expect(assets.length, `${page} loads no scripts or stylesheets`).toBeGreaterThan(0);
            for (const asset of assets) {
                expect(asset, `${page}: ${asset} isn't stamped`).toMatch(new RegExp(`\\?v=${version.replace(/\./g, "\\.")}$`));
                expect(fs.existsSync(path.join(out, asset.split("?")[0])), `${page}: ${asset} has no file`).toBe(true);
            }
        }
    });

    test("never stamps the repo's own pages", () => {
        for (const page of ["index.html", "tracker.html"]) {
            expect(fs.readFileSync(path.join(ROOT, page), "utf8")).not.toContain("?v=");
        }
    });
});
