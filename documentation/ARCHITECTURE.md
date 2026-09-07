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
   The shared globals are `window.GameState` and `window.TrackerData`.

   Four files (`dataLoader`, `locationStatsTracker`, `locationPanelLayout`,
   `locationMap`) are wrapped in IIFEs and expose nothing else. Three
   (`itemTracker`, `locationTracker`, `mobileTabManager`) are not, so their
   **14** top-level functions — `canAccess`, `evaluateAllRegions`, `renderGrid`,
   `switchMobileTab` and the rest — are on `window` too. Nothing reads them
   across files and nothing collides, and being able to call them from devtools
   is genuinely useful, but the inconsistency is not deliberate. The plan is to
   wrap the remaining three during Phase 2 and expose the handful worth having at
   a console behind one deliberate `window.TrackerDebug`.

   Those same three files also hold three top-level `let`/`const` bindings:
   `trackerConfig`, `activeRegionTrackers`, `tabScrollPositions`. **These are the
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
     ├─ #item-section  > .grid-container > 4 × .item-grid[data-grid]
     └─ #location-section
         ├─ #location-stats-box        (injected by locationStatsTracker.js)
         ├─ #location-map-container    (injected by locationMap.js)
         └─ #region-sidebar > #region-dropdown-container   (region list)
```

The order inside `#location-section` is the runtime one, not the source one:
`#region-sidebar` is the only child in `index.html`, and `locationPanelLayout.js`
inserts the stats box and the map ahead of it. On mobile the stats box is moved
out to `<main>` entirely, above the tab bar, so it stays visible on both tabs.

- **Item tracker** (left): four grids of clickable item slots.
- **Location tracker** (right): on desktop, the Termina map with per-region
  markers + an overlay; on mobile, the accordion region list.

---


## 3. JavaScript files

