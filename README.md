# MM3D Randomizer Tracker

Item and location tracker for the [Majora's Mask 3D Randomizer](https://github.com/z3DR/mm3dr).

**[Open the tracker →](https://gonzalojmora.github.io/mm3drTracker/)**

Nothing to install and nothing to sign into. It runs in the browser, on a desktop
or on a phone: mark off what you have picked up, and it works out where that lets
you go.

## What it does

**Settings first.** Pick the settings your seed was generated with, click your
starting items into the same grids the tracker uses, then launch a tracker. It
starts you with those items and marks the checks your settings leave
unrandomized. Launch New Tracker on the tracker takes you back to change them.

**Item tracker.** Four grids covering items, masks, dungeon items and quest gear.
Left-click a slot to advance it, right-click to step back. Upgrades walk their
chain (Kokiri → Razor → Gilded Sword), counters count — skulltula tokens, stray
fairies, heart pieces — and the Bomber's Code gets its own five digits.

**Location tracker.** Every check carries a requirement, so the tracker knows
what your current inventory can actually reach. Checks are marked as reachable,
out of reach, not randomized, or already collected, each with its own color and
shape, and each region rolls its checks up into a single status, including
partly reachable when it has some of both.

**On desktop** the location view is the map of Termina, with a marker for each
region colored by that region's status. Click a marker and its checks open over
the map.

**On mobile** the two trackers become tabs, and the regions become an accordion
list. Show Only Accessible Checks cuts that list down to what you can go and do
right now.

Either way, a Location Progress box keeps a running count of what is checked,
what is reachable and what is left.

## Browser support

Built in Brave, and tested in Chromium, Firefox and WebKit (the engines behind
Chrome and Edge, Firefox, and Safari) and in Safari on iPhone. Anything else
reasonably current should be fine — roughly Chrome/Edge 105+, Safari 16+ or
Firefox 110+, the limiting factor being CSS container queries.

## Reporting a bug

[Open an issue](https://github.com/GonzaloJMora/mm3drTracker/issues/new).

What helps most:

- The version number from the bottom-left corner of the page
- Your browser, and roughly how wide the window was — a lot of the layout keys
  off width, so "about 1600 across" narrows it down quickly
- What you were doing, and what you expected to happen instead
- If a message appeared on the page, paste it in. Those boxes are selectable on
  purpose, even though the rest of the page isn't
- Anything the browser console printed. The tracker reports data problems there
  at load, naming the file and the entry at fault

## Development

[`documentation/ARCHITECTURE.md`](documentation/ARCHITECTURE.md) covers how the
pieces fit together.

### Running it locally

It has to be served over HTTP. The tracker fetches its data out of `data/`, and
browsers block that on `file://`, so opening `index.html` straight from disk gets
you a load error rather than a tracker.

```bash
git clone https://github.com/GonzaloJMora/mm3drTracker.git
cd mm3drTracker
python -m http.server 8000
```

Then open <http://localhost:8000>. Any static file server will do — the tracker
has no build step, no bundler and no dependencies. (The tests have a few of their
own; see [Testing](#testing).)

To try it on an external device like a phone, serve it to your network instead and open the address the
script prints, on the same Wi-Fi:

- **Windows:** double-click `scripts/serveOnNetwork.bat`, or run `python scripts/serveOnNetwork.py`
- **macOS / Linux:** `python3 scripts/serveOnNetwork.py`

It takes a port as an argument (8000 by default), tells the browser not to cache
anything so an edit shows up on the next reload, and keeps dot-named files and
folders such as `.git` off the network.

### Data

Everything the tracker knows lives in `data/` as JSON. None of it is written into
the JavaScript:

| File | Holds |
|---|---|
| `config.json`, `config/*.json` | which items appear in which grid, upgrade chains, counters, the values logic counts (hearts, masks), the legend, linked checks, the map |
| `Items.json` | every item's display name and icon |
| `<Region>.json` | one per region: its checks, each check's requirement, and where its marker sits on the map |
| `manifest.json` | the region list, in display order |
| `settings.json` | the randomizer's settings in its menu order: what each can be set to, what it starts you with, and what it locks |
| `locationFlags.json` | progress made somewhere else that a check depends on, named once and used in the logic like an item |
| `logicHelpers.json` | lists of items written once and used by name in the logic |
| `version.json` | the app version, written by the release script |

So adding a region, correcting a requirement or reordering the list is a JSON
edit — nothing in `js/` needs touching. Data that does not make sense is reported
in the browser console as the page loads, naming the file and the entry, rather
than failing quietly.

### Testing

The tests run on every pull request into `develop`, and a pull request can't
merge while they fail. Run them yourself before opening one:

- **Windows:** double-click `scripts/runTests.bat`, or run `python scripts/runTests.py`
- **macOS / Linux:** `python3 scripts/runTests.py`

You need [Node.js](https://nodejs.org/) 24 or later and Python 3. The script
installs everything else into this folder the first time: the test packages
(pinned in `package-lock.json`, so you get the same versions CI does) and the
browsers they drive. A full run takes a minute or two.

To run one group, name it: `python scripts/runTests.py saving`. To watch the
browsers, add `--headed`. Anything after the script's name goes to
[`playwright test`](https://playwright.dev/docs/test-cli) unchanged.

The tests are grouped by what they cover, one file each, so a failure points at
the part that broke:

| Group | Covers |
|---|---|
| `tests/node/` | No browser, so first and fastest: saves (every released format still loads), the logic grammar, and `saveLayout.json` and `offline.json` being up to date |
| `loading` | Both pages load clean, every region and check in the data is drawn, and a missing file fails the way it should |
| `settings` | Every kind of setting control, locks, the Starting Items slots, Reset to Defaults and Launch New Tracker |
| `items` | Clicking and right-clicking slots, starting items as a floor, and a stress run of everything owned and every check ticked |
| `logic` | Every check's color and every count against the data's own logic, settings that change logic, and implied layers |
| `locations` | Ticking checks off, linked checks, and the two view toggles |
| `map` | Markers and the region overlay |
| `tooltips` | The requirements and item tooltips, on hover and pinned on a phone |
| `header` | The phone layout's header bar and menu |
| `saving` | Autosave, Export, Load From File, the previous run, two tabs, and refused saves |
| `offline` | The offline copy, and its off switch |
| `layout` | Both pages measured at every window size from a small phone to a wide monitor, and at the largest text size |

Every browser test also fails if the page prints a warning or an error. The full
set runs in Chromium; Firefox and WebKit (Safari's engine, and every browser on an
iPhone) run a shorter pass. CI then builds the site that would be published (see
[Releasing](#releasing)) and runs the shorter pass over that too. To do the same
locally, run `scripts/buildSite.py`, then the tests with `TEST_SITE_ROOT=_site`
set.

When a test fails, the output names the file and the step, and
`npx playwright show-report` opens a report with a trace of each failure you can
step through.

The tests never say what a check should need. They hold the page to what the
data's own logic says, so changing a check's logic won't break them. The few
facts about the game they can't work out from the data live in
`tests/fixtures/majorasMask.json`. One of those is the list of **implied
layers** kept on purpose: a requirement on a room that, for some check inside it,
the check's own requirement already covers, so it can never change anything for
that check. That usually means the check sits in the wrong room, so a new one
fails the `logic` group. If it's deliberate, add the line the failure prints to
that file.

`tests/fixtures/saves/` holds one save from every released save format, with what
each must load as. Never edit them: they are what proves old saves still load.

### Workflow

Work happens on `develop`; `main` only changes at a release, and the live site is
published from it. Nothing is pushed straight to either: every change lands
through a pull request.

1. Branch off the latest `develop`, named `feature/<what_it_adds>` or
   `bugfix/<what_it_fixes>`, in snake_case.
2. Log what the branch changes as you go, with the branch changes script:
   - **Windows:** double-click `scripts/logBranchChanges.bat`, or run `python scripts/logBranchChanges.py`
   - **macOS / Linux:** `python3 scripts/logBranchChanges.py`
3. Open a pull request into `develop`. The [tests](#testing) run on it, and it can
   only merge once they pass on the latest `develop`: if `develop` moves while it is
   open, use **Update branch** and let them run again.
4. Merge with **Squash and merge**, so the branch lands on `develop` as one commit.

The script needs Python 3 and git, and refuses to run on `main`, `develop` or a
`release/` branch: changes are logged on the branch that makes them. It asks for
the changes one per line, finished
with an empty line, then whether to add notes, and writes them to
`documentation/unreleased/<branch>.md`. Run it again whenever there is more to
log: it shows what the file already holds and adds to it. Commit the file with
the work it describes. It is plain markdown, so correcting a line is an ordinary
edit, and a long bullet can wrap onto indented lines, which the release joins back
into one.

Each branch gets a file of its own so that two pull requests open at the same time
never edit the same one. The next release gathers them all into the changelog.
The file records the branch that started it, and the script won't add to a file
another branch started: two branch names can make the same file name, like
`feature/foo` and `feature-foo`.

File names are case-sensitive on the live site, though not on Windows or macOS:
`bow.png` and `Bow.png` are the same file on your machine and different ones once
deployed. To change only the case of a file's name, rename it with
`git mv old-name New-Name`; a rename in the file browser isn't seen by git. The
tests run on Linux in CI, so a reference with the wrong case fails there.

### Versioning

Releases are numbered `x.y.z`:

| Part | Bumped when |
|---|---|
| `x` — major | Saves from earlier versions can no longer be brought up to date |
| `y` — minor | A new feature is added, and earlier saves still load |
| `z` — hotfix | Bug fixes only: nothing new, and earlier saves still load |

A release takes the highest part that applies. A new feature alongside some bug
fixes is minor, and a change that leaves old saves behind is major whatever else
is in it. Until saving arrives, no release has saves to break.
`scripts/release.py` shows these same three rules when it asks for the release
type, so a change to one of them is made in both places.

The number lives in one place, `data/version.json`. The page shows it in the
footer and adds it to the load-error report, and
[`documentation/changelog.md`](documentation/changelog.md) records what each
version changed. Neither file is edited by hand for a release — the release
script writes both.

### Releasing

A release takes two pull requests, made once everything going into it has merged
into `develop`:

1. Branch off the latest `develop`, named `release/vX.Y.Z` after the version it
   will be.
2. Run the release script:
   - **Windows:** double-click `scripts/release.bat`, or run `python scripts/release.py`
   - **macOS / Linux:** `python3 scripts/release.py`
3. Review the result with `git diff`, commit it, open a pull request into
   `develop`, and squash and merge it once the tests pass.
4. Open a pull request from `develop` into `main`, and merge it with **Create a
   merge commit**. Never squash or rebase this one: either gives `main` new copies
   of `develop`'s commits, and the two branches drift apart for good.

The script needs Python 3 and nothing else. It lists the files waiting in
`documentation/unreleased/` and asks whether this is a major, minor or hotfix
release, each option showing its rule and the version it would produce. It then
shows the finished entry and asks before writing anything. On yes it adds the
entry, dated today, to the top of the changelog, deletes the files it read, and
sets the new version in `data/version.json`. It never commits, tags or pushes. If
no changes are logged, it stops and says so.

Before asking anything, it checks that the logged files can be deleted, so a
read-only one, or one open in another program, stops it before anything is written.
If a release does stop partway — the changelog entry written but the version not
bumped — the next run says so and offers to finish that release instead of
starting another.

Merge nothing else into `develop` between the two. A pull request that merges in
between ships in the release, but its logged changes wait for the next release's
entry.

When the merge into `main` lands, two workflows run. The
[release workflow](.github/workflows/release.yml) sees a version with no tag yet,
tags that commit `vx.y.z`, and publishes a GitHub release with the changelog entry
as its notes; if the changelog has no entry for the version, it fails and nothing
is tagged. The [deploy workflow](.github/workflows/deploy.yml) runs the full test
suite again, then publishes the site.

What gets published is a built copy, not the repo: `scripts/buildSite.py`
(`buildSite.bat`) copies only the files the pages use (the list in
`data/offline.json`, plus the offline worker) into `_site/`, and stamps every
script and stylesheet address with the version (`js/foo.js?v=1.2.3`). A new
release then gives every script a new address, so a browser can't pair a script it
still holds from the last version with the new data. Build it locally to see
exactly what goes out; the tests check the build on every pull request.

Leave the `## Version: vx.y.z` lines in the changelog exactly as the script writes
them: they are how the workflow finds an entry.

### Contributing

A one-person project for now. I'll open it up to contributions after 1.0.

## License

[MIT](LICENSE)
