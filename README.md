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
unrandomized. Back to Settings on the tracker takes you back to them.

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

Either way, a running count of what is reachable, what is checked and what is
left sits at the top of the page.

**Your run is saved as you go**, in the browser, and comes back when you reopen the
tracker. Export it to a file or a short code to move it to another device, and once
it has been opened online, the tracker works with no connection.

## Browser support

Built in Brave, and tested in Chromium, Firefox and WebKit (the engines behind
Chrome and Edge, Firefox, and Safari) and in Safari on iPhone. Anything else
reasonably current should be fine — roughly Chrome/Edge 105+, Safari 16+ or
Firefox 110+, the limiting factor being CSS container queries.

## How it was built

The code was largely written with an AI coding assistant (Claude Code), under my
direction: I made the design decisions, approved each change before it went in, and
tested it by hand, on desktop, on a phone, and in-game where the logic depended on
it.

## Reporting a bug or suggesting a feature

Use the **Report a bug** or **Suggest a feature** link at the bottom of the
page. Each opens a GitHub form with what the page knows already filled in: the
version, your browser and window size, your save code and anything the page
reported going wrong. All that's left is to say what happened. You can change or
delete anything filled in before you submit.

The same forms are on GitHub under
[New issue](https://github.com/GonzaloJMora/mm3drTracker/issues/new/choose), with
the boxes empty. If a message appeared on the page, paste it in: those boxes are
selectable on purpose, even though the rest of the page isn't.

## Development

It has to be served over HTTP: the tracker fetches its data out of `data/`, and
browsers block that on `file://`. There is no build step and no dependency:

```bash
git clone https://github.com/GonzaloJMora/mm3drTracker.git
cd mm3drTracker
python -m http.server 8000
```

Then open <http://localhost:8000>. To try it on a phone, run
`scripts/dev/serveOnNetwork.py` (or double-click its `.bat`) and open the address it
prints, on the same Wi-Fi.

Run the tests with `scripts/dev/runTests.py` (or its `.bat`) before opening a pull
request; you need Node.js 24 or later and Python 3.

- [How the tracker works](documentation/README.md): the architecture, the data, and one
  doc per part of the tracker
- [Testing](documentation/TESTING.md) and [the workflow](documentation/WORKFLOW.md):
  branches, versions and releases
- [The scripts](scripts/README.md): what each one does and when you'd run it

### Contributing

Contributions are welcome. For anything bigger than a small fix, open an issue
first (a bug report or a feature suggestion) so we can agree on the approach before
you put the work in.

1. Fork the repo and branch off `develop`, named `feature/<what_it_adds>` or
   `bugfix/<what_it_fixes>`.
2. Read [how the tracker works](documentation/README.md) for the part you're
   changing. Game data goes in `data/`, never in the JavaScript.
3. Log what a player would notice with `scripts/release/logBranchChanges.py`, and
   commit the file it writes with your work.
4. Run the tests (`scripts/dev/runTests.py`) and open a pull request into `develop`.
   The tests run on it once a maintainer approves the run, and it merges once they
   pass and it has been reviewed.

[The workflow](documentation/WORKFLOW.md) has the details. Releases are cut by the
maintainer.

## License

[MIT](LICENSE)
