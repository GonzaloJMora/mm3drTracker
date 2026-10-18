# Majora's Mask 3D data notes

The tracker's code knows nothing about any one game; `data/` is what makes it a
Majora's Mask 3D tracker. Most of that data reads plainly: items, regions, checks
and their logic. This page covers the choices in it that only make sense for this
game and its randomizer. How the pieces work is in the other docs here, starting
with ARCHITECTURE.md.

## The derived tokens

`config/logicTokens.json` defines five values logic can name that are not items.
The kinds are generic (LOGIC_AND_REGIONS.md, *Logic tokens*); these are the ones this
game needs.

| Token | Kind | What it counts |
| --- | --- | --- |
| `hearts` | `sum` | The Health setting, plus one per four Heart Pieces, plus one per Heart Container |
| `boss_masks` | `count` | The four remains, from the `boss_masks` group in `config/inventory.json` |
| `total_masks` | `count` | Items tagged `regular_mask` in `Items.json` |
| `bottle` | `any` | Anything in the `bottles` group: an Empty Bottle, or one of the contents that still counts as holding a bottle |
| `bombers_code` | `distinct` | The five Bomber's Code digit slots, each set and all different |

### Starting hearts are a setting, not a grant

The randomizer adds the starting hearts on top of every Heart Piece and Heart
Container still in the seed. As a grant they would fill those counters, and push
them past their maximums once the rest were found. So `hearts` reads the Health
setting as its first term instead.

### Why `total_masks` counts 20 masks

It counts the 20 masks tagged `regular_mask`: every mask except the four
transformation masks. The checks it gates are the Moon children (the Moon trials,
and the Fierce Deity's Mask reward), and the four transformation masks can't be
given away, so they don't count toward them.

## Names that follow the randomizer

The location flags stand for the randomizer's own event flags, and the logic
helpers for its helpers. The tracker names each for what happened rather than
copying the randomizer's name.

| Tracker | Randomizer |
| --- | --- |
| `odolwa_defeated`, `goht_defeated`, `gyorg_defeated` | `WoodfallClear`, `SnowheadClear`, `GreatBayClear` |
| `woodfall_frog`, `great_bay_frog`, `laundry_frog`, `swamp_frog` | `WoodfallFrog`, `GreatBayFrog`, `LaundryFrog`, `SwampFrog` |
| `hot_spring_water` | `HotSpringWater` |
| `fighting` (*Melee Damage*) | `Fighting` |
| `projectile` (*Projectile Damage*) | `CanUseProjectile` |

`hot_spring_water` covers the two springs on the Snowhead side. The randomizer's
third source, the hot water in Beneath the Well, holds no check for a flag to point
at, so the one check in the well that needs hot water carries its own alternative
beside the flag: `hot_spring_water|zora_mask`.

## Settings

`settings.json` holds only the randomizer settings that change a check, plus Skip
Bombers' Minigame, in the randomizer's menu order. Choices that follow this game:

- **Labels follow the menu, except item names**, which use the tracker's name from
  `Items.json` (Troupe Leader's Mask, not Circus Leader's Mask). The four starting
  stray fairy counts read "Woodfall Stray Fairies" and so on, to match the Skulltula
  token counts beside them.
- **Bottle Slots 1–7** are dropdowns of every content. Red Potion, Milk, Chateau
  Romani, Gold Dust and Mystery Milk mark only themselves, since each already counts as
  holding a bottle (the `bottles` group). Seahorse and Deku Princess mark themselves and
  an Empty Bottle, a Zora Egg marks one more Zora Egg and an Empty Bottle, and every
  other content marks an Empty Bottle. `starting_max` caps the Empty Bottle at one.
- **Great Bay Temple's *Start With* keys grant 1**, not the game's 3.
- **Stray Fairies *Start With* grants nothing.** The per-temple starting counts decide
  what you start with, even at 0, so its only effect is unpinning the fairy checks.

## Checks that are never randomized

A check the randomizer can't shuffle yet still goes in, with `"vanilla_when": true`, so
the tracker is complete when it becomes shuffleable: Stock Pot Inn's Mystery Milk
delivery, the Bomb Shop's stock, and the Trading Post's eight items.

## Copies of one check

The randomizer lists some checks twice: a spring and a cleared variant, the second and
third postbox, the Keaton quizzes, the second Tingle selling a map. A copy in the same
area as its original is left out. One in another area joins a `check_group` with the
original, so they tick off together: each Tingle map is one location across his two
spots (Clock Town in North Clock Town and Ikana Canyon, and so on).

Oath to Order is one location written in all four temples, because the randomizer gives
it for whichever boss falls first. Each copy needs only its own temple's boss, and the
group is reachable once any of them is.

A scrub moved by trading a deed is one check in two places, and can only be bought where
it currently stands, so only its original spot is written.
