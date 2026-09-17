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
   tag in one of the two pages, `index.html` (the settings page) and
   `tracker.html` (§2). No `import`/`export`, no bundler. Load order is the only
   dependency mechanism, and it matters (see §5).
2. **Files talk through `window` events, not references.** A file never reaches
   into another file's internals. It dispatches a `CustomEvent` on `window`;
   whoever cares listens. This is what keeps the files independently editable.
   The shared globals are `window.GameState`, `window.SettingsState`,
   `window.TrackerView`, `window.TrackerLaunch` and `window.TrackerData`, plus one
   object per helper: `LogicParser`, `Tooltip`, `RequirementsView`,
   `SettingControls`, `ItemGrids`.

   Every file is wrapped in an IIFE or defines nothing but its one global, and a
   new file has to be too. Not for tidiness: a top-level `let` or `const` in a
   classic script is a global *lexical* binding, not a `window` property, so two
   scripts declaring the same name is a `SyntaxError` that stops the **whole**
   later file before a line of it runs. A `window` collision would only
   overwrite and carry on, which is why this one is easy to miss.

   Anything worth calling from a devtools console goes on `window.TrackerDebug`,
   which `gameStateManager.js` creates next to the F1 panel and each file fills
   in with its own helpers. `TrackerDebug.evaluateAllRegions()` re-runs the sweep
   and `TrackerDebug.canAccess(logic)` tests a logic string, both against the
   live `GameState`.
