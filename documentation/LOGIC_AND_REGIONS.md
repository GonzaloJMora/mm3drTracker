# Logic and regions

What decides whether a check is reachable: the region files and their sub-region
trees, location flags, logic helpers, and the logic strings all of them are written
in.

## Region files

One file per region, listed in `data/manifest.json`, whose order is the order the
regions are shown in:

```
{ region_name, logic, map_coordinates: { xPercent, yPercent }, item_checks: [...], subregions?: [...] }
```

- **`region_name` has to be present and unique.** It is the key the map markers, the
  overlay and every status announcement use, so a region without one, or with one
  another region already took, isn't drawn (DATA.md, *When the data is wrong*).
- **`logic`** is what reaching the region takes. Every region keeps it, even as
  `""`, as a statement of what getting there needs; checks and sub-regions leave it
  out when they add nothing. An absent `logic` and `""` mean the same.
- **`map_coordinates`** place the region's marker, as percentages of the map image.
- **Each check** is `{ id, name, logic?, vanilla_when?, vanilla_item? }`. The `id` is
  what a save keeps, so it has to be there and stay the same. `vanilla_when` is the
  clause under which the check is not randomized (SETTINGS.md, *Clauses*), and
  `vanilla_item` what it then holds: an `Items.json` id, shown by the tracker's
  name for it, or plain text for something the tracker doesn't track. A check with a
  `vanilla_when` always names its `vanilla_item`, since a vanilla check holds
  something in the game.

## Sub-regions

A region may nest its checks, so checks sharing a requirement write it once. A
sub-region has a `name`, and any of `logic`, `vanilla_when`, `vanilla_item`,
`item_checks` and `subregions` of its own. (In Majora's Mask, the Ocean Spider House
writes `bomb_bag|(blast_mask&termina_shield)` once, on the group holding its thirty tokens.)

**Only areas whose rooms nest use a tree**: a dungeon, where each layer adds what it
takes to reach the next and the tree reads like a map of the place. A town or a
field keeps a flat `item_checks` list, where the repetition is small and the list
reads more easily. It is decided per area, not per file: a mostly flat region can
nest its one deep area. Within a tree, each group is a room or the way into one, and
earns its place by carrying logic, being a room among sibling rooms, or keeping a
check last in the list. Sibling sub-regions don't share a name, since the name only
appears in warnings.

`dataModel.js` flattens every region at load, flat ones included, into one
`item_checks` list, so nothing downstream knows a tree exists. Order is depth first:
a node's own checks, then its sub-regions. Each resolved check carries `group_logic`
(its ancestors' logic, in order), `group_path` (their names), and
`vanilla_when_from` / `vanilla_item_from` (which node supplied an inherited value).

The fields inherit by different rules, on purpose:

| Field | Rule | Why |
|---|---|---|
| `logic` | Adds up: every ancestor's, then the check's own | You pass through every area to reach the check |
| `vanilla_when`, `vanilla_item` | The nearest node that sets one, replacing rather than merging | Whether a check is randomized is a property of that check, not something collected on the way in |

The region itself can set `vanilla_when` and `vanilla_item` for every check in the
file. A check that wants something other than what it would inherit writes:

| The check wants | It writes |
|---|---|
| A different clause or item | The value itself |
| To be randomized despite its group | `"vanilla_when": false`, which drops the inherited item too |

**A sub-region adds a requirement and never narrows a parent's alternative.**
Nesting a check needing `a&b` under a group offering `c|(a&b)` evaluates correctly,
though the tooltip leaves out a requirement the others already cover (TOOLTIPS.md, *The
requirements list*), so a player never sees it. `TrackerDebug.resolvedChecks(name)`
prints each check's resolved requirement and flags a layer that changes no outcome, and
`TrackerDebug.impliedLayers()` lists every such layer, usually a sign that a check sits
in the wrong room.

**A check that needs several sibling areas at once spells out its own
requirement**, since a node has only one parent to inherit from.

## Logic strings

Region and check `logic` are small expressions, parsed by `logicParser.js` and
evaluated in `locationTracker.js`'s `canAccess()`. What each name in them is worth
comes from `dataModel.js`: `DataModel.tokenValue()` works out the tokens and
`DataModel.resolver()` looks up items, tokens, flags, helpers and settings, so the
tests evaluate logic exactly as the page does, without a page:

- `&` is and, `|` is or, `( )` groups, and `item>=count` asks for at least that many.
  `|` binds loosest, then `&`, then `>=`.
- A bare token is an item id, a location flag, a logic helper, or a token from
  `config/logicTokens.json`.
- An empty string is always reachable.

**The grammar is deliberately small.** There is no negation and no comparison but
`>=`, because the tracker only ever gains items: "not X" and "at most X" can only
encode a mistake. A comparison is a bare item on the left and a number or setting on
the right, and anything else is a parse error naming the offender. A number on its
own is a parse error too, since no inventory ever changes it.

**A setting after `>=` is a count the seed picks.** A dropdown whose options each
carry a `value` stands for the picked option's number. (In Majora's Mask,
`boss_masks>=majora_remains_required` asks for as many remains as Majora
Requirements is set to.) The name after `>=` is always a setting and every other name
an item, so the two are never mistaken for each other. What you hold always goes on
the left, which is why a `number` setting is never needed there.

