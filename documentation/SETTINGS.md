# Settings

`data/settings.json` describes the randomizer's settings: what each can be set to,
what each choice starts you with on the tracker, and what other data can ask about
them. `settingsModel.js` reads it, the same code the tests use, and `settingsState.js`
answers for it on both pages. The settings page is where a player picks them.

## A setting

A setting is `{ id, name, class, default }`, listed in the order the randomizer's own
menu shows it. `class` decides what a value can be:

| Class | Value | Other fields |
|---|---|---|
| `toggle` | `true` or `false` | `grants`, applied while it is on |
| `dropdown` | one of its option ids | `options: [{ id, name, value?, grants? }]`; a numeric `value` lets logic count to the setting (LOGIC_AND_REGIONS.md, *Logic strings*) |
| `number` | a whole number from `min` to `max` | `min`, `max`, `grants` |

A new class is code: its value rules in `settingsModel.js` and its control in
`settingControls.js`.

## Sections and groups

The file is `sections[]` → `groups[]` → `settings[]`, which only lays out the settings
page. The one section marked `"view": "item_grids"` is drawn as the tracker's item
grids: its settings show through the slots they grant, and the rest of them are
listed separately (*The settings page*, below). Every other section is listed in the
settings panel, and a group's optional `name` heads its settings.

## Grants

`grants` say what a grid slot starts at: a progression's stage id, a count, a digit,
or `true` for a plain item. On a `number`, a grant of `"value"` hands on the number
picked. `always_grants` apply to every tracker, for what every run starts with.

When several grants land on one slot, counters add up to their top, progressions keep
the highest stage, digits the highest number, and a plain item is owned if anything
grants it. `starting_max` then caps a counter however it was reached. The result,
`SettingsState.startingItems()`, is the tracker's starting state, and also each
slot's floor (ITEM_GRIDS.md, *Clicking*).

A starting value a randomizer adds *on top of* the item pool is not a grant: as a
grant it would fill the pool's counters and push them past their tops once the rest
were found. A `sum` token reads the setting instead (MAJORAS_MASK_DATA.md has this
game's case).

## Locks

`forced` is a list of `{ when, value }`. While `when` matches, the setting reads as
`value` whatever was picked, its control is disabled, and the pick comes back once
the lock lifts. A `when` may not name a setting with a lock of its own: locks that
depend on locks would give different answers depending on which was read first.

## Clauses

Clauses are how data asks about settings. A lock's `when` is one, and so is a check's
`vanilla_when`: while it matches, the check is not randomized, and with none it is
always randomized.

- `true` always matches.
- An object matches when every setting it names has the value given, or one of the
  values in a list.
- A list of objects matches when any one of them does.

Anything malformed never matches, and the data checks name it.

## The settings page

The randomizer's settings sit in one panel, every list section in menu order, flowing
down columns. Edits apply as they are made. A setting picked away from its default is
marked with a dot and counted in its section's heading; a value a lock forces is not
a pick, so it adds neither. A locked setting's control is disabled, with a note
naming the picks that lock it.

The Starting Items half is the tracker's own grids, showing the state the tracker
will open with: every change re-runs `GameState.init` with the starting items and
redraws the slots. Which setting a slot answers to comes from the grants, not from a
list (`SettingsState.slotSettings`):

- **A setting that grants one slot and nothing else controls it.** Clicking the slot
  steps through that setting's choices in the slot's own order, from the one that
  grants nothing up the slot's stages, and right-clicking steps back. When several
  choices look alike in the slot, it shows the chosen one's name. (In Majora's Mask,
  the sword slot steps through no sword, Kokiri, Razor and Gilded.)
- **A slot granted only by settings that grant other slots too, or by a number, is
  filled in but not clicked.** Its tooltip names what sets it. (In Majora's Mask:
  maps and keys, bottle contents, the Bomber's code.)
- **A slot no setting grants is drawn faded**, so the grids still match the tracker.

A legend above the grids draws a sample slot of each kind, worded for the input
rather than the window: click, right-click and hover for a mouse, tap for a
touchscreen.

The item grids section's settings that no slot shows, the inventory options, are the
settings panel's last section on desktop, and sit under the grids in the phone
layout, on the Starting Items tab. `settingsPage.js` builds that block once and moves
it when the window crosses the breakpoint, the way the map overlay moves a region, so
there is never a second copy to keep in step.

**Reset to Defaults** asks first, and lets go of a loaded save. **Launch New Tracker**
asks first, moves the autosave into the previous run, and hands the picks and a new
run id to the tracker (ARCHITECTURE.md, *Pages*). With a save loaded, it first lets go
of the save and keeps its settings, and a second press starts the run. Loading and
resuming a save are SAVING.md, *Loading a save*.

The page loads no region files, so the data checks about regions don't run there. A
browser that blocks storage gets a warning at load, since nothing could be handed to
the tracker.
