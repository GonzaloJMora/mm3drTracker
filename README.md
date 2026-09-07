# MM3D Randomizer Tracker

Item and location tracker for the [Majora's Mask 3D Randomizer](https://github.com/z3DR/mm3dr).

**[Open the tracker →](https://gonzalojmora.github.io/mm3drTracker/)**

Nothing to install and nothing to sign into. It runs in the browser, on a desktop
or on a phone: mark off what you have picked up, and it works out where that lets
you go.

## What it does

**Item tracker.** Four grids covering items, masks, dungeon items and quest gear.
Left-click a slot to advance it, right-click to step back. Upgrades walk their
chain (Kokiri → Razor → Gilded Sword), counters count — skulltula tokens, stray
fairies, heart pieces — and the Bomber's Code gets its own five digits.

**Location tracker.** Every check carries a requirement, so the tracker knows
what your current inventory can actually reach. Checks are colored as reachable,
out of reach, or already collected, and each region rolls its checks up into a
single status.

**On desktop** the location view is the map of Termina, with a marker for each
region colored by that region's status. Click a marker and its checks open over
the map.

**On mobile** the two trackers become tabs, and the regions become an accordion
list.

Either way, a Location Progress box keeps a running count of what is checked,
what is reachable and what is left.

## Running it locally

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

## Data

Everything the tracker knows lives in `data/` as JSON. None of it is written into
the JavaScript:

| File | Holds |
|---|---|
| `config.json` | which items appear in which grid, upgrade chains, counters, the map |
| `Items.json` | every item's display name and icon |
| `<Region>.json` | one per region: its checks, each check's requirement, and where its marker sits on the map |
| `manifest.json` | the region list, in display order |

So adding a region, correcting a requirement or reordering the list is a JSON
edit — nothing in `js/` needs touching. Data that does not make sense is reported
in the browser console as the page loads, naming the file and the entry, rather
than failing quietly.

[`documentation/ARCHITECTURE.md`](documentation/ARCHITECTURE.md) covers how the
pieces fit together.

## Browser support

Built and tested in Brave. Anything else reasonably current should be fine —
roughly Chrome/Edge 105+, Safari 16+ or Firefox 110+, the limiting factor being
CSS container queries.

## Reporting a bug

[Open an issue](https://github.com/GonzaloJMora/mm3drTracker/issues/new).

What helps most:

- Your browser, and roughly how wide the window was — a lot of the layout keys
  off width, so "about 1600 across" narrows it down quickly
- What you were doing, and what you expected to happen instead
- If a message appeared on the page, paste it in. Those boxes are selectable on
  purpose, even though the rest of the page isn't
- Anything the browser console printed. The tracker reports data problems there
  at load, naming the file and the entry at fault

## Contributing

A one-person project for now. I'll open it up to contributions after 1.0.

## License

[MIT](LICENSE)
