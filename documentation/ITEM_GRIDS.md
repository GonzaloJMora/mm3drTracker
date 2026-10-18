# Item grids

The item tracker: grids of slots, each holding an item, an upgrade chain, a count or
a digit. The tracker and the settings page draw the same grids through
`itemGrids.js`, and each adds its own clicks, so the settings page shows exactly what
the tracker will open with.

## The grids

`config/grids.json` has one key per grid, in display order, each a list of slot ids.
Every key becomes a drawn grid, and the code names none of them.

**Pad every grid to a multiple of 6 with `""` entries**, which draw as invisible
empty slots. On desktop two grids share a row, and a grid whose last row is short
stretches to its neighbor's height: its slots, square through `aspect-ratio`, blow up
with it, so a four-slot grid beside a thirty-slot one draws at several times the size.
Don't fix that with `align-self: start` or `grid-auto-rows: min-content` on
`.item-grid`. Both stop the blow-up, then collapse the `max-content` column track to
360px while the grid still paints at 394, so the grids spill onto the map. A real fix
has to untangle `.grid-container`'s `max-content` tracks from `.item-grid`'s
`width: 100%; max-width: 360px` first; padding is the cheap answer.

## Slots

What a slot is comes from `config/inventory.json`, worked out by
`DataModel.slotKind()`:

| Kind | Defined by | Holds | Drawn as |
|---|---|---|---|
| progression | `progressions`: the slot id and its chain of item ids | a stage, from -1 (none) to the last | the stage's item, faded when none |
| counter | `item_counts`: the slot id and its top | a count from 0 | the item with its count, green at the top |
| digit | `digit_slots`: a shared `name`, the slot `ids` and the highest digit, `max_value` | a digit from 0 | the digit; its tooltip is the shared name and its place |
| toggle | anything else: an `Items.json` id | owned or not | the item, faded when not owned |

A slot isn't in both `progressions` and `item_counts`; the data checks say so if one
is.

`GameState` holds every slot's value, and is the only thing that changes one, through
`setSlot()`. The tracker's grids redraw a slot from what `GameState` then holds, so a
click and a loaded save draw the same way. A save keeps each slot's value, not the
item flags, so renaming a stage needs no change to saves. For logic, the state holds
each stage as an item, set together with every stage below it (LOGIC_AND_REGIONS.md,
*Logic strings*).

## Clicking

On the tracker a click steps a slot up and a right-click steps it back, wrapping
around at either end. `GameState.slotRange()` says where it can go:

- **Starting items are a floor.** A slot starts at what the settings grant it
  (SETTINGS.md, *Grants*), and clicking never takes it lower: it cycles from its
  floor to its top and back to the floor.
- **A slot whose floor is its top is locked**, with no click handler, since there is
  nothing to cycle.
- **A granted digit is locked whatever its value**, because a code is fixed rather
  than something to count up from.

On the settings page a slot's clicks change a setting instead (SETTINGS.md, *The
settings page*).

## Tooltip

Hovering a slot names its item. A song you own also shows its button sequence, from
`notes_image` in `Items.json`; a song not yet owned shows only its name, since the
notes are what getting it teaches you, and the settings page leaves the notes out. A
page can add a line through the slot's `data-tooltip-note`. The tooltip itself is
TOOLTIPS.md.

## Sizing

On desktop the grids have a base size, and are scaled up together with the map on a
window with room (LAYOUT.md, *Scale*). The scale doesn't depend on how many slots
the data has, down to the design height in `--grid-design-rows`. In the phone layout they flow into one or two
columns, never more, since four across shrinks the slots into a thin row
(LAYOUT.md, *The phone layout*).

**The slot images decide when the grids have their final height.** `itemTracker.js`
counts the `.item-image` elements still loading, and sends `itemGridsReady` a second
time once they are in, because the map is sized from the grids' height. A tooltip
image must not use that class, or the count stalls and the map stays sized to a
half-height grid.
