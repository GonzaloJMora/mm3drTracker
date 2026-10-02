"""Add anything new in data/ to the end of data/saveLayout.json.

The layout says which bits of a save code hold what: every setting, view toggle,
item slot and check, in order, each with a fixed width. Positions never move, so
this only ever appends. It stops, changing nothing, when a field has outgrown its
width, and it names ids that are gone without retiring them, since a missing id
may be a rename, which is fixed by renaming it in the layout. See
ARCHITECTURE.md, Saving.

--new-format is for what appending can't do. It copies the layout as it stands to
data/saveLayouts/format<N>.json, which is how saves of that format are read from
then on, then widens every field that outgrew its width, drops the retired
placeholders, appends what's new and bumps the format.

    python scripts/updateSaveLayout.py                 write the additions
    python scripts/updateSaveLayout.py --check         only report; exit 1 if out of date
    python scripts/updateSaveLayout.py --new-format    freeze this format and start the next
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
LAYOUT = DATA / "saveLayout.json"
FROZEN_DIR = DATA / "saveLayouts"
TRACKER_PAGE = ROOT / "tracker.html"

# A new layout starts here. The app name marks an exported file as this
# tracker's, so it is data rather than code.
NEW_LAYOUT = {"app": "mm3drTracker", "format": 1, "fields": []}


class LayoutError(Exception):
    pass


def read_json(path):
    try:
        with open(path, encoding="utf-8") as file:
            return json.load(file)
    except (OSError, ValueError) as error:
        raise LayoutError(f"{path.relative_to(ROOT)} can't be read: {error}")


def bits_for(largest):
    """Bits to hold 0..largest."""
    return max(1, int(largest).bit_length())


# ---------- What the data holds now, in the order new fields are appended ----------

def current_settings():
    """Each setting as a field: a list of values, or a number range."""
    data = read_json(DATA / "settings.json")
    fields = []
    for section in data.get("sections", []):
        for group in section.get("groups", []):
            for setting in group.get("settings", []):
                kind = setting.get("class")
                entry = {"kind": "setting", "id": setting["id"]}
                if kind == "toggle":
                    entry["options"] = [False, True]
                elif kind == "dropdown":
                    entry["options"] = [option["id"] for option in setting.get("options", [])]
                elif kind == "number":
                    entry["min"] = setting["min"]
                    entry["max"] = setting["max"]
                else:
                    raise LayoutError(f'setting "{setting["id"]}" has the class {kind!r}, which this script does not know')
                fields.append(entry)
    return fields


def current_view_toggles():
    page = TRACKER_PAGE.read_text(encoding="utf-8")
    fields = []
    for tag in re.findall(r"<button\b[^>]*\bdata-view-toggle=[^>]*>", page):
        match = re.search(r'\bid="([^"]+)"', tag)
        if not match:
            raise LayoutError("a view toggle button in tracker.html has no id")
        fields.append({"kind": "view", "id": match.group(1)})
    return fields


def current_slots():
    """Each grid slot with the range its value can take. Stage -1 is not owned."""
    config = {}
    for name in read_json(DATA / "config.json")["files"]:
        config.update(read_json(DATA / name))
    progressions = config.get("progressions", {})
    counts = config.get("item_counts", {})
    digits = config.get("digit_slots", {})
    fields = []
    seen = set()
    for grid in config.get("grids", {}).values():
        for slot in grid:
            if not slot or slot in seen:
                continue
            seen.add(slot)
            if slot in progressions:
                low, high = -1, len(progressions[slot]) - 1
            elif isinstance(counts.get(slot), int) and not isinstance(counts.get(slot), bool):
                low, high = 0, counts[slot]
            elif slot in digits.get("ids", []):
                low, high = 0, digits["max_value"]
            else:
                low, high = -1, 0
            fields.append({"kind": "slot", "id": slot, "min": low, "max": high})
    return fields


def region_check_ids(node):
    """Depth-first, a node's own checks before its sub-regions, as dataLoader.js
    resolves them."""
    ids = [check.get("id") for check in node.get("item_checks", []) if isinstance(check, dict)]
    for sub in node.get("subregions", []):
        if isinstance(sub, dict):
            ids.extend(region_check_ids(sub))
    return ids


def current_checks():
    fields = []
    seen = set()
    for name in read_json(DATA / "manifest.json"):
        for check_id in region_check_ids(read_json(DATA / name)):
            if not isinstance(check_id, str) or not check_id.strip():
                raise LayoutError(f"{name} has a check with no id, which can't be saved")
            if check_id not in seen:
                seen.add(check_id)
                fields.append({"kind": "check", "id": check_id})
    return fields


# ---------- Widths ----------

def width_needed(entry):
    if "options" in entry:
        return bits_for(len(entry["options"]) - 1)
    if "max" in entry:
        return bits_for(entry["max"] - entry["min"])
    return 1


def new_field(entry):
    """A field for something not yet in the layout, exactly as wide as it needs.
    No spare room: outgrowing it takes a new format, which is only data."""
    field = {"kind": entry["kind"], "id": entry["id"], "bits": width_needed(entry)}
    if "options" in entry:
        field["options"] = list(entry["options"])
    if "min" in entry:
        field["min"] = entry["min"]
    return field


# ---------- Writing ----------

def dump(layout):
    """One field per line, so a diff shows exactly what was appended."""
    lines = [
        "{",
        f'  "app": {json.dumps(layout["app"])},',
        f'  "format": {json.dumps(layout["format"])},',
        '  "fields": [',
    ]
    fields = layout["fields"]
    for index, field in enumerate(fields):
        comma = "," if index < len(fields) - 1 else ""
        lines.append("    " + json.dumps(field, ensure_ascii=False) + comma)
    lines += ["  ]", "}", ""]
    return "\n".join(lines)


def update(layout, widen=False):
    """Appends what's missing to layout, and with widen, widens what outgrew its
    field instead of naming it. Returns (added, gone, problems)."""
    by_key = {(field["kind"], field.get("id")): field for field in layout["fields"] if field["kind"] != "retired"}
    wanted = current_settings() + current_view_toggles() + current_slots() + current_checks()
    wanted_keys = {(entry["kind"], entry["id"]) for entry in wanted}

    added, problems = [], []
    for entry in wanted:
        key = (entry["kind"], entry["id"])
        field = by_key.get(key)
        if field is None:
            field = new_field(entry)
            layout["fields"].append(field)
            by_key[key] = field
            added.append(f'{entry["kind"]} {entry["id"]}')
            continue

        # Already there: new options go on the end, and the value has to fit.
        if "options" in entry:
            options = field.setdefault("options", [])
            for option in entry["options"]:
                if option not in options:
                    options.append(option)
                    added.append(f'option {option!r} of {entry["kind"]} {entry["id"]}')
            if len(options) > 2 ** field["bits"]:
                if widen:
                    field["bits"] = bits_for(len(options) - 1)
                    added.append(f'{entry["kind"]} {entry["id"]} widened to {field["bits"]} bits')
                else:
                    problems.append(f'{entry["kind"]} {entry["id"]} has {len(options)} options, more than its {field["bits"]} bits hold')
        if "max" in entry:
            low = field.get("min", 0)
            if (entry["min"] < low or entry["max"] - low >= 2 ** field["bits"]) and widen:
                field["min"] = min(low, entry["min"])
                field["bits"] = bits_for(entry["max"] - field["min"])
                added.append(f'{entry["kind"]} {entry["id"]} widened to {field["bits"]} bits from {field["min"]}')
            elif entry["min"] < low or entry["max"] - low >= 2 ** field["bits"]:
                problems.append(f'{entry["kind"]} {entry["id"]} runs {entry["min"]} to {entry["max"]}, '
                                f'which {field["bits"]} bits from {low} can\'t hold')

    gone = [f"{kind} {key}" for (kind, key) in by_key if (kind, key) not in wanted_keys]
    return added, gone, problems


def new_format():
    if not LAYOUT.exists():
        print("Stopped: there is no layout yet, so there is no format to freeze.")
        return 1
    try:
        frozen = read_json(LAYOUT)
        layout = json.loads(json.dumps(frozen))
        frozen_path = FROZEN_DIR / f'format{frozen["format"]}.json'
        if frozen_path.exists():
            raise LayoutError(f"{frozen_path.relative_to(ROOT)} already exists, so format {frozen['format']} "
                              "was frozen before. Check the format number in saveLayout.json.")
        retired = sum(1 for field in layout["fields"] if field["kind"] == "retired")
        layout["fields"] = [field for field in layout["fields"] if field["kind"] != "retired"]
        added, gone, _ = update(layout, widen=True)
    except LayoutError as error:
        print(f"Stopped: {error}")
        return 1

    if gone:
        print("Stopped, nothing written. These are in the layout but no longer in the data. Rename")
        print('or retire each first ({"kind": "retired", "bits": N}), so the new format starts clean:')
        for line in gone:
            print(f"  {line}")
        return 1

    if not retired and not any("widened" in line for line in added):
        print("Nothing has outgrown its width and nothing is retired, so no new format is needed.")
        print("Run it without --new-format to append what's new.")
        return 1

    layout["format"] = frozen["format"] + 1
    FROZEN_DIR.mkdir(exist_ok=True)
    frozen_path.write_text(dump(frozen), encoding="utf-8", newline="")
    LAYOUT.write_text(dump(layout), encoding="utf-8", newline="")
    print(f"Froze format {frozen['format']} as {frozen_path.relative_to(ROOT)}.")
    print(f"Started format {layout['format']}: {retired} retired placeholder(s) dropped, {len(added)} change(s):")
    for line in added[:40]:
        print(f"  {line}")
    if len(added) > 40:
        print(f"  ... and {len(added) - 40} more")
    total = sum(field["bits"] for field in layout["fields"])
    print(f"Wrote {LAYOUT.relative_to(ROOT)}: {len(layout['fields'])} fields, {total} bits.")
    return 0


def main():
    args = sys.argv[1:]
    if "--new-format" in args:
        if "--check" in args:
            print("--check and --new-format don't go together.")
            return 1
        return new_format()
    check_only = "--check" in args
    try:
        layout = read_json(LAYOUT) if LAYOUT.exists() else json.loads(json.dumps(NEW_LAYOUT))
        added, gone, problems = update(layout)
    except LayoutError as error:
        print(f"Stopped: {error}")
        return 1

    if problems:
        print("Stopped, nothing written. These fields have outgrown their width:")
        for line in problems:
            print(f"  {line}")
        print("That takes a new format: run this again with --new-format.")
        return 1

    if gone:
        print("In the layout but no longer in the data (left alone). If one was renamed, rename it")
        print('in the layout; if it was removed, turn its field into {"kind": "retired", "bits": N}:')
        for line in gone:
            print(f"  {line}")

    if not added:
        print("The layout is up to date.")
        return 0
    print(f"{len(added)} addition(s):")
    for line in added[:40]:
        print(f"  {line}")
    if len(added) > 40:
        print(f"  ... and {len(added) - 40} more")
    if check_only:
        print("Not written (--check).")
        return 1
    LAYOUT.write_text(dump(layout), encoding="utf-8", newline="")
    total = sum(field["bits"] for field in layout["fields"])
    print(f"Wrote {LAYOUT.relative_to(ROOT)}: {len(layout['fields'])} fields, {total} bits.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