**Progressions are cumulative, so name the lowest stage you'll accept.** Reaching a
stage sets it and every stage below it, so the first stage reads as "any" and a later
one as "at least this one". (In Majora's Mask, the Razor Sword sets `kokiri_sword`
and `razor_sword`, so `kokiri_sword` reads as "any sword".) A progression's slot id
is not a token unless it is also its first stage. A counter is the other way round:
its slot id is the item, holding a number, so `key` means at least one and
`key>=2` asks for two. **An item needed more than once down a chain is a running
total on the deeper layer** (`key>=2`): a bare token is a yes/no question, so writing
it twice asks for one.

**A check's requirement is every layer on the way to it**: the region's `logic`, each
sub-region's above it, then its own. They are handed to the parser as a list and each
is parsed on its own, so a group like `a|b` can't bind loosely against the layer
below it, and a broken string is named once under the text its file actually holds.
The requirements tooltip uses the same list, so a check is never explained by
different rules than the ones that colored it.

**The tree is why the tooltip can be specific.** Evaluating text can only say yes or
no; walking a tree can say which token in `(a|b)&(c|d)` is the one stopping you.
`annotate()` marks every part:

| State | Meaning |
|---|---|
| `satisfied` | you have it |
| `blocking` | you don't, and the group around it is unmet |
| `optional` | you don't, but a sibling already meets the group |

A string that can't be parsed gates nothing but itself: everything it gates reads
unreachable, the tooltip says it couldn't be read, and the parser names it once in
the console rather than on every sweep. A quiet console after that first message
doesn't mean it was fixed. Parsed trees are cached by string, since every sweep
evaluates every check.

## Logic tokens

`config/logicTokens.json` defines the values logic can name that aren't items,
worked out by `GameState` on every change and read from `GameState.tokens`. Each is
`{ id, name, kind, ... }`, and can't share an id with an item.

| Kind | Value | Counts |
|---|---|---|
| `count` | a number | how many items of a `group` (`item_groups` in `inventory.json`) or `tag` (a field set to `true` in `Items.json`) you hold |
| `any` | yes or no | the same, at least one |
| `sum` | a number | its `terms`: a number setting, or an item's count divided by `per` |
| `distinct` | yes or no | every slot of a `slots` list set, and all different |

A token that counts items reads a tag or a group, never a grid: a grid only says
where a panel draws things, and moving an item to another panel must not change a
count. Adding a token is data; a new kind is code. This game's tokens are in
MAJORAS_MASK_DATA.md.

## Location flags

Some checks depend on progress made elsewhere, such as a boss being beaten. Writing
out what that takes on every check that needs it would copy one region's logic into
another's file. A location flag names it once, in `data/locationFlags.json`, and logic
uses it like an item. (In Majora's Mask, Boat Archery needs `odolwa_defeated`.)

A flag is worked out from the logic, never from ticking a check: it is met whenever
the place it points at could be reached with what you hold, plus any `logic` of its
own. That matches how a randomizer treats its event flags, so a check needing one
turns green exactly when the randomizer would call it reachable.

| `at` | The flag stands for |
|---|---|
| `{ "check": "<id>" }` | everything that check needs: its region's entry, any sub-regions above it, and its own logic |
| `{ "region": "<region_name>" }` | that region's entry requirement |

The `name` is what the tooltip shows. A flag resolves while the logic is evaluated,
with the same resolver, so it follows the inventory like everything else; one that
needs itself through other flags reads false rather than recursing. A flag goes in
the file only once the place it points at exists.

## Logic helpers

The same lists of items turn up on check after check, such as everything that can
hit an enemy. A randomizer usually names those once, and so does
`data/logicHelpers.json`: each helper is `{ id, name, logic }`, a name for one list.
(In Majora's Mask, `fighting` is any melee weapon, shown as *Melee Damage*.)

A helper is a location flag without a location, and resolves the same way, so
anything a check can write a helper can hold. Writing the list once also keeps the
tooltip from naming the same items twice when a region's way in and a check both
need them: each reads as the one name.
