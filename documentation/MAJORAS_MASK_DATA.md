# Majora's Mask 3D data notes

The tracker's code knows nothing about any one game; `data/` is what makes it a
Majora's Mask 3D tracker. Most of that data reads plainly: items, regions, checks
and their logic. This page covers the choices in it that only make sense for this
game and its randomizer. How the pieces work is ARCHITECTURE.md.

## The derived tokens

`config/logicTokens.json` defines five values logic can name that are not items.
The kinds are generic (ARCHITECTURE.md, *Logic strings*); these are the ones this
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
