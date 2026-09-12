# MM3D Randomizer Tracker — Architecture

A browser-based item/location tracker for Majora's Mask 3D randomizer runs.
Vanilla JS, no build step, no framework, no package manager, no modules.

It does need to be **served over HTTP** rather than opened off disk — there is no
build step, but `dataLoader.js` fetches `data/`, and a `file://` origin cannot do
that. `python -m http.server` in the repo root is enough.

> See also: [`architecture-diagram.md`](architecture-diagram.md) for the visual
> version of everything below.

---

# How it is put together

## 1. Design principles

1. **Plain scripts, loaded in order.** Every file in `js/` is a classic script
   tag in `index.html`. No `import`/`export`, no bundler. Load order is the only
   dependency mechanism, and it matters (see §5).
2. **Files talk through `window` events, not references.** A file never reaches
   into another file's internals. It dispatches a `CustomEvent` on `window`;
   whoever cares listens. This is what keeps the files independently editable.
   The shared globals are `window.GameState` and `window.TrackerData`, plus one
   object per helper: `LogicParser`, `Tooltip`, `RequirementsView`.

   Every file but three is wrapped in an IIFE, or defines nothing but its one
   global. The three that are not (`itemTracker`, `locationTracker`,
   `mobileTabManager`) put their top-level functions — `canAccess`,
   `evaluateAllRegions`, `renderGrid`, `switchMobileTab` and the rest — on
   `window` too. Nothing reads them
   across files and nothing collides, and being able to call them from devtools
   is genuinely useful, but the inconsistency is not deliberate. The plan is to
   wrap the remaining three during Phase 2 and expose the handful worth having at
   a console behind one deliberate `window.TrackerDebug`.

   Those same three files also hold top-level `let`/`const` bindings:
   `trackerConfig`, `activeRegionTrackers`, `checkNames`, `checkRequirements`,
   `tabScrollPositions`. **These are the
   dangerous ones, and they are not on `window` at all** — a top-level `let` or
   `const` in a classic script creates a global *lexical* binding instead. The
   difference matters at exactly the wrong moment: a `window` name collision
   silently overwrites and the page keeps running, while redeclaring one of these
   in a second script is a `SyntaxError` that stops the **whole** later file
   before a line of it executes. Phase 2 adds a settings file and Phase 4 adds
   `itemCheckStateManager.js`; that is the real reason the IIFE task is on the
   roadmap rather than tidiness. NOTE: This portion of the design will need to be
   reworked eventually.
