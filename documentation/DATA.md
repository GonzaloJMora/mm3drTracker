# Data

Everything the tracker knows about a game is in `data/`, as JSON. This doc lists
every file, says what isn't data, and covers what the tracker does when the data is
wrong. How the region files and their logic are written is LOGIC_AND_REGIONS.md;
the settings file is SETTINGS.md.

## The files

**Only `dataLoader.js` fetches these.** Other files read them off
`window.TrackerData`, and wait for them through `TrackerData.onReady(fn)`.

| File | Holds | Read by |
|---|---|---|
| `manifest.json` | The region file names. **Its order is the region display order**; nothing re-sorts it. | `dataLoader.js` |
| `config.json` and `config/*.json` | `config.json` is only an index: a `files` list whose keys merge into one `TrackerData.config`. A key in two files warns, and the later one wins. The files are split by who reads them: `grids.json` (the grids, ITEM_GRIDS.md), `inventory.json` (`progressions`, `item_counts`, `item_groups`, `digit_slots`), `logicTokens.json` (the values logic counts that aren't items, LOGIC_AND_REGIONS.md), `legend.json`, `map.json` (the map image and its real size, and the overlay's text sizes, LAYOUT.md) and `checkGroups.json` (`check_groups`: checks that are one location shown in more than one region). | Everything that draws |
| `Items.json` | Every item: `{ id, name, image, notes_image? }`. `notes_image` is a song's button sequence, for its tooltip. Any other field set to `true` is a tag a token can count. | The grids, `GameState`, the requirements tooltip |
| `settings.json` | The randomizer's settings, in its menu order (SETTINGS.md). | `settingsModel.js` |
| `<Region>.json` | One per region: its name, entry logic, map position and checks (LOGIC_AND_REGIONS.md). | `locationTracker.js`, `locationMap.js` |
| `locationFlags.json` | Progress elsewhere that a check depends on, named once (LOGIC_AND_REGIONS.md, *Location flags*). Tracker only. | `locationTracker.js` |
| `logicHelpers.json` | Lists of items written once and used by name (LOGIC_AND_REGIONS.md, *Logic helpers*). Tracker only. | `locationTracker.js` |
| `saveLayout.json` | Which bits of a save code hold what (SAVING.md, *The layout*). Written by `scripts/data/updateSaveLayout.py`. If it can't be read, saving is off and nothing else is affected. Older formats' layouts sit in `saveLayouts/`, fetched only when a save needs one. | `saveManager.js`, `loadSave.js` |
| `offline.json` | Every file the offline copy stores, and the off switch (OFFLINE.md). Written by `scripts/data/updateOfflineFiles.py`. | `offline.js`, `offlineWorker.js` |
| `version.json` | The app version, written by `scripts/release/release.py`. Fetched apart from the rest, so a report that they failed to load still carries it. | The footer, the load-error report, the bug form |

## What isn't data

Nearly everything comes out of `data/`, which is what makes the tracker mostly
portable: pointing it at another game is largely a matter of replacing those files.
These parts are code:

- **The logic token kinds.** The tokens themselves are data, but each is one of four
  kinds `GameState` knows how to work out (`count`, `any`, `sum`, `distinct`). A
  logic string needing something none of them can say needs a new kind in
  `gameStateManager.js`.
- **The map shape.** `locationMap.js` assumes one image with markers placed on it by
  percentage.
- **The setting classes.** `toggle`, `dropdown` and `number` are defined in
  `settingsModel.js`, with their controls in `settingControls.js`.

Everything else, the grids, the items, the regions, the checks, the logic and the
map image, is JSON.

## When the data is wrong

Every mistake below would otherwise fail silently, or loudly in the wrong place. The
rule they share: **say what is wrong, once, at load, and keep the rest of the app
up.**

