# Saving

A run is saved as a short code: the settings picks, each item slot's value, which
checks are completed, and the view toggles. Logic, regions and vanilla clauses are
not in it, so they change with the app and an old save picks the changes up. The
same code is the autosave, an exported file, and what Copy Code puts on the
clipboard, so there is one encoder and one decoder to get right.

## What a save holds

Four owners each hand over their part through `snapshot()`: `SettingsState`,
`GameState`, `ItemCheckState` and `TrackerView`. `saveManager.js` puts them
together:

```
{ settings: { id: pick }, slots: { id: value }, checks: [ids], view: { buttonId: bool } }
```

A save is only ever loaded as the tracker opens, handed over from the settings page
with the picks (ARCHITECTURE.md, *Pages*), never into a tracker already running.
Each owner takes its part at start-up.

A slot's value is its stage or count, not the item flags, so renaming a
progression's stages needs no change to saves. A completed check the tracker didn't
draw, because its region file failed to load, stays in every save it writes, so
the check is ticked again once the file loads; it counts nowhere meanwhile.

## The save code

`saveCodec.js` packs a snapshot into bits and writes them as base64url text: the
format number and how many fields were written, 16 bits each, then every field in
layout order, then a CRC-32 of all of it, so a mistyped or cut-short code is
refused rather than read wrong. Nothing in it depends on the screen, so a code
moves between a phone and a desktop.

| Field | Written as |
|---|---|
| A toggle or dropdown setting | its value's position in the field's `options` |
| A number setting, an item slot | the value minus the field's `min` |
| A check, a view toggle | 1 bit |
| A check in a `check_group` | a bit for each of its ids, all set together |
| A retired field | its width in zeros, never read |

An autosave or exported file holds the code in a readable wrapper,
`{ app, format, version, savedAt, code }`. Only `code` is read back, and `app` has
to match the layout's, so another tracker's file is refused. A bare code pasted on
its own is read the same way.

## The layout

`data/saveLayout.json` lists the fields in bit order, with the app's name and the
format number. Positions never move:

- **Adding is appending.** A new setting, slot, check or toggle goes on the end. An
  older save simply ends sooner, and the header's field count tells the decoder
  where, so everything past it takes its default.
- **A dropdown keeps its own option list**, so reordering options in
  `settings.json` changes nothing saved. New options go on the end of it.
- **Renaming is free.** The code holds no names, so renaming an id in the layout and
  the data together keeps every save reading the same.
- **Removing leaves a placeholder**, `{ "kind": "retired", "bits": N }`, so the bits
  after it stay where they were.
- **Each field is exactly as wide as its values need.** One that outgrows its width
  takes a new format.

`scripts/data/updateSaveLayout.py` does the appending, reading the settings, the
grids, every region's checks (sub-regions resolved in the order `dataLoader.js`
uses) and the toggle buttons in `tracker.html`. It stops without writing when a
field has outgrown its width, and names an id that has gone without retiring it,
since that may be a rename. At load the tracker checks the layout covers everything
it would save, and warns naming the script when it doesn't.

## A new format

A new format is for what appending can't do: a field that has outgrown its width,
or reclaiming the bits of retired fields. `updateSaveLayout.py --new-format` copies
the current layout to `data/saveLayouts/format<N>.json`, widens, drops the retired
placeholders, appends what's new and bumps the format.

A code is always read with the layout of the format it was written in, into named
values, which are then compared with the current layout: what the save held that is
gone comes back as *dropped*, and what the save lacks as *missing*, which takes its
default. A save from a newer format than the app knows is refused whole, never read
partway. Only a save that can't be brought forward makes a major release
(WORKFLOW.md, *Versioning*).

## Storage keys

Browser storage is shared by every page on a site, and more than one tracker can be
served from one, so every key starts with the tracker's id: `<tracker-id>.<name>`.
The id is the page's `<meta name="tracker-id">`, and `storageKeys.js` is the only
file that reads it, so the code never names the game. It lives in the page rather
than in `data/` because the handoff key is needed before any data has loaded. The
same id is the save layout's `app`; `saveManager.js` warns if the two differ.

| Name | Where | Holds |
|---|---|---|
| `launch` | `sessionStorage` | The handoff from the settings page to the tracker (ARCHITECTURE.md, *Pages*) |
| `autosave`, `previousRun`, `autosaveBackup` | `localStorage` | The saves (*The autosave*, below) |
| `hideNonRandomized`, `showOnlyAccessible` | `localStorage` | The view toggles, named on their buttons |
| `homeScreenTipClosed` | `localStorage` | That the iPhone Home Screen tip was closed |

## The autosave

`saveStore.js` keeps three slots, each a wrapper plus the run's id, the tab that
wrote it, and its progress (checked locations out of all of them, counted by
`ItemCheckState` like every other count):

