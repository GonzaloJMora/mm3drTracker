# Test environment

A small, complete tracker world that only the tests load. Every answer below was
worked out by hand from this page, never by asking the tracker, so a test that
compares the tracker against this page is checking the tracker against something
independent of it.

It borrows Majora's Mask names and pictures to stay readable, but its logic is
made up: each region exists to exercise one part of the tracker, and its logic
is kept short enough to check at a glance.

`tests/server.js` serves `tests/environment/data` and `tests/environment/images` in
place of the repo's `data/` and `images/` when a test asks for this world. The app
itself is never changed and never knows. Nothing here is in the built site or the
offline copy.

The world has to keep every data rule in `js/dataChecks.js`, and a test holds it to
them. Bad data, such as a flag that loops back on itself, is tested in node on
throwaway data instead, never here.

## Items and grids

Three grids, each padded to a multiple of six.

| Grid | Slots |
|---|---|
| item | Sword, Bow, Hookshot, Magic, Empty Bottle, Red Potion |
| mask | Deku Mask, Goron Mask, Bunny Hood, Stone Mask, Blast Mask, *(empty)* |
| quest | Ocarina of Time, Song of Time, Heart Piece, Heart Container, Woodfall Small Key, Odolwa's Remains, Goht's Remains, Code Digit 1, Code Digit 2, Code Digit 3, *(empty)*, *(empty)* |

| Slot kind | Slots |
|---|---|
| Progression | Sword: Kokiri Sword → Razor Sword. Bow: Bow → Large Quiver. Magic: Magic Meter → Double Magic |
| Counter | Empty Bottle (2), Heart Piece (8), Heart Container (2), Woodfall Small Key (2) |
| Digit | Code Digit 1 to 3, each 0 to 3 |
| Toggle | everything else |

Bunny Hood, Stone Mask and Blast Mask are tagged `regular_mask`. Odolwa's and
Goht's Remains are the group `boss_remains`. Red Potion and Empty Bottle are the
group `bottles`.

## Tokens, helpers and flags

| Name | Kind | Value |
|---|---|---|
| `hearts` | token, sum | Health setting + Heart Pieces ÷ 4 (rounded down) + Heart Containers |
| `boss_count` | token, count | how many of `boss_remains` are owned |
| `masks` | token, count | how many `regular_mask` items are owned |
| `bottle` | token, any | owns Red Potion or at least one Empty Bottle |
| `code` | token, distinct | all three Code Digits set, and no two the same |
| `fighting` | helper | `kokiri_sword\|razor_sword\|goron_mask` |
| `projectile` | helper | `bow\|hookshot\|(deku_mask&magic_meter)` |
| `odolwa_defeated` | flag at a check | everything Odolwa's Remains needs (below), plus `song_of_time` |
| `frog_found` | flag at a region | Mountain Village's own logic, plus `bunny_hood` |

## Settings

| Section | Setting | Kind | Default | What it does |
|---|---|---|---|---|
| Shuffles | Shuffle Songs | toggle | on | off makes Song Spot non-randomized, while Item Pool is Normal |
| Shuffles | Shuffle Shops | toggle | on | off makes Bottle Shop non-randomized |
| Shuffles | Shuffle Bottles | toggle | on | off also makes Bottle Shop non-randomized |
| Shuffles | Item Pool | dropdown | Normal | Normal / Plentiful: Plentiful locks Fairy Shuffle to Anywhere |
| Shuffles | Fairy Shuffle | dropdown | Vanilla | Vanilla / Anywhere: decides whether the fairies are randomized; locked to Anywhere when Item Pool is Plentiful |
| Goals | Remains Required | dropdown with numbers | Two (2) | One (1), Two (2), Zero (0): what Moon Gate compares against |
| Starting Items | Starting Sword | dropdown | Kokiri Sword | Kokiri Sword, Razor Sword, None: grants the Sword stage |
| Starting Items | Start With Hookshot | toggle | off | grants Hookshot; locked on when Starting Kit is Full |
| Starting Items | Starting Kit | dropdown | None | None, Full: Full grants 4 Heart Pieces |
| Starting Items | Health | number 3 to 6 | 3 | the first term of `hearts` |
| Starting Items | Starting Heart Pieces | number 0 to 8 | 0 | grants that many Heart Pieces |
| Starting Items | Start With Bottle | toggle | off | grants one Empty Bottle |

