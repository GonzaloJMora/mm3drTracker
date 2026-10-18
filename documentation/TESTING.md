# Testing

The tests run on every pull request into `develop`, and a pull request can't merge
while they fail. Run them yourself before opening one:

- **Windows:** double-click `scripts/dev/runTests.bat`, or run `python scripts/dev/runTests.py`
- **macOS / Linux:** `python3 scripts/dev/runTests.py`

You need [Node.js](https://nodejs.org/) 24 or later and Python 3. The script installs
everything else into this folder the first time: the test packages, pinned in
`package-lock.json` so you get the versions CI does, and the browsers they drive. A
full run takes a minute or two.

To run one group, name it: `python scripts/dev/runTests.py saving`. To watch the
browsers, add `--headed`. Anything after the script's name goes to
[`playwright test`](https://playwright.dev/docs/test-cli) unchanged. The app itself
never gets a dependency or a build step; the `package.json` is for the tests only.

## Two suites

The tests come in two halves, so the tracker's own behavior is tested the same way
whatever game it is built for, and each game only adds tests of its own.

- **The factory suite** tests the tracker itself. It runs on the made-up world in
  `tests/environment` (its README lists every region, check and setting, with the
  answers worked out by hand) and never reads the game's `data/` or `images/`, so it
  runs the same for any game, or none.
- **The game suite** tests what is true of one game's `data/` and of the site that
  ships: that the game's data keeps every data rule and draws clean, its released saves
  still load, its layout holds at every window size, and the built site is complete.
  For Majora's Mask it lives in `tests/game/`.

| | Factory suite | Game suite |
|---|---|---|
| Node checks | `tests/node/` | `tests/game/node/` |
| Browser tests | `tests/browser/` | `tests/game/browser/` |
| Its world | `tests/environment/` | `data/`, with facts and saves in `tests/game/fixtures/` |
| Playwright projects | `node`, `chromium`, `firefox`, `webkit` | `game-node`, `game-chromium`, `game-firefox`, `game-webkit` |

`tests/server.js` serves both: with `TEST_ENVIRONMENT` set, it answers `data/` and
`images/` from `tests/environment`, and `playwright.config.js` starts one server of
each kind. To look at the test world yourself, run
`TEST_ENVIRONMENT=1 node tests/server.js 8790` and open `http://localhost:8790/`.

Each suite runs its node checks first, which need no browser, then its browser tests.
The full set runs in Chromium; Firefox and WebKit (Safari's engine, and every browser
on an iPhone) run a shorter pass, the tests tagged `@smoke`, and WebKit those tagged
`@webkit` too. WebKit is the closest thing to an iPhone without one, not the same:
Safari-only behavior still needs a real phone.

## The groups

One file per part of the tracker, so a failure points at what broke.

The factory suite:

| Group | Covers |
|---|---|
| `tests/node/` | The engine on the test world: every check, token, helper, flag and non-randomized rule against the answers in its README (`engine.test.js`). The test world itself (it keeps every data rule, its generated files are up to date, every picture it needs is its own), every data rule catching a made-up mistake, the save codec, the logic grammar, what the requirements tooltip lists (`requirementsView.test.js`), and every doc pointer in the code naming a real heading |
| `loading` | Both pages load clean, every region and check is drawn, and a missing or broken file fails the way it should |
| `settings` | Every kind of setting control, locks, the Starting Items slots, Reset to Defaults and Launch New Tracker |
| `items` | Clicking and right-clicking slots, starting items as a floor, and a stress run of everything owned and every check ticked |
| `logic` | Every check drawn the color the engine gives it and every count matching, the desktop progress numbers agreeing with the progress line, and the settings that change logic |
| `locations` | The region list's order, counts and colors, ticking checks off, linked checks, and the two view toggles |
| `map` | Markers and the region overlay |
| `tooltips` | The requirements and item tooltips, on hover and pinned on a phone |
| `header` | The phone layout's header bar and menu |
| `saving` | Autosave, Export, Load From File, the previous run, two tabs, and refused saves |
| `offline` | The offline copy, its background refresh, its clean-up of entries stored with a query, and its off switch |
| `feedback` | The Report a bug and Suggest a feature links, filled in under field ids the forms really have |

The game suite:

| Group | Covers |
|---|---|
| `tests/game/node/` | The game's data keeps every data rule, its generated data files are up to date, every released save format still decodes, what each check's tooltip lists means exactly its requirement, and the site build |
| `gameData` | Both pages load the game's data clean and draw every region and check, and every released save format loads through the page |
| `layout` | Both pages measured at every window size from a small phone to a wide monitor, and at the largest text size, with the game's real number of regions and the length of its names: both halves of the phone switch, and on desktop the map, the overlay and the summary row shown in the header |

CI then builds the site that would be published (WORKFLOW.md, *Releasing*) and runs the
smoke tests and those tagged `@built` over that copy, in two passes: `built` for the
factory suite, with the test world's data, and `built-game` for the game suite. To do
the same locally, run `scripts/release/buildSite.py`, then the tests with
`TEST_SITE_ROOT=_site` set.

When a test fails, the output names the file and the step, and
`npx playwright show-report` opens a report with a trace of each failure to step
through. `npx playwright test --ui` opens the same traces while the tests run.

## How the tests are written

- **A test fails when the behavior it names breaks**, and passes otherwise. Its
  expected answers are worked out by hand, never by asking the tracker.
- **Each rule is covered once, at its edge**: zero against one, met against unmet,
  each side of each operator. Checking either side of a line covers everything past
  it, so a test gets its breadth from choosing the edges, not from piling up
  combinations.
- **A gap is worth closing only when it is a plausible mistake that gets past the
  whole suite.** A broken behavior another test already catches, or one that changes
  nothing a player sees, doesn't need a test of its own.
- **Every browser test fails on a console warning, an error or an uncaught
  exception.** Specs import `test` and `expect` from their suite's `fixtures.js`, which
  builds on `tests/browser/fixtures.js` and watches for them; a test that expects one
  adds a pattern to `allowConsole`.
- **A test reads its world through `readWorld`**, never from `data/` directly, so the
  same spec reads the test world in the factory suite and the game's data in the game
  suite.
- **The engine is tested against answers worked out by hand.** `tests/node/engine.test.js`
  holds what `DataModel.tokenValue()` and `DataModel.resolver()` decide, for every check
  of the test world, to the tables in its README, which nobody worked out by asking the
  tracker. The browser `logic` tests then hold the page to the engine: that it draws
  what the engine decides. The logic grammar is tested on made-up strings.
- **No test says what a game's check should need.** Whether Majora's Mask's logic
  matches the randomizer is a review, not a test.
- **A fact about the game no test can work out from its data** goes in the game's
  fixtures, `tests/game/fixtures/`, never in a factory test.
- **The pages are served by `tests/server.js`**, not `python -m http.server`, which
  refuses connections under the tests' parallel page loads.
- Playwright's headless browsers do paint, so `requestAnimationFrame` and
  `ResizeObserver` fire in the tests.
- **The test world's generated files** are written by the same scripts as the game's:
  `scripts/data/updateSaveLayout.py --data tests/environment/data` and
  `scripts/data/updateOfflineFiles.py --site tests/environment`. A test fails when
  either is out of date.

`tests/game/fixtures/saves/` holds one save from every released format, with what each
must load as. Never edit them: they are what proves old saves still load (SAVING.md,
*Save fixtures*).
