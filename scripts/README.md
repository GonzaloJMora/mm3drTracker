# Scripts

Every script is a Python file with a `.bat` beside it. On Windows, double-click the
`.bat`: it runs the script from the repo root and keeps the window open so you can
read the result. Elsewhere, run the `.py` with `python3` from the repo root. Each
script's first lines say the same in more detail, with every option it takes.

They need Python 3. `runTests` also needs Node.js 24 or later.

## `dev/`: working on the tracker

| Script | What it does | When you run it |
|---|---|---|
| `runTests` | Installs what the tests need the first time (the pinned test packages and the browsers they drive, into this folder only), then runs the suite. Name a group to run only that one (`runTests.py saving`); anything else goes to `playwright test`. | Before opening a pull request. CI runs the same suite on every one. [TESTING.md](../documentation/TESTING.md). |
| `serveOnNetwork` | Serves the repo to the other devices on your Wi-Fi with caching off, and prints the address to open. | To try a change on a phone. On your own computer, `python -m http.server` is enough. The repo's [README.md](../README.md), *Development*. |

## `data/`: files that are written by a script, never by hand

| Script | What it does | When you run it |
|---|---|---|
| `updateOfflineFiles` | Writes `data/offline.json`, the list of every file the offline copy stores. | After adding, removing or renaming any file under `css/`, `js/`, `data/` or `images/`, or a page. A test fails, saying so, when the list is out of date. |
| `updateSaveLayout` | Appends anything new (a setting, item slot, check or view toggle) to `data/saveLayout.json`, the map of which bits of a save code hold what. Stops without writing when a field has outgrown its width, and names ids that are gone. `--new-format` is for what appending can't do. | After adding a setting, slot, check or toggle, or when the tracker warns that something is missing from the layout. A test fails when it is out of date. [SAVING.md](../documentation/SAVING.md), *The layout*. |

Both take `--check`, which only reports, and is what the tests run.

## `release/`: logging changes and cutting a release

| Script | What it does | When you run it |
|---|---|---|
| `logBranchChanges` | Asks what your branch changes and adds it to `documentation/unreleased/<branch>.md`, for the next release's changelog. | On your feature branch, whenever there is something a player would notice. [WORKFLOW.md](../documentation/WORKFLOW.md), *Branches*. |
| `release` | Gathers every branch's logged changes into a new changelog entry, asks what kind of release it is, and bumps `data/version.json`. Commits nothing. | On a `release/` branch, to cut a release. [WORKFLOW.md](../documentation/WORKFLOW.md), *Releasing*. The release workflow also calls it, to read the version and the release notes. |
| `buildSite` | Builds the copy of the site that gets published into `_site/`: only the files the pages use, with every script and stylesheet address stamped with the version. | Never for a release: CI and the deploy run it. Run it yourself only to try the published copy locally, then serve `_site/` or run the tests with `TEST_SITE_ROOT=_site`. [TESTING.md](../documentation/TESTING.md). |