Remains Required lists its options out of number order on purpose, so no option
sits at the position its number would give it: a page that read the position instead
of the number would show it.

`starting_max` caps Heart Pieces from settings at 6. Nothing is granted always.

Starting Items is the `item_grids` section, so the settings page draws it as the
grids. Its *Starting Options* group (Starting Kit, Health) is the block of settings no
slot shows, which sits at the end of the settings list on desktop and under the grids
on a phone; the *Starting Inventory* settings are set by clicking their slots.

## Regions

Four regions, in this order on the list and the map.

**South Clock Town**: open from the start (no logic). Plain checks, a group, an
either/or, a `vanilla_when` naming two settings and one naming a dropdown, and a token
compared to a number.

| Check | Logic | Non-randomized when |
|---|---|---|
| Clock Tower Chest | none | never |
| Hookshot Ledge | `hookshot\|(bow&magic_meter)` | never |
| Song Spot | `ocarina_of_time` | Shuffle Songs is off **and** Item Pool is Normal (one clause naming two settings; holds Song of Time) |
| Postbox | none | never; one location with North Clock Town's Postbox |
| Stray Fairy | none | Fairy Shuffle is Vanilla (holds "Stray Fairy"); randomized when it's Anywhere |
| Heart Door | `hearts>=4` | never |

**North Clock Town**: open from the start. Both helpers, a token of kind `any`, a
flag used away from where it is earned, and a list of `vanilla_when` clauses.

| Check | Logic | Non-randomized when |
|---|---|---|
| Postbox | none | never; one location with South Clock Town's Postbox |
| Target Practice | `projectile` | never |
| Guard's Gift | `fighting` | never |
| Bottle Shop | `bottle` | Shuffle Shops is off, **or** Shuffle Bottles is off (a list of clauses; holds Empty Bottle) |
| Odolwa Reward | `odolwa_defeated` | never |

**Woodfall**: needs `deku_mask`. Rooms nested three deep, so requirements add up,
non-randomized values pass down from a room, however deep, and flags earned here and
elsewhere shorten the tooltip or don't.

```
Woodfall (deku_mask)
├─ Entrance Chest (deku_mask|hookshot)   an either/or the region's entry already meets
├─ Frog Pond (frog_found)               a flag earned in another region
└─ Temple (projectile)  ·  non-randomized when Fairy Shuffle is Vanilla, holds "Stray Fairy"
   ├─ Entrance Fairy                    passes the Temple's rule down
   ├─ Map Chest                         vanilla_when: false, so always randomized
   ├─ Side Room (hookshot)
   │  └─ Side Chest (odolwa_defeated & ocarina_of_time)   vanilla_when: false
   └─ Inner Room (woodfall_small_key>=1)
      ├─ Inner Fairy                    passes the Temple's rule down, two rooms deep
      ├─ Key Chest                      vanilla_when: false, so always randomized
      └─ Boss Room (woodfall_small_key>=2 & bow)
         └─ Odolwa's Remains (fighting) vanilla_when: false; where the flag odolwa_defeated is earned
```

The Temple's rule reaches every check under it, however deep, unless the check
sets its own: that's why the four chests and Odolwa's Remains opt out.

So Odolwa's Remains needs all of `deku_mask`, `projectile`,
`woodfall_small_key>=1`, `woodfall_small_key>=2`, `bow` and `fighting`. The flag needs
all of those and its own `song_of_time` too: earning a flag can ask for more than
reaching its check.

The requirements tooltip leaves out what a flag earned in the same region already
needs: the layers the check shares with where the flag is earned.

