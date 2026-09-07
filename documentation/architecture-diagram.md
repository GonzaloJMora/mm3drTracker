# MM3D Randomizer Tracker — Diagrams

Companion to [`ARCHITECTURE.md`](ARCHITECTURE.md). Four views:

1. [Components and data](#1-components-and-data)
2. [The event bus](#2-the-event-bus)
3. [Load / init sequence](#3-load--init-sequence)
4. [Desktop: moving a region into the map overlay](#4-desktop-region--overlay-move)

Components and events are drawn separately on purpose. One graph with both is
twenty-odd crossing edges, where a wrong one is easier to miss than a right one is
to read.

---

## 1. Components and data

Who reads what, and who renders what. No events here — those are in §2.

```mermaid
flowchart TB
    subgraph D["data/ — read by dataLoader.js and by nothing else"]
        direction LR
        CFG["config.json"]
        ITM["Items.json"]
        MAN["manifest.json"]
        REG["Region JSON Files"]
    end

    DL["<b>dataLoader.js</b><br/>window.TrackerData"]
    CFG --> DL
    ITM --> DL
    MAN --> DL
    REG --> DL

    subgraph CONS["consumers — all via TrackerData.onReady()"]
        direction LR
        IT["itemTracker.js"]
        LT["locationTracker.js"]
        LST["locationStatsTracker.js"]
        LM["locationMap.js"]
    end
    DL --> CONS

    subgraph DOM["what they render"]
        direction LR
        G[".grid-container<br/>.item-grid[data-grid]"]
        RDC["#region-dropdown-container<br/>.region-group"]
        SB["#location-stats-box"]
        MC["#location-map-container<br/>image · markers · overlay"]
    end

    IT --> G
    LT --> RDC
    LST --> SB
    LM --> MC

    GSM["gameStateManager.js<br/>window.GameState + F1 panel"]
    IT -- "init()" --> GSM

    LPL["locationPanelLayout.js<br/>no data dependency"]
    LPL -- "places" --> SB
    LPL -- "sizes" --> MC
    LM -. "moves a node" .-> MC

    MTM["mobileTabManager.js"] --> TABS[".mobile-tabs · .tracker-section<br/>#back-to-top"]
```

Legend: solid arrow = reads from, or renders into. Dotted = moves a live DOM node
rather than creating one.

`locationPanelLayout.js` has no data dependency by design — the map's aspect ratio
is handed to it on `locationMapReady` instead, so it can never be left waiting on
a fetch before it can size anything.

---

## 2. The event bus

Nine `CustomEvent`s on `window`. **Nothing observes the DOM** — there is no
`MutationObserver` anywhere in the codebase, and `ARCHITECTURE.md`'s event bus
section says why not.

The ninth, `trackerDataReady`, is left out of this graph: it is the one-to-four
fan-out already drawn in §1, and drawing it here costs four long edges that cross
everything else. What follows is what happens *after* load.

```mermaid
flowchart TB
    GSM["gameStateManager.js"]
    DBG["F1 debug panel"]
    IT["itemTracker.js"]
    LT["locationTracker.js"]
    LST["locationStatsTracker.js"]
    LM["locationMap.js"]
    LPL["locationPanelLayout.js"]

    GSM -- "trackerStateUpdated" --> DBG
    GSM -- "trackerStateUpdated" --> LT

    LT -- "trackerChecksUpdated" --> LST
    LT -- "regionsRendered" --> LST
    LT -- "regionsRendered" --> LM
    LT -- "regionStatusChanged" --> LM

    IT -- "itemGridsReady" --> LPL
    LST -- "locationStatsBoxReady" --> LPL
    LM -- "locationMapReady" --> LPL
    LPL -- "locationMapResized" --> LM
```

Payloads are deliberately not on the edges — they live in the event bus table in
`ARCHITECTURE.md`, and repeating them here costs more legibility than it buys.

Two of these are worth reading twice:

- **`regionStatusChanged`** exists because a watcher cannot see the open region.
  That region's node has been *moved out* of `#region-dropdown-container` into the
  overlay, so anything watching that container misses it and its marker holds a
  stale color until you close it.
- **`locationMapResized`** runs the opposite way to every other event here: the
  layout file telling the map file it has just been resized. Listening for this
  rather than racing it on `resize` is what makes the refit correct regardless of
  which file registered its listener first, and it is the only signal at all when
  the `ResizeObserver` on `.grid-container` resizes the map with no window resize
  involved.

Two files also listen off this bus, to browser events rather than to each other.
`locationPanelLayout.js` re-runs its sizing on `window.load`, on `resize`, and
from a `ResizeObserver` on `.grid-container`. `locationMap.js` re-fits an open
overlay on `resize`, and closes one on a `matchMedia` change into mobile — that
last listener is the only thing handing a checked-out region back to the list when
the window narrows across the breakpoint, so it is load-bearing despite not being
drawn here.

---

## 3. Load / init sequence

`dataLoader.js` fetches everything once and holds `trackerDataReady` until the
data **and** `DOMContentLoaded` are both done. Consumers register via
`TrackerData.onReady(...)` at parse time, so they fire in `index.html` script
order and the sequence is deterministic.

```mermaid
sequenceDiagram
    autonumber
    participant DL as dataLoader.js
    participant GSM as gameStateManager.js
    participant IT as itemTracker.js
    participant LT as locationTracker.js
    participant LST as locationStatsTracker.js
    participant LM as locationMap.js
    participant LPL as locationPanelLayout.js

    DL->>DL: fetch config, Items, manifest, then every region file
    GSM->>GSM: build the F1 panel at parse time, items still empty
    LT->>LT: register trackerStateUpdated at parse time, no regions yet
    Note over DL: waits for the fetches AND DOMContentLoaded, then fires trackerDataReady once
    DL-->>IT: trackerDataReady
    IT->>IT: validateGridSlots
    IT->>GSM: GameState.init(items, config)
    GSM-->>LT: trackerStateUpdated, first broadcast (sweeps zero regions)
    IT->>IT: render one grid per config.grids key
    IT-->>LPL: itemGridsReady
    DL-->>LT: trackerDataReady
    LT->>LT: render accordions in manifest order, skipping any region it cannot render
    LT-->>LM: regionsRendered
    LT-->>LST: regionsRendered
    LT->>LT: validateLogicTokens + validateCheckIds, then the first evaluateAllRegions sweep
    LT-->>LST: trackerChecksUpdated
    DL-->>LST: trackerDataReady
    LST->>LST: build the stats box and count
    LST-->>LPL: locationStatsBoxReady
    DL-->>LM: trackerDataReady
    LM->>LM: build container, then a marker per rendered region, then syncMarkerColors
    LM-->>LPL: locationMapReady
    LPL->>LPL: syncPanelHeight
    LPL-->>LM: locationMapResized
    Note over LPL: also re-runs on window.load, on resize, and from a ResizeObserver — the grid's rendered height settles independently of when the data arrives
```

The validators and the region-dropping step all warn to the console and let
everything else carry on — see `ARCHITECTURE.md`, *When the data is wrong*. The
handoff and the first sweep sit in a `finally`, so a region file that breaks
mid-render costs that one region rather than everything after it.

**Some arrows are drawn where they are sent, not where they land.** The two
`regionsRendered` edges and the first `trackerChecksUpdated` reach nobody: both
receiving files register their listeners inside their own `TrackerData.onReady`,
which runs later in this sequence. Nothing is lost, because each does the
equivalent work during its own init. Those listeners exist to catch a region
rendered *after* load, which nothing does today.

---

## 4. Desktop: region ↔ overlay move

On desktop `#region-sidebar` is `display: none`. `locationMap.js` physically
**moves** the live `.region-group` node between the hidden list and the overlay,
so its event bindings and class state survive the trip.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> InList: rendered by locationTracker.js
    InList --> InOverlay: marker click
    InOverlay --> InList: close
    InOverlay --> InOverlay: another region's marker clicked
```

**Going in** (`openOverlayFor`): remember `nextElementSibling` as the return
anchor, move the node into `.location-map-overlay-body`, force `.region-content`
open, then `fitOverlayContent()` picks the column count and text size.

**Coming out** (`closeOverlay`), triggered by the X, anywhere on the titlebar, the
same marker again, another marker, or crossing to mobile: reset the accordion
state, clear the inline styles `fitOverlayContent()` set, then put the node back
**in front of its return anchor** — not on the end, which is invisible on desktop
and obvious the moment you narrow the window.

The self-transition is a swap: clicking a different region's marker closes the
current overlay (returning that region to the list) before opening the new one,
so only one is ever out at a time.

Consequences of the node moving:

- Anything counting checks must query **globally** (`.region-check-item`), never
  scoped to `#region-dropdown-container` — the region in question may be in the
  overlay. `locationStatsTracker.js` does exactly this.
- Anything reacting to those checks changing must listen for
  `trackerChecksUpdated`, for the same reason (§2).
- `regionLookup` in `locationMap.js` is additive-only. Rebuilding it by
  re-scanning the container would silently drop whichever region is currently
  checked out, leaving that marker gray for good.
