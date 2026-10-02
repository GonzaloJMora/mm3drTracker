// The test suite: the checks that need no browser first, then the tracker in
// Chromium, then a shorter pass in Firefox and WebKit. See README.md, *Testing*.
const { defineConfig } = require("@playwright/test");

const CI = Boolean(process.env.CI);
// TEST_SITE_ROOT points the server at a built site (scripts/buildSite.py) and runs
// only the "built" pass over it, on a port of its own so it never reuses a server
// running the repo.
const SITE_ROOT = process.env.TEST_SITE_ROOT;
const PORT = Number(process.env.TEST_PORT) || (SITE_ROOT ? 8732 : 8731);

// Tests tagged @smoke run in every browser; WebKit, the engine of every browser
// on an iPhone, also runs the ones tagged @webkit.
const browser = (name, grep) => ({
    name,
    testDir: "tests/browser",
    dependencies: ["node"],
    grep,
    use: { browserName: name, viewport: { width: 1920, height: 1080 } }
});

module.exports = defineConfig({
    fullyParallel: true,
    forbidOnly: CI,
    // A test that only passes on its retry is reported as flaky, not as a pass.
    retries: CI ? 1 : 0,
    workers: CI ? 4 : undefined,
    timeout: 60_000,
    reporter: CI
        ? [["github"], ["list"], ["html", { open: "never" }]]
        : [["list"], ["html", { open: "never" }]],
    use: {
        baseURL: `http://localhost:${PORT}/`,
        // The offline group turns the worker on for itself; anywhere else it would
        // answer requests from its stored copy and hide what the server sends.
        serviceWorkers: "block",
        trace: "retain-on-failure"
    },
    webServer: {
        command: `node tests/server.js ${PORT}`,
        url: `http://localhost:${PORT}/index.html`,
        reuseExistingServer: !CI,
        stdout: "ignore",
        stderr: "ignore"
    },
    projects: SITE_ROOT
        ? [Object.assign(browser("chromium", /@smoke|@built/), { name: "built", dependencies: [] })]
        : [
            { name: "node", testDir: "tests/node" },
            browser("chromium"),
            browser("firefox", /@smoke/),
            browser("webkit", /@smoke|@webkit/)
        ]
});
