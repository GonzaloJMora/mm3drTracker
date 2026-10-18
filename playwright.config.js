// The test suite, in two halves (TESTING.md, *Two suites*). The factory suite tests
// the tracker itself on the made-up world in tests/environment, so it runs the same
// for any game or none. The game suite tests what is true of this game's data/ and of
// the site that ships. Each half runs its node checks first, then the tracker in
// Chromium, then a shorter pass in Firefox and WebKit.
const { defineConfig } = require("@playwright/test");

const CI = Boolean(process.env.CI);
// TEST_SITE_ROOT points the servers at a built site (scripts/release/buildSite.py) and
// runs only the "built" passes over it, on ports of their own so they never reuse a
// server running the repo.
const SITE_ROOT = process.env.TEST_SITE_ROOT;
const BASE_PORT = Number(process.env.TEST_PORT) || (SITE_ROOT ? 8732 : 8731);
// The factory suite's server answers data/ and images/ from tests/environment; the
// game suite's serves the site as it is.
const ENVIRONMENT_PORT = BASE_PORT;
const GAME_PORT = BASE_PORT + 100;

// The whole environment is passed on, so TEST_SITE_ROOT reaches both servers, and
// TEST_ENVIRONMENT is set or cleared per server whatever the shell running the tests has.
function serverEnv(environment) {
    const env = Object.assign({}, process.env);
    if (environment) env.TEST_ENVIRONMENT = "1";
    else delete env.TEST_ENVIRONMENT;
    return env;
}

const server = (port, environment) => ({
    command: `node tests/server.js ${port}`,
    url: `http://localhost:${port}/index.html`,
    env: serverEnv(environment),
    reuseExistingServer: !CI,
    stdout: "ignore",
    stderr: "ignore"
});

// Tests tagged @smoke run in every browser; WebKit, the engine of every browser on an
// iPhone, also runs the ones tagged @webkit.
const browser = (name, browserName, { testDir, port, grep, dependencies }) => ({
    name,
    testDir,
    dependencies,
    grep,
    use: { browserName, baseURL: `http://localhost:${port}/`, viewport: { width: 1920, height: 1080 } }
});

const factory = { testDir: "tests/browser", port: ENVIRONMENT_PORT, dependencies: ["node"] };
const game = { testDir: "tests/game/browser", port: GAME_PORT, dependencies: ["game-node"] };

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
        // The offline group turns the worker on for itself; anywhere else it would
        // answer requests from its stored copy and hide what the server sends.
        serviceWorkers: "block",
        trace: "retain-on-failure"
    },
    webServer: [server(ENVIRONMENT_PORT, true), server(GAME_PORT, false)],
    projects: SITE_ROOT
        ? [
            browser("built", "chromium", Object.assign({}, factory, { grep: /@smoke|@built/, dependencies: [] })),
            browser("built-game", "chromium", Object.assign({}, game, { grep: /@smoke|@built/, dependencies: [] }))
        ]
        : [
            { name: "node", testDir: "tests/node" },
            browser("chromium", "chromium", factory),
            browser("firefox", "firefox", Object.assign({}, factory, { grep: /@smoke/ })),
            browser("webkit", "webkit", Object.assign({}, factory, { grep: /@smoke|@webkit/ })),
            { name: "game-node", testDir: "tests/game/node" },
            browser("game-chromium", "chromium", game),
            browser("game-firefox", "firefox", Object.assign({}, game, { grep: /@smoke/ })),
            browser("game-webkit", "webkit", Object.assign({}, game, { grep: /@smoke|@webkit/ }))
        ]
});
