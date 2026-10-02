# Randomizer Tracker — Architecture

A browser-based item/location tracker for randomizer runs. Which game it tracks is
its `data/`.
Vanilla JS, no build step, no framework, no package manager, no modules. (The
tests have a `package.json` of their own; nothing the page loads reads it. See
README.md, *Testing*.)

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
   `SettingControls`, `ItemGrids`, `StorageKeys`, `PhoneLayout`.

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
   logically owns it (a region's own file, a file in `config/`, `Items.json`). This is
   a hard rule.

---


## 2. Pages and runtime layout

### Pages

The app is two pages. `index.html` is the settings page, the one a visitor lands
on: pick the seed's settings, then Launch New Tracker opens `tracker.html`, which
runs with them. The tracker's Back to Settings goes back without asking while the
tab autosaves the run: leaving saves it, and Load From Autosave brings it back. A
tab that isn't autosaving asks first (*Saving*, *The autosave*).

The settings cross over in `sessionStorage`, under the tracker's `launch` key
(*Storage keys*, below), as
`{ picks }`: every setting that differs from its default. `trackerLaunch.js` reads and
writes it on both pages and `settingsState.js` applies it at load, so the settings
page opens on the last tracker's settings and a reloaded tracker keeps its own.
Session storage belongs to one tab, so two tabs can run two trackers with
different settings. Picks cross over rather than locked values, and the tracker
works the locks out again for itself. The handoff also carries the run's id,
which its autosave is filed under, and a tracker opened from a save gets the rest
of it the same way, as `{ picks, runId, save, stamp }`: the save's item slots,
completed checks and view toggles as plain named values, and which stored copy of
the run is this tab's (*Saving*). The tracker rewrites the handoff every time it
autosaves, its own picks included, so a reload opens where the run is. Its own
picks, because a tracker page the browser brings back with Back can find the
handoff of a later launch in the same tab.

Opened with nothing handed over — a bookmark, a fresh tab — `tracker.html` goes to
the settings page before its body draws: it marks `<html>` with
`data-requires-launch`, and `trackerLaunch.js` runs in `<head>`. The one exception is
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
 ├─ .mobile-tabs                (phone layout only: the Settings / Starting Items switch)
 ├─ #header-menu-button         (phone layout only: opens the toolbar as a menu)
 ├─ #tracker-toolbar            (Reset to Defaults, Load From Autosave, Load From File, Resume Tracker, Launch New Tracker)
 └─ #header-keep-out            (phone layout only: Resume Tracker, kept out of the menu)
main
 ├─ #home-screen-tip            (iPhone and iPad only, any browser, until closed)
 ├─ #save-load-message          (only after loading a save, or failing to)
 ├─ #settings-storage-warning   (only if the browser blocks storage)
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
the grids leave; below the breakpoint the header's switch shows one at a time,
through the same `mobileTabManager.js` as the tracker's (§13). Edits apply as they are made. A setting
picked away from its default is marked with a dot and counted in its section's
heading; a value a lock forces is not a pick, so it adds neither. A locked
setting's control is disabled, with a note naming the picks that lock it.

The Starting Items half is the tracker's own grids, showing the state the tracker
will open with: every change re-runs `GameState.init` with
`SettingsState.startingItems()` and redraws the slots. Which setting a slot
answers to comes from the grants, not from a list (`SettingsState.slotSettings`):

- **A setting that grants one slot and nothing else controls it.** Clicking the
  slot steps through that setting's choices in the slot's own order, from the one
  that grants nothing up the slot's stages, and right-clicking steps back. When
  several choices look alike in the slot, the slot shows the chosen one's name. The
  slot and the setting's row are one value, so they always change together.
  (In Majora's Mask, the sword slot steps through no sword, Kokiri, Razor and
  Gilded, and the stick capacities are the choices that look alike.)
- **A slot granted only by settings that grant other slots too, or by a number,
  is filled in but not clicked.** Its tooltip names what sets it. (In Majora's
  Mask: maps and keys, bottle contents, the Bomber's code, and the token and stray
  fairy counts.)
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

**Loading a save** (`loadSave.js`). Load From Autosave is enabled while there is
an autosave or a previous run; with a previous run it opens a chooser showing each
one's date, progress and version, and otherwise loads the autosave straight away.
A loaded save's settings fill in and are held by `SettingsState`: their controls
are disabled and slot clicks do nothing, and Resume Tracker appears beside Launch
New Tracker. A setting the save didn't hold takes its default and stays editable,
highlighted as not in this save, row or slot alike. A message above the settings
says what was loaded, and for a save updated from an older version, which settings
took defaults. A save that can't be read is refused with the reason, and nothing
is held.

With a save loaded, Reset to Defaults lets go of it and resets everything, and
Launch New Tracker lets go of it but keeps its settings, unlocked, so a new run can
start on them; pressing Launch New Tracker again starts it. Launching a new run
moves the autosave into the previous-run slot first, and says so.

Load From File takes a file exported from the tracker, or a code pasted into its
box, through the same loading as the autosave. A loaded file always starts a run
of its own here, so resuming it moves the autosave into the previous-run slot
rather than writing over it, whichever run the file came from. A file that was
updated on loading also asks to be exported again once resumed, since the file
itself still holds the old version. The page loads no region files (§5).

### The tracker page: two trackers side by side

```
header
 ├─ logo
 ├─ .mobile-tabs                (phone layout only: the Items / Locations switch)
 ├─ #header-menu-button         (phone layout only: opens the toolbar as a menu)
 ├─ #tracker-toolbar            (Hide Non-Randomized Checks, Show Only Accessible Checks on phones, Export, Back to Settings)
 └─ #location-status-line       (phone layout only: accessible, checked and remaining)
main
 ├─ #home-screen-tip            (iPhone and iPad only, any browser, until closed)
 ├─ #autosave-warning           (only if this tab isn't autosaving: another tab, or storage refused)
 ├─ #tracker-save-warning       (only if saveLayout.json failed to load)
 ├─ #tracker-map-warning        (only if the map could not be built)
 ├─ #tracker-logic-warning      (only if locationFlags.json or logicHelpers.json failed to load)
 ├─ #tracker-region-warning     (only if a region file failed to load)
 └─ .tracker-layout-wrapper
     ├─ #item-section  > .grid-container > one .item-grid[data-grid] per config.grids key
     └─ #location-section
         ├─ #location-map-container    (built by locationMap.js)
         └─ #region-sidebar > #region-dropdown-container   (region list)
footer#app-version              (the version, from data/version.json)
#back-to-top                    (phone layout only)
```

The order inside `#location-section` is the runtime one, not the source one:
`#region-sidebar` is the only child in `tracker.html`, and `locationPanelLayout.js`
inserts the map ahead of it. The same file places `#location-summary-row` (the
progress numbers from `locationStatsTracker.js` and the legend from
`locationLegend.js`): in `header`, under the toolbar and lined up with the map, on
desktop (§10b). In the phone layout the
row is hidden: its numbers are the header's status line, and the legend moves into
the header's menu (§13).

- **Item tracker** (left): four grids of clickable item slots.
- **Location tracker** (right): on desktop, the game's map with per-region
  markers + an overlay; on mobile, the accordion region list.

---


## 3. JavaScript files

Both pages load `storageKeys.js`, `phoneLayout.js` and `trackerLaunch.js` in
`<head>`, in that order. The settings page then loads `dataLoader.js`, `tooltip.js`,
`gameStateManager.js`, `settingsState.js`, `itemGrids.js`, `saveCodec.js`,
`saveStore.js`, `offline.js`, `mobileTabManager.js`, `headerMenu.js`, and three of its own: `settingControls.js`,
`settingsPage.js` and `loadSave.js`. The tracker page loads everything else, and
those it shares. `offlineWorker.js`, the service worker, sits at the site's root rather than
in `js/`, and runs apart from both pages (*Offline*).

| File | Owns | Key globals / DOM |
|---|---|---|
| `storageKeys.js` | **In `<head>`, first, on both pages.** Names everything kept in browser storage: `key(name)` puts the tracker's id, from the page's `<meta name="tracker-id">`, in front of the name (*Storage keys*). | `window.StorageKeys` |
| `phoneLayout.js` | **In `<head>`, on both pages.** Whether the page is in the phone layout (`active`) and a listener for crossing the breakpoint (`onChange`), from `--mobile-breakpoint` in `common.css` (§10). | `window.PhoneLayout` |
| `trackerLaunch.js` | **In `<head>`, on both pages.** Opens the tracker (`open(picks, { runId, save, stamp })`, `openOnDefaults()`) and goes back to the settings page (`toSettings()`); the two pages' addresses live here only. Reads and writes the settings handed from the settings page to the tracker, in `sessionStorage`, with the run's id, a save and its stamp handed over with them (`readRunId()`, `readSave()`, `readStamp()`, and `updateSave(picks, { runId, save, stamp })` as the tracker autosaves), and says whether storage works at all, by trying a write: a browser can read storage and still refuse to write it. On a page marked `data-requires-launch` (the tracker), goes to the settings page before the body draws when nothing was handed over, unless the address has `?defaults` (§2, *Pages*). | `window.TrackerLaunch` |
| `dataLoader.js` | **The first script in the body**, so only the three in `<head>` run before it. The only file that reads `data/`. Fetches `config.json` and the files it lists, `Items.json`, `manifest.json`, `settings.json`, every region file, `locationFlags.json` and `logicHelpers.json` exactly once, then announces them with `trackerDataReady`. Every file is asked of the site rather than taken from the browser's cache, so a page never gets data from before a release beside data from after it. Its script tag on the settings page carries `data-skip-regions`, which leaves out the region files, `locationFlags.json` and `logicHelpers.json`. Renders the three load-failure messages (§8). | `window.TrackerData`, `#tracker-load-error`, `#tracker-region-warning`, `#tracker-logic-warning` |
| `logicParser.js` | Parses a logic string into a tree, evaluates that tree against an inventory, and annotates each node as satisfied / blocking / optional. No DOM, no data of its own. `locationTracker.js` evaluates through it and the requirements tooltip reads the same tree, so the two cannot disagree (§9). | `window.LogicParser` |
| `tooltip.js` | The tooltip: follows the pointer on hover, or docks to the bottom of the screen when pinned from a check's button on touch. Owns showing, hiding, positioning, the edge flip and pinning; owns nothing about what is in it. An owner calls `Tooltip.register(selector, build)` and gets called back with the hovered element (§14). | `window.Tooltip`, `.tracker-tooltip` |
| `requirementsView.js` | Turns an annotated logic tree into the *Items Required* chips. Presentation only. | `window.RequirementsView` |
| `gameStateManager.js` | `window.GameState` — the inventory source of truth. Works out the logic tokens (`tokens`: the values logic can name that are not items) from the definitions in `config/logicTokens.json`, on every state change. `slotKind(config, id)` names what kind of slot an id is — progression, counter, digit or toggle — from config alone, so it works before `init`. `slotBounds(config, id)` gives every value a slot can hold and `grantedValue(config, id, grant)` what a grant from `settings.json` means for it, also from config alone, so the settings and the save layout check use the same rules. `init` takes the starting items, sets those slots and records each one's floor, then any saved slot values, each kept between its floor and its top; `setSlot(id, value)` is the one way a slot changes after that; `slotValue(id)` reads a slot's stage or count back out of `items`, and `slotRange(id)` gives the values clicking can move it through. `snapshot()` is every grid slot's value, for a save. Also builds the **F1 debug panel**, which lists the changed settings and the starting items as well, and creates `window.TrackerDebug` for the other files' console helpers. | `window.GameState`, `window.TrackerDebug`, `#tracker-debug-panel` |
| `settingsState.js` | `window.SettingsState` — the randomizer settings, read and validated out of `settings.json` (§7, *Settings*). Answers a setting's value with any lock applied (`get`, `isForced`), whether a clause matches (`matches`, `clauseProblem`), and what every grant adds up to (`startingItems`). `set` and `reset` change the picks and announce `settingsChanged`; `holdFromSave(values, editable)` fills in a loaded save's settings and holds all but the ones it didn't have, which `set` and `step` then refuse, until `releaseSave()` or `reset`; `sections`, `describe`, `lockedBy` and `picks` are what the settings page reads. `slotSettings(slot)` says which setting controls a grid slot and which only fill it in, worked out from the grants, and `step(id, direction)` moves a controlling setting to its next choice along its slot. `numberOf(id)` is the number a dropdown's chosen option carries, for the right of `>=`, and `isNumeric(id)` says whether a dropdown carries numbers at all (§9); `list()` is every setting with its value, default and lock state, for the F1 panel, and `snapshot()` every setting's pick, for a save. Applies the picks handed over through `trackerLaunch.js` once the file is read (§2, *Pages*). No DOM. | `window.SettingsState` |
| `trackerToolbar.js` | The toolbar in the header, its view toggles and Back to Settings: Hide Non-Randomized Checks, and Show Only Accessible Checks in the phone layout. Each button names the class it puts on `<body>` and its storage name (*Storage keys*) in data attributes; the choices read back through `TrackerView`, and a flip announces `trackerViewChanged` (§10b, *Hiding checks*). A handed-over save sets them, and `TrackerView.snapshot()` gives them to one. Loaded before the trackers, so their first sweep already knows the state. Back to Settings goes to the settings page, asking first only while the tab isn't autosaving (§2, *Pages*). Export is in its markup and belongs to `exportSave.js`. | `window.TrackerView`, `#tracker-toolbar` |
| `itemGrids.js` | **On both pages.** Draws the item grids: one grid per key in `config/grids.json`'s `grids` — the count and order come from config, nothing here — with every slot drawn from `GameState`, so a slot starts wherever the starting items put it. Hands back a view per slot for the page to add its own clicks to and redraw through `draw`. Validates every grid slot at load (§8), and registers the item tooltip: name, the song's `notes_image` where there is one and the song is owned, and any line a page puts in the slot's `data-tooltip-note`. | `window.ItemGrids`, one `.item-grid[data-grid="<key>"]` per grid |
| `itemTracker.js` | The tracker's grids: starts `GameState` from the starting items, has `itemGrids.js` draw the grids, and handles left-click (advance) / right-click (retreat) cycling between a slot's floor and its top, giving a locked slot no click handler. A click changes the slot through `GameState.setSlot` and redraws it from what `GameState` then holds. | `.grid-container` |
| `itemCheckStateManager.js` | `window.ItemCheckState` — which locations are completed, the source of truth a save reads and writes (*Completed checks*, §6). A location is one check id, or every id in a `check_group` with it. Also holds each check's accessible and non-randomized status from the last sweep, derived and never saved, and counts checks as locations for every count on the page (`count`, `overall`, `progress`). `toggle` / `setCompleted` announce `checkCompletionChanged`. `init` takes a handed-over save's completed ids, and `snapshot()` gives them to one. Puts `completedChecks()` on `TrackerDebug`. No DOM. | `window.ItemCheckState` |
| `locationTracker.js` | Builds every region's accordion (`.region-group` = header + `.region-content` of `.region-check-item`s) into `#region-dropdown-container`. Evaluates logic strings (`canAccess()`), sets `accessible` / `inaccessible` on checks and a rolled-up status class on each region header, and announces both. Draws `completed` on the rows from `ItemCheckState`, and hands each sweep's statuses to it. Also validates its regions at load (§8): the location flags and logic helpers, the logic tokens, the check ids and names, the `check_groups` ids, each check's `vanilla_when` and `vanilla_item` and their agreement across one location, and items demanded twice. Registers the requirements tooltip for its checks, and puts the sweep and `canAccess()` on `TrackerDebug`. Marks a region with nothing accessible, and keeps rows a tap hid shown until their region closes (*Hiding checks*). | `#region-dropdown-container` |
| `locationLegend.js` | The **Legend** box only: one row per entry in `config/legend.json`'s `legend`, each swatch colored by the same status class the region headers and map markers use. Hands the box over on an event; where it sits is not its business. | `#location-legend-box` |
| `locationStatsTracker.js` | The **Location Progress** numbers only: computes accessible / checked / remaining, one per location, from `ItemCheckState`. Creates its own element, hands it off via an event, and writes the same numbers into the phone layout's status line. Re-counts when `locationTracker.js` says the checks changed. | `#location-stats-box`, `#location-status-line` |
| `locationPanelLayout.js` | Where the summary row and map container sit (the row in the header on desktop, the map first in `#location-section`; in the phone layout the row is hidden and the legend goes into the header's menu), sizing the desktop map to the item grids' height, and scaling the grids up on windows with room (§11). It owns `#location-summary-row`, which holds the progress numbers and the legend, and lines it up with the map (§10b). Nothing about tracking. | builds `#location-summary-row`, sizes `#location-map-container` |
| `locationMap.js` | Desktop map view: builds `#location-map-container` (image + marker layer), one marker per region JSON with `map_coordinates`, matched to the real `.region-group` by its `data-region-name`. Clicking a marker **moves** that node into a fixed overlay and back to its original position on close, and announces the close with `regionOverlayClosed`. Also fits the region's checks to the overlay (§12). | `#location-map-container`, `#location-map-marker-layer` |
| `saveCodec.js` | Turns a snapshot of the tracker's state into a save code and back, reading each code with the layout of the format it was written in, and wraps a code in the readable object an autosave or exported file holds (*Saving*). No DOM and no data of its own, so Node can run it too. | `window.SaveCodec` |
| `saveStore.js` | **On both pages.** Where saves are kept in this browser: the autosave, the previous run and the backup, in `localStorage`. The one file that touches those keys; makes run ids and tells this tab's writes from another's. | `window.SaveStore` |
| `saveManager.js` | The tracker's autosave: collects the snapshot from each owner, encodes it through `SaveCodec`, and writes it to `SaveStore` and this tab's handoff shortly after every change and at once when the page is hidden. Stops writing the autosave, with a banner, when another tab writes it or has moved this run on, checked at load and again when the browser restores the page from its back/forward cache, and keeps the banner in step with the slots while it is up. Keeps the handoff up to date. At load it checks that `saveLayout.json` covers every setting, slot, check and toggle, and fits their values. Puts `saveCode()`, `decodeSave(code)` and `openSave(code)` on `TrackerDebug`. | `window.TrackerSave`, `#autosave-warning` |
| `exportSave.js` | **Tracker page only.** The Export dialog: the run as a file to download or, on a touch device that can share files, to share, and its code to copy. Exports this tab's own state, even while another tab holds the autosave. | `#export-dialog` |
| `loadSave.js` | **Settings page only.** Load From Autosave and its chooser, Load From File (a file or a pasted code), the message about a loaded save, and Resume Tracker, which hands the save to the tracker. Puts `putSave(text, slot)` on `TrackerDebug`. | `#save-load-message`, `#autosave-chooser`, `#load-file-dialog` |
| `offline.js` | **On both pages.** Registers `offlineWorker.js`, or removes it and its stored copy when `data/offline.json`'s `enabled` is false (*Offline*). Asks for persistent storage only when the tracker runs as an installed app, and on an iPhone or iPad, in any browser, shows the Home Screen tip once. | `#home-screen-tip` |
| `mobileTabManager.js` | **On both pages.** `switchMobileTab()` toggles `.active-section` between the sections the tab buttons name in `data-section`: `#item-section` and `#location-section` on the tracker, `#settings-section` and `#starting-section` on the settings page. It does so at any width; CSS is what confines the tabs to the phone layout (§10). Announces a switch with `mobileTabChanged`. Also shows the back-to-top button once the page is scrolled half a screen, and remembers each tab's scroll position. | `.mobile-tabs`, `.tab-btn`, `#back-to-top` |
| `headerMenu.js` | **On both pages.** The phone layout's header (§13): opens and closes the toolbar as the bar's menu, moves the buttons marked `data-menu-keep-out` under the bar and back into the toolbar on desktop, and lets the bar scroll away (`bar-loose`) when it grows past a quarter of the window. The toolbar's buttons keep their own handlers; this file only shows and hides them. | `#header-menu-button`, `#header-keep-out` |
| `settingControls.js` | **Settings page only.** One control per setting class: a slider for `toggle` (an invisible checkbox over a drawn track), a select for `dropdown`, a number field clamped to `min`–`max` for `number`. `create(description, onChange)` returns `{ element, update(value, locked) }`. A new class is one `register` call here, alongside its value rules in `settingsState.js`. | `window.SettingControls` |
| `settingsPage.js` | **Settings page only.** Builds the settings panel from every list section in menu order, and the Starting Items half from the item grids section: the grids through `itemGrids.js`, each slot's clicks and tooltip line from `SettingsState.slotSettings`. The slot legend above the grids is markup in `index.html`. The section's other settings are one block, moved between the end of the settings panel on desktop and the space under the grids on a phone (§2, *The settings page*). On `settingsChanged` it redraws every control, count and lock note, and re-runs `GameState.init` to redraw the slots. Draws a setting a loaded save holds as locked, and one it didn't hold as highlighted. Owns Reset to Defaults, which asks with `confirm()` and lets go of a loaded save, and Launch New Tracker, which with a save loaded lets go of it and keeps its settings, and otherwise moves the autosave to the previous run (asking first), hands `SettingsState.picks()` and a new run id to `trackerLaunch.js` and opens `tracker.html`, or, when they can't be stored, asks with `confirm()` and opens `tracker.html?defaults`. Warns on the page when storage is blocked at load or a launch couldn't store the picks. | `#settings-list`, `#starting-extras`, `#settings-storage-warning` |

---


## 4. The event bus

All events are `CustomEvent`s on `window`.

| Event | Dispatched by | Consumed by | Payload |
|---|---|---|---|
| `trackerDataReady` | `dataLoader.js`, once all of `data/` has loaded **and** `DOMContentLoaded` has fired | `settingsState.js` (first, so the settings exist before `GameState.init`), `itemGrids.js`, `itemTracker.js`, `locationTracker.js`, `locationStatsTracker.js`, `locationLegend.js`, `locationMap.js`; on the settings page, `settingsState.js`, `itemGrids.js` and `settingsPage.js` | `window.TrackerData` |
| `trackerStateUpdated` | `gameStateManager.js` → `broadcastChange()`, on every state change | `locationTracker.js` (re-evaluates all regions), F1 debug panel, `tooltip.js` (redraws an open tooltip) | `{ items, tokens }` |
| `itemGridsReady` | `itemTracker.js`, after every grid renders, **and again** once the slot images have loaded, if any were still loading | `locationPanelLayout.js` (re-runs map sizing against the grid's real height) | — |
| `regionsRendered` | `locationTracker.js`, once every region accordion is in the DOM | `locationMap.js` (builds its region lookup) | — |
| `regionStatusChanged` | `locationTracker.js`, when a region's rolled-up status or its counts change | `locationMap.js` (recolors that marker, sets its count, updates an open overlay's titlebar) | `{ regionName, status, accessible, remaining }` |
| `trackerChecksUpdated` | `locationTracker.js`, at the end of every `evaluateAllRegions()` sweep | `locationStatsTracker.js` (recount), `tooltip.js` (redraws an open tooltip) | — |
| `checkCompletionChanged` | `itemCheckStateManager.js`, when a location is completed or uncompleted | `locationTracker.js` (sets `completed` on every row of those ids, then runs the sweep) | `{ ids }`, every check id of the location |
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
deterministic. Before any of it, the three scripts in `<head>` have run:
`storageKeys.js` and `phoneLayout.js`, which only define their helpers, and
`trackerLaunch.js`, which has either sent the page to the settings page (§2,
*Pages*) or let it load:

1. `dataLoader.js` — fetches `config.json` and the files it lists, `Items.json`,
   `manifest.json` and `settings.json`, and checks the shape of `check_groups`.
   Then every region file the manifest lists, dropping any that can't be read,
   and resolves each region's checks into one flat list (*Sub-regions*).
   `locationFlags.json` and `logicHelpers.json` load alongside all of these, and
   read as empty if they fail rather than stopping the load, and so does
   `saveLayout.json`, which only turns saving off if it fails. `version.json` is
   fetched on its own, for the footer and the load-error report.
2. `logicParser.js`, `tooltip.js`, `requirementsView.js` — define their globals
   (`tooltip.js` also binds its `document` listeners). None of them waits for
   data; the trackers call them.
3. `gameStateManager.js` — creates `window.TrackerDebug` and builds the (empty)
   F1 panel at parse time; needs no data of its own (`itemTracker` hands it
   config).
4. `settingsState.js` — defines `window.SettingsState` at parse time.
5. `trackerToolbar.js` — defines `window.TrackerView` and applies both saved view
   toggles at parse time, so every sweep below already counts and hides the right
   checks. It needs no data. `itemCheckStateManager.js`, loaded just before
   `locationTracker.js`, defines `window.ItemCheckState` at parse time too.
6. *(`trackerDataReady` fires here)*
7. `settingsState.js` — reads and validates `settings.json`, then applies the
   picks handed over from the settings page. It is first in line
   on purpose: nothing may ask for a setting before this, and `GameState.init`
   works out the tokens, some of which read a setting.
8. `itemGrids.js` then `itemTracker.js` — the first registers the item tooltip.
   The second validates the grid slots, calls `GameState.init(items, config,
   startingItems)` with `SettingsState.startingItems()` (populates `items`, sets
   each starting slot and its floor, dispatches the first `trackerStateUpdated`),
   has `itemGrids.js` render one grid per `config.grids` key with every slot drawn
   from `GameState`, adds its clicks, and dispatches `itemGridsReady`. A save handed
   over from the settings page goes into `GameState.init` here, so the grids draw
   its slots.
9. `locationTracker.js` — registers the check tooltip, renders all accordions
   from `TrackerData.regions`, and dispatches `regionsRendered`. Then it hands the
   regions that rendered to `ItemCheckState.init`, before the validators, which
   read its locations, and before any click. Then it indexes
   the location flags and logic helpers, which has to come first: the validators
   count them as known tokens, and the sweep reads them. The validators follow,
   each in its own try/catch: the flags and helpers themselves, the logic tokens
   against the fully populated `GameState.items`, the check ids, the check names,
   the `check_groups` ids, each check's `vanilla_when` and `vanilla_item`, their
   agreement across one location, and items demanded twice. Last, one
   `evaluateAllRegions()` sweep against the real inventory. Everything from
   `regionsRendered` down is in a `finally`, so a region file that breaks still
   leaves the rest of the page told about the ones that rendered (§8).
10. `locationStatsTracker.js` — builds its box, counts (the first sweep has
    already filled `ItemCheckState`),
    dispatches `locationStatsBoxReady`, starts listening for
    `trackerChecksUpdated`. (It has no observer — see §4.)
11. `locationLegend.js` — builds its box from `config.legend` and dispatches
    `locationLegendReady`, or does neither when no entry is usable.
12. `locationMap.js` — builds the container, dispatches `locationMapReady`, then
    builds markers from `TrackerData.regions`.
13. `saveManager.js` — once every owner has its state and the first sweep has
    run: checks the save layout against the settings, slots, rendered checks and
    toggles, then writes the first autosave, which is the state the tracker opened
    with (*Saving*). `exportSave.js` follows it and enables Export only if saving
    is on.

Until step 6 has run, `<main>` is hidden: both pages start it with
`awaiting-data`, and `dataLoader.js` takes the class off once every
`trackerDataReady` listener has drawn, or before it writes the load-failure
message. A refresh then shows the page whole rather than empty boxes filling in.
It is `visibility`, not `display`, so the layout code can still measure while it
is hidden, and a CSS animation shows the page after a few seconds if the scripts
never run at all. The header and the version footer are hidden with it, on both
pages: the tracker's header takes its width from the scaled layout (§11), and the
footer sits under `<main>`'s content, so shown early either one would jump when
the page appeared.

While `<main>` is hidden, both pages show a loading animation in the middle of
the screen: `.page-loading`, the element straight after `<main>`. It is pure CSS
and shows only while `<main>` still has `awaiting-data`, so it goes the moment
`dataLoader.js` reveals the page or the load-failure message, with no code of its
own. It waits a moment before appearing, so a fast load never flashes it, and
hides again when the fallback shows the page. Its image is set in the CSS, not in
`data/`, because it has to show before `data/` has loaded.

`locationPanelLayout.js` sits outside this — it has no data dependency and just
reacts to `locationStatsBoxReady` / `locationLegendReady` / `locationMapReady` /
`itemGridsReady`, plus `window.load`, `resize`, and a `ResizeObserver` on
`.grid-container`. It still re-runs its sizing on every one
of those because the item grid's *rendered height* settles independently of when
the data arrives — see §11.

The settings page runs a shorter version of the same: the same three in `<head>`, then
`dataLoader.js` with no region files, `tooltip.js`, `gameStateManager.js` (for
`slotKind`, which reading the grants needs, and to show the starting state),
`settingsState.js`, `settingControls.js`, `itemGrids.js`, `saveCodec.js`,
`saveStore.js`, `settingsPage.js`, which builds the page in its `onReady` once the
settings and the handed-over picks are in, `loadSave.js`, which enables Load From
Autosave, and `mobileTabManager.js` for the tabs.

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

**Completed checks** — `ItemCheckState` is the only record of which checks are
done; the `completed` class on a row is drawn from it and never read back. A tap
calls `ItemCheckState.toggle(id)`, which announces `checkCompletionChanged` with
every id of that location, and `locationTracker.js` sets the class on each of
their rows, searching the whole page because a region may be in the map overlay.
A loaded save goes through the same event, so the page is drawn one way whatever
changed it.

"These ids are one location" lives only there too. A check id maps to a location:
its `check_group`, or itself. The region roll-up, the progress numbers and the
vanilla-agreement validator all ask `ItemCheckState` rather than reading the
groups themselves. Counting is its too: `ItemCheckState.count()` is the one rule
every count uses, whether over every check (the progress numbers and a save's
summary) or over one region's rows (the roll-up). A region counts a location once,
so each region showing a shared location counts it, and two ids of one group in
the same region count once. Location keys are internal; a save names check ids.

The sweep records each check's accessible and non-randomized status in
`ItemCheckState` as well, and the counts are worked out from that
rather than from the classes. It is worked out again on every sweep and never
saved, like `GameState.tokens`.

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
`css/regionList.css` (`.region-arrow::after`), switched by an
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
| `config.json` and `config/*.json` | `config.json` is only an index: a `files` list, relative to `data/`, of the files whose keys merge into one `TrackerData.config`. `grids.json` (`grids`: slot layout per grid — **each key becomes a rendered grid**), `inventory.json` (`progressions` for multi-stage items, `item_counts` for numeric or staged counters, `item_groups` for items that count together whatever grid they are drawn in, and `digit_slots`, slots that each hold a digit, with their shared display name and the highest digit), `logicTokens.json` (`tokens`: each derived value logic can name that is not an item, with its display name, its kind and what it counts; §9), `legend.json` (the status swatches and their labels, in display order), `map.json` (`map`: image path + real pixel size, and `map_overlay.text_sizes`, §12) and `checkGroups.json` (`check_groups`: check ids that are one location listed in more than one region, which tick off and count together). A key in two files warns, and the later one wins. | `TrackerData.config` | `itemTracker.js` and `settingsPage.js` (handing it to `itemGrids.js`), `gameStateManager.js` (via `init`), `settingsState.js`, `locationTracker.js`, `locationStatsTracker.js`, `locationLegend.js`, `locationMap.js` |
| `Items.json` | Array of `{ id, name, image, notes_image? }`. `name` drives tooltips; `notes_image` is the song's button sequence, shown in the item tooltip (§14). Any other field set to `true` is a tag a `count` or `any` token can count (§9). | `TrackerData.items` | `itemTracker.js` and `settingsPage.js` (handing it to `itemGrids.js`), `gameStateManager.js` (via `init`), `locationTracker.js` (names in the requirements tooltip) |
| `settings.json` | `always_grants`, `starting_max`, and `sections[]` → `groups[]` → `settings[]` in the randomizer's own menu order. See *Settings* below. | `TrackerData.settings` | `settingsState.js` |
| `<Region>.json` | `region_name`, `logic` (region entry requirement), `map_coordinates: { xPercent, yPercent }`, `item_checks: [{ id, name, logic, vanilla_when?, vanilla_item? }]`, and an optional `subregions` tree that lets checks sharing a requirement write it once (*Sub-regions* below), where `vanilla_when` is the clause under which the check is not randomized (see *Settings*) and `vanilla_item` is what it holds then: an `Items.json` id, shown by the tracker's name for it, or plain text for an item the tracker doesn't track (§14). **`region_name` must be present, text, and unique** — see §8. | `TrackerData.regions` (manifest order, unreadable files dropped; empty on the settings page), and `TrackerData.regionFile(region)`, the file a region came from | `locationTracker.js` (accordion + logic), `locationMap.js` (marker position) |
| `logicHelpers.json` | `{ "helpers": [{ id, name, logic }] }`: a list of items written once and used by name, like any melee damage source (*Logic helpers* below). Loaded on the tracker only. | `TrackerData.logicHelpers` (empty on the settings page, and if the file can't be read) | `locationTracker.js` (resolves each helper as a logic token) |
| `locationFlags.json` | `{ "flags": [{ id, name, at: { check } or { region }, logic? }] }`: progress elsewhere that a check depends on, like a boss being beatable (*Location flags* below). Loaded on the tracker only. | `TrackerData.locationFlags` (empty on the settings page, and if the file can't be read) | `locationTracker.js` (resolves each flag as a logic token) |
| `saveLayout.json` | `{ app, format, fields: [...] }`: which bits of a save code hold which setting, view toggle, item slot and check, in order (*Saving*). Only ever appended to, by `scripts/updateSaveLayout.py`. Loaded on both pages; a failed load turns saving and loading off and nothing else. Older formats' layouts sit under `saveLayouts/` once there are any, fetched only when a save needs one. | `TrackerData.saveLayout` (null if it can't be used), `TrackerData.saveLayoutFor(format)` | `saveManager.js` |
| `offline.json` | `{ enabled, files: [...] }`: every file the offline copy stores, and the off switch. Written by `scripts/updateOfflineFiles.py`, never by hand (*Offline*). Fetched fresh every time, like every data file, which matters most here since it holds the off switch. | `TrackerData.offline` (null if it can't be read) | `offline.js`; `offlineWorker.js` reads it itself |
| `version.json` | `{ "version": "x.y.z" }`, written by `scripts/release.py` rather than by hand (README.md, *Releasing*). Fetched apart from the core files, so a report that they failed to load still carries the version. | `TrackerData.version` (null until it arrives, and if it cannot be read) | `dataLoader.js` (the `#app-version` footer and the load-error report) |

Map marker positions live per-region in `map_coordinates`.

### Sub-regions

A region file may nest its checks instead of listing them flat. A sub-region has a
`name`, and any of `logic`, `vanilla_when`, `vanilla_item`, `item_checks` and
`subregions` of its own. Most of a region's checks then carry only an `id` and a
`name`, and the requirement they share is written once on the group that holds
them. (In Majora's Mask, the Ocean Spider House writes `bomb_bag|blast_mask` once,
on the group holding its thirty tokens.)

The region itself can carry `vanilla_when` and `vanilla_item` too, for every check
in the file: an area whose checks are all non-randomized under the same settings
says so once.

Most regions don't use sub-regions. A tree is for an area whose checks sit in rooms
behind rooms, such as a dungeon, where each layer adds what it takes to reach the
next and the tree reads like a map of the place. A town or a field keeps a flat
`item_checks` list, where the repetition is small and the list is easier to read.
The choice is made per area rather than per file: a mostly flat region can nest its
one deep area. (In Majora's Mask, Ikana Canyon lists most of its checks flat and
nests only Beneath the Well and Ikana Castle.)

`dataLoader.js` walks every region at load, flat ones included, and hands every
other file one flat `item_checks` list, so nothing downstream knows the tree exists
and the inheritance rules below mean the same in every file.
Each resolved check carries three synthesized fields: `group_logic`, the ancestors'
logic in order, `group_path`, their names, and `vanilla_when_from` /
`vanilla_item_from`, naming whichever node supplied an inherited value.

The two fields inherit by different rules, and the asymmetry is deliberate.

| Field | Rule | Why |
|---|---|---|
| `logic` | Accumulates: every ancestor's, then the check's own | You pass through every area to reach the check |
| `vanilla_when` | The nearest node that sets one, replacing rather than merging | Whether a check is randomized is a property of that check, not something it collects on the way in |
| `vanilla_item` | Same | Same |

Because the layers stay a list rather than being joined into one string,
`LogicParser.parse()` parses each on its own. An `a|b` group can never bind loosely
against the `c` below it, and a broken string is reported once under the text the
file actually contains.

Escape hatches, since an absent field means "inherit":

| The check wants | It writes |
|---|---|
| A different clause or item from its group | The value itself |
| To be randomized despite its group | `"vanilla_when": false` — the inherited item goes with it |
| To be vanilla holding nothing listed | `"vanilla_item": null` |

**A sub-region must add a requirement, never narrow one of its parent's
alternatives.** Nesting a check needing `a&b` under a group offering `c|(a&b)`
evaluates correctly — the strict term subsumes the loose one — and still renders a bullet in the requirements tooltip
that can never matter. `TrackerDebug.resolvedChecks(name)` prints each check's
resolved requirement and flags a layer that changes no outcome. The answer is
exact, so the same files always give the same list; the comment on
`redundantLayers()` in `locationTracker.js` says how it is decided.

### Location flags

Some checks depend on progress made somewhere else, such as a boss being beaten.
Writing out what that takes on every check that needs it would copy one region's
logic into another region's file. A location flag names that progress once, and
logic uses it like an item. (In Majora's Mask, Boat Archery in Southern Swamp needs
Odolwa beaten, written `odolwa_defeated`, and the Frog Choir needs a frog from four
places.)

A flag is worked out from the logic, never toggled by ticking a check. It is met
whenever the check or region it points at could be reached with what you hold,
together with any `logic` of its own. That matches how a randomizer treats its
event flags, so a check that needs one turns green exactly when the randomizer
would call it reachable, and nothing depends on remembering to tick the boss. The
flags this game uses and the randomizer names they follow are in
MAJORAS_MASK_DATA.md.

Each entry in `data/locationFlags.json` points at one place:

| `at` | The flag stands for |
|---|---|
| `{ "check": "<id>" }` | Everything that check needs: its region's entry, any sub-regions above it, and its own logic |
| `{ "region": "<region_name>" }` | That region's entry requirement |

Its `logic`, if any, is added on top: the flag is met where the place can be
reached and its own requirement is held too. (In Majora's Mask, the Laundry Pool
frog is the Laundry Pool plus `don_gero_mask`.) The `name` is what the requirements
tooltip shows.

A flag is resolved while the logic is evaluated, with the same resolver, so it
follows the inventory like everything else. One that needs itself through other
flags is a loop, and reads false instead of recursing.

Flags are added one at a time, each approved first, and only once the check or
region it points at exists. Until then a check that uses it warns of an unknown
token and stays red, which is its own reminder.

### Logic helpers

The same lists of items turn up on check after check, such as everything that
can hit an enemy. A randomizer usually names these once, and so does
`data/logicHelpers.json`: each helper is a name for one of those lists, shown in the
tooltip by its `name`. (In Majora's Mask, `fighting` is a sword, the Great Fairy's
Sword, the Goron Mask or the Zora Mask, shown as *Melee Damage*, and `projectile`
is the ranged list, shown as *Projectile Damage*.)

A helper is a location flag without a location: a name for a logic string that
depends only on items. It resolves the same way, while the logic is evaluated, so
anything a check can write a helper can hold, flags and other helpers included.

Writing the list once also removes a common source of repetition in the tooltip.
A region whose way in lists weapons next to a check that lists weapons shows the
same items twice. With the helper each list reads as one name. (In Majora's
Mask: *Melee Damage or Projectile Damage*.)

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
`"view": "item_grids"` is drawn as the tracker's item grids:
its settings show through the slots they grant, and the rest are listed at the end
of the settings panel on desktop and under the grids on a phone. Every other
section is listed in the settings panel. A group's optional
`name` heads its settings.

**`grants`** say what a grid slot starts at: a progression's stage id, a count, a
digit, or `true` for a plain item. On a `number` setting, a grant of `"value"` hands
on the number picked. `always_grants` apply to every tracker whatever the settings,
for what every run starts with. When several grants land on one slot, counters add up to their
maximum, progressions keep the highest stage, digits the highest number, and a plain item is on if anything grants it. `starting_max` then caps a
counter's starting value however it was reached. The merged result is
`SettingsState.startingItems()`.

On the tracker the starting state is also a floor. A slot starts at what it was
granted, and clicking never takes it lower: a progression or counter cycles from
its floor to its top and wraps back to the floor. A slot whose floor
is already its top has nothing to cycle and is locked. So is a granted digit,
whatever its value, because a code is fixed rather than something to count up
from. `GameState.slotRange()` is where those rules live.

A starting value that a randomizer adds on top of the item pool is not a grant:
as a grant it would fill the pool's counters and push them past their maximums
once the rest were found. A `sum` token reads the setting instead. (In Majora's
Mask, the starting hearts: MAJORAS_MASK_DATA.md.)

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
  the values in a list. (In Majora's Mask:
  `{ "shuffle_songs": ["song_locations", "anywhere"], "shuffle_song_of_time": false }`.)
- A list of objects matches when any one of them does.

Anything malformed never matches. `SettingsState.clauseProblem()` says what is
wrong with one, and the validators use it.

### What is not data

Nearly everything the tracker knows comes out of `data/`, which is what makes it
mostly portable — pointing it at a different game is largely a matter of
replacing those files. The parts that are *not* data are worth knowing before you
try:

- **The logic token kinds.** The tokens themselves are entries in
  `config/logicTokens.json` (this game's are in MAJORAS_MASK_DATA.md), each of one
  of four kinds that `GameState` knows how to work out: `count` and `any` over an item
  group or tag, `sum` of settings and items, and `distinct` over a list of slots.
  Anything a logic string needs that fits none of those has to be added to
  `gameStateManager.js` as a new kind (§9).
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
| A core file (`config.json` or a file it lists, `Items.json`, `manifest.json`, `settings.json`) cannot be fetched, is not valid JSON, or holds the wrong shape: a config file that is not an object, an `Items.json` or `manifest.json` that is not a list, or a `settings.json` with no `sections` list | `dataLoader.js` | Nothing can render, so `<main>`'s contents are replaced with `#tracker-load-error` — the cause, naming the file, the version and the page URL, in a selectable block meant to be pasted into a bug report. |
| An `Items.json` entry is not an object with an `id` | `dataLoader.js` | One warning naming the entries by position, which are dropped. Every file that reads the items would otherwise throw on it; a grid slot naming a dropped item draws empty, as any unknown item does. |
| `version.json` cannot be read, or has no `x.y.z` version | `dataLoader.js` | One warning. The footer stays empty and a load-error report says `version: unknown`; nothing else reads it. |
| A region file cannot be read, or holds something other than a region object (such as `null`) | `dataLoader.js` | That region is dropped and the rest load. Names of the dropped files land on `TrackerData.failedRegions` and in a `#tracker-region-warning` banner above the tracker. |
| A grid slot names an item that is not in `Items.json` | `itemGrids.js` → `validate()` | One warning naming grid, index, and for a progression the stage number. The slot draws as an `.empty-slot` so the six-column alignment holds and the other grids still render. |
| A logic string can't be parsed | `logicParser.js`, then `locationTracker.js` → `validateLogicTokens()` | The parser names the string and what is wrong with it; the validator names every region, sub-region, check, flag or helper using it. Anything it gates reads unreachable. |
| A logic string uses a token that matches nothing in the item state, or a name after `>=` that is not a dropdown setting carrying values | `locationTracker.js` → `validateLogicTokens()` | One warning per kind, naming each name and every check using it, plus the right stage id for a progression slot, or a note that a setting only goes after `>=`. The check resolves to `false`. |
| `region_name` is missing, blank, not text, or duplicated | `locationTracker.js` | The region is not rendered and is named in a warning by its file, since the name can't identify it; a duplicate also names the file that kept the name. Spaces around a name are trimmed by `dataLoader.js` first, with a warning, so `"Name "` counts as a duplicate of `"Name"`. The region gets no marker from `locationMap.js`. A duplicate is the nastier case: both copies resolve to the one accordion that rendered, so the second marker would sit at its own coordinates and open the other region's checks. |
| `item_checks` is missing, or is not a list | `locationTracker.js` | The region is skipped and named in the same warning as a bad `region_name`. An empty list is *not* an error — a region whose checks are not written yet renders as an empty accordion. A region that lists only `subregions` is fine: resolving the tree gives it an `item_checks` before this runs. |
| A region's or sub-region's `item_checks` or `subregions` is not a list | `dataLoader.js` | That list is dropped and named by its path; the node's other checks, and the rest of the region, still load. A region left with no `item_checks` list at all is then rejected by `locationTracker.js`, as above. |
| An entry in an `item_checks` list is not a check | `dataLoader.js` | That entry is dropped and named by its position; the rest of the list still loads. |
| A sub-region's `logic` is not text (a number, a list, an object) | `dataLoader.js` | Named by its path. It stays in the chain, so LogicParser rejects it and every check under it reads unreachable, as a bad region or check `logic` does; dropping it would let those checks turn green early. `null` and `""` mean no requirement. |
| A sub-region has no `name` | `dataLoader.js` | Named by position (`subregions[3]`) and still resolved. The name is never rendered — it exists so a warning can point at the one node that put a wrong value on thirty checks. |
| A sub-region holds no checks and no sub-regions | `dataLoader.js` | Named, and does nothing. Usually a group whose checks were moved out from under it. |
| A check sets `vanilla_when: false` and also names a `vanilla_item` | `dataLoader.js` | The item is dropped and the contradiction named. `false` means randomized, so the item could never show. |
| One item is demanded twice down a check's chain | `locationTracker.js` | Named once per pair of layers, not once per check under them. A bare token is a truthiness test, so a second demand for it changes nothing and the check turns green a key early — it fails open, which is why it warns. A counted item asks for the running total instead (`key>=2`). A token inside an `|` is an alternative rather than a demand and is not counted. |
| `locationFlags.json` can't be read, or has no `flags` list; the same for `logicHelpers.json` and `helpers` | `dataLoader.js` | One error, and a `#tracker-logic-warning` banner above the tracker naming the file. Every flag or helper in that file reads false and the tracker still loads, the way a missing region file doesn't stop it. The unknown-token warning then lists those names as matching nothing, and says which file failed to load, since it is the likelier cause. |
| A flag's `at` names a check or region that isn't rendered, or names both or neither | `locationTracker.js` | Named, and the flag reads false. Every check using it stays red, which is why it warns rather than failing quietly. |
| A helper has no `logic` | `locationTracker.js` | Named, and the helper reads false. |
| A flag's or helper's id is already an item or derived token | `locationTracker.js` | Named, and the entry is ignored. Logic reads the item, since a name checked first would replace every requirement for it. |
| A flag or helper is declared twice (in one file or across both), has no `name`, or has an id not written like a token | `locationTracker.js` | Named. The first declaration counts, flags before helpers; a missing name shows the id, and a malformed id is never registered. |
| Flags and helpers need each other in a loop | `locationTracker.js` | Named with the path around the loop. That path reads false; an alternative outside the loop can still meet the token. |
| A region's sub-region tree throws while being walked | `dataLoader.js` | Only that region is affected: it keeps whatever `item_checks` it listed, and the error names it. |
| A region file is readable, but something inside it throws while rendering | `locationTracker.js` | That one region is skipped and named, with the thrown message; every other region still renders. The render call sits in its own try/catch inside the loop for exactly this. |
| A check has no `id` | `locationTracker.js` | The region is not rendered, and is named with the checks missing one. A save keeps a check by its id, so an id-less check couldn't be saved, and every one of them would tick together. |
| Two checks share an `id` | `locationTracker.js` → `validateCheckIds()` | One warning naming the id and the regions using it. Nothing is skipped — a repeat is *legal*, it is how `check_groups` works, so the tracker cannot tell a typo from a group. The symptom is a check ticking itself off somewhere else and the progress total quietly shrinking. |
| A check has no `name` | `locationTracker.js` → `validateCheckNames()` | One warning naming the check. It draws as a blank row that can still be ticked. |
| A `check_groups` entry is not a list of at least two check ids, or `check_groups` itself is not a list | `dataLoader.js` | One warning naming the group, which is dropped: its checks tick off and count on their own. Checked before anything reads the groups, because a group that throws takes the check click and the progress box down with it. |
| A `check_groups` id matches no check on the page, or is in two groups | `locationTracker.js` → `validateCheckGroups()` | One warning per id. An unmatched id leaves its location unlinked; an id in two groups merges both groups into one location, so every id in either ticks off and counts together. |
| A region has no `map_coordinates`, or its `xPercent` and `yPercent` aren't numbers from 0 to 100 | `locationMap.js` → `validateMarkerCoordinates()` | One warning naming the region. It still renders its accordion and still counts, but it gets no marker — and on desktop the accordion list is `display: none`, so its checks are unreachable from anywhere. |
| A `map_overlay.text_sizes` rung has no `font_size` or `padding`, or one that isn't valid CSS once multiplied by the overlay's scale (`0` and `small` are valid alone but not there), or the list is missing, isn't a list, or is empty | `locationMap.js` | One warning naming the rungs, which are skipped, and one more when none is left. The overlay is then fitted once at the stylesheet's text size, which still grows with the map, so a region too big for the box scrolls rather than being cut off. |
| `config.map` is missing or unusable, or building the map throws | `locationMap.js` | One error, and a `#tracker-map-warning` banner above the tracker saying the desktop location view is missing. No map is built; the item tracker and the phone layout's region list still work. |
| The map image's real size differs from `config.map`'s | `locationMap.js` | One warning once the image loads. The map still draws, but every marker drifts off its spot until `config/map.json` is corrected. |
| A token in `logicTokens.json` is malformed: no id or name, a repeated id, the id of an item, an unknown kind, a group or tag or slot list that names nothing, an `item_groups` group that is not a list, a `sum` term that is neither a number setting nor a known item | `gameStateManager.js` | One warning per problem, naming the token. An unusable token is left out; one whose source is missing still exists and reads 0 or false. A tag no item carries is one of these: its token reads 0 until it is fixed. A token that still throws while being worked out reads 0 or false and is named once, so the state change is still announced. |
| An `item_groups` group names an id that is not an item | `gameStateManager.js` | One warning per token reading the group. That id counts as never owned. |
| A slot appears in both `progressions` and `item_counts` | `gameStateManager.js` | Warns; the click handler would silently do nothing. |
| The starting items give a slot a value it can't start at | `gameStateManager.js` → `init` | One warning naming the slot. It starts empty. |
| An entry in `settings.json` is malformed: a missing or repeated id, an unknown `class`, a default that is not one of its values, a grant on something that is not a grid slot or with a value that slot cannot take, a lock whose `when` is malformed or names another locked setting, a `starting_max` on anything but a counter, a dropdown that gives some options a `value` but not others | `settingsState.js` | One warning per problem, naming the entry and what is ignored because of it. A bad setting is left out, a bad option, grant or lock is ignored, and every other setting still loads. |
| A section's `view` is neither `list` nor `item_grids`, or a second section is `item_grids` | `settingsState.js` | One warning. That section is listed in the settings panel. |
| A setting's `class` has no control in `settingControls.js` | `settingsPage.js` | One warning naming the setting. Its row is left out of the settings page; the setting still has its default. |
| Two settings each grant only the same grid slot | `settingsState.js` | One warning. The first in `settings.json` steps through that slot on the settings page; the other still works from its row. |
| The settings handed over from the settings page can't be read | `trackerLaunch.js` | One warning. Every setting keeps its default. |
| `saveLayout.json` can't be read, or has no `fields` list | `dataLoader.js` | One error, and a `#tracker-save-warning` banner saying saving and loading are off. Everything else works. |
| `saveLayout.json` reads but can't be used: no `app` or `format`, a field with an unknown kind, no id, a width outside 1–16, more options than its bits hold, or a field listed twice | `saveManager.js` | Named, and saving is off. |
| Something to save is missing from `saveLayout.json`, or its field can't hold its values | `saveManager.js` | One warning per problem, pointing at `scripts/updateSaveLayout.py`. That setting, slot, check or toggle is left out of saves; the rest still save. |
| A handed-over save names a slot the grids don't have, has no number for one, or marks a check this tracker doesn't show | `gameStateManager.js`, `itemCheckStateManager.js` | One warning each, naming them. They're left out; a slot value past its floor or top is kept inside them without a warning. |
| A handed-over pick names no setting, or a value its setting can't take — the data changed since it was picked, or the storage was edited | `settingsState.js` | One warning per pick, in the same report as the problems in `settings.json`. That setting keeps its default and the rest still apply. |
| A check's `vanilla_when` is malformed or names an unknown setting or value | `locationTracker.js` → `validateVanillaClauses()` | One warning per check. The clause never matches, so the check shows as randomized. |
| A check's `vanilla_item` is not text, is written like an id (lowercase and underscores) but matches no item, or sits on a check with no `vanilla_when` | `locationTracker.js` → `validateVanillaItems()` | One warning per check. The tooltip leaves the "Vanilla:" line out; plain text is always accepted, since most vanilla contents are not tracked items. |
| Checks that are one location — a `check_group`, or a repeated id — have different `vanilla_when` or different `vanilla_item` | `locationTracker.js` → `validateVanillaAgreement()` | One warning per set, for each field that disagrees. Both are compared as written, not by what they match right now, so the disagreement shows under any settings. |
| A `legend` entry is missing its `status` or `label`, or names a status `common.css` pairs no color with | `locationLegend.js` | One warning naming the entry, which is not drawn. The check asks CSS rather than a list, so status names still live only in `common.css`. |

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

- `&` = and, `|` = or, `()` = group up checks, `>=` = check if the count is
  greater than or equal to a number, or to the number a setting carries
  (`item>=setting`).
- Bare tokens are item ids, looked up in `GameState.items` (boolean or number),
  location flags from `locationFlags.json` (*Location flags*), or logic helpers
  from `logicHelpers.json` (*Logic helpers*).
- Tokens that are not items, worked out by `GameState` from
  `config/logicTokens.json` and read from `GameState.tokens`: a `count` or `sum`
  is a number, an `any` or `distinct` is yes or no. A token can't share an id with
  an item.
- Empty string = always accessible.

A token that counts items reads a tag on the item or an `item_groups` list, never
a grid. A grid is a layout list: it says what a panel draws and in what order, so
moving an item to another panel, or putting something else into that one, would
change the count silently. (In Majora's Mask, `total_masks` counts the masks
tagged `regular_mask`; why it is 20 and not 24 is in MAJORAS_MASK_DATA.md.)

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
legal only after `>=`: on its own, `item | 0` would be a requirement no inventory
ever changes.

**A setting after `>=` is a count the seed picks.** A dropdown whose options each
carry a `value` stands for that number, so `item>=setting` asks for as many as the
picked option says. (In Majora's Mask, `boss_masks>=majora_remains_required` asks
for as many remains as Majora Requirements is set to.) The name after `>=` is
always looked up as a setting, through `SettingsState.numberOf()`, and every other
name as an item, so the two can never be mistaken for each other. Only a dropdown
whose options carry `value` has a number; against anything else the comparison is
unmet. What you have always goes on the left, which is why a `number` setting is
never needed there.

A region check's effective logic is every layer on the way to it, all required:
the region's `logic`, the `logic` of each sub-region above the check, then the
check's own. `combinedLogic()` hands them over as a list, and each part is parsed
on its own and joined as trees rather than glued into one string, so a broken
string is named and suppressed once, under the text actually in the region file —
not once per check under a joined string no file contains. The requirements
tooltip uses the same function, so a check can never be explained by different
rules than the ones that colored it.

**The tree, not the string, is why the tooltip can be specific.** Evaluating text
can only answer true or false; walking a tree can say which token in
`(a|b)&(c|d)` is the one stopping you. `annotate()`
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
Reaching a stage sets it *and* every stage below it true, so the first stage in a
logic string reads as "any", and a later one as "at least this one". That is why
no logic needs an `|` chain over one progression's stages. It works because every
chain in `progressions` is a real ladder: you cannot hold a later stage without
having held the earlier ones. (In Majora's Mask, the Razor Sword sets
`kokiri_sword` and `razor_sword`, so `kokiri_sword` reads as "any sword".)

A progression's slot id is **not** a valid token unless it is also its first stage:
the state only ever holds the stage ids. (In Majora's Mask, `sword` is not a token,
while `bow` and `bomb_bag` are, as the first stage of their own progressions.)

A counter slot (`item_counts`) is the other way round: its slot id is the item,
holding a number. Used bare it is truthy once it is above zero, so `key` means "at
least one" and `token>=30` is the explicit form.

**`validateLogicTokens()` runs once at load** and warns to the console about any
token that matches nothing in `GameState.items`, naming the checks that use it.
Without it a typo, or a slot id used where a stage id was meant, resolves to
`false` forever with nothing said — the check just never turns green and it
reads like bad region logic. For a progression slot it also suggests the right
stage id. It sees only the regions that rendered, for the reasons in §8.

It walks the parsed tree rather than the text, because only the tree knows which
side of `>=` a name is on. A setting used as an item is named with a note that
settings only go after `>=`, and a name after `>=` that is not a dropdown carrying
values is named too. A string that fails to parse is named once more, with every
place that uses it, since the parser names only the string.

## 9b. Saving

A save holds only what the player entered: the settings picks, each item slot's
value, which checks are completed, and the view toggles. Logic, regions and
vanilla clauses are not in it, so they change with the app and an old save picks
the changes up.

**One owner per piece.** `SettingsState`, `GameState`, `ItemCheckState` and
`TrackerView` each hand over their part through `snapshot()`, and each takes it
back at start-up: a save is only ever loaded as the tracker opens, handed over
from the settings page with the picks (§2, *Pages*), never into a tracker already
running. `saveManager.js` puts the snapshot together:

```
{ settings: { id: pick }, slots: { id: value }, checks: [ids], view: { buttonId: bool } }
```

A slot's value is its stage or count, not the item flags, so changing what a
progression's stages are called needs no change to saves.

A completed check the tracker didn't draw, in a region whose file failed to load,
stays in every save it writes, so the check is ticked again once the file loads.
It counts nowhere meanwhile. One in a `check_group` whose other checks were drawn
isn't kept apart: the group already carries the location.

**The code.** `saveCodec.js` packs a snapshot into bits and writes them as
base64url text. First the format number and how many fields were written, 16
bits each, then every field in layout order, then a CRC-32 of all of it, so a
mistyped or cut-short code is refused rather than read wrong. A code is short
enough to paste into a message, and nothing in it depends on the screen, so it
moves between a phone and a desktop.

| Field | Written as |
|---|---|
| A toggle or dropdown setting | its value's position in the field's `options` |
| A number setting, an item slot | the value minus the field's `min` |
| A check, a view toggle | 1 bit |
| A check in a `check_group` | a bit for each of its ids, all set together |
| A retired field | its width in zeros, never read |

**The layout** (`data/saveLayout.json`) is the list those fields come from, with
the app's name and the format number. Positions never move:

- **Adding is appending.** A new setting, slot, check or toggle goes on the end.
  An older save ends sooner, and the header's field count is what tells the
  decoder where: everything past it takes its default. Without the count, the
  zero bits padding out the last byte would read as a dropdown's first option.
- **A dropdown keeps its own option list**, so reordering the options in
  `settings.json` changes nothing saved. New options go on the end of it.
- **Renaming is free.** The code holds no names, so renaming an id in the layout
  and the data together keeps every save reading the same.
- **Removing leaves a placeholder**: the field becomes `{ "kind": "retired",
  "bits": N }`, so the bits after it stay where they were.
- **Each field is exactly as wide as its values need.** One that outgrows its
  width, a dropdown gaining an option past what its bits hold, takes a new format,
  which is only data (below).

`scripts/updateSaveLayout.py` does the appending. It reads the settings, the grids,
every region's checks (sub-regions resolved in the same order `dataLoader.js`
uses) and the toggle buttons in `tracker.html`. It stops without writing when a
field has outgrown its width, and it names an id that has gone without retiring
it, since that may be a rename. `--check` reports without writing.

**A new format** is for anything appending can't do: a field that has outgrown its
width, or reclaiming the bits of retired fields. The current layout is copied to
`data/saveLayouts/format<N>.json` before it changes, and the format goes up. A
code is always read with the layout of the format it was written in, into named
values, and those are compared with the current layout: what the save held that is
gone comes back as *dropped*, and what the current layout has that the save didn't
as *missing*, which takes its default. A save from a newer format than the app
knows is refused whole, never read partway.

**The wrapper.** An autosave or exported file holds the code in a readable object,
`{ app, format, version, savedAt, code }`. Only `code` is read back; `app` has to
match the layout's, so another app's file is refused. A bare code, pasted on its
own, is read the same way.

### Storage keys

Browser storage is shared by every page on a site, and more than one tracker can be
served from the same one, so every key starts with the tracker's id:
`<tracker-id>.<name>`. The id is the page's `<meta name="tracker-id">`, the same on
both pages, and `storageKeys.js` is the only file that reads it, so the generic code
never names the game. It lives in the page rather than in `data/` because the handoff
key is needed before any data has loaded. The same id is the save layout's `app`,
which says whose save a file is; `saveManager.js` warns if the two differ.

| Name | Where | Holds |
|---|---|---|
| `launch` | `sessionStorage` | The handoff from the settings page to the tracker (§2, *Pages*) |
| `autosave`, `previousRun`, `autosaveBackup` | `localStorage` | The saves (*The autosave*) |
| `hideNonRandomized`, `showOnlyAccessible` | `localStorage` | The view toggles, named on their buttons |
| `homeScreenTipClosed` | `localStorage` | That the iPhone Home Screen tip was closed |

**A fixture per released format** keeps these rules honest.
`tests/fixtures/saves/format<N>.json` is a file the tracker exported with that
format's layout, byte for byte, and `format<N>.expected.json` beside it is what it
decodes to: the snapshot, and empty `missing` and `dropped` lists. Neither is ever
edited once its format has shipped. Whatever the layout becomes, the fixture has to
keep decoding to the same snapshot, except that fields appended since then show up
in `missing` and fields retired since in `dropped`. A change that breaks that has
broken players' saves. The fixture's settings are mostly off their defaults, with
high values, items at their top stages and checks spread from the first field to
the last, since a save of defaults would decode correctly through most mistakes.
`tests/node/saves.test.js` decodes every fixture against that rule on each pull
request, and `tests/browser/saving.spec.js` loads the format-1 one through the page.

### The autosave

`saveStore.js` keeps three slots in `localStorage`, each a wrapper plus the run's
id, the tab that wrote it and its progress (checked locations out of all of them,
counted by `ItemCheckState` like every other count, so hidden non-randomized checks
are left out), which the chooser and the load message show:

| Slot | Holds |
|---|---|
| autosave | the current run |
| previous run | the run before it, moved there when a new run launches |
| backup | the original of an autosave just updated from an older version, until the updated one has loaded cleanly |

**Writing.** The tracker saves half a second after the last change (an item, a
check, a toggle) and at once when the page is hidden or closed, since a phone can
close a background tab before a scheduled save runs. Each save also rewrites the
tab's handoff, so a reload resumes the run. The first save comes right after
load: it confirms a save that was just updated, and the backup is removed then. A
browser that refuses the write, full or blocking site data, gets one banner saying
autosave isn't working, and the tracker carries on.

A written save is safe from a closed tab, a normal quit and a phone closing the tab
in the background. What it isn't safe from is the whole browser being killed in the
seconds after: browsers write `localStorage` to disk in batches a few seconds
later, so a crash loses whatever they hadn't written yet.

**One tab writes at a time.** A tab writes the autosave only while it owns it: from
load, when the autosave is empty or already this tab's copy of its run, until
another tab writes it. Then it stops and says so in a banner; Autosave This Tab
takes over again, and whatever the autosave holds becomes the previous run rather
than being lost. A tab opened on a different run than the autosave's starts out not
owning it. The banner follows the slots while it is up, since other tabs can go on
changing them. When the autosave holds another run and the previous run holds
another tab's copy of this tab's run, taking over would replace that copy, so the
banner says so and points to Load From Autosave instead. A tab that doesn't own the autosave still rewrites its own handoff,
which no other tab reads, so a reload keeps its progress. Back to Settings asks
first there, since the settings page only loads what the autosave holds.

Two tabs can hold the same run, so the run's id alone can't say whose copy the
autosave is. The handoff's stamp does: the `savedAt` of the copy the tab last
wrote, or resumed from. A reloaded tab whose stamp doesn't match was overtaken by
another tab on the same run, and starts out not owning the autosave rather than
writing its older state over the newer one. A handoff with no stamp, from a new
run or a file, goes by the run alone. The same check runs when the browser
restores a tracker page from its back/forward cache, since not every browser tells
a restored page what other tabs wrote while it was away.

**A run's id** is made when a new run launches and travels in the handoff, so the
autosave, the previous run and the chooser can tell runs apart. Resuming the
previous run swaps the two slots, so neither is lost. Resuming a run no slot holds,
a file among them, moves the autosave into the previous run, replacing what was
there. The run can
move on after the settings page loaded it, in another tab or through the browser's
Back and Forward, so Resume reads the slots again and carries on from the newest
copy of that run rather than from what it read at load, looking first in the slot
it was loaded from: after Autosave This Tab in a second tab, both slots can hold
the run. A save loaded from the backup passes over a stored copy that still won't
read, since that is why the backup was offered.

### Export and Load From File

Export writes the same record the autosave keeps, less the tab that wrote it,
built by `TrackerSave.record()` so the two can't drift apart. It goes out three
ways:

- **Download File**, as the readable wrapper. The name is the layout's app name
  with the local date and time, and no spaces or colons, so it is a valid file
  name everywhere: `<app>-<yyyy>-<mm>-<dd>-<hhmm>.json`.
- **Copy Code**, the bare code, also shown below it in a read-only box sized to the
  code, which a tap or click selects whole. The clipboard needs a secure page, so over
  plain HTTP on a local network the button says it couldn't copy and selects the
  code instead.
- **Share**, only on a touch device whose browser can share a file, on a secure
  page. Desktop browsers on Windows also say they can share a file, but hand it to
  a system panel that is little use here, so the input decides, not the window
  size.

Load From File reads a file or a pasted code with the same decoder as the
autosave. A file is text: a wrapper, or a bare code, which carries no app name and
so is taken as this app's. Anything over 64 KB is refused unread, since a save is
far smaller and a large file is something picked by mistake. A file always starts
a run of its own, so resuming it moves the autosave into the previous run and never
writes over newer progress there. A file never fills the backup slot, since it is
its own backup. Enter in the paste box loads the
code, since a code never holds a line break.

## 9c. Offline

The tracker works with no connection once it has been opened online. `offlineWorker.js`, a
service worker at the site's root so it covers both pages, keeps a copy of every
file, and answers from it when the site can't.

**Online, the site answers first.** Every request is asked of the site rather than
taken from the browser's cache, and the answer is stored. The site is asked because
a host can let the browser keep a file for minutes after a release, which could hand a page
old scripts beside new data. So a player online has the latest files, and there is
no "update available" step: the version number only changes at a release, and a
copy that answered first would serve stale files until then. A running page is
never changed under the player either, since files are only fetched when a page
loads. A file that can't be stored, with storage full, still answers the page.

One cache the worker can't skip: Chromium can reuse a script from its in-memory
cache when a tab reloads or moves between the pages, and that request never reaches
the worker. So the published site stamps every script and stylesheet address with
the version (`js/foo.js?v=1.2.3`, written by `scripts/buildSite.py` into the built
copy only): after a release the pages ask for addresses nothing has kept. The worker
stores each file under its address without the stamp, so a release replaces a
file's copy rather than adding another, and finds it again the same way.

**Offline, the stored copy answers.** With no connection a request fails at once
and the copy answers instead. A connection that neither fails nor answers gets a
few seconds before the copy answers; the site's late reply still updates it. A
server error (a 5xx) is the site failing rather than the file changing, so the copy
answers that too when it has the file. A 404 goes through: that file is gone.

**The copy is the whole site, kept current.** The first visit stores every file in
`data/offline.json`, so pages never opened online still open offline. At most once
an hour while a page is open online, the worker re-checks every file in the
background; the browser asks the site whether each changed, so an unchanged file
costs a short reply. A file missing from the list is stored the first time a page
uses it, so a stale list only costs completeness. `scripts/updateOfflineFiles.py`
writes the list from the pages, the manifest and everything under `css/`, `js/`,
`data/` and `images/`; its `--check` reports without writing.

**The off switch** is `"enabled": false` in `data/offline.json`. Every page reads
that file fresh from the site, and on seeing it tells the worker
serving it to stop, then removes every registration and the stored copy. The
worker itself also stops if it reads the flag during a refresh. Told to stop, it
passes requests straight to the site and stores nothing, or the pages it still
serves would store the copy again as it was deleted. A fixed `offlineWorker.js` needs no
switch at all: the browser checks the worker file against the site itself.

**It needs a secure page**, HTTPS or `localhost`. Over plain HTTP on a local network
nothing registers, and the tracker works online as before.

**Keeping the storage.** Safari on an iPhone or iPad deletes a site's storage, the
autosave with it, after days of use without a visit; an app added to the Home
Screen is exempt. So on an iPhone or iPad, not in the Home Screen app, a tip
suggests adding it, once, until closed. It checks the device rather than the
browser, so it shows in every browser there, all of which run on Safari's engine.
Other phones don't clear storage this way, and never see it. A Home Screen app keeps storage of its own,
apart from Safari's, and export moves a run between the two. Other browsers are
asked to keep the storage (`navigator.storage.persist()`) only when the tracker
runs as an installed app, where they agree without asking; in a tab, Firefox
would ask with a prompt.

---


# Layout

## 10. Desktop vs mobile — the 1500px split

The number lives in `css/common.css` as `--mobile-breakpoint`. `phoneLayout.js`
reads it from there, and every script that asks which layout the page is in asks
`PhoneLayout`, so JS can never disagree with CSS about where mobile starts — that
disagreement hides the region list *and* leaves the map sizing itself against a
`display: none` element. `@media` cannot read a custom property, so every media
query still spells the number out. Changing the breakpoint means changing each of
those, the property itself, and the last-resort fallback literal in
`phoneLayout.js` for the case where the stylesheet fails to load — a stale fallback
is invisible until exactly that happens.

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

`#location-summary-row` holds the progress numbers and the legend on one line.
`locationPanelLayout.js` builds it and fills it as the two pieces announce
themselves, in either order; neither knows the other exists.

On desktop the row describes the locations, so it sits over the map: the header
becomes two columns, the logo and a column that starts at the map's left edge, with
the toolbar at its top and the row along its bottom. The map is centered in its
column and its size is worked out in whole pixels, so `locationPanelLayout.js`
measures where it actually starts each time it sizes it and hands that to the CSS as
`--summary-inset`. The numbers sit left and the legend right; on a narrower window
the legend wraps under the numbers. Large text wraps both further and the header
grows; the map keeps its size and the taller header pushes the page down. In the
phone layout the row is hidden (§13).

**Keep the toolbar and the row no taller than the logo on desktop**, or the header
grows at the default text size and the page scrolls: the scale's height budget
counts the header as its logo (§11).

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

**Status is a color and a shape, paired once** in `common.css`. Each status class
sets `--status-color` and `--status-shape`, plus `--status-outline` and
`--status-outline-pct` where a shape needs a wider marker outline and
`--status-wide-ratio` where it needs a smaller two-digit count (see *Markers*
below); region headers, check rows,
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
`trackerViewChanged`. A save carries both, and a tracker opened from one takes its
values. Each is also kept in `localStorage`, which is what a new tracker starts
from, and flipping one updates it. Storage that throws — a
private window, a browser blocking site data — just starts with everything shown.

**Hide Non-Randomized Checks** takes those checks out of the tracker as if the
regions did not have them, and everything that counts reads it at the moment it
counts:

- CSS hides the rows, and the legend's *Not Randomized* row, off one class on
  `<body>`. The rule sits beside the status pairing in `common.css`, the one place
  status names live.
- `determineRegionLocationAccessibility()` skips them, so a region's counts, color
  and marker all move together. A region with nothing but non-randomized checks
  reads `(0/0)` and gray, the same as one with nothing left.
- `locationStatsTracker.js` skips them in all three numbers, checked ones
  included, so *Checked* only counts what is still shown.

When it flips, `locationTracker.js` runs the sweep again, which carries the new
counts to the markers, the overlay titlebar and the progress numbers through the events
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
  overlay holds its region open, so a mark made there would never be let go.
  `locationTracker.js` lets the marks go when that region's header is clicked, on
  `mobileTabChanged`, on `trackerViewChanged`, so flipping a toggle applies at
  once, and on `regionOverlayClosed`, because the map overlay
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
inset, so the slanted shapes get a wider one. That width is set with the shape in
`common.css` (`--status-outline`) rather than keyed off a status name in
the map CSS, so it follows the shape if a status is ever given a different one. A
two-digit count has the same problem: on a shape that tapers it has less room than
the marker's width suggests, so those pairings also set a
`--status-wide-ratio`, the share of the one-digit size the count drops to, and a
shape without one keeps the full count size.

**Everything about a marker is a share of the map's width.** The marker is 3.2% of
it, with a floor of 15px (20px once it carries a count), the count's type follows
at about 1.45% of it, and the outline is a share of the marker with a floor in
pixels. So markers grow with the map: on the largest windows they are several
times the size they have on the smallest.

3.2% is the limit, not a preference: the closest pair of markers on the map is
about 3.4% of the map's width apart, so a bigger marker would overlap its neighbor
at rest. The tightest cluster of markers sits on a grid 50 map-image pixels apart
for the same reason: at the narrowest desktop map the 20px counted marker is nearly
the whole gap. That distance is center to center, which only round shapes clear:
a full square's corners, and a full-width triangle's base, reach further out. So
on a marker the square is drawn at 76% of its box and the triangle at 80%, the
least that leaves a pixel between every close pair at every size, whatever their
statuses. These are marker-only copies of the two shapes; rows, headers and the
legend have no neighbors to clear and keep the full ones. A shape that fills less
of its box also leaves a thinner outline, so the two marker shapes divide their
outline width by the same share. Hovering grows a marker to 1.3× in front of its
neighbors, which may overlap them while it does; two markers overlapping at rest
is the thing to avoid.

Keeping the count centered on the marker is a stack of rendering traps; each is
explained beside the rule it protects in `locationMap.css`. The marker and the
type are rounded to even pixels, which lands the centered line on a whole pixel.

**The hover tooltip** is `tooltip.js` (§14), registered by `locationMap.js`: the
region's name and its live `(accessible/remaining)` count. Clicking a marker
closes it, because the overlay opens under the pointer.

The count is dark with a light halo, which reads on every fill that carries one.
That is why the purple is a light one: a dark purple would need a light count of
its own, and as header text it would be hard to read on the dark header.

---


## 11. Map sizing and scale (`locationPanelLayout.js` → `syncPanelHeight`)

Desktop only. The grids are scaled up on windows with room, and the map is sized
to the grids' height, so the two always end together.

### Scale

`--ui-scale` (1 or more) multiplies every pixel size that belongs to the grids in
`itemGrids.css`. `applyScale` picks the largest value at which the grids and a
full-height map fit side by side without the page scrolling, across the window's
width and in the height left under the header and above the footer. The smaller
of the two wins, and it never goes below 1. So
a window narrower than the layout needs is not scaled down: the grids stay at their
base size and the map is limited by the column's width.

- **From the window, not the page.** Not everything in the grids scales: the slot
  borders stay one pixel. So their size is a fixed part plus a part that grows
  with the scale, and both are read by measuring the grids at scale 1 and at 2,
  inside one script so neither is painted. Dividing the current size by the current
  scale instead would give a smaller base the larger the scale, and the same window
  would settle differently depending on the size it was resized from. The scale is
  floored to two places so the observers below don't keep firing on a hair's
  difference.
- **The header counts as its logo.** The logo has a fixed height; the summary row
  and the toolbar grow with the browser's text size, and whether the toolbar wraps
  depends on the header's width, which `--layout-max-width` sets from the scale.
  Measuring the whole header would feed the scale back into itself, so the same
  window could settle on a smaller scale or a larger one depending on the size it
  was resized from. Counting only the logo keeps the scale a property of the
  window: large text pushes the map down the page, and the page scrolls, instead
  of the map shrinking.
- **`--layout-max-width`** is set to the width the scaled layout takes, so the
  header and `main` line up and stay centered on a very wide window. It isn't
  known until the grids are drawn, which is one reason the header stays hidden
  with `<main>` while the page loads.
- **The grid has an explicit width on desktop** (`calc(360px * var(--ui-scale))`).
  At `100%` it settles at its slots' content width and stops growing once the scale
  lifts `max-width` past that.

### The map

1. Measure the item grids' rendered height and the location column's width, after
   the scale is applied.
2. **Bail if either looks too small to be real** (`MIN_SANE_PX`). Mid-load, and
   whenever the page isn't painting, they read as zero or something intermediate,
   and sizing from those locks in a tiny map.
3. The summary row is in the header, so the map gets the grids' whole height.
4. Fit a box of the map image's aspect ratio — handed over on `locationMapReady`
   — inside that width and height, setting **both** dimensions explicitly.

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

**Where it hangs from.** The top of the location column, not of the map. On a
window where the map is shorter than the item grids it is centered in the column,
and the overlay takes the space above it too, so it always covers at least the
column.

**How tall it may get.** A windowful measured down from the top of the column, or
the column's own height, whichever is larger. The location column has dead space
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
falls back to the height it has to cover anyway, the map's or the location
column's, whichever is taller: the same defensive idea as `MIN_SANE_PX` in §11.

**How the text is sized.** `config/map.json` → `map_overlay.text_sizes`, largest
first. It walks the ladder and stops at the first size that fits, so a region only
shrinks if it has to and an ordinary one never does. Only the largest regions drop
at all, and then only on a short window, where the viewport caps the height
budget.

**The ladder grows with the map.** Its sizes were made for a map
`map_overlay.base_map_width` wide. On a wider one, `--overlay-scale` (the map's
width divided by that, never below 1) multiplies the text, the padding, the gaps and
the titlebar, so a big map isn't left with small text and empty room. The fit then
runs at the larger sizes, and a region that is too big still steps down the ladder.

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


## 13. The phone layout

Everything below `--mobile-breakpoint` shares one layout: a bar frozen at the top,
and whichever of the two panels its switch shows. It is not only for phones — it
covers everything up to the breakpoint, so it has to use a wide window well too.

**Both panels flow into columns**, and the browser picks the counts, so there is
no per-width breakpoint to maintain. `.grid-container` uses `auto-fit` with a
`min()` floor, and an open `.region-content` uses CSS multi-column.

**The item grids stop at two columns on purpose.** Uncapped they reach four across
near the breakpoint, which shrinks the slots enough to read as one thin row rather
than a block. The `min()` in the track definition matters too: without it a narrow
phone gets a track wider than its screen.

**The header is the bar, and it is `position: sticky`.** It holds the logo, a
two-part switch (the tab buttons) and a menu button, and on the tracker a line
with the progress numbers. It needs its own opaque background (the page scrolls
under it) and a z-index above the region headers. Sticky fails silently: if an
ancestor of `header` ever gets an `overflow` other than `visible`, it stops
sticking with no error.

**The toolbar is the bar's menu.** The same buttons serve both layouts with the
same handlers; `headerMenu.js` only opens and closes the menu. A view toggle leaves
it open, so its new state shows; any other button is an action and closes it, as
do a tap outside and Esc. On the tracker the legend moves into the menu
(`locationPanelLayout.js`, the way the settings page moves its inventory options),
and the progress box is hidden, since the status line has its numbers.

**A button marked `data-menu-keep-out` stays out of the menu**, shown under the bar
in `#header-keep-out`, and goes back to its place in the toolbar on desktop. Resume
Tracker is one: with a save loaded it is the next step, so it shouldn't sit behind
a menu.

**The bar lets go when it grows.** At the largest text sizes a frozen bar would
cover much of the screen, so once it is taller than a quarter of the window it
takes `bar-loose` and scrolls away with the page. Opening the menu scrolls it into
view, since a loose bar can be taller than the window.

**Anything switched on is `--active-green`**, the active half of the switch and a
pressed toggle alike: dark enough for the white text on it to read clearly.

**Scroll position is remembered per tab** in `mobileTabManager.js`, in memory
only - it is where you were looking, not what you collected, so it is not part of
a run's state.

**The digit sizing is slot-relative, not viewport-relative.** A viewport-derived
size only tracks the slot while the mobile grid is a single column — once the
grids sit two across the slot shrinks and the digit does not follow. `80cqw`
cannot drift.

**Container query units stay inside the mobile media query.** `80cqw` measures
against `container-type` on `.item-slot`. On desktop, containment stops the slots
feeding `.grid-container`'s `max-content` tracks and the whole item panel
collapses to a fraction of its width. Mobile's tracks never consult the slots, so
containment costs nothing there. Desktop keeps a pixel size, multiplied by
`--ui-scale` (§11).

**`.item-grid` is `border-box` here and `content-box` on desktop, on purpose.**
Here `.grid-container`'s tracks are sized from the container, not from the grids,
so a `content-box` `width: 100%` paints wider than its track once padding and
border are added, and the page scrolls sideways on a phone. Desktop only looks
like the same situation: its `max-content` tracks already resolve to exactly what
`.item-grid` paints, so `border-box` would only shrink every grid and slot for no
gain. Do not lift the mobile rule to the base one.

**Back to top does not use `behavior: 'smooth'`.** Smooth scrolling is animated
on the same frame loop as `requestAnimationFrame`, which Chrome stops running for
a covered window - so the button would do nothing precisely when someone jabs at
it. That is the same trap as the progress recount and the map sizing (§11). An
instant `scrollTo(0, 0)` always works.

---


## 14. Tooltips (`tooltip.js`)

Hovering an item shows its name, and for a song you own the button sequence from
`notes_image`. A song still grayed out shows only its name: the notes are what
getting it teaches you. The settings page leaves the notes out, since nothing
there asks you to play a song. Hovering a location check shows what it needs, colored by
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

**It replaces the `title` attribute rather than joining it** — on the map markers
too. A native tooltip cannot hold an image or a live count, and leaving both
would show two tooltips per hover, a second apart, in different places. The
accessible name is on `aria-label`.

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

`requirementsView.js` renders the annotated tree from §9 as chips: one per thing
you need, wrapping to the panel's width, each led by a ✓ or a ✗ so the state never
rests on color alone. Nested `&` is flattened, so a region's entry logic and the
check's own produce separate chips rather than one reading "A and B". Chips wrap
side by side, so a long list takes a few lines rather than one line per
requirement, which keeps the docked panel short enough to read on a phone without
scrolling. The same chips are drawn in the hover tooltip on desktop and the docked
panel on a phone, at one size; a chip's colors are blue when met, red when it is what
is missing, and gray when another route already covers it. The heading says how
many are missing (`3 missing`, or `all met`), from the container's `data-missing`,
so it reads before the chips do.

Alternatives stay inline in one chip: `A or B`. The exception is an either/or whose
alternatives have parts of their own, like "an explosive and a song, or one other
song". Written inline, that needs nested parentheses to read. So the requirement
becomes a dashed *Any one of* group of its routes, each route's parts joined by
"and" and each with its own mark, every route a chip like a single requirement, so
a route of several parts reads the same as a lone item. At the top level every
single item is a route of its own; deeper in, single items stay together as one
choice in parentheses, so "(A or B or C) and (D or E)" is one route rather than
six.
A route you can do reads ✓. One you can't reads red ✗ while nothing else meets the
bullet, and gray ✗ once another route does. A plain either/or of four or more
single items is listed the same way, one item per line, since a long line of "or"
is harder to scan than a list. Combining alternatives can multiply a few written
ones into many routes, so a bullet that would produce more than six stays on one
line, unless it has at least that many alternatives written out: those never
multiplied, and listing them is just the either/or one per line.

Before any of that, bullets stop repeating each other. A region's entry often offers
several ways in, and a check may need one of their items anyway. Every bullet is
required, so an item one bullet asks for outright is taken as given in the rest. An
either/or that offers it is already met and drops out, and a way in that includes
it loses that part. (In Majora's Mask, Deku Palace can be entered with the Zora
Mask, the Deku Mask plus a bottle or weapon, or Odolwa beaten, and its West Garden
heart piece needs the Deku Mask regardless. The heart piece reads "Deku Mask" and
"Zora Mask or Bottle or Bow or Hookshot or Odolwa Defeated" instead of three routes
plus the Deku Mask again.)
Only single items and identical counts are matched, and both steps keep the meaning
exactly, so the marks are the ones the unsimplified list would show.

Names come from `Items.json`, then from the location flags' and logic helpers' own
`name`, then from the token definitions in `config/logicTokens.json`, and last the
raw token id — a typo stays visible in the tooltip instead of rendering a
blank bullet.

A `>=` renders as a count, `Tokens 12/30`, since what you already have is the
part being asked about. Against a setting the target is that setting's current
number, `Remains 2/4`, or `?` when it has none.

A non-randomized check also says what it holds, in a `Vanilla: <item>` line
above the requirements — under the check's name when pinned, over *Items
Required* on hover. It comes from the check's `vanilla_item`, worked out once when
the row renders: an `Items.json` id reads as the tracker's name for it, and
anything else is shown as written. A randomized check has no such line, since what
it holds is unknown. The line is text only; item images are too small to read at
tooltip size, and most vanilla contents have none.

Counts of the same item among the bullets merge into one showing the highest
target, which is the one the check actually needs: a region's entry and a check
inside it counting the same item against different settings show one line, not
two. (In Majora's Mask, the Moon's entry asks for `moon_remains_required` and
Majora's own logic for `majora_remains_required`, and Majora shows a single
`Boss Masks` line.) Only bullets merge: inside an `|` the counts are alternatives,
and they stay as written.