3. **Data lives in `data/*.json`, never in JS.** No hardcoded arrays/objects of
   game data at the top of a JS file. A list belongs in the JSON file that
   logically owns it (a region's own file, `config.json`, `Items.json`). This is
   a hard rule.

---


## 2. Pages and runtime layout

### Pages

The app is two pages. `index.html` is the settings page, the one a visitor lands
on: pick the seed's settings, then Launch New Tracker opens `tracker.html`, which
runs with them. The tracker's own Launch New Tracker asks with `confirm()` and
goes back, because nothing on a tracker is saved yet.

The settings cross over in `sessionStorage`, under `mm3drTracker.v0.launch`, as
`{ picks }`: every setting that differs from its default. `launch.js` reads and
writes it on both pages and `settingsState.js` applies it at load, so the settings
page opens on the last tracker's settings and a reloaded tracker keeps its own.
Session storage belongs to one tab, so two tabs can run two trackers with
different settings. Picks cross over rather than locked values, and the tracker
works the locks out again for itself.

Opened with nothing handed over — a bookmark, a fresh tab — `tracker.html` goes to
the settings page before its body draws: it marks `<html>` with
`data-requires-launch`, and `launch.js` runs in `<head>`. The one exception is
`tracker.html?defaults`. When Launch New Tracker can't store the picks, whether
storage is blocked or just full, the settings page shows its storage warning,
asks with `confirm()`, and opens that address, where the tracker starts on the
default settings and ignores any older handoff. Only that write knows whether the
picks fit, so the tracker doesn't test storage itself: a small test value can fit
where the picks don't, and the tracker would send the reader straight back. The
settings page still tests storage at load, to warn up front.

### The settings page

```
header
 ├─ logo
 └─ #tracker-toolbar            (Reset to Defaults, Load From Autosave, Load From File, Launch New Tracker)
main
 ├─ #settings-storage-warning   (only if the browser blocks storage)
 ├─ .mobile-tabs                (visible ≤ 1499px only: Settings, Starting Items)
 └─ .tracker-layout-wrapper
     ├─ #settings-section > .settings-panel > #settings-list    (every list section, in menu order)
     └─ #starting-section > .starting-items
         ├─ h2
         ├─ ul.slot-legend      (what the four kinds of slot mean)
         ├─ .grid-container     (the tracker's item grids, drawn by itemGrids.js)
         └─ #starting-extras    (the inventory options, in the phone layout)
footer#app-version              (the version, from data/version.json)
#back-to-top                    (phone layout only)
```

On desktop the two halves sit side by side, the settings panel taking the width
the grids leave; below the breakpoint they are tabs, through the same
`mobileTabManager.js` as the tracker's. Edits apply as they are made. A setting
picked away from its default is marked with a dot and counted in its section's
heading; a value a lock forces is not a pick, so it adds neither. A locked
setting's control is disabled, with a note naming the picks that lock it.

The Starting Items half is the tracker's own grids, showing the state the tracker
will open with: every change re-runs `GameState.init` with
`SettingsState.startingItems()` and redraws the slots. Which setting a slot
answers to comes from the grants, not from a list (`SettingsState.slotSettings`):

- **A setting that grants one slot and nothing else controls it.** Clicking the
  slot steps through that setting's choices in the slot's own order (no sword,
  Kokiri, Razor, Gilded), and right-clicking steps back. When several choices
  look alike in the slot, like the stick capacities, the slot shows the chosen
  one's name. Sword, Shield and Ocarina are Major Items settings that work this
  way too, so their slot and their row change together.
- **A slot granted only by settings that grant other slots too, or by a number,
  is filled in but not clicked:** maps and keys, bottle contents, the Bomber's
  code, the token and stray fairy counts. Its tooltip names what sets it.
- **A slot no setting grants is drawn faded**, so the grids still match the
  tracker.

A legend above the grids draws one sample slot of each kind with the grids' own
classes, worded for the input rather than the window: click, right-click and hover
for a mouse, tap for a touchscreen.

The item grids section's settings that no slot shows — the inventory options — are
the settings panel's last section on desktop, and sit under the grids in the phone
layout, where they belong to the Starting Items tab. `settingsPage.js` builds that
block of rows once and moves it when the window crosses the breakpoint, the way
the map overlay moves a region, so there is never a second copy to keep in step.
The heading counts follow it.

Load From Autosave and Load From File stay disabled until there is saving. The
page loads no region files (§5).

### The tracker page: two trackers side by side

```
header
 ├─ logo
 └─ #tracker-toolbar            (Hide Non-Randomized Checks, Show Only Accessible Checks on phones, Export, Launch New Tracker)
main
 ├─ #tracker-map-warning        (only if the map could not be built)
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
footer#app-version              (the version, from data/version.json)
#back-to-top                    (phone layout only)
```

The order inside `#location-section` is the runtime one, not the source one:
`#region-sidebar` is the only child in `tracker.html`, and `locationPanelLayout.js`
inserts the summary row and the map ahead of it. On mobile the summary row is
moved out to `<main>` entirely, above the tab bar, so it stays visible on both
tabs.

- **Item tracker** (left): four grids of clickable item slots.
- **Location tracker** (right): on desktop, the Termina map with per-region
  markers + an overlay; on mobile, the accordion region list.

---


## 3. JavaScript files

All of these load on the tracker page except the last two. The settings page
loads `launch.js`, `dataLoader.js`, `tooltip.js`, `gameStateManager.js`,
`settingsState.js`, `itemGrids.js`, `mobileTabManager.js` and those two.

| File | Owns | Key globals / DOM |
|---|---|---|
| `launch.js` | **In `<head>`, on both pages.** Reads and writes the settings handed from the settings page to the tracker, in `sessionStorage`, and says whether storage works at all, by trying a write: a browser can read storage and still refuse to write it. On a page marked `data-requires-launch` (the tracker), goes to `index.html` before the body draws when nothing was handed over, unless the address has `?defaults` (§2, *Pages*). | `window.TrackerLaunch` |
| `dataLoader.js` | **The first script in the body**, so only `launch.js` runs before it. The only file that reads `data/`. Fetches `config.json`, `Items.json`, `manifest.json`, `settings.json` and every region file exactly once, then announces them with `trackerDataReady`. Its script tag on the settings page carries `data-skip-regions`, which leaves the region files out. Renders the two load-failure messages (§8). | `window.TrackerData`, `#tracker-load-error`, `#tracker-region-warning` |
| `logicParser.js` | Parses a logic string into a tree, evaluates that tree against an inventory, and annotates each node as satisfied / blocking / optional. No DOM, no data of its own. `locationTracker.js` evaluates through it and the requirements tooltip reads the same tree, so the two cannot disagree (§9). | `window.LogicParser` |
| `tooltip.js` | The tooltip: follows the pointer on hover, or docks to the bottom of the screen when pinned from a check's button on touch. Owns showing, hiding, positioning, the edge flip and pinning; owns nothing about what is in it. An owner calls `Tooltip.register(selector, build)` and gets called back with the hovered element (§14). | `window.Tooltip`, `.tracker-tooltip` |
| `requirementsView.js` | Turns an annotated logic tree into the *Items Required* bullet list. Presentation only. | `window.RequirementsView` |
| `gameStateManager.js` | `window.GameState` — the inventory source of truth. Computes derived values (hearts, counted up from the Health setting; boss-mask count, regular-mask count, bomber's-code validity, "has a bottle"). `slotKind(config, id)` names what kind of slot an id is — progression, capacity, counter, digit or toggle — from config alone, so it works before `init`. `init` takes the starting items, sets those slots and records each one's floor; `slotValue(id)` reads a slot's stage or count back out of `items`, and `slotRange(id)` gives the values clicking can move it through. Also builds the **F1 debug panel**, which lists the changed settings and the starting items as well, and creates `window.TrackerDebug` for the other files' console helpers. | `window.GameState`, `window.TrackerDebug`, `#tracker-debug-panel` |
| `settingsState.js` | `window.SettingsState` — the randomizer settings, read and validated out of `settings.json` (§7, *Settings*). Answers a setting's value with any lock applied (`get`, `isForced`), whether a clause matches (`matches`, `clauseProblem`), and what every grant adds up to (`startingItems`). `set` and `reset` change the picks and announce `settingsChanged`; `sections`, `describe`, `lockedBy` and `picks` are what the settings page reads. `slotSettings(slot)` says which setting controls a grid slot and which only fill it in, worked out from the grants, and `step(id, direction)` moves a controlling setting to its next choice along its slot. `numberOf(id)` is the number a dropdown's chosen option carries, for the right of `>=`, and `isNumeric(id)` says whether a dropdown carries numbers at all (§9); `list()` is every setting with its value, default and lock state, for the F1 panel. Applies the picks handed over through `launch.js` once the file is read (§2, *Pages*). No DOM. | `window.SettingsState` |
| `trackerToolbar.js` | The toolbar in the header, and its view toggles: Hide Non-Randomized Checks, and Show Only Accessible Checks in the phone layout. Each button names the class it puts on `<body>` and its `localStorage` key in data attributes; the choices read back through `TrackerView`, and a flip announces `trackerViewChanged` (§10b, *Hiding checks*). Loaded before the trackers, so their first sweep already knows the state. Launch New Tracker asks with `confirm()`, then goes back to the settings page (§2, *Pages*). Export is in its markup but disabled until it is wired up. | `window.TrackerView`, `#tracker-toolbar` |
| `itemGrids.js` | **On both pages.** Draws the item grids: one grid per key in `config.json`'s `grids` — the count and order come from config, nothing here — with every slot drawn from `GameState`, so a slot starts wherever the starting items put it. Hands back a view per slot for the page to add its own clicks to and redraw through `draw`. Validates every grid slot at load (§8), and registers the item tooltip: name, the song's `notes_image` where there is one, and any line a page puts in the slot's `data-tooltip-note`. | `window.ItemGrids`, one `.item-grid[data-grid="<key>"]` per grid |
| `itemTracker.js` | The tracker's grids: starts `GameState` from the starting items, has `itemGrids.js` draw the grids, and handles left-click (advance) / right-click (retreat) cycling between a slot's floor and its top, giving a locked slot no click handler. Pushes every change into `GameState`. | `.grid-container` |
| `locationTracker.js` | Builds every region's accordion (`.region-group` = header + `.region-content` of `.region-check-item`s) into `#region-dropdown-container`. Evaluates logic strings (`canAccess()`), sets `accessible` / `inaccessible` on checks and a rolled-up status class on each region header, and announces both. Also validates its regions at load: the logic tokens, the check ids, and each check's `vanilla_when` and `vanilla_item` (§8). Registers the requirements tooltip for its checks, and puts the sweep and `canAccess()` on `TrackerDebug`. Marks a region with nothing accessible, and keeps rows a tap hid shown until their region closes (*Hiding checks*). | `#region-dropdown-container` |
| `locationLegend.js` | The **Legend** box only: one row per entry in `config.json`'s `legend`, each swatch colored by the same status class the region headers and map markers use. Hands the box over on an event; where it sits is not its business. | `#location-legend-box` |
| `locationStatsTracker.js` | The **Location Progress** box only: computes checked / accessible / remaining, deduped via `config.json` `check_groups`. Creates its own box element, hands it off via an event. Re-counts when `locationTracker.js` says the checks changed. | `#location-stats-box` |
| `locationPanelLayout.js` | Where the summary row and map container sit in `#location-section`, and sizing the desktop map so `summary row + gap + map` matches the item grid's height. It owns `#location-summary-row`, which holds the stats box and the legend side by side. Nothing about tracking. | builds `#location-summary-row`, sizes `#location-map-container` |
| `locationMap.js` | Desktop map view: builds `#location-map-container` (image + marker layer), one marker per region JSON with `map_coordinates`, matched to the real `.region-group` by its `data-region-name`. Clicking a marker **moves** that node into a fixed overlay and back to its original position on close, and announces the close with `regionOverlayClosed`. Also fits the region's checks to the overlay (§12). | `#location-map-container`, `#location-map-marker-layer` |
| `mobileTabManager.js` | **On both pages.** `switchMobileTab()` toggles `.active-section` between the sections the tab buttons name in `data-section`: `#item-section` and `#location-section` on the tracker, `#settings-section` and `#starting-section` on the settings page. It does so at any width; CSS is what confines the tabs to the phone layout (§10). Announces a switch with `mobileTabChanged`. Also shows the back-to-top button once the page is scrolled half a screen, and remembers each tab's scroll position. | `.mobile-tabs`, `.tab-btn`, `#back-to-top` |
| `settingControls.js` | **Settings page only.** One control per setting class: a slider for `toggle` (an invisible checkbox over a drawn track), a select for `dropdown`, a number field clamped to `min`–`max` for `number`. `create(description, onChange)` returns `{ element, update(value, locked) }`. A new class is one `register` call here, alongside its value rules in `settingsState.js`. | `window.SettingControls` |
| `settingsPage.js` | **Settings page only.** Builds the settings panel from every list section in menu order, and the Starting Items half from the item grids section: the grids through `itemGrids.js`, each slot's clicks and tooltip line from `SettingsState.slotSettings`. The slot legend above the grids is markup in `index.html`. The section's other settings are one block, moved between the end of the settings panel on desktop and the space under the grids on a phone (§2, *The settings page*). On `settingsChanged` it redraws every control, count and lock note, and re-runs `GameState.init` to redraw the slots. Owns Reset to Defaults, which asks with `confirm()`, and Launch New Tracker, which hands `SettingsState.picks()` to `launch.js` and opens `tracker.html`, or, when they can't be stored, asks with `confirm()` and opens `tracker.html?defaults`. Warns on the page when storage is blocked at load or a launch couldn't store the picks. | `#settings-list`, `#starting-extras`, `#settings-storage-warning` |

---


## 4. The event bus

All events are `CustomEvent`s on `window`.

| Event | Dispatched by | Consumed by | Payload |
|---|---|---|---|
| `trackerDataReady` | `dataLoader.js`, once all of `data/` has loaded **and** `DOMContentLoaded` has fired | `settingsState.js` (first, so the settings exist before `GameState.init`), `itemGrids.js`, `itemTracker.js`, `locationTracker.js`, `locationStatsTracker.js`, `locationLegend.js`, `locationMap.js`; on the settings page, `settingsState.js`, `itemGrids.js` and `settingsPage.js` | `window.TrackerData` |
| `trackerStateUpdated` | `gameStateManager.js` → `broadcastChange()`, on every state change | `locationTracker.js` (re-evaluates all regions), F1 debug panel, `tooltip.js` (redraws an open tooltip) | `{ items, totalHearts, totalBossMasks, totalRegularMasks }` |
| `itemGridsReady` | `itemTracker.js`, after every grid renders, **and again** once the slot images have loaded, if any were still loading | `locationPanelLayout.js` (re-runs map sizing against the grid's real height) | — |
| `regionsRendered` | `locationTracker.js`, once every region accordion is in the DOM | `locationMap.js` (builds its region lookup) | — |
| `regionStatusChanged` | `locationTracker.js`, when a region's rolled-up status or its counts change | `locationMap.js` (recolors that marker, sets its count, updates an open overlay's titlebar) | `{ regionName, status, accessible, remaining }` |
| `trackerChecksUpdated` | `locationTracker.js`, at the end of every `evaluateAllRegions()` sweep | `locationStatsTracker.js` (recount), `tooltip.js` (redraws an open tooltip) | — |
| `locationStatsBoxReady` | `locationStatsTracker.js`, after it builds its box | `locationPanelLayout.js` (puts it in the summary row) | `{ box }` |
| `locationLegendReady` | `locationLegend.js`, after it builds its box. Never fires if `config.legend` is empty or has no usable entry | `locationPanelLayout.js` (puts it in the summary row) | `{ box }` |
| `locationMapReady` | `locationMap.js`, right after it builds the container (before markers are built) | `locationPanelLayout.js` (positions + sizes it) | `{ mapContainer, aspectRatio }` |
| `locationMapResized` | `locationPanelLayout.js` → `syncPanelHeight()`, after it writes a new map width/height | `locationMap.js` (re-fits an open overlay) | `{ mapContainer, width, height }` |
| `trackerViewChanged` | `trackerToolbar.js`, when either view toggle is flipped | `locationTracker.js` (lets rows kept shown by a tap go, and re-runs the sweep, so counts and colors follow), `locationMap.js` (re-fits an open overlay) | `{ hidesNonRandomized, showsOnlyAccessible }` |
| `mobileTabChanged` | `mobileTabManager.js`, when a tab button switches to another tab (on both pages) | `locationTracker.js` (lets rows kept shown by a tap go) | `{ tab }` |
| `regionOverlayClosed` | `locationMap.js` → `closeOverlay()`, once the region is back in the list | `locationTracker.js` (lets that region's kept rows go) | `{ regionName }` |
| `settingsChanged` | `settingsState.js`, on every `set` and on `reset` (a slot click on the settings page is a `set` too) | `settingsPage.js` (redraws every control, count, lock note and grid slot, since one pick can lock or unlock others) | `{ id, value }`, or `{ reset: true }` |

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
they run **in `tracker.html` script order**, which makes the sequence
deterministic. Before any of it, `launch.js` in `<head>` has either sent the page
to the settings page (§2, *Pages*) or let it load:

1. `dataLoader.js` — fetches `config.json`, `Items.json`, `manifest.json` and
   `settings.json`, then every region file the manifest lists.
2. `logicParser.js`, `tooltip.js`, `requirementsView.js` — define their globals
   (`tooltip.js` also binds its `document` listeners). None of them waits for
   data; the trackers call them.
3. `gameStateManager.js` — creates `window.TrackerDebug` and builds the (empty)
   F1 panel at parse time; needs no data of its own (`itemTracker` hands it
   config).
4. `settingsState.js` — defines `window.SettingsState` at parse time.
5. `trackerToolbar.js` — defines `window.TrackerView` and applies both saved view
   toggles at parse time, so every sweep below already counts and hides the right
   checks. It needs no data.
6. *(`trackerDataReady` fires here)*
7. `settingsState.js` — reads and validates `settings.json`, then applies the
   picks handed over from the settings page. It is first in line
   on purpose: nothing may ask for a setting before this, and `GameState.init`
   asks for the Health setting to count the starting hearts.
8. `itemGrids.js` then `itemTracker.js` — the first registers the item tooltip.
   The second validates the grid slots, calls `GameState.init(items, config,
   startingItems)` with `SettingsState.startingItems()` (populates `items`, sets
   each starting slot and its floor, dispatches the first `trackerStateUpdated`),
   has `itemGrids.js` render one grid per `config.grids` key with every slot drawn
   from `GameState`, adds its clicks, and dispatches `itemGridsReady`.
9. `locationTracker.js` — registers the check tooltip, renders all accordions
   from `TrackerData.regions`, dispatches `regionsRendered`, validates the logic
   tokens against the fully populated `GameState.items`, the check ids against
   each other, and each check's `vanilla_when` and `vanilla_item`, then runs one
   `evaluateAllRegions()` sweep against the
   real inventory. Everything from `regionsRendered` down is in a `finally`, so a
   region file that breaks still leaves the rest of the page told about the ones
   that rendered (§8).
10. `locationStatsTracker.js` — builds its box, counts (the checks already exist),
    dispatches `locationStatsBoxReady`, starts listening for
    `trackerChecksUpdated`. (It has no observer — see §4.)
11. `locationLegend.js` — builds its box from `config.legend` and dispatches
    `locationLegendReady`, or does neither when no entry is usable.
12. `locationMap.js` — builds the container, dispatches `locationMapReady`, then
    builds markers from `TrackerData.regions`.

Until step 6 has run, `<main>` is hidden: both pages start it with
`awaiting-data`, and `dataLoader.js` takes the class off once every
`trackerDataReady` listener has drawn, or before it writes the load-failure
message. A refresh then shows the page whole rather than empty boxes filling in.
It is `visibility`, not `display`, so the layout code can still measure while it
is hidden, and a CSS animation shows the page after a few seconds if the scripts
never run at all.

`locationPanelLayout.js` sits outside this — it has no data dependency and just
reacts to `locationStatsBoxReady` / `locationLegendReady` / `locationMapReady` /
`itemGridsReady`, plus `window.load`, `resize`, and a `ResizeObserver` on
`.grid-container` and the summary row. It still re-runs its sizing on every one
of those because the item grid's *rendered height* settles independently of when
the data arrives — see §11.

The settings page runs a shorter version of the same: `launch.js`, then
`dataLoader.js` with no region files, `tooltip.js`, `gameStateManager.js` (for
`slotKind`, which reading the grants needs, and to show the starting state),
`settingsState.js`, `settingControls.js`, `itemGrids.js`, `settingsPage.js`, which
builds the page in its `onReady` once the settings and the handed-over picks are
in, and `mobileTabManager.js` for the tabs.

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
  why `Tooltip.register` sits in an `onReady` in `itemGrids.js` and
  `locationTracker.js`. Made at the top
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
| `config.json` | `grids` (slot layout per grid — **each key becomes a rendered grid**), `progressions` (multi-stage items), `item_counts` (numeric or staged counters), `item_groups` (boss masks, bottles), `heart_rules` (`starting_hearts_setting` names the setting the starting hearts come from), `logic_token_names` (display names for the derived tokens that have no `Items.json` entry — `hearts`, `bottle` and friends), `legend` (the status swatches and their labels, in display order), `bombers_code`, `map` (image path + real pixel size), `map_overlay.text_sizes` (§12), `check_groups` (checks that grant the player the same exact item despite existing in multiple locations). | `TrackerData.config` | `itemTracker.js` and `settingsPage.js` (handing it to `itemGrids.js`), `gameStateManager.js` (via `init`), `settingsState.js`, `locationTracker.js`, `locationStatsTracker.js`, `locationLegend.js`, `locationMap.js` |
| `Items.json` | Array of `{ id, name, image, notes_image?, regular_mask? }`. `name` drives tooltips; `notes_image` is the song's button sequence, shown in the item tooltip (§14); `regular_mask: true` marks an item as counting toward `total_masks` (§9). | `TrackerData.items` | `itemTracker.js` and `settingsPage.js` (handing it to `itemGrids.js`), `gameStateManager.js` (via `init`), `locationTracker.js` (names in the requirements tooltip) |
| `settings.json` | `always_grants`, `starting_max`, and `sections[]` → `groups[]` → `settings[]` in the randomizer's own menu order. See *Settings* below. | `TrackerData.settings` | `settingsState.js` |
| `<Region>.json` | `region_name`, `logic` (region entry requirement), `map_coordinates: { xPercent, yPercent }`, `item_checks: [{ id, name, logic, vanilla_when?, vanilla_item? }]`, where `vanilla_when` is the clause under which the check is not randomized (see *Settings*) and `vanilla_item` is what it holds then: an `Items.json` id, shown by the tracker's name for it, or plain text for an item the tracker doesn't track (§14). **`region_name` must be present and unique** — see §8. | `TrackerData.regions` (manifest order, unreadable files dropped; empty on the settings page) | `locationTracker.js` (accordion + logic), `locationMap.js` (marker position) |
| `version.json` | `{ "version": "x.y.z" }`, written by `scripts/release.py` rather than by hand (README.md, *Releasing*). Fetched apart from the core files, so a report that they failed to load still carries the version. | `TrackerData.version` (null until it arrives, and if it cannot be read) | `dataLoader.js` (the `#app-version` footer and the load-error report) |

Map marker positions live per-region in `map_coordinates`.

### Settings

`settings.json` describes the randomizer's settings: what each one can be set
to, what each choice starts you with on the tracker, and what other data can ask
about them. `settingsState.js` reads it and answers for it.

**A setting** is `{ id, name, class, default }`, listed in the order the
randomizer's own menu shows it. `class` decides what a value can be:

| Class | Value | Other fields |
|---|---|---|
| `toggle` | `true` or `false` | `grants`, applied while it is on |
| `dropdown` | one of its option ids | `options: [{ id, name, value?, grants? }]`, where `value` is an optional number carried by the option, which lets a logic string count to the setting (§9) |
| `number` | a whole number from `min` to `max` | `min`, `max`, `grants` |

**Sections and groups** only lay out the settings page. The one section marked
`"view": "item_grids"` (Starting Inventory) is drawn as the tracker's item grids:
its settings show through the slots they grant, and the rest are listed at the end
of the settings panel on desktop and under the grids on a phone. Every other
section is listed in the settings panel. A group's optional
`name` heads its settings.

**`grants`** say what a grid slot starts at: a progression's stage id, a capacity
from its list, a count, a bomber's code digit, or `true` for a plain item. On a
`number` setting, a grant of `"value"` hands on the number picked. `always_grants`
apply to every tracker whatever the settings, which is how the base Wallet is
always owned. When several grants land on one slot, counters add up to their
maximum, progressions and capacities keep the highest stage, digits the highest
number, and a plain item is on if anything grants it. `starting_max` then caps a
counter's starting value however it was reached. The merged result is
`SettingsState.startingItems()`.

On the tracker the starting state is also a floor. A slot starts at what it was
granted, and clicking never takes it lower: a progression, capacity or counter
cycles from its floor to its top and wraps back to the floor. A slot whose floor
is already its top has nothing to cycle and is locked. So is a granted bomber's
code digit, whatever its value, because a code is fixed rather than something to
count up from. `GameState.slotRange()` is where those rules live.

The starting hearts are deliberately not a grant. The randomizer adds them on top
of every heart piece and container still in the seed, so as a grant they would
push those counters past their maximums. `heart_rules.starting_hearts_setting` in
`config.json` names the number setting they come from instead.

**`forced`** is a list of `{ when, value }` locks. While `when` matches, the
setting reads as `value` whatever was picked, and the pick comes back once the
lock lifts. A `when` may not name a setting that has a lock of its own: locks
that depend on other locks would give different answers depending on which one
was read first.

**Clauses** are how data asks about settings. A lock's `when` is one, and so is a
region check's `vanilla_when`: while it matches, the check is not randomized. A
check with no `vanilla_when` is always randomized.

- `true` always matches.
- An object matches when every setting it names has the value given, or any of
  the values in a list: `{ "shuffle_songs": ["song_locations", "anywhere"], "shuffle_song_of_time": false }`.
- A list of objects matches when any one of them does.

Anything malformed never matches. `SettingsState.clauseProblem()` says what is
wrong with one, and the validators use it.

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
- **The setting classes.** `toggle`, `dropdown` and `number` are defined in
  `settingsState.js`, with their controls in `settingControls.js`, so a new kind
  of setting means code in both, not just JSON.

Everything else — the grids, the items, the regions, the checks, the logic
strings, the map image itself — is JSON.

---


## 8. When the data is wrong

Every one of these is a data-authoring mistake that would otherwise fail
silently, or loudly in the wrong place. The rule they share: **say what is wrong,
once, at load, and keep the rest of the app up.**

| Check | Where | On failure |
|---|---|---|
| A core file (`config.json`, `Items.json`, `manifest.json`, `settings.json`) cannot be read | `dataLoader.js` | Nothing can render, so `<main>`'s contents are replaced with `#tracker-load-error` — the cause, the version and the page URL, in a selectable block meant to be pasted into a bug report. |
| `version.json` cannot be read, or has no `x.y.z` version | `dataLoader.js` | One warning. The footer stays empty and a load-error report says `version: unknown`; nothing else reads it. |
| A region file cannot be read | `dataLoader.js` | That region is dropped and the rest load. Names of the dropped files land on `TrackerData.failedRegions` and in a `#tracker-region-warning` banner above the tracker. |
| A grid slot names an item that is not in `Items.json` | `itemGrids.js` → `validate()` | One warning naming grid, index, and for a progression the stage number. The slot draws as an `.empty-slot` so the six-column alignment holds and the other grids still render. |
| A logic string uses a token that matches nothing in the item state, or a name after `>=` that is not a dropdown setting carrying values | `locationTracker.js` → `validateLogicTokens()` | One warning per kind, naming each name and every check using it, plus the right stage id for a progression slot, or a note that a setting only goes after `>=`. The check resolves to `false`. |
| `region_name` is missing or duplicated | `locationTracker.js` | The region is not rendered and is named in a warning, and `locationMap.js` gives it no marker. A duplicate is the nastier case: both copies resolve to the one accordion that rendered, so the second marker would sit at its own coordinates and open the other region's checks. |
| `item_checks` is missing, or is not a list | `locationTracker.js` | The region is skipped and named in the same warning as a bad `region_name`. An empty list is *not* an error — a region whose checks are not written yet renders as an empty accordion. |
| A region file is readable, but something inside it throws while rendering | `locationTracker.js` | That one region is skipped and named, with the thrown message; every other region still renders. The render call sits in its own try/catch inside the loop for exactly this. |
| Two checks share an `id`, or a check has no `id` | `locationTracker.js` → `validateCheckIds()` | One warning naming the id and the regions using it. Nothing is skipped — a repeat is *legal*, it is how `check_groups` works, so the tracker cannot tell a typo from a group. The symptom is a check ticking itself off somewhere else and the progress total quietly shrinking. |
| A region has no `map_coordinates` | `locationMap.js` → `validateMarkerCoordinates()` | One warning naming the region. It still renders its accordion and still counts, but it gets no marker — and on desktop the accordion list is `display: none`, so its checks are unreachable from anywhere. |
| `config.map` is missing or unusable, or building the map throws | `locationMap.js` | One error, and a `#tracker-map-warning` banner above the tracker saying the desktop location view is missing. No map is built; the item tracker and the phone layout's region list still work. |
| The map image's real size differs from `config.map`'s | `locationMap.js` | One warning once the image loads. The map still draws, but every marker drifts off its spot until `config.json` is corrected. |
| Nothing is tagged `regular_mask` | `gameStateManager.js` | Warns that `total_masks` will be 0 forever. |
| A slot appears in both `progressions` and `item_counts` | `gameStateManager.js` | Warns; the click handler would silently do nothing. |
| The starting items give a slot a value it can't start at | `gameStateManager.js` → `init` | One warning naming the slot. It starts empty. |
| An entry in `settings.json` is malformed: a missing or repeated id, an unknown `class`, a default that is not one of its values, a grant on something that is not a grid slot or with a value that slot cannot take, a lock whose `when` is malformed or names another locked setting, a `starting_max` on anything but a counter, a dropdown that gives some options a `value` but not others | `settingsState.js` | One warning per problem, naming the entry and what is ignored because of it. A bad setting is left out, a bad option, grant or lock is ignored, and every other setting still loads. |
| A section's `view` is neither `list` nor `item_grids`, or a second section is `item_grids` | `settingsState.js` | One warning. That section is listed in the settings panel. |
| A setting's `class` has no control in `settingControls.js` | `settingsPage.js` | One warning naming the setting. Its row is left out of the settings page; the setting still has its default. |
| Two settings each grant only the same grid slot | `settingsState.js` | One warning. The first in `settings.json` steps through that slot on the settings page; the other still works from its row. |
| `heart_rules.starting_hearts_setting` names no `number` setting | `settingsState.js` | Warns. Hearts start from 0, so every check gated on hearts stays out of reach until it is fixed — loud on purpose, where a silent fallback would look right on the defaults. |
| The settings handed over from the settings page can't be read | `launch.js` | One warning. Every setting keeps its default. |
| A handed-over pick names no setting, or a value its setting can't take — the data changed since it was picked, or the storage was edited | `settingsState.js` | One warning per pick, in the same report as the problems in `settings.json`. That setting keeps its default and the rest still apply. |
| A check's `vanilla_when` is malformed or names an unknown setting or value | `locationTracker.js` → `validateVanillaClauses()` | One warning per check. The clause never matches, so the check shows as randomized. |
| A check's `vanilla_item` is not text, is written like an id (lowercase and underscores) but matches no item, or sits on a check with no `vanilla_when` | `locationTracker.js` → `validateVanillaItems()` | One warning per check. The tooltip leaves the "Vanilla:" line out; plain text is always accepted, since most vanilla contents are not tracked items. |
| Checks that are one location — a `check_group`, or a repeated id — have different `vanilla_when` or different `vanilla_item` | `locationTracker.js` → `validateVanillaAgreement()` | One warning per set, for each field that disagrees. Both are compared as written, not by what they match right now, so the disagreement shows under any settings. |
| A `legend` entry is missing its `status` or `label`, or names a status `style.css` pairs no color with | `locationLegend.js` | One warning naming the entry, which is not drawn. The check asks CSS rather than a list, so status names still live only in `style.css`. |

Three rules worth keeping if you add more:

- **A diagnostic must never be the thing that breaks the page.** `ItemGrids.validate()`
  runs before `GameState.init()`, so anything it throws also leaves the item state
  empty — which then makes `validateLogicTokens()` report every token in every
  region as unknown. It is called inside its own try/catch for that reason, and so
  is every validator after it.
- **Show a validator only what rendered.** Every validator in `locationTracker.js`
  is handed the regions that made it onto the page, not
  `TrackerData.regions`. Both directions matter. A rejected region is not on screen,
  so nothing said about it can come true, and it has already been named once — a
  region dropped for a duplicate `region_name` is a near-copy of one that rendered,
  so the full list would report every check inside it as a duplicate id. And it is
  precisely the malformed regions that make a validator throw, so handing one the
  full list means a single bad file costs you the diagnosis of every other file too.
- **Degrade to a hole, not to a halt.** A bad slot draws empty, a bad region is
  skipped, a bad region file is dropped, a region that throws costs only itself.
  `regionsRendered`, every validator and the first `evaluateAllRegions()` sweep are
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

- `&` = and, `|` = or, `()` = group up checks, `>=` = check if the count is greater than or equal to a number, or to the number a setting carries (`boss_masks>=moon_remains_required`).
- Bare tokens are item ids, looked up in `GameState.items` (boolean or number).
- Special tokens resolved to numbers: `hearts`, `boss_masks`, `total_masks`.
- Empty string = always accessible.

`total_masks` counts the **20** masks tagged `regular_mask: true` in `Items.json`
— every mask except the four transformation masks. That is not an off-by-four
bug: the checks it gates are the moon children (the Moon trials, and the Fierce
Deity's Mask reward), and the four transformation masks cannot be given away.

The tag lives on the item rather than being derived from `config.grids.mask`,
which is a layout list: it says what the mask panel draws and in what order, so
moving a mask to another panel — or putting anything that is not a mask into that
one — would change the count silently.

`canAccess()` hands the string to `LogicParser`, which tokenizes it, builds a
tree, and walks that tree. `|` binds loosest, then `&`, then the comparison.
Parsed trees are cached by string, since every sweep re-evaluates every check.

**The grammar is deliberately smaller than an expression language.** There is no
negation and no operator but `>=`, because the tracker is additive: you only ever
gain items, so "not X" and "at most X" cannot describe a real requirement — they
can only encode a mistake. A comparison must be written `item >= count`, with a
bare item on the left and a bare number or setting on the right; a group on either
side, or the operands the other way round, is a parse error naming the offender
rather than a rule that quietly evaluates to something surprising. A number is
legal only after `>=`: on its own, `bomb | 0` would be a requirement no inventory
ever changes.

**A setting after `>=` is a count the seed picks.** Moon Requirements and Majora
Requirements are dropdowns whose options each carry a `value`, so
`boss_masks>=majora_remains_required` asks for as many remains as the picked
option says. The name after `>=` is always looked up as a setting, through
`SettingsState.numberOf()`, and every other name as an item, so the two can never
be mistaken for each other. Only a dropdown whose options carry `value` has a
number; against anything else the comparison is unmet. What you have always goes
on the left, which is why a `number` setting such as Health is never needed
there.

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

It walks the parsed tree rather than the text, because only the tree knows which
side of `>=` a name is on. A setting used as an item is named with a note that
settings only go after `>=`, and a name after `>=` that is not a dropdown carrying
values is named too. A string that fails to parse is skipped there, since the
parser has already named it.

---


# Layout

## 10. Desktop vs mobile — the 1500px split

The number lives in `css/style.css` as `--mobile-breakpoint`. The JS files that
need it — `locationPanelLayout.js`, `locationMap.js` and `settingsPage.js` — read
it from there rather than repeating it, so JS can never disagree with CSS about
where mobile starts — that disagreement hides the region list *and* leaves the
map sizing itself against a `display: none` element. `@media` cannot read a
custom property, so every media query still spells the number out. Changing
the breakpoint means changing each of those, the property itself, and the
last-resort fallback literal each of those three files carries for the case where
the stylesheet fails to load — a stale fallback is invisible until exactly that
happens.

Every query asks the same question: is this the phone layout? The phone side is
`max-width: 1499px`, and a desktop-only block is `not all and (max-width: 1499px)`
rather than `min-width: 1500px`. With display scaling or browser zoom a window's
width can fall between 1499 and 1500, where neither of those two numbers claims
it; asked as "not the phone layout", every width is exactly one layout or the
other.

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
  (`.region-content` loses `open`, the header loses `expanded`) or it shows up wrongly
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
of how many are not yet ticked off. A non-randomized check that is shown counts
like any other: it is still somewhere to go. Hidden, it counts for nothing (see
*Hiding checks* below). The same pair shows in the map overlay's titlebar,
because the moved-in region's own header is hidden in there, and a yellow, green
or purple marker carries the accessible number on its own — red and gray would
only ever show a zero.

A non-randomized check still runs through logic, so it is red until you can
reach it and purple once you can. A region is yellow when it has something red
alongside anything reachable, green when anything reachable left in it is
randomized, and purple only when everything reachable left in it is
non-randomized.

`locationTracker.js` records the pair on the header as display text in
`data-counts`, and the accessible count as a number in `data-accessible`, beside
`data-status`. `locationMap.js` reads those back rather than counting again, so a
marker cannot disagree with the header above it: the titlebar copies
`data-counts`, and a marker shows a number exactly when `data-accessible` is
above zero. That is the yellow, green and purple markers by construction, so neither
`locationMap.js` nor its CSS names a status to decide it — the larger
counted-marker size keys off a `has-count` class, and a two-digit count off a
`wide-count` class (see *Markers* below).

**Status is a color and a shape, paired once** in `style.css`. Each status class
sets `--status-color` and `--status-shape`, plus `--status-outline` where a shape
needs a wider marker outline and `--status-wide-count` where it needs a smaller
two-digit count (see *Markers* below); region headers, check rows,
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

### Hiding checks

Two toolbar toggles take checks out of view. `trackerToolbar.js` holds each as a
class on `<body>`, read back through `TrackerView.hidesNonRandomized()` and
`TrackerView.showsOnlyAccessible()`, and flipping either fires
`trackerViewChanged`. Both are preferences rather than part of a run, so each is
kept in `localStorage` and carries over to every tracker. Storage that throws — a
private window, a browser blocking site data — just starts with everything shown.

**Hide Non-Randomized Checks** takes those checks out of the tracker as if the
regions did not have them, and everything that counts reads it at the moment it
counts:

- CSS hides the rows, and the legend's *Not Randomized* row, off one class on
  `<body>`. The rule sits beside the status pairing in `style.css`, the one place
  status names live.
- `determineRegionLocationAccessibility()` skips them, so a region's counts, color
  and marker all move together. A region with nothing but non-randomized checks
  reads `(0/0)` and gray, the same as one with nothing left.
- `locationStatsTracker.js` skips them in all three numbers, checked ones
  included, so *Checked* only counts what is still shown.

When it flips, `locationTracker.js` runs the sweep again, which carries the new
counts to the markers, the overlay titlebar and the stats box through the events
they already listen to; `locationMap.js` re-fits an open overlay, whose region
just gained or lost rows; and `tooltip.js`, redrawing on the click itself, closes
a panel whose check was hidden under it.

**Show Only Accessible Checks** belongs to the phone layout. Its button and its
CSS both sit under the mobile breakpoint, so the desktop map shows every region,
and a window widened past the breakpoint shows everything again. It only hides:
every count stays what Hide Non-Randomized Checks alone makes it.

- CSS hides inaccessible and completed checks, the legend's *Inaccessible* and
  *Checked* rows, and every region marked `nothing-accessible`, a class
  `determineRegionLocationAccessibility()` sets when the region's accessible
  count — the one its header shows — is 0.
- **A tap never hides what it just changed.** Completing a check in an open
  region marks the check and its region `keep-shown`, which the hiding rules skip,
  and so does every other row that is the same location in a region that is open
  too. That way a mistaken tap can be undone where it happened and the list doesn't
  jump under the finger. Marks are only made in the phone layout: the desktop
  overlay holds its region open, so a mark made there would never be let go. `locationTracker.js` lets the marks go when that region's
  header is clicked, on `mobileTabChanged`, on `trackerViewChanged`, so flipping
  a toggle applies at once, and on `regionOverlayClosed`, because the map overlay
  closes a region without its header. A header click lets them go on opening as
  well as closing, so a region always opens with nothing held over.
- An item change can put the check a pinned panel describes out of reach, and so
  out of view. `tooltip.js` closes a panel whose target is no longer drawn
  whenever it would otherwise redraw.

### Markers

The shape is drawn by the marker's pseudo-elements — an outline behind, the
status color inset in front — rather than by the button, because `clip-path`
clips text along with paint and a count on the button would be cut off where the
shape tapers. A slanted edge shows less outline than a straight one from the same
inset, so the slanted shapes get a wider one. That width is part of the status
pairing in `style.css` (`--status-outline`) rather than keyed off a status name in
the map CSS, so it follows the shape if a status is ever given a different one. A
two-digit count has the same problem: on a shape that tapers it has less room than
the marker's width suggests, so those pairings also set a smaller
`--status-wide-count`, and a shape without one keeps the full count size.

Keeping the count centered on the marker is a stack of rendering traps; each is
explained beside the rule it protects in `locationMap.css`.

The count is dark with a light halo, which reads on every fill that carries one.
That is why the purple is a light one: a dark purple would need a light count of
its own, and as header text it would be hard to read on the dark header.

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

`scheduleHeightSync()` here, `scheduleUpdate()` in `locationStatsTracker.js` and
`scheduleRefit()` in `locationMap.js` all pair `requestAnimationFrame` with a
`setTimeout`. One rule explains all three:
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

**It re-fits on three triggers.** Column count and text size both come off a
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
- `trackerViewChanged`, because hiding non-randomized checks changes how many rows
  the open region has to fit.

Scroll is deliberately not a trigger — see the note on document coordinates above.
The rAF/timeout scheduling guard collapses triggers that coincide into a single
refit.

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
Here `.grid-container`'s tracks are sized from the container, not from the grids,
so a `content-box` `width: 100%` paints wider than its track once padding and
border are added, and the page scrolls sideways on a phone. Desktop only looks like the same situation: its
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
`notes_image`. The settings page leaves the notes out, since nothing there asks
you to play a song. Hovering a location check shows what it needs, colored by
whether you have it.

Both come from one element. `tooltip.js` owns showing, hiding, following the
pointer and flipping at the viewport edge; it knows nothing about items or logic.
An owner registers a selector and a builder:

```js
window.TrackerData.onReady(() => {
    window.Tooltip.register(".item-slot", (element, { pinned }) => nodeOrNull);
});
```

The builder is called with the hovered element and returns what to show, so
`itemGrids.js` keeps the item knowledge and `locationTracker.js` keeps the
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

**The hover tooltip is `width: max-content`.** Left to shrink-to-fit, a fixed box
takes its width from the room between its current `left` and the window's edge.
The edge flip measures the box before moving it, so a tooltip last placed near the
right edge measures narrow, lands somewhere else, and changes size as the pointer
moves. `max-width` still wraps the long ones, and the pinned panel sets its width
back to `auto` to stretch across the screen.

**A builder that throws closes the tooltip** and is named once in the console.
Left to escape, the throw would land after `pin()` had already docked the panel
and hidden back-to-top, with nothing drawn and nothing to close it.

**The pinned panel is fixed, so scrolling does not strand it** — and dismissing
on scroll is therefore wrong for it, though it stays right for the hover path.

**Clearing the home bar depends on `viewport-fit=cover`.** The panel's offsets
add `env(safe-area-inset-*)`, and on iPhone those only read non-zero because
each page asks for `viewport-fit=cover`. Without it they are 0, and the panel
docks behind the home bar and under the screen's rounded corners. The same
setting lets the rest of the page run under the notch and home bar, which is why
`body` pads all four sides by the insets and the sticky mobile tabs pad their
top.

**The notes image must not be `.item-image`.** `itemTracker.js` counts those to
decide when the grids have stopped growing, and `locationPanelLayout.js` sizes
the map off that (§11). A tooltip image joining the count stalls the
re-announce and leaves the map sized against a half-height grid.

**It redraws in place on `trackerStateUpdated`, `trackerChecksUpdated` and any
click or right-click.** What is under a stationary pointer changes without the pointer moving —
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

A `>=` renders as a count, `Ocean Skulltula Tokens 12/30`, since what you already
have is the part being asked about. Against a setting the target is that
setting's current number, `Boss Masks 2/4`, or `?` when it has none.

A non-randomized check also says what it holds, in a `Vanilla: Heart Piece` line
above the requirements — under the check's name when pinned, over *Items
Required* on hover. It comes from the check's `vanilla_item`, worked out once when
the row renders: an `Items.json` id reads as the tracker's name for it, and
anything else is shown as written. A randomized check has no such line, since what
it holds is unknown. The line is text only; item images are too small to read at
tooltip size, and most vanilla contents have none.

Counts of the same item among the bullets merge into one showing the highest
target, which is the one the check actually needs. The Moon's entry asks for
`moon_remains_required` and Majora's own logic for `majora_remains_required`, and
Majora shows a single `Boss Masks` line rather than two. Only bullets merge:
inside an `|` the counts are alternatives, and they stay as written.
