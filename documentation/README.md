# How the tracker works

A browser-based item and location tracker for randomizer runs. Which game it tracks
is its `data/`; the code knows nothing about any one game. It is plain JavaScript
with no build step, no framework and no dependencies, served over HTTP (README.md, *Development*).

Start with **ARCHITECTURE.md**: it says how the pieces fit, and every other doc
assumes it. After that, each doc stands alone, so read the one for the part you are
changing.

| Doc | Covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | The design rules, the two pages, every script and what it owns, the events the scripts talk through, and the order a page loads in |
| [DATA.md](DATA.md) | Every file in `data/`, what isn't data, and what the tracker does when the data is wrong |
| [LOGIC_AND_REGIONS.md](LOGIC_AND_REGIONS.md) | Region files and sub-regions, location flags, logic helpers, and the logic strings that decide what is reachable |
| [ITEM_GRIDS.md](ITEM_GRIDS.md) | The item grids: slots, upgrade chains, counters and digits, and starting items as a floor |
| [SETTINGS.md](SETTINGS.md) | `settings.json` (grants, locks and clauses) and the settings page |
| [SAVING.md](SAVING.md) | The save code and its layout, the autosave, loading, export, and the formats old saves are read with |
| [OFFLINE.md](OFFLINE.md) | The offline copy, how it stays current, and its off switch |
| [LAYOUT.md](LAYOUT.md) | Desktop and phone layouts, the status colors and shapes, hiding checks, map markers, sizing the map, fitting a region into the map overlay, and the phone's header bar |
| [TOOLTIPS.md](TOOLTIPS.md) | The tooltip, the pinned panel on a phone, and the requirements list |
| [TESTING.md](TESTING.md) | Running the tests, what each group covers, and how they are written |
| [WORKFLOW.md](WORKFLOW.md) | Branches and logging changes, version numbers, and cutting a release |
| [MAJORAS_MASK_DATA.md](MAJORAS_MASK_DATA.md) | Choices in this repo's data that only make sense for Majora's Mask 3D and its randomizer |
| [changelog.md](changelog.md) | Every release, newest first |

The scripts are in `scripts/README.md`.