| Check | Tooltip lists | Left out |
|---|---|---|
| Side Chest | Hookshot, Odolwa Defeated, Ocarina of Time | Deku Mask, Projectile Damage (Woodfall and the Temple, shared with Odolwa's Remains) |
| Frog Pond | Deku Mask, Frog Found | nothing: `frog_found` is earned in Mountain Village |
| Frog Choir | Frog Found | Odolwa Defeated (Mountain Village's entry, where `frog_found` is earned) |
| Odolwa Reward | Odolwa Defeated | nothing: North Clock Town has no entry |

An either/or is drawn as an *Any one of* group of its ways in, each marked on its
own, unless another requirement already meets it, and then it isn't listed.

| Check | At Swamp, the tooltip lists |
|---|---|
| Hookshot Ledge | Any one of: ✗ Hookshot, ✗ Bow and Magic (the Bow is owned, Magic isn't) |
| Entrance Chest | ✓ Deku Mask only: Woodfall's entry already needs it, so `deku_mask\|hookshot` is met |

With Start With Hookshot on (at Start), Hookshot Ledge is met by its first route: Any
one of ✓ Hookshot, gray ✗ Bow and Magic (still short, but nothing on it is needed), and
the heading reads all met.

**Mountain Village**: needs `odolwa_defeated`. A count against a setting, a count
over a tag, the distinct token, and a flag earned at a region. Frog Choir sits in a
trailing group with no logic, which keeps it last and adds nothing to what it needs.

| Check | Logic |
|---|---|
| Moon Gate | `boss_count>=remains_required` |
| Mask Collector | `masks>=3` |
| Bomber's Door | `code` |
| Frog Choir | `frog_found` |

## Expected answers

Each inventory adds to the one above it. ✓ is accessible, ✗ is not, and *(nr)*
marks a check that is non-randomized on default settings. The settings are the
defaults unless a row says otherwise.

| Check | Start | Swamp | Odolwa | Everything |
|---|---|---|---|---|
| *what's added* | *Kokiri Sword from the setting* | *Deku Mask, Bow, 1 Small Key* | *a 2nd Small Key, the Song of Time* | *every slot at its top, digits 1, 2, 3* |
| Clock Tower Chest | ✓ | ✓ | ✓ | ✓ |
| Hookshot Ledge | ✗ | ✗ | ✗ | ✓ |
| Song Spot | ✗ | ✗ | ✗ | ✓ |
| Postbox (both) | ✓ | ✓ | ✓ | ✓ |
| Stray Fairy *(nr)* | ✓ | ✓ | ✓ | ✓ |
| Heart Door | ✗ | ✗ | ✗ | ✓ |
| Target Practice | ✗ | ✓ | ✓ | ✓ |
| Guard's Gift | ✓ | ✓ | ✓ | ✓ |
| Bottle Shop | ✗ | ✗ | ✗ | ✓ |
| Odolwa Reward | ✗ | ✗ | ✓ | ✓ |
| Entrance Chest | ✗ | ✓ | ✓ | ✓ |
| Entrance Fairy *(nr)* | ✗ | ✓ | ✓ | ✓ |
| Map Chest | ✗ | ✓ | ✓ | ✓ |
| Inner Fairy *(nr)* | ✗ | ✓ | ✓ | ✓ |
| Key Chest | ✗ | ✓ | ✓ | ✓ |
| Odolwa's Remains | ✗ | ✗ | ✓ | ✓ |
| Side Chest | ✗ | ✗ | ✗ | ✓ |
| Frog Pond | ✗ | ✗ | ✗ | ✓ |
| Moon Gate | ✗ | ✗ | ✗ | ✓ |
| Mask Collector | ✗ | ✗ | ✗ | ✓ |
| Bomber's Door | ✗ | ✗ | ✗ | ✓ |
| Frog Choir | ✗ | ✗ | ✗ | ✓ |

The tokens at each step:

| | Start | Swamp | Odolwa | Everything |
|---|---|---|---|---|
| `hearts` | 3 | 3 | 3 | 3 + 2 + 2 = 7 |
| `boss_count` | 0 | 0 | 0 | 2 |
| `masks` | 0 | 0 | 0 | 3 |
| `bottle` | no | no | no | yes |
| `code` | no | no | no | yes |
| `fighting` | yes | yes | yes | yes |
| `projectile` | no | yes | yes | yes |
| `odolwa_defeated` | no | no | yes | yes |
| `frog_found` | no | no | no | yes |

Counted as locations, the two Postboxes are one, so the world has 22 locations. The
page draws 23 check rows, since the Postbox is a row in each Clock Town.

| | Start | Swamp | Odolwa |
|---|---|---|---|
| accessible | 4 | 10 | 12 |
| remaining | 22 | 22 | 22 |

Each region counts its own locations, so the Postbox is one in each Clock Town.
A region's header and its map marker show its count as (accessible/remaining);
the marker shows just the accessible number, and nothing at 0.

| Region count | Start | Swamp | Swamp, chests ticked |
|---|---|---|---|
| South Clock Town | (3/6) | (3/6) | (3/6) |
| North Clock Town | (2/5) | (3/5) | (3/5) |
| Woodfall | (0/8) | (5/8) | (2/5) |
| Mountain Village | (0/4) | (0/4) | (0/4) |

Ticking Clock Tower Chest at Start takes South Clock Town to (2/5).

| Region color | Start | Swamp | Swamp, chests ticked | Odolwa | Everything |
|---|---|---|---|---|---|
| South Clock Town | partial | partial | partial | partial | accessible |
| North Clock Town | partial | partial | partial | partial | accessible |
| Woodfall | inaccessible | partial | partial | partial | accessible |
| Mountain Village | inaccessible | inaccessible | inaccessible | inaccessible | accessible |

*Swamp, chests ticked* is Swamp with Woodfall's three reachable chests ticked (Entrance
Chest, Map Chest and Key Chest). That leaves red and non-randomized checks and nothing
randomized to do: Odolwa's Remains, Side Chest and Frog Pond are red, the two fairies
purple. It still reads partial, since a reachable non-randomized check is something to
do.

On Everything, South Clock Town and Woodfall still hold reachable non-randomized
checks, but they read accessible, not purple, because a reachable randomized check
outranks them.

On Everything, ticking South Clock Town's randomized checks (Clock Tower Chest,
Hookshot Ledge, Song Spot, Postbox and Heart Door) leaves only Stray Fairy, which is
non-randomized and needs nothing: the region reads non-randomized (purple), (1/1).
The other three keep their colors.

A region with every location ticked reads completed (gray), whatever the inventory.

### Settings that change the answers

Each starts from the Start inventory unless it says otherwise.

| Change | What moves |
|---|---|
| Shuffle Songs off | Song Spot becomes non-randomized |
| Shuffle Songs off and Item Pool Plentiful | Song Spot stays randomized: its clause needs both settings to match. Plentiful also makes the three fairies randomized, through the lock |
| Fairy Shuffle Anywhere | Stray Fairy, Entrance Fairy and Inner Fairy become randomized |
| Item Pool Plentiful | Fairy Shuffle is locked to Anywhere, so the same three fairies become randomized |
| Shuffle Shops off | Bottle Shop becomes non-randomized |
| Shuffle Bottles off | Bottle Shop becomes non-randomized |
| Shuffle Shops and Shuffle Bottles both off | Bottle Shop is non-randomized (either clause is enough) |
| Starting Kit Full | Start With Hookshot is locked on, so Hookshot Ledge and Target Practice open; 4 Heart Pieces make `hearts` 4, so Heart Door opens |
| Starting Kit Full and Starting Heart Pieces 8 | 12 Heart Pieces capped at 6: `hearts` is still 4 |
| Health 4 | Heart Door opens |
| Starting Sword None | Guard's Gift closes (`fighting` needs a sword or the Goron Mask) |
| Remains Required One, on Odolwa plus Odolwa's Remains | Moon Gate opens |
| Remains Required Zero, on Odolwa | Moon Gate opens |
| Start With Bottle | Bottle Shop opens |

### Single pieces

The node tests also take each piece away on its own and expect the answer to
change:

- Odolwa Reward closes when any one of Deku Mask, the second key, the Bow, the
  Sword (Odolwa's Remains' own logic) or the Song of Time (the flag's own) is
  missing. The projectile can't be taken away on its own, since the Bow is one, so
  for the Bow's step the Hookshot stands in as the projectile.
- Key Chest closes when the first key is missing. Odolwa Reward can't show the
  first key: with none, the second is missing too.
- `projectile` is met by the Bow alone, the Hookshot alone, or the Deku Mask with
  Magic, and not by the Deku Mask or Magic alone.
- `hearts`: 3 Heart Pieces add nothing, 4 add one, 8 add two.
- `code`: digits 1, 2, 3 meet it; 1, 1, 2 do not; 0, 1, 2 do not.
- `masks`: two of the three tagged masks are not enough; the Deku Mask and Goron
  Mask never count, since they aren't tagged.