| Slot | Holds |
|---|---|
| autosave | the current run |
| previous run | the run before it, moved there when a new run launches |
| backup | the original of an autosave just updated from an older format, until the updated one has loaded cleanly |

**Writing.** The tracker saves half a second after the last change and at once when
the page is hidden or closed, since a phone can close a background tab before a
scheduled save runs. Each save also rewrites the tab's handoff, so a reload resumes
the run. The first save comes right after load; it confirms a save that was just
updated, and removes the backup. A browser that refuses the write gets one banner
saying autosave isn't working, and the tracker carries on.

A written save survives a closed tab, a normal quit and a phone closing the tab in
the background. It doesn't survive the whole browser being killed in the seconds
after: browsers write `localStorage` to disk in batches, a few seconds later.

**One tab writes at a time.** A tab writes the autosave only while it owns it: from
load, when the autosave is empty or already this tab's copy of its run, until
another tab writes it. Then it stops and says so in a banner. Autosave This Tab
takes over again, and whatever the autosave holds becomes the previous run rather
than being lost. The banner is worked out again whenever another tab changes the
slots, and when taking over would replace another tab's copy of this run in the
previous run, it says so and points to Load From Autosave instead. A tab that
doesn't own the autosave still rewrites its own handoff, so a reload keeps its
progress, and Back to Settings asks first, since the settings page only loads what
the autosave holds.

Two tabs can hold the same run, so the run's id alone can't say whose copy the
autosave is. The handoff's stamp does: the `savedAt` of the copy the tab last wrote
or resumed from. A reloaded tab whose stamp doesn't match was overtaken by another
tab on the same run, and starts out not owning the autosave rather than writing its
older state over the newer one. The same check runs when the browser restores a
page from its back/forward cache.

**A run's id** is made when a new run launches and travels in the handoff, so the
slots and the chooser can tell runs apart. Resuming the previous run swaps the two
slots, so neither is lost. Resuming a run no slot holds, a file among them, moves
the autosave into the previous run.

## Loading a save

Loading happens on the settings page (`loadSave.js`), and every source goes through
one path.

- **Load From Autosave** is enabled while there is an autosave or a previous run.
  With a previous run it opens a chooser showing each one's date, progress and
  version; otherwise it loads the autosave straight away.
- **Load From File** takes an exported file or a pasted code. Anything over 64 KB is
  refused unread, since a save is far smaller. A file always starts a run of its
  own, so resuming it moves the autosave into the previous run and never writes over
  newer progress, and it never fills the backup slot, being its own backup.

A loaded save's settings fill in and are held: their controls are disabled, slot
clicks do nothing, and Resume Tracker appears. A setting the save didn't hold takes
its default and stays editable, highlighted as not in this save. A message says what
was loaded and, for a save updated from an older format, which settings took
defaults; an updated file also asks to be exported again, since the file itself
still holds the old format. A save that can't be read is refused with the reason,
and offers the backup when there is one.

With a save loaded, Reset to Defaults lets go of it and resets everything, and
Launch New Tracker lets go of it but keeps its settings, so a new run can start on
them; pressing it again starts that run.

**Resume Tracker** reads the slots again rather than trusting what it read at load,
since the run can move on in another tab, and carries on from the newest stored
copy of it, looking first in the slot it was loaded from.

## Export

Export writes the same record the autosave keeps, built by `TrackerSave.record()`
so the two can't drift apart, and exports this tab's state even while another tab
holds the autosave. It goes out three ways:

- **Download File**: the wrapper, named `<app>-<yyyy>-<mm>-<dd>-<hhmm>.json` in
  local time, with no spaces or colons so the name is valid everywhere.
- **Copy Code**: the bare code, also shown in a read-only box that a tap selects
  whole. The clipboard needs a secure page, so over plain HTTP the button says it
  couldn't copy and selects the code instead.
- **Share**: only on a touch device whose browser can share a file. Desktop browsers
  on Windows also claim they can, but hand the file to an unhelpful system panel, so
  the input decides, not the window size.

## Save fixtures

`tests/game/fixtures/saves/format<N>.json` is a save the tracker exported in each
released format, and `format<N>.expected.json` is what it decodes to. **Neither is
ever edited** once its format has shipped. Whatever the layout becomes, a fixture
has to keep decoding to the same snapshot, apart from fields appended since (in
*missing*) and retired since (in *dropped*); a change that breaks that has broken
players' saves. The fixtures hold settings off their defaults, items at high stages
and checks spread across the whole layout, since a save of defaults decodes
correctly through most mistakes. `tests/game/node/saves.test.js` decodes every
fixture, and the game suite's `gameData` group loads one through the page.