| File | Owns | Key globals / DOM |
|---|---|---|
| `dataLoader.js` | **Loaded first.** The only file that reads `data/`. Fetches `config.json`, `Items.json`, `manifest.json` and every region file exactly once, then announces them with `trackerDataReady`. Renders the two load-failure messages (§8). | `window.TrackerData`, `#tracker-load-error`, `#tracker-region-warning` |
| `gameStateManager.js` | `window.GameState` — the inventory source of truth. Computes derived values (hearts, boss-mask count, regular-mask count, bomber's-code validity, "has a bottle"). Also builds the **F1 debug panel**. | `window.GameState`, `#tracker-debug-panel` |
| `itemTracker.js` | Renders one grid per key in `config.json`'s `grids` — the count and order come from config, nothing here. Handles left-click (advance) / right-click (retreat) cycling for toggles, progressions, and counters. Pushes every change into `GameState`. Validates every grid slot at load (§8). | `.grid-container`, one `.item-grid[data-grid="<key>"]` per grid |
| `locationTracker.js` | Builds every region's accordion (`.region-group` = header + `.region-content` of `.region-check-item`s) into `#region-dropdown-container`. Evaluates logic strings (`canAccess()`), sets `accessible` / `inaccessible` on checks and a rolled-up status class on each region header, and announces both. Also validates the logic tokens and the check ids at load (§8). | `#region-dropdown-container`, `activeRegionTrackers[]` |
| `locationStatsTracker.js` | The **Location Progress** box only: computes checked / accessible / remaining, deduped via `config.json` `check_groups`. Creates its own box element, hands it off via an event. Re-counts when `locationTracker.js` says the checks changed. | `#location-stats-box` |
| `locationPanelLayout.js` | Where the stats box and map container sit in `#location-section`, and sizing the desktop map so `stats box + gap + map` matches the item grid's height. Nothing about tracking. | positions `#location-stats-box`, sizes `#location-map-container` |
| `locationMap.js` | Desktop map view: builds `#location-map-container` (image + marker layer), one marker per region JSON with `map_coordinates`, matched to the real `.region-group` by its `data-region-name`. Clicking a marker **moves** that node into a fixed overlay and back to its original position on close. Also fits the region's checks to the overlay (§12). | `#location-map-container`, `#location-map-marker-layer` |
| `mobileTabManager.js` | `switchMobileTab()` — toggles `.active-section` between `#item-section` and `#location-section` under the mobile breakpoint (§10). | `.mobile-tabs`, `.tab-btn` |

---


## 4. The event bus

All events are `CustomEvent`s on `window`.

| Event | Dispatched by | Consumed by | Payload |
|---|---|---|---|
| `trackerDataReady` | `dataLoader.js`, once all of `data/` has loaded **and** `DOMContentLoaded` has fired | `itemTracker.js`, `locationTracker.js`, `locationStatsTracker.js`, `locationMap.js` | `window.TrackerData` |
| `trackerStateUpdated` | `gameStateManager.js` → `broadcastChange()`, on every state change | `locationTracker.js` (re-evaluates all regions), F1 debug panel | `{ items, totalHearts, totalBossMasks, totalRegularMasks }` |
| `itemGridsReady` | `itemTracker.js`, after every grid renders, **and again** once the slot images have loaded | `locationPanelLayout.js` (re-runs map sizing against the grid's real height) | — |
| `regionsRendered` | `locationTracker.js`, once every region accordion is in the DOM | `locationMap.js` (builds its region lookup), `locationStatsTracker.js` | — |
| `regionStatusChanged` | `locationTracker.js`, when a region's rolled-up status actually changes | `locationMap.js` (recolors that one marker) | `{ regionName, status }` |
| `trackerChecksUpdated` | `locationTracker.js`, at the end of every `evaluateAllRegions()` sweep | `locationStatsTracker.js` (recount) | — |
| `locationStatsBoxReady` | `locationStatsTracker.js`, after it builds its box | `locationPanelLayout.js` (positions it) | `{ box }` |
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
2. `gameStateManager.js` — builds the (empty) F1 panel at parse time; needs no
   data of its own (`itemTracker` hands it config).
3. *(`trackerDataReady` fires here)*
4. `itemTracker.js` — calls `GameState.init(items, config)` (populates `items`,
   dispatches the first `trackerStateUpdated`), renders one grid per
   `config.grids` key, dispatches `itemGridsReady`.
5. `locationTracker.js` — renders all accordions from `TrackerData.regions`,
   dispatches `regionsRendered`, validates the logic tokens against the now
   fully populated `GameState.items` and the check ids against each other, then
   runs one `evaluateAllRegions()` sweep — by now `GameState` is populated, so
   that first sweep uses the real inventory. Everything from `regionsRendered`
   down is in a `finally`, so a region file that breaks still leaves the rest of
   the page told about the ones that rendered (§8).
6. `locationStatsTracker.js` — builds its box, counts (the checks already exist),
   dispatches `locationStatsBoxReady`, starts listening for
   `trackerChecksUpdated` / `regionsRendered`. (It has no observer — see §4.)
7. `locationMap.js` — builds the container, dispatches `locationMapReady`, then
   builds markers from `TrackerData.regions`.

`locationPanelLayout.js` sits outside this — it has no data dependency and just
reacts to `locationStatsBoxReady` / `locationMapReady` / `itemGridsReady`, plus
`window.load`, `resize`, and a `ResizeObserver` on `.grid-container`. It still
re-runs its sizing on every one of those because the item grid's *rendered
height* settles independently of when the data arrives — see §11.

---


## 6. Contracts and couplings

**Region status** — `locationTracker.js` writes the current status onto
`headerBtn.dataset.status` as well as adding it as a class. `locationMap.js`
mirrors that attribute onto its marker without testing it against a list of
names, so adding a sixth status means touching `locationTracker.js`'s decision
logic and the CSS, and nothing else.

Per-click recoloring goes one marker at a time, through the
`regionStatusChanged` listener — and `locationTracker.js` only dispatches that
when a region's rolled-up status actually changed, so a click that moves nothing
writes nothing. `applyMarkerStatus()` early-returns on an unchanged status as a
second guard. `syncMarkerColors()` is the full 33-marker sweep and runs only when
the markers are built, never on a click.

**Couplings that are not events.** The files talk through `window` events, with
three deliberate exceptions worth knowing before you move anything:

- `locationPanelLayout.js` measures `.grid-container`, which `itemTracker.js`
  owns. It is the **only** file that does — `locationMap.js` used to measure it
  too, for the overlay height budget, and no longer needs to (§12). Keep it that
  way: two files independently deciding how tall the item column is means two
  places to fix when it changes.
- `locationMap.js` reads `#tracker-debug-panel` and its inline `style.display` to
  gate the coordinate finder behind the F1 panel. That is a reach into
  `gameStateManager.js`'s DOM, and switching the panel to a class toggle would
  disable the finder with no error.
- **Load order is masked, and relies on it.** Every consumer registers through
  `TrackerData.onReady` at parse time, and `trackerDataReady` cannot fire until
  all eight scripts have run, because it waits for `DOMContentLoaded` as well as
  the fetches. That is what makes the §5 sequence deterministic rather than
  lucky. It only holds for events that respect it — `window.load` does not, which
  is the whole of the `MIN_SANE_PX` story in §11.

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
| `config.json` | `grids` (slot layout per grid — **each key becomes a rendered grid**), `progressions` (multi-stage items), `item_counts` (numeric or staged counters), `item_groups` (boss masks, bottles), `heart_rules`, `bombers_code`, `map` (image path + real pixel size), `map_overlay.text_sizes` (§12), `check_groups` (checks that grant the player the same exact item despite existing in multiple locations). | `TrackerData.config` | `itemTracker.js`, `gameStateManager.js` (via `init`), `locationTracker.js`, `locationStatsTracker.js`, `locationMap.js` |
| `Items.json` | Array of `{ id, name, image, notes_image?, regular_mask? }`. `name` drives tooltips; `notes_image` is for song "how to play" popups (not wired up yet); `regular_mask: true` marks an item as counting toward `total_masks` (§9). | `TrackerData.items` | `itemTracker.js`, `gameStateManager.js` |
| `<Region>.json` | `region_name`, `logic` (region entry requirement), `map_coordinates: { xPercent, yPercent }`, `item_checks: [{ id, name, logic }]`. **`region_name` must be present and unique** — see §8. | `TrackerData.regions` (manifest order, unreadable files dropped) | `locationTracker.js` (accordion + logic), `locationMap.js` (marker position) |

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
| A core file (`config.json`, `Items.json`, `manifest.json`) cannot be read | `dataLoader.js` | Nothing can render, so `<main>` is replaced with `#tracker-load-error` — the cause and the page URL, in a selectable block meant to be pasted into a bug report. |
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

Region `logic` and check `logic` are mini-expressions evaluated in
`locationTracker.js` → `canAccess()`:

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

`canAccess()` rewrites the string to JavaScript (`&`→`&&`, `|`→`||`, tokens →
their values) and evaluates it with `Function(...)`. A region check's effective
logic is `(region.logic) & (check.logic)` when both are non-empty.

**Progression items are cumulative — name the lowest stage you will accept.**
Picking up the Razor Sword sets `kokiri_sword` *and* `razor_sword` true, so
`kokiri_sword` in a logic string reads as "any sword", and `guilded_sword` reads
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
custom property, so the nine media queries still spell the number out. Changing
the breakpoint means changing all nine, the property itself, and the two
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


## 11. Map sizing (`locationPanelLayout.js` → `syncPanelHeight`)

Desktop only. The map is sized to fill the location column without pushing the
page taller than the item grids beside it.

1. Measure the item grid's rendered height and the location column's width.
2. **Bail if either looks too small to be real** (`MIN_SANE_PX`). Mid-load, and
   whenever the page isn't painting, they read as zero or something intermediate,
   and sizing from those locks in a tiny map.
3. Subtract the stats box and the gap to get the height available.
4. Fit a box of the map image's aspect ratio — handed over on `locationMapReady`
   — inside that width and height, setting **both** dimensions explicitly, and
   match the stats box's width to it so the two read as one unit.

**Both dimensions are set from JS deliberately.** CSS `aspect-ratio` with flex
`align-self` does not resolve to the exact ratio at every viewport width, and a
box even slightly off ratio drifts every percent-positioned marker, worst on
ultrawide. Don't revert to CSS-only aspect-ratio without solving that.

Centering the stats box is a no-op today, which is worth knowing before you go
hunting for its effect: `main` is capped, so the map is width-constrained at
every desktop width and the stats box always ends up exactly the column width. It
starts mattering the moment the item grids get shorter and the map can be
narrower than its column.

### Why it has to be re-callable

Because step 2 can bail, the sizing runs from several angles: the three "ready"
events, `window.load`, `resize`, and a `ResizeObserver` on the item grid.

**`window.load` is not the backstop it looks like.** On a warm cache it fires
*before* `trackerDataReady` — `dataLoader.js` holds that until its fetches and
`DOMContentLoaded` are both done, and cached fetches lose the race — so the `load`
listener runs while the grid is still empty, bails, and is spent.

That leaves a real gap, because the grid existing is not the same as the grid
being its final size: until the slot images load it measures a fraction of its
real height. `MIN_SANE_PX` can't catch that, since the intermediate value is
perfectly plausible and the floor is there for zero. The "ready" chain then sizes
the map against it, and the only correction left is the `ResizeObserver` — frozen
in precisely the not-painting case this file keeps designing around. It showed up
on roughly one warm load in four.

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
page already had. Verified across the standard widths at three window heights —
`scrollHeight` reads the same with the overlay open as closed.

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

**A note on `.item-grid` and `box-sizing`.** It is `border-box` under the mobile
query and `content-box` above it, on purpose.

On mobile `.grid-container` is a plain flex column, so a `content-box`
`width: 100%` paints wider than its container once padding and border are added,
and the page scrolls sideways on a phone.

On desktop it is not the same situation, despite looking like it. There
`.grid-container` sizes its columns with `max-content` tracks that already resolve
to exactly what `.item-grid` paints, so nothing is mismatched and `border-box`
would only shrink every grid and slot for no gain. Measured both ways — do not
lift the mobile rule to the base one.

**And a warning about container query units.** `container-type` on `.item-slot`
is the clean way to size the bomber's-code digit against its slot, and mobile does
exactly that (`font-size: 80cqw`, see §13). **It must stay inside the mobile media
query.** On desktop, containment stops the slots feeding `.grid-container`'s
`max-content` tracks and the whole item panel collapses to a fraction of its
width. Mobile's tracks never consult the slots, so containment costs nothing
there. Desktop keeps a flat pixel size.

---


## 13. The mobile (tabbed) layout

Everything below `--mobile-breakpoint` shares one layout: the stats box, a tab
bar, and whichever of the two panels is active. It is not only a phone layout — it
covers everything up to the breakpoint, so it has to use a 1400px window well too.

**Both panels flow into columns**, and the browser picks the counts, so there is
no per-width breakpoint to maintain. `.grid-container` uses `auto-fit` with a
`min()` floor, and an open `.region-content` uses CSS multi-column.

| Viewport | Item grid columns | Item slot | Check columns |
|---|---|---|---|
| 390 | 1 | 45.7px | 1 |
| 768 | 2 | 46.8px | 2 |
| 1024 | 2 | 68.2px | 3 |
| 1400 | 2 | 73.3px | 4 |
| 1499 | 2 | 73.3px | 5 |

Measure these by reloading at each width — resizing into one does not fire the
events the layout depends on.

**The item grids stop at two columns on purpose.** Uncapped they reach four across
near the breakpoint, which shrinks the slots enough to read as one thin row rather
than a block. 1400 and 1499 are identical for every item-grid number because the
grid hits that cap well before either. The `min()` in the track definition matters
too: without it a narrow phone gets a track wider than its screen.

**A phone gets one column of checks whatever you do** — and by far less room than
it looks. At 390px the longest check name currently fits its column with **about
half a pixel to spare**. The phone layout is wrap-free by a hair, not by a
comfortable margin, so any check name longer than the current worst will wrap
there. Worth knowing before Phase 3 adds several hundred more.

The multi-column width is a compromise. Tighter and several labels wrap for the
sake of one more column; as it stands, one label wraps in a narrow band of widths
just below the breakpoint, where the extra column lands narrowest. One label in a
band that thin beats several labels everywhere, so the value stands.

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

**Back to top does not use `behavior: 'smooth'`.** Smooth scrolling is animated
on the same frame loop as `requestAnimationFrame`, which Chrome stops running for
a covered window - so the button would do nothing precisely when someone jabs at
it. That is the same trap as the stats box (section 11) and the map sizing, now
three times in this codebase. An instant `scrollTo(0, 0)` always works.