3. **Data lives in `data/*.json`, never in JS.** No hardcoded arrays/objects of
   game data at the top of a JS file. A list belongs in the JSON file that
   logically owns it (a region's own file, `config.json`, `Items.json`). This is
   a hard rule.

---


## 2. Runtime layout: two trackers side by side

```
header (logo)
main
 ├─ #tracker-region-warning     (only if a region file failed to load)
 ├─ .mobile-tabs                (visible ≤ 1499px only)
 └─ .tracker-layout-wrapper
     ├─ #item-section  > .grid-container > one .item-grid[data-grid] per config.grids key
     └─ #location-section
         ├─ #location-summary-row      (built by locationPanelLayout.js)
         │   ├─ #location-stats-box    (built by locationStatsTracker.js)
         │   └─ #location-legend-box   (built by locationLegend.js)
         ├─ #location-map-container    (built by locationMap.js)
         └─ #region-sidebar > #region-dropdown-container   (region list)
```

The order inside `#location-section` is the runtime one, not the source one:
`#region-sidebar` is the only child in `index.html`, and `locationPanelLayout.js`
inserts the summary row and the map ahead of it. On mobile the summary row is
moved out to `<main>` entirely, above the tab bar, so it stays visible on both
tabs.

- **Item tracker** (left): four grids of clickable item slots.
- **Location tracker** (right): on desktop, the Termina map with per-region
  markers + an overlay; on mobile, the accordion region list.

---


## 3. JavaScript files

| File | Owns | Key globals / DOM |
|---|---|---|
| `dataLoader.js` | **Loaded first.** The only file that reads `data/`. Fetches `config.json`, `Items.json`, `manifest.json` and every region file exactly once, then announces them with `trackerDataReady`. Renders the two load-failure messages (§8). | `window.TrackerData`, `#tracker-load-error`, `#tracker-region-warning` |
| `logicParser.js` | Parses a logic string into a tree, evaluates that tree against an inventory, and annotates each node as satisfied / blocking / optional. No DOM, no data of its own. `locationTracker.js` evaluates through it and the requirements tooltip reads the same tree, so the two cannot disagree (§9). | `window.LogicParser` |
| `tooltip.js` | The tooltip: follows the pointer on hover, or docks to the bottom of the screen when pinned from a check's button on touch. Owns showing, hiding, positioning, the edge flip and pinning; owns nothing about what is in it. An owner calls `Tooltip.register(selector, build)` and gets called back with the hovered element (§14). | `window.Tooltip`, `.tracker-tooltip` |
| `requirementsView.js` | Turns an annotated logic tree into the *Items Required* bullet list. Presentation only. | `window.RequirementsView` |
| `gameStateManager.js` | `window.GameState` — the inventory source of truth. Computes derived values (hearts, boss-mask count, regular-mask count, bomber's-code validity, "has a bottle"). Also builds the **F1 debug panel**. | `window.GameState`, `#tracker-debug-panel` |
| `itemTracker.js` | Renders one grid per key in `config.json`'s `grids` — the count and order come from config, nothing here. Handles left-click (advance) / right-click (retreat) cycling for toggles, progressions, and counters. Pushes every change into `GameState`. Validates every grid slot at load (§8). Registers the item tooltip: name, plus the song's `notes_image` where there is one. | `.grid-container`, one `.item-grid[data-grid="<key>"]` per grid |
| `locationTracker.js` | Builds every region's accordion (`.region-group` = header + `.region-content` of `.region-check-item`s) into `#region-dropdown-container`. Evaluates logic strings (`canAccess()`), sets `accessible` / `inaccessible` on checks and a rolled-up status class on each region header, and announces both. Also validates the logic tokens and the check ids at load (§8). Registers the requirements tooltip for its checks. | `#region-dropdown-container`, `activeRegionTrackers[]` |
| `locationLegend.js` | The **Legend** box only: one row per entry in `config.json`'s `legend`, each swatch colored by the same status class the region headers and map markers use. Hands the box over on an event; where it sits is not its business. | `#location-legend-box` |
| `locationStatsTracker.js` | The **Location Progress** box only: computes checked / accessible / remaining, deduped via `config.json` `check_groups`. Creates its own box element, hands it off via an event. Re-counts when `locationTracker.js` says the checks changed. | `#location-stats-box` |
| `locationPanelLayout.js` | Where the summary row and map container sit in `#location-section`, and sizing the desktop map so `summary row + gap + map` matches the item grid's height. It owns `#location-summary-row`, which holds the stats box and the legend side by side. Nothing about tracking. | builds `#location-summary-row`, sizes `#location-map-container` |
| `locationMap.js` | Desktop map view: builds `#location-map-container` (image + marker layer), one marker per region JSON with `map_coordinates`, matched to the real `.region-group` by its `data-region-name`. Clicking a marker **moves** that node into a fixed overlay and back to its original position on close. Also fits the region's checks to the overlay (§12). | `#location-map-container`, `#location-map-marker-layer` |
| `mobileTabManager.js` | `switchMobileTab()` — toggles `.active-section` between `#item-section` and `#location-section` under the mobile breakpoint (§10). | `.mobile-tabs`, `.tab-btn` |

---


## 4. The event bus

All events are `CustomEvent`s on `window`.

| Event | Dispatched by | Consumed by | Payload |
|---|---|---|---|
| `trackerDataReady` | `dataLoader.js`, once all of `data/` has loaded **and** `DOMContentLoaded` has fired | `itemTracker.js`, `locationTracker.js`, `locationStatsTracker.js`, `locationLegend.js`, `locationMap.js` | `window.TrackerData` |
| `trackerStateUpdated` | `gameStateManager.js` → `broadcastChange()`, on every state change | `locationTracker.js` (re-evaluates all regions), F1 debug panel, `tooltip.js` (redraws an open tooltip) | `{ items, totalHearts, totalBossMasks, totalRegularMasks }` |
| `itemGridsReady` | `itemTracker.js`, after every grid renders, **and again** once the slot images have loaded | `locationPanelLayout.js` (re-runs map sizing against the grid's real height) | — |
| `regionsRendered` | `locationTracker.js`, once every region accordion is in the DOM | `locationMap.js` (builds its region lookup), `locationStatsTracker.js` | — |
| `regionStatusChanged` | `locationTracker.js`, when a region's rolled-up status or its counts change | `locationMap.js` (recolors that marker, sets its count, updates an open overlay's titlebar) | `{ regionName, status, accessible, remaining }` |
| `trackerChecksUpdated` | `locationTracker.js`, at the end of every `evaluateAllRegions()` sweep | `locationStatsTracker.js` (recount), `tooltip.js` (redraws an open tooltip) | — |
| `locationStatsBoxReady` | `locationStatsTracker.js`, after it builds its box | `locationPanelLayout.js` (puts it in the summary row) | `{ box }` |
| `locationLegendReady` | `locationLegend.js`, after it builds its box. Never fires if `config.legend` is empty | `locationPanelLayout.js` (puts it in the summary row) | `{ box }` |
| `locationMapReady` | `locationMap.js`, right after it builds the container (before markers are built) | `locationPanelLayout.js` (positions + sizes it) | `{ mapContainer, aspectRatio }` |
| `locationMapResized` | `locationPanelLayout.js` → `syncPanelHeight()`, after it writes a new map width/height | `locationMap.js` (re-fits an open overlay) | `{ mapContainer, width, height }` |

**Don't listen for `trackerDataReady` directly — use `TrackerData.onReady(fn)`.**
It runs the callback immediately if the data already arrived, so a file that
registers late still gets it. Listening for the raw event has a real race.

Because `trackerDataReady` waits for `DOMContentLoaded` too, a consumer woken by
it can touch the DOM without a second guard.

**Nothing watches the page for changes, and nothing should.** Two reasons, and
the second is the one that bites:

- A `MutationObserver` wide enough to be useful is too wide. One over
  `document.body` recounts on every unrelated DOM write — the F1 debug panel
  redrawing on each item click is enough to trigger it.
- A watcher only sees inside the element it is pointed at, and the region whose
  marker you just clicked has been *moved out* of `#region-dropdown-container`
  into the overlay. So a watcher on that container cannot see the one region most
  likely to be changing, and its marker sits on a stale color until you close it.

`locationTracker.js` causes those changes, so it announces them. Keep it that
way.

---


# What happens at runtime

## 5. Load and init sequence

`dataLoader.js` starts fetching the moment it parses — before `DOMContentLoaded`,
overlapping with the rest of HTML parsing. It then waits for **both** the fetches
and `DOMContentLoaded` before firing `trackerDataReady` once.

Every consumer registers via `TrackerData.onReady(...)` at script-parse time, so
they run **in `index.html` script order**, which makes the sequence deterministic:

1. `dataLoader.js` — fetches `config.json`, `Items.json` and `manifest.json`,
   then every region file the manifest lists.
2. `logicParser.js`, `tooltip.js`, `requirementsView.js` — define their globals
   (`tooltip.js` also binds its `document` listeners). None of them waits for
   data; the trackers call them.
3. `gameStateManager.js` — builds the (empty) F1 panel at parse time; needs no
   data of its own (`itemTracker` hands it config).
4. *(`trackerDataReady` fires here)*
5. `itemTracker.js` — calls `GameState.init(items, config)` (populates `items`,
   dispatches the first `trackerStateUpdated`), renders one grid per
   `config.grids` key, dispatches `itemGridsReady`, then registers the item
   tooltip.
6. `locationTracker.js` — registers the check tooltip, renders all accordions
   from `TrackerData.regions`, dispatches `regionsRendered`, validates the logic
   tokens against the fully populated `GameState.items` and the check ids
   against each other, then runs one `evaluateAllRegions()` sweep against the
   real inventory. Everything from `regionsRendered` down is in a `finally`, so a
   region file that breaks still leaves the rest of the page told about the ones
   that rendered (§8).
7. `locationStatsTracker.js` — builds its box, counts (the checks already exist),
   dispatches `locationStatsBoxReady`, starts listening for
   `trackerChecksUpdated` / `regionsRendered`. (It has no observer — see §4.)
8. `locationLegend.js` — builds its box from `config.legend` and dispatches
   `locationLegendReady`, or does neither when no entry is usable.
9. `locationMap.js` — builds the container, dispatches `locationMapReady`, then
   builds markers from `TrackerData.regions`.

`locationPanelLayout.js` sits outside this — it has no data dependency and just
reacts to `locationStatsBoxReady` / `locationLegendReady` / `locationMapReady` /
`itemGridsReady`, plus `window.load`, `resize`, and a `ResizeObserver` on
`.grid-container` and the summary row. It still re-runs its sizing on every one
of those because the item grid's *rendered height* settles independently of when
the data arrives — see §11.

---


## 6. Contracts and couplings

**Region status** — `locationTracker.js` writes the current status onto
`headerBtn.dataset.status` as well as adding it as a class. `locationMap.js`
mirrors that attribute onto its marker without testing it against a list of
names, so adding a sixth status means touching `locationTracker.js`'s decision
logic and the CSS, and nothing else.

Per-click recoloring goes one marker at a time, through the
`regionStatusChanged` listener — and `locationTracker.js` only dispatches that
when a region's rolled-up status or its counts changed, so a click that moves
neither writes nothing. `applyMarkerStatus()` then writes only what differs on
the marker. `syncMarkerColors()` is the full sweep over every marker and runs
only when the markers are built, never on a click.

**Couplings that are not events.** The files talk through `window` events, with
three deliberate exceptions worth knowing before you move anything:

- `locationPanelLayout.js` measures `.grid-container`, which `itemTracker.js`
  owns. It is the **only** file that does — the overlay's height budget reads the
  viewport and the map instead (§12). Keep it that way: two files independently
  deciding how tall the item column is means two places to fix when it changes.
- `locationMap.js` reads `#tracker-debug-panel` and its inline `style.display` to
  gate the coordinate finder behind the F1 panel. That is a reach into
  `gameStateManager.js`'s DOM, and switching the panel to a class toggle would
  disable the finder with no error.
- **Load order is masked, and relies on it.** Every consumer registers through
  `TrackerData.onReady` at parse time, and `trackerDataReady` cannot fire until
  every script has run, because it waits for `DOMContentLoaded` as well as
  the fetches. That is what makes the §5 sequence deterministic rather than
  lucky. It only holds for events that respect it — `window.load` does not, which
  is the whole of the `MIN_SANE_PX` story in §11.

  A call into another file's global belongs inside that callback too, which is
  why `Tooltip.register` sits in an `onReady` in both trackers. Made at the top
  of the file instead, it throws on an undefined global whenever `tooltip.js`
  loads later, and the rest of that file never runs — for `locationTracker.js`,
  every region, marker and check, with nothing on the page to say so.

**Accordion arrow** — the ▼/▲ character lives only in
`css/locationContainers.css` (`.region-arrow::after`), switched by an
`.expanded` class on the header. JS toggles the class; it never writes the
glyph. That is why closing a map overlay removes `.expanded` rather than
restoring a character.

---


# The data

## 7. Data files (`data/`)

**Every one of these is fetched by `dataLoader.js` and only by `dataLoader.js`.**
Other files read them off `window.TrackerData`; none of them call `fetch`.

| File | Shape | Surfaced as | Used by |
|---|---|---|---|
| `manifest.json` | Flat array of region file names. **Its order is the region display order** — reorder this file to reorder the mobile list. | `TrackerData.manifest` | (drives the region load order) |
| `config.json` | `grids` (slot layout per grid — **each key becomes a rendered grid**), `progressions` (multi-stage items), `item_counts` (numeric or staged counters), `item_groups` (boss masks, bottles), `heart_rules`, `logic_token_names` (display names for the derived tokens that have no `Items.json` entry — `hearts`, `bottle` and friends), `legend` (the status swatches and their labels, in display order), `bombers_code`, `map` (image path + real pixel size), `map_overlay.text_sizes` (§12), `check_groups` (checks that grant the player the same exact item despite existing in multiple locations). | `TrackerData.config` | `itemTracker.js`, `gameStateManager.js` (via `init`), `locationTracker.js`, `locationStatsTracker.js`, `locationLegend.js`, `locationMap.js` |
| `Items.json` | Array of `{ id, name, image, notes_image?, regular_mask? }`. `name` drives tooltips; `notes_image` is the song's button sequence, shown in the item tooltip (§14); `regular_mask: true` marks an item as counting toward `total_masks` (§9). | `TrackerData.items` | `itemTracker.js`, `gameStateManager.js` (via `init`), `locationTracker.js` (names in the requirements tooltip) |
| `<Region>.json` | `region_name`, `logic` (region entry requirement), `map_coordinates: { xPercent, yPercent }`, `item_checks: [{ id, name, logic }]`. **`region_name` must be present and unique** — see §8. | `TrackerData.regions` (manifest order, unreadable files dropped) | `locationTracker.js` (accordion + logic), `locationMap.js` (marker position) |
| `version.json` | `{ "version": "x.y.z" }`, written by `scripts/release.py` rather than by hand (README.md, *Releasing*). Fetched apart from the core files, so a report that they failed to load still carries the version. | `TrackerData.version` (null until it arrives, and if it cannot be read) | `dataLoader.js` (the `#app-version` footer and the load-error report) |

Map marker positions live per-region in `map_coordinates`.

### What is not data

Nearly everything the tracker knows comes out of `data/`, which is what makes it
mostly portable — pointing it at a different game is largely a matter of
replacing those files. The parts that are *not* data are worth knowing before you
try:

- **The special logic tokens.** `hearts`, `boss_masks` and `total_masks` are named
  in `specialTokenValues()` (§9). Anything else a logic string needs to compare as
  a number has to be added there.
- **The derived values `GameState` computes.** Hearts, the two mask counts, the
  bomber's-code check and "has a bottle" are each their own method, and each knows
  a `config.json` key or tag by name (`heart_rules`, `item_groups.boss_masks`,
  `item_groups.bottles`, `bombers_code`, `regular_mask`).
- **The map shape.** `locationMap.js` assumes a single image with markers placed
  on it by percentage.

Everything else — the grids, the items, the regions, the checks, the logic
strings, the map image itself — is JSON.

---


## 8. When the data is wrong

Every one of these is a data-authoring mistake that would otherwise fail
silently, or loudly in the wrong place. The rule they share: **say what is wrong,
once, at load, and keep the rest of the app up.**

| Check | Where | On failure |
|---|---|---|
| A core file (`config.json`, `Items.json`, `manifest.json`) cannot be read | `dataLoader.js` | Nothing can render, so `<main>` is replaced with `#tracker-load-error` — the cause, the version and the page URL, in a selectable block meant to be pasted into a bug report. |
| `version.json` cannot be read, or has no `x.y.z` version | `dataLoader.js` | One warning. The footer stays empty and a load-error report says `version: unknown`; nothing else reads it. |
| A region file cannot be read | `dataLoader.js` | That region is dropped and the rest load. Names of the dropped files land on `TrackerData.failedRegions` and in a `#tracker-region-warning` banner above the tracker. |
| A grid slot names an item that is not in `Items.json` | `itemTracker.js` → `validateGridSlots()` | One warning naming grid, index, and for a progression the stage number. The slot draws as an `.empty-slot` so the six-column alignment holds and the other grids still render. |
| A logic string uses a token that matches nothing in the item state | `locationTracker.js` → `validateLogicTokens()` | One warning naming the token and every check using it, plus the right stage id if it looks like a progression slot. The check resolves to `false`. |
| `region_name` is missing or duplicated | `locationTracker.js` | The region is not rendered and is named in a warning, and `locationMap.js` gives it no marker. A duplicate is the nastier case: both copies resolve to the one accordion that rendered, so the second marker would sit at its own coordinates and open the other region's checks. |
| `item_checks` is missing, or is not a list | `locationTracker.js` | The region is skipped and named in the same warning as a bad `region_name`. An empty list is *not* an error — a region whose checks are not written yet renders as an empty accordion. |
| A region file is readable, but something inside it throws while rendering | `locationTracker.js` | That one region is skipped and named, with the thrown message; every other region still renders. The render call sits in its own try/catch inside the loop for exactly this. |
| Two checks share an `id`, or a check has no `id` | `locationTracker.js` → `validateCheckIds()` | One warning naming the id and the regions using it. Nothing is skipped — a repeat is *legal*, it is how `check_groups` works, so the tracker cannot tell a typo from a group. The symptom is a check ticking itself off somewhere else and the progress total quietly shrinking. |
| A region has no `map_coordinates` | `locationMap.js` → `validateMarkerCoordinates()` | One warning naming the region. It still renders its accordion and still counts, but it gets no marker — and on desktop the accordion list is `display: none`, so its checks are unreachable from anywhere. |
| Nothing is tagged `regular_mask` | `gameStateManager.js` | Warns that `total_masks` will be 0 forever. |
| A slot appears in both `progressions` and `item_counts` | `gameStateManager.js` | Warns; the click handler would silently do nothing. |
| A `legend` entry is missing its `status` or `label`, or names a status `style.css` pairs no color with | `locationLegend.js` | One warning naming the entry, which is not drawn. The check asks CSS rather than a list, so status names still live only in `style.css`. |

Three rules worth keeping if you add more:

- **A diagnostic must never be the thing that breaks the page.** `validateGridSlots()`
  runs before `GameState.init()`, so anything it throws also leaves the item state
  empty — which then makes `validateLogicTokens()` report every token in every
  region as unknown. It is called inside its own try/catch for that reason, and so
  is every validator after it.
- **Show a validator only what rendered.** `validateLogicTokens()` and
  `validateCheckIds()` are handed the regions that made it onto the page, not
  `TrackerData.regions`. Both directions matter. A rejected region is not on screen,
  so nothing said about it can come true, and it has already been named once — a
  region dropped for a duplicate `region_name` is a near-copy of one that rendered,
  so the full list would report every check inside it as a duplicate id. And it is
  precisely the malformed regions that make a validator throw, so handing one the
  full list means a single bad file costs you the diagnosis of every other file too.
- **Degrade to a hole, not to a halt.** A bad slot draws empty, a bad region is
  skipped, a bad region file is dropped, a region that throws costs only itself.
  `regionsRendered`, both validators and the first `evaluateAllRegions()` sweep are
  in a `finally`, so the rest of the page is told about the regions that *did*
  render however badly the loop went — skip that and no marker gets a color and no
  check gets tagged, which reads as "nothing is reachable anywhere" and sends you
  hunting through the logic strings instead of at the one region file that broke.
  Only an unreadable core file stops everything, because at that point there is
  genuinely nothing to draw.

---


## 9. Logic strings

Region `logic` and check `logic` are mini-expressions parsed by
`logicParser.js` and evaluated through `locationTracker.js` → `canAccess()`:

- `&` = and, `|` = or, `()` = group up checks, `>=` = check if the count is greater than or equal to a number.
- Bare tokens are item ids, looked up in `GameState.items` (boolean or number).
- Special tokens resolved to numbers: `hearts`, `boss_masks`, `total_masks`.

`total_masks` counts the **20** masks tagged `regular_mask: true` in `Items.json`
— every mask except the four transformation masks. That is not an off-by-four
bug: the checks it gates are the moon children (the Moon trials, and the Fierce
Deity's Mask reward), and the four transformation masks cannot be given away.

The tag lives on the item rather than being derived from `config.grids.mask`,
which is a layout list: it says what the mask panel draws and in what order, so
moving a mask to another panel — or putting anything that is not a mask into that
one — would change the count silently.
- Empty string = always accessible.

`canAccess()` hands the string to `LogicParser`, which tokenizes it, builds a
tree, and walks that tree. `|` binds loosest, then `&`, then the comparison.
Parsed trees are cached by string, since every sweep re-evaluates every check.

**The grammar is deliberately smaller than an expression language.** There is no
negation and no operator but `>=`, because the tracker is additive: you only ever
gain items, so "not X" and "at most X" cannot describe a real requirement — they
can only encode a mistake. A comparison must be written `item >= count`, with a
bare item on the left and a bare number on the right; a group on either side, or
the operands the other way round, is a parse error naming the offender rather
than a rule that quietly evaluates to something surprising. A number is legal only
after `>=`: on its own, `bomb | 0` would be a requirement no inventory ever
changes.

A region check's effective logic is `region.logic` AND `check.logic`. The two are
parsed separately and joined as trees rather than glued into one string, so a
broken string is named and suppressed once, under the text actually in the region
file — not once per check under a joined string no file contains.
`combinedLogic()` builds the pair and the requirements tooltip uses the same
function, so a check can never be explained by different rules than the ones that
colored it.

**The tree, not the string, is why the tooltip can be specific.** Evaluating text
can only answer true or false; walking a tree can say which token in
`(bomb|blast_mask)&(hookshot|zora_mask)` is the one stopping you. `annotate()`
labels every node:

| State | Meaning | Shown as |
|---|---|---|
| `satisfied` | you have it | blue |
| `blocking` | you do not have it, and the group around it is unmet | red |
| `optional` | you do not have it, but a sibling already satisfies the group | gray |

The third one is the whole reason a context flag is threaded through the walk. An
unmet alternative inside an OR that some sibling already covers is not blocking
anything, and calling it blocking paints half the tooltip red.

A malformed string is a data bug, so anything it gates is treated as unreachable
rather than taking the whole sweep down, and the requirements tooltip says it could
not be read. `LogicParser` names each bad string once in the console, with the
character position of the problem, and suppresses the repeats, since every sweep
would otherwise log it again on every click. A quiet console after that first
error does not mean the data has been fixed.

**Progression items are cumulative — name the lowest stage you will accept.**
Picking up the Razor Sword sets `kokiri_sword` *and* `razor_sword` true, so
`kokiri_sword` in a logic string reads as "any sword", and `gilded_sword` reads
as "specifically the Gilded Sword". That is why there are no `|` chains over
sword stages anywhere. It works because every chain in `progressions` is a real
ladder — you cannot hold a later stage without having held the earlier ones.

The slot ids themselves (`sword`, `shield`, `wallet`, `magic`, `goron_lullaby`)
are **not** valid tokens: the state only ever holds the stage ids. Counter slots
are the other way round — `bow` and `bomb` *are* valid and mean "any", because
`item_counts` sets a slot-level flag as well as the staged ones.

A counted item used bare is truthy once it is above zero, so
`woodfall_small_key` means "at least one" and `ocean_skulltula_token>=30` is the
explicit form.

**`validateLogicTokens()` runs once at load** and warns to the console about any
token that matches nothing in `GameState.items`, naming the checks that use it.
Without it a typo, or a slot id used where a stage id was meant, resolves to
`false` forever with nothing said — the check just never turns green and it
reads like bad region logic. For a progression slot it also suggests the right
stage id. It sees only the regions that rendered, for the reasons in §8.

---


# Layout

## 10. Desktop vs mobile — the 1500px split

The number lives in `css/style.css` as `--mobile-breakpoint`. Both JS files read
it from there rather than repeating it, so JS can never disagree with CSS about
where mobile starts — that disagreement hides the region list *and* leaves the
map sizing itself against a `display: none` element. `@media` cannot read a
custom property, so every media query still spells the number out. Changing
the breakpoint means changing each of those, the property itself, and the two
last-resort fallback literals — `locationPanelLayout.js` and `locationMap.js` each
carry one for the case where the stylesheet fails to load, and a stale fallback
there is invisible until exactly that happens.

The number comes from the map needing a certain width to be readable at all. The
item grids are a fixed width at every viewport, so below the breakpoint there is
not enough left beside them for a usable map — hence the switch to tabs.

**The region list exists in the DOM on both.** On mobile (`≤ 1499px`) it is the
visible location UI. On desktop (`≥ 1500px`) `#region-sidebar` is
`display: none` and acts as a **storage bin**:

- `locationMap.js` **moves** (not clones) a `.region-group` node out of
  `#region-dropdown-container` into the map overlay when its marker is clicked,
  and moves it back on close. Moving preserves live event bindings and class
  state.
- It goes back **in front of the sibling it was lifted out from**, not on the
  end. An `appendChild` on the way back is invisible on desktop (the list is
  hidden) but dumps the region at the bottom of the mobile list the moment you
  narrow the window.

Consequences:

- Anything querying checks must query **globally** (`.region-check-item`), never
  scoped to `#region-dropdown-container` — the region in question may currently
  be inside the overlay. For the same reason, anything reacting to a change in
  those checks must listen for `trackerChecksUpdated` rather than watch a
  container (§4).
- On overlay close, the region's accordion state must be reset
  (`.region-content` loses `open`, arrow back to `▼`) or it shows up wrongly
  expanded when the user next sees the mobile list.

---


## 10b. The summary row and the status colors

`#location-summary-row` holds the stats box and the legend side by side.
`locationPanelLayout.js` builds it and fills it as the two boxes announce
themselves, in either order; neither box knows the other exists.

Both boxes are as wide as their own content and the pair is centered. On desktop
the row is set to the map's width, so the pair centers over the map. When large
text will not fit them side by side, the boxes shrink and wrap their labels first,
and if that is still not enough the row stacks the legend under the stats box. The
map keeps its size and the taller row pushes it down the page.

The map is sized against a fixed reserve for the row's height (§11), so **keep the
legend no taller than the stats box on desktop**: at the default text size a
taller row outgrows the reserve. Below the breakpoint the map is hidden, so the
row's height is free there.

**Regions count what is left in them.** The header reads
`Region Name (accessible/remaining)`: how many checks you could do right now, out
of how many are not yet ticked off. Non-randomized checks count toward neither.
The same pair shows in the map overlay's titlebar, because the moved-in region's
own header is hidden in there, and a yellow or green marker carries the
accessible number on its own — the other three statuses would only ever show a
zero.

`locationTracker.js` records the pair on the header as display text in
`data-counts`, and the accessible count as a number in `data-accessible`, beside
`data-status`. `locationMap.js` reads those back rather than counting again, so a
marker cannot disagree with the header above it: the titlebar copies
`data-counts`, and a marker shows a number exactly when `data-accessible` is
above zero. That is the yellow and green markers by construction, so neither
`locationMap.js` nor its CSS names a status to decide it — the larger
counted-marker size keys off a `has-count` class.

**Status is a color and a shape, paired once** in `style.css`. Each status class
sets `--status-color` and `--status-shape`, and `--status-outline` where a shape
needs a wider marker outline (see *Markers* below); region headers, check rows,
map markers and the legend swatches read those and nothing else, so a surface
cannot disagree with what the legend says a status means. An element with
no status class has none of these variables, so it draws no status at all: text
keeps its default color, and a glyph, swatch or marker fill stays transparent.

| Status | Color | Shape |
|---|---|---|
| `inaccessible` | red | triangle |
| `partialCompletion` | yellow | diamond |
| `fullClear` / `accessible` | green | circle |
| `vanilla` | purple | square |
| `completed` | pale gray | circle |

The shape carries the meaning on its own because red-green is the most common
form of color blindness and it is exactly the distinction this tracker leans on
hardest. Regions roll up to `fullClear` where a single check is `accessible`;
both map to the circle. The `completed` pairing is written last so a check that
is both completed and accessible shows as completed.

**Completed shares the circle with accessible, so lightness has to carry that
pair** — a pale gray against a saturated green, which stays apart in grayscale.
Do not darken it toward the green's lightness: shape does not separate those
two. On the map they differ again in that only accessible ever draws a
count.

### Markers

The shape is drawn by the marker's pseudo-elements — an outline behind, the
status color inset in front — rather than by the button, because `clip-path`
clips text along with paint and a count on the button would be cut off where the
shape tapers. A slanted edge shows less outline than a straight one from the same
inset, so the slanted shapes get a wider one. That width is part of the status
pairing in `style.css` (`--status-outline`) rather than keyed off a status name in
the map CSS, so it follows the shape if a status is ever given a different one.

Keeping the count centered on the marker is a stack of rendering traps; each is
explained beside the rule it protects in `locationMap.css`.

---


## 11. Map sizing (`locationPanelLayout.js` → `syncPanelHeight`)

Desktop only. The map is sized to fill the location column without pushing the
page taller than the item grids beside it.

1. Measure the item grid's rendered height and the location column's width.
2. **Bail if either looks too small to be real** (`MIN_SANE_PX`). Mid-load, and
   whenever the page isn't painting, they read as zero or something intermediate,
   and sizing from those locks in a tiny map.
3. Subtract the summary row's **reserved** height and the gap to get the height
   available. The reserve is the row's height at the default text size, set in
   `locationPanelLayout.css`. Larger text makes the real row taller, and sizing
   against the reserve means that pushes the map down the page instead of
   shrinking it. The first time the page is at the default text size, the JS warns
   if the row does not match the reserve.
4. Fit a box of the map image's aspect ratio — handed over on `locationMapReady`
   — inside that width and height, setting **both** dimensions explicitly, and
   give the summary row the map's width. The row then rearranges for its text:
   side by side, labels wrapped, or stacked.

**Both dimensions are set from JS deliberately.** CSS `aspect-ratio` with flex
`align-self` does not resolve to the exact ratio at every viewport width, and a
box even slightly off ratio drifts every percent-positioned marker, worst on
ultrawide. Don't revert to CSS-only aspect-ratio without solving that.

### Why it has to be re-callable

Because step 2 can bail, the sizing runs from several angles: the "ready" events,
`window.load`, `resize`, and a `ResizeObserver` on the item grid and the summary
row. The row is watched because its size follows the browser's text size, so a
text-size change re-fits the row without a reload.

**`window.load` is not the backstop it looks like.** On a warm cache it fires
*before* `trackerDataReady` — `dataLoader.js` holds that until its fetches and
`DOMContentLoaded` are both done, and cached fetches lose the race — so the `load`
listener runs while the grid is still empty, bails, and is spent.

That leaves a real gap, because the grid existing is not the same as the grid
being its final size: until the slot images load it measures a fraction of its
real height. `MIN_SANE_PX` can't catch that, since the intermediate value is
perfectly plausible and the floor is there for zero. The "ready" chain then sizes
the map against it, and the only correction left is the `ResizeObserver` — frozen
in precisely the not-painting case this file keeps designing around.

`itemTracker.js` closes the gap by dispatching `itemGridsReady` a second time once
its images settle. That is the visibility-independent cover; `load` is not.

### The rAF rule

`scheduleHeightSync()` here, and `scheduleUpdate()` in `locationStatsTracker.js`,
both pair `requestAnimationFrame` with a `setTimeout`. One rule explains both:
**`rAF` can stop running, so nothing may depend on it alone.** A window the
browser has decided not to paint stops firing `rAF` callbacks, and
`ResizeObserver` stops with it — they are delivered in the same rendering step. A
tracker sitting behind an emulator is the normal case here, not an edge case, and
without the timeout the progress numbers silently stop moving.

Don't reach for a feature-detect. `document.hidden` doesn't track whether `rAF` is
running — it reads `true` in contexts that are merely unpainted, which is a
different question, and it is no use for the covered-window case this was written
for either. The unconditional `setTimeout` costs one timer and is right every
time.

---


## 12. Fitting a region into the map overlay (`locationMap.js` → `fitOverlayContent`)

Desktop only. The overlay has to show every check in a region at once, in a box
as wide as the map and naturally as short — wide and flat, the opposite of what a
list wants.

**How it lays out.** CSS grid, with the column and row counts set from JS
(`grid-auto-flow: column`, `grid-template-columns: repeat(N, minmax(0, 1fr))`).
Columns are equal width and always span the full box; fill order runs down each
column before moving right, so a region's rooms stay grouped the way its JSON
lists them.

**Not flex `column`-wrap.** Flex sizes each column to its own widest item and
packs them left, leaving roughly a third of the box empty instead of spreading
the checks across it. Nothing overflows either way — the cost is the wasted
width, which buys narrower columns and so an earlier step down the text ladder.

**How tall it may get.** A windowful measured down from the top of the page, or
the map's own height, whichever is larger. The location column has dead space
below the map — the item grids run lower, and below those the page usually has
room to spare — and letting the overlay use it is what keeps the text readable.

That single ceiling is enough on its own to stop the overlay ever making the page
scroll: its bottom edge lands one margin above `clientHeight`, and `scrollHeight`
is never below `clientHeight`, so the overlay always sits inside the height the
page already had.

`documentElement.clientHeight` rather than `window.innerHeight`, because the two
differ by the height of a horizontal scrollbar and `clientHeight` is the one
`scrollHeight` gets compared against. That makes the guarantee exact rather than
nearly exact.

**Do not add the item grids' bottom edge back as a second ceiling.** It looks like
the thing keeping the scrollbar away and it is not — the paragraph above does
that. All it costs is height, and on a tall window that is worth a couple of rungs
of the text ladder. The trade-off it removes is real but narrow: on a short window
the viewport is the binding ceiling anyway, and elsewhere the overlay hangs a
little below the item grids into page that is empty regardless. It only grows as
far as the content needs, so an ordinary region doesn't hang at all.

**Document coordinates, not viewport, and that matters.** Both terms have to be
scroll-invariant. Read them off `getBoundingClientRect()` alone and the budget
grows as you scroll, so the same region renders at a different text size depending
on where the page was when you clicked its marker — and one opened while scrolled
down leaves checks below the fold when you scroll back up, because nothing re-fits
on scroll. Nothing should: that would resize the text under the reader mid-scroll.

If the measurement looks wrong — short or negative, before layout settles — it
falls back to the map's own height, the same defensive idea as `MIN_SANE_PX` in
§11.

**How the text is sized.** `config.json` → `map_overlay.text_sizes`, largest
first. It walks the ladder and stops at the first size that fits, so a region only
shrinks if it has to and an ordinary one never does. Only the largest regions drop
at all, and then only on a short window, where the viewport caps the height
budget.

A label too long for its column wraps rather than being clipped — a last resort,
since the columns are sized from the widest label in the first place. `nowrap` is
forced back on through a CSS variable while the measuring pass runs, because a
wrappable label reports a much narrower min-content width and would throw the
column count off for every region.

**Why the overlay draws its own border.** It sits just outside the map container
so its border lands on top of the container's. The overlay can grow taller than
the map, and the container's border stops at the map's bottom edge, so without one
of its own the grown part would hang outside the frame. That is also why
`#location-map-container` has no `overflow: hidden` — the image rounds its own
corners instead.

**It re-fits on two triggers.** Column count and text size both come off a
measurement, so an overlay left open while anything moves has to be recomputed.

- `locationMapResized`, announced by `locationPanelLayout.js` once it has
  actually written the new map size. Listening for that rather than racing it on
  `resize` is what makes the refit correct regardless of which file registered
  its listener first — two files on the same event only run in the right order by
  accident of registration order. It is also the only signal when the
  `ResizeObserver` on `.grid-container` resizes the map with no window resize.
- `resize`, still, because the height budget reads the viewport: a height-only
  resize moves the budget while leaving the map exactly the size it was, so
  nothing would be announced.

Scroll is deliberately not a trigger — see the note on document coordinates above.
The rAF/timeout scheduling guard collapses the two into a single refit when they
coincide.

---


## 13. The mobile (tabbed) layout

Everything below `--mobile-breakpoint` shares one layout: the summary row, a tab
bar, and whichever of the two panels is active. It is not only a phone layout — it
covers everything up to the breakpoint, so it has to use a wide window well too.

**Both panels flow into columns**, and the browser picks the counts, so there is
no per-width breakpoint to maintain. `.grid-container` uses `auto-fit` with a
`min()` floor, and an open `.region-content` uses CSS multi-column.

**The item grids stop at two columns on purpose.** Uncapped they reach four across
near the breakpoint, which shrinks the slots enough to read as one thin row rather
than a block. The `min()` in the track definition matters too: without it a narrow
phone gets a track wider than its screen.

**The tab bar is `position: sticky`.** It needs its own opaque background (the
list scrolls under it otherwise) and a z-index above the region headers. Sticky
fails silently: if anything above `.mobile-tabs` ever gets an `overflow` other
than `visible`, it stops sticking with no error.

**Scroll position is remembered per tab** in `mobileTabManager.js`, in memory
only - it is where you were looking, not what you collected, so it stays out of
the Phase 4 save format.

**The digit sizing is slot-relative, not viewport-relative.** A viewport-derived
size only tracks the slot while the mobile grid is a single column — once the
grids sit two across the slot shrinks and the digit does not follow. `80cqw`
cannot drift.

**Container query units stay inside the mobile media query.** `80cqw` measures
against `container-type` on `.item-slot`. On desktop, containment stops the slots
feeding `.grid-container`'s `max-content` tracks and the whole item panel
collapses to a fraction of its width. Mobile's tracks never consult the slots, so
containment costs nothing there. Desktop keeps a flat pixel size.

**`.item-grid` is `border-box` here and `content-box` on desktop, on purpose.**
Here `.grid-container` is a plain flex column, so a `content-box` `width: 100%`
paints wider than its container once padding and border are added, and the page
scrolls sideways on a phone. Desktop only looks like the same situation: its
`max-content` tracks already resolve to exactly what `.item-grid` paints, so
`border-box` would only shrink every grid and slot for no gain. Do not lift the
mobile rule to the base one.

**Back to top does not use `behavior: 'smooth'`.** Smooth scrolling is animated
on the same frame loop as `requestAnimationFrame`, which Chrome stops running for
a covered window - so the button would do nothing precisely when someone jabs at
it. That is the same trap as the progress recount and the map sizing (§11). An
instant `scrollTo(0, 0)` always works.

---


## 14. Tooltips (`tooltip.js`)

Hovering an item shows its name, and for a song the button sequence from
`notes_image`. Hovering a location check shows what it needs, colored by whether
you have it.

Both come from one element. `tooltip.js` owns showing, hiding, following the
pointer and flipping at the viewport edge; it knows nothing about items or logic.
An owner registers a selector and a builder:

```js
window.TrackerData.onReady(() => {
    window.Tooltip.register(".item-slot", (element, { pinned }) => nodeOrNull);
});
```

The builder is called with the hovered element and returns what to show, so
`itemTracker.js` keeps the item knowledge and `locationTracker.js` keeps the
logic knowledge. A `null` shows nothing.

Register from inside `onReady`, not at the top of the file, so the owner does not
depend on `tooltip.js` loading before it (§6).

**Binding is delegated from `document`, and has to be.** A `.region-group` is
moved into the map overlay and back (§10), and delegation survives that with no
rebinding — per-element listeners would need reattaching on every move.

**It replaces the `title` attribute rather than joining it.** A native tooltip
cannot hold an image, and leaving both would show two tooltips per hover, a
second apart, in different places. The accessible name is on `aria-label`.

**Two ways in.** On a pointer, hovering shows the tooltip at the cursor — that
path is gated behind `(hover: hover)`, so touch never reaches it. On touch, each
location check carries its own button that *pins* the tooltip instead. Pinned
mode is driven by a real click, so it is not gated: it works with a mouse too,
which is what makes it testable at a desktop width.

Item slots have no pinned mode. Song notes stay a hover feature.

### The pinned panel

`Tooltip.pin(element)` / `unpin()` / `togglePin(element)` reuse the builder
already registered for that element, so nothing is registered twice.

It docks to the bottom of the viewport rather than anchoring to the row. Anchored
popups near the bottom of a phone screen need scrolling to read, and the position
would change with every row; docked, it lands in the same place every time. The
cost is that it is nowhere near the row it describes, which is why the panel
leads with the check's name while the hover tooltip just says "Items Required".

**Anything that activates a control closes it, and that control still does its
own job.** Tapping a check completes it *and* closes the panel; tapping a region
header opens that accordion *and* closes the panel. Nothing is suppressed, so
dismissal behaves the same wherever you touch.

It listens for `click` rather than `pointerdown`, for two reasons. A keyboard
activates a control with a click and no pointer event, so a `pointerdown` rule
leaves a keyboard user with a panel they cannot close. And a finger that starts a
scroll fires `pointerdown` but never a click, so scrolling the list leaves the
panel up. Escape closes it too, and dismisses a hover tooltip.

**It closes on crossing to desktop**, where it would be stranded with no button
to close it. It tells by asking whether the anchor's button is still drawn rather
than by knowing the breakpoint. CSS hides the button above it,
so asking the button is asking CSS, and this file never learns the number.

### Things that bite

**The tooltip must never be under its own pointer.** `pointer-events: none` in
the CSS — without it, the tooltip appearing under the cursor fires `mouseout` on
the real target, which hides the tooltip, which uncovers the target, forever.

**Content that grows after it is shown has to reposition.** An `<img>` has no
height until it loads, so the edge flip measures the wrong box and the notes can
end up hanging off the bottom of the window. The item builder calls
`Tooltip.reposition()` on the image's `load`.

**A builder that throws closes the tooltip** and is named once in the console.
Left to escape, the throw would land after `pin()` had already docked the panel
and hidden back-to-top, with nothing drawn and nothing to close it.

**The pinned panel is fixed, so scrolling does not strand it** — and dismissing
on scroll is therefore wrong for it, though it stays right for the hover path.

**Clearing the home bar depends on `viewport-fit=cover`.** The panel's offsets
add `env(safe-area-inset-*)`, and on iPhone those only read non-zero because
`index.html` asks for `viewport-fit=cover`. Without it they are 0, and the panel
docks behind the home bar and under the screen's rounded corners. The same
setting lets the rest of the page run under the notch and home bar, which is why
`body` pads all four sides by the insets and the sticky mobile tabs pad their
top.

**The notes image must not be `.item-image`.** `itemTracker.js` counts those to
decide when the grids have stopped growing, and `locationPanelLayout.js` sizes
the map off that (§3, §11). A tooltip image joining the count stalls the
re-announce and leaves the map sized against a half-height grid.

**It redraws in place on `trackerStateUpdated`, `trackerChecksUpdated` and any
click.** What is under a stationary pointer changes without the pointer moving —
clicking an item advances that slot and re-runs the whole sweep, so a tooltip
that only built once would quietly describe the previous state.

### The requirements list

`requirementsView.js` renders the annotated tree from §9. One bullet per thing
you need; nested `&` is flattened, so a region's entry logic and the check's own
produce separate bullets rather than one line reading "A and B". Alternatives
stay inline: `Bombs or Blast Mask`.

Names come from `Items.json`, falling back to `config.logic_token_names`, then to
the raw token id — a typo stays visible in the tooltip instead of rendering a
blank bullet.

A `>=` against a number renders as a count, `Ocean Skulltula Tokens 12/30`, since
what you already have is the part being asked about.