**Most are named rules.** Every check of the files themselves is in
`js/dataChecks.js`, under the id in the table's "Where" column. `dataLoader.js` runs
them once the data is read and prints each problem as `Data check "<id>": …`; the
file that draws the data only recovers, with an empty slot or a skipped region, and
says nothing. The data is read by `js/dataModel.js` and `js/settingsModel.js`, which
the tests use too, so they hold the data to every rule without a browser:
`tests/node/dataChecks.test.js` holds the test world to every rule and proves each one
catches a made-up mistake, and `tests/game/node/gameData.test.js` holds the game's own
data to them. **A new rule needs an example in `tests/node/dataChecks.test.js`**, or
that test fails. Rows naming a script file are
about the running page rather than the files, and stay where they happen.

### Files that can't be read

| Problem | Where | What happens |
|---|---|---|
| A core file (`config.json` or a file it lists, `Items.json`, `manifest.json`, `settings.json`) can't be fetched, isn't valid JSON, or has the wrong shape | `dataLoader.js` | Nothing can draw, so the page shows `#tracker-load-error`: the cause, the file, the version and the address, selectable for a bug report. |
| A region file can't be read, or holds no region | `dataLoader.js` | That region is dropped and named in a banner; the rest load. |
| `locationFlags.json` or `logicHelpers.json` can't be read | `dataLoader.js` | A banner names the file. Its entries read false, and the unknown-token rule says which file failed, since it is the likelier cause. |
| `saveLayout.json` can't be read | `dataLoader.js` | A banner says saving and loading are off. |
| `version.json` can't be read | `dataLoader.js` | The footer stays empty, and a load-error report says `version: unknown`. |

### Items, grids and config

