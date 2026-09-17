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

Built and tested in Brave. Anything else reasonably current should be fine —
roughly Chrome/Edge 105+, Safari 16+ or Firefox 110+, the limiting factor being
CSS container queries.

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

Then open <http://localhost:8000>. Any static file server will do — there is no
build step, no bundler, no package manager and no dependencies.

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
| `config.json` | which items appear in which grid, upgrade chains, counters, the map |
| `Items.json` | every item's display name and icon |
| `<Region>.json` | one per region: its checks, each check's requirement, and where its marker sits on the map |
| `manifest.json` | the region list, in display order |
| `settings.json` | the randomizer's settings in its menu order: what each can be set to, what it starts you with, and what it locks |
| `version.json` | the app version, written by the release script |

So adding a region, correcting a requirement or reordering the list is a JSON
edit — nothing in `js/` needs touching. Data that does not make sense is reported
in the browser console as the page loads, naming the file and the entry, rather
than failing quietly.

### Workflow

Nothing is pushed straight to `main`. Every change lands through a pull request:

1. Branch off the latest `main`.
2. Log what the branch changes as you go, with the branch changes script:
   - **Windows:** double-click `scripts/logBranchChanges.bat`, or run `python scripts/logBranchChanges.py`
   - **macOS / Linux:** `python3 scripts/logBranchChanges.py`
3. Rebase onto the latest `main` before opening the pull request, and again if
   `main` moves while it is open.
4. Open a pull request into `main`.

The script needs Python 3 and git. It asks for the changes one per line, finished
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

### Versioning

Releases are numbered `x.y.z`:

| Part | Bumped when |
|---|---|
| `x` — major | Saves from an earlier major version no longer load |
| `y` — minor | Bigger than a hotfix, and existing saves still load |
| `z` — hotfix | Bug fixes only |

Saving arrives with 1.0, so the 0.x releases have no saves to break.
`scripts/release.py` shows these same three rules when it asks for the release
type, so a change to one of them is made in both places.

The number lives in one place, `data/version.json`. The page shows it in the
footer and adds it to the load-error report, and
[`documentation/changelog.md`](documentation/changelog.md) records what each
version changed. Neither file is edited by hand for a release — the release
script writes both.

### Releasing

A release is a pull request of its own, made once everything going into it has
merged:

1. Branch off the latest `main`.
2. Run the release script:
   - **Windows:** double-click `scripts/release.bat`, or run `python scripts/release.py`
   - **macOS / Linux:** `python3 scripts/release.py`
3. Review the result with `git diff`, commit it, and open a pull request.

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

Merge the release pull request before anything else lands. A pull request that
merges in between ships in the tagged commit, but its logged changes wait for the
next release's entry.

Once it merges, the [release workflow](.github/workflows/release.yml) sees a
version with no tag yet, tags that commit `vx.y.z`, and publishes a GitHub release
with the changelog entry as its notes. If the changelog has no entry for the
version, the workflow fails and nothing is tagged.

Leave the `## Version: vx.y.z` lines in the changelog exactly as the script writes
them: they are how the workflow finds an entry.

### Contributing

A one-person project for now. I'll open it up to contributions after 1.0.

## License

[MIT](LICENSE)