| Problem | Where | What happens |
|---|---|---|
| A key is in two config files | `config-keys` | The later file wins. |
| An `Items.json` entry has no `id` | `item-ids` | Dropped; every file that reads the items would otherwise throw on it. |
| A grid slot names no item (a progression's later stages included) | `grid-slots` | The slot draws empty, so the grid's columns still line up. |
| The Bomber's code digit slots have no `name` | `digit-slots-named` | Each digit's tooltip shows its slot id. |
| A slot is both a progression and a counter | `progressions-or-counts` | Clicking it would do nothing. |
| A token in `logicTokens.json` is malformed, or reads a group naming something that isn't an item | `logic-tokens-defined` | An unusable token is left out; one whose source is missing reads 0 or false. |
| `check_groups` isn't a list, or an entry isn't a list of at least two check ids | `check-group-shape` | The group is dropped, so its checks tick off and count on their own. |
| A `check_groups` id matches no check, or is in two groups | `check-groups` | An unmatched id leaves its location unlinked; an id in two groups joins both into one location. |
| A starting value doesn't fit its slot | `gameStateManager.js` | The slot starts empty. |
| A legend entry has no `status` or `label`, or names a status the CSS gives no color | `locationLegend.js` | The entry isn't drawn. |
| The overlay's `text_sizes` are missing or a rung is unusable | `locationMap.js` | Bad rungs are skipped; with none left, the overlay is fitted once at the stylesheet's size and scrolls if it must. |
| `config.map` is unusable, or building the map throws | `locationMap.js` | A banner says the desktop map is missing; the grids and the phone's region list still work. |
| The map image's real size differs from `config.map`'s | `locationMap.js` | Every marker drifts off its spot until it is corrected. |

### Regions and checks

| Problem | Where | What happens |
|---|---|---|
| `region_name` has spaces around it | `region-names` | Trimmed, so `"Name "` counts as a duplicate of `"Name"`. |
| A list in a region's tree isn't a list, an entry isn't a check, a sub-region has no name or holds nothing, a sub-region's `logic` isn't text, or a check sets `vanilla_when: false` beside a `vanilla_item` | `region-trees` | Named by its path in the tree. A bad list is dropped; logic that isn't text stays in the chain, so the checks under it read unreachable rather than turning green early. |
| A region's tree throws while being read | `dataModel.js` | That region keeps whatever checks it listed. |
| `region_name` is missing, blank or repeated, there's no `item_checks` list, or a check has no `id` | `region-accepted` | The region isn't drawn and gets no marker, named by its file. A repeated name would make a second marker open the first region's checks; a check without an id couldn't be saved. An empty `item_checks` is fine: a region not written yet. |
| A region throws while drawing | `locationTracker.js` | Only that region is skipped. |
| Two checks share an `id` | `check-ids-unique` | Nothing is skipped, since a shared id is how a group works, but they tick off together as one location. |
| A check has no `name` | `check-names` | It draws as a blank row. |
| A region has no `map_coordinates` from 0 to 100 | `map-coordinates` | No marker, so on desktop its checks can't be reached at all. |

### Logic

| Problem | Where | What happens |
|---|---|---|
| A logic string can't be parsed | `logic-parses` | Named with every place using it, and everything it gates reads unreachable. The parser also names the position of the problem. |
| A token matches nothing (no item, token, flag or helper) | `logic-tokens-known` | Named with every check using it, with the right stage for a progression slot. It reads false. |
| A name after `>=` isn't a dropdown whose options carry a `value` | `logic-counts` | The comparison is never met. |
| An item is demanded twice down one check's chain | `logic-demanded-once` | Named once per pair of layers. A bare token is a yes/no question, so the second asks for nothing and the check turns green early; a counted item takes a running total (`key>=2`). |
| A flag points nowhere, a helper has no logic, an id is taken or repeated, or flags and helpers need each other in a loop | `flags-and-helpers` | Named; that flag, helper or path reads false. |

### Settings and vanilla values

| Problem | Where | What happens |
|---|---|---|
| A section, group or setting can't be read: no id, a repeated id, an unknown class, a default that isn't one of its values, a bad view, some dropdown options with a `value` and some without | `settings-entries` | Each line says what is ignored; every other setting still loads. |
| A grant or `starting_max` names something that isn't a grid slot, or a value its slot can't hold | `settings-grants` | That grant is ignored. |
| Two settings each grant only the same slot | `settings-slots` | The first steps through the slot on the settings page; the other still works from its row. |
| A lock is malformed, or its `when` names a setting with a lock of its own | `settings-locks` | The lock is ignored. |
| A setting's class has no control | `settingsPage.js` | Its row is left out of the settings page. |
| A handed-over pick or save no longer fits the data | `settingsState.js`, `gameStateManager.js`, `itemCheckStateManager.js` | That value keeps its default; a completed check the tracker doesn't show is kept in the save. |
| `saveLayout.json` is unusable, or misses something there is to save | `saveManager.js` | Unusable turns saving off; a missing entry is left out of saves, with a pointer to the script that adds it. |
| A `vanilla_when` is malformed or names an unknown setting or value | `vanilla-clauses` | The clause never matches, so the check shows as randomized. |
| A `vanilla_item` isn't text, looks like an id but names no item, or sits on a check with no `vanilla_when` | `vanilla-items` | The tooltip leaves the "Vanilla:" line out. Plain text is always fine, since most vanilla contents aren't tracked items. |
| A check with a `vanilla_when` names no `vanilla_item`, its own or its group's | `vanilla-item-named` | It still reads non-randomized when its clause matches; the tooltip leaves the "Vanilla:" line out. |
| Checks that are one location disagree on `vanilla_when` or `vanilla_item` | `vanilla-agreement` | Named, compared as written, so the disagreement shows under any settings. |

### Adding a check

- **A diagnostic must never be what breaks the page.** Each rule runs in its own
  try/catch, and one that throws becomes a finding of its own.
- **Judge only what can draw.** The region rules see only the regions that pass
  `DataModel.acceptRegions()`, the ones the page draws. A rejected region has been
  named once already, and a malformed one is what makes a rule throw in the first
  place.
- **Degrade to a hole, not a halt.** A bad slot draws empty, a bad region is
  skipped, a bad file is dropped. Only an unreadable core file stops everything,
  because then there is nothing to draw.
