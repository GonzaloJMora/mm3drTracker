"""Write data/offline.json: every file the site needs, for the offline copy.

offlineWorker.js stores these on a player's first visit, so the tracker works with no
connection. The list is the pages, the manifest, and everything under css/, js/,
data/ and images/; docs, scripts and repo files stay out, and so does offlineWorker.js, which
the browser fetches itself. A file left off the list is still stored the first
time a page uses it, so a stale list costs completeness, not correctness. The
"enabled" flag is the off switch: set it to false and every page removes the
offline copy on its next visit. See OFFLINE.md.

    python scripts/data/updateOfflineFiles.py            write the list
    python scripts/data/updateOfflineFiles.py --check    only report; exit 1 if out of date

Add --site DIR for a world whose data/ and images/ are served in place of the
repo's, such as tests/environment: the list is written to DIR/data/offline.json,
with the pages, css/ and js/ still the repo's.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "data" / "offline.json"
FOLDERS = ["css", "js", "data", "images"]
# The folders a --site world brings its own copy of.
SITE_FOLDERS = ["data", "images"]
site = None
ROOT_FILES = ["index.html", "tracker.html", "site.webmanifest"]


def base_of(folder):
    return site if site and folder in SITE_FOLDERS else ROOT


def current_files():
    # "./" is the site's own address, which serves index.html.
    files = ["./"] + [name for name in ROOT_FILES if (ROOT / name).exists()]
    for folder in FOLDERS:
        base = base_of(folder)

        # Sorted the same on every machine: Python orders paths ignoring case on
        # Windows and not on Linux, and CI would then see the list as changed.
        def sort_key(path):
            parts = path.relative_to(base).parts
            return [part.lower() for part in parts], list(parts)

        for path in sorted((base / folder).rglob("*"), key=sort_key):
            if path.is_file() and not path.name.startswith("."):
                files.append(path.relative_to(base).as_posix())
    return files


def main():
    global site, OUTPUT
    args = sys.argv[1:]
    if "--site" in args:
        at = args.index("--site")
        if at + 1 >= len(args):
            print("--site needs a folder.")
            return 1
        site = (ROOT / args[at + 1]).resolve()
        OUTPUT = site / "data" / "offline.json"
    check_only = "--check" in args
    enabled = True
    old_files = None
    if OUTPUT.exists():
        try:
            old = json.loads(OUTPUT.read_text(encoding="utf-8"))
            enabled = old.get("enabled", True) is not False
            old_files = old.get("files")
        except ValueError:
            print(f"{OUTPUT.relative_to(ROOT)} isn't valid JSON, so it is written fresh.")

    files = current_files()
    if files == old_files:
        print(f"The list is up to date: {len(files)} files.")
        return 0

    added = sorted(set(files) - set(old_files or []))
    gone = sorted(set(old_files or []) - set(files))
    for label, names in (("Added", added), ("Gone", gone)):
        if names:
            print(f"{label}: {len(names)}")
            for name in names[:20]:
                print(f"  {name}")
            if len(names) > 20:
                print(f"  ... and {len(names) - 20} more")
    if check_only:
        print("Not written (--check).")
        return 1

    lines = ["{", f'  "enabled": {json.dumps(enabled)},', '  "files": [']
    lines += [f"    {json.dumps(name)}{',' if i < len(files) - 1 else ''}" for i, name in enumerate(files)]
    lines += ["  ]", "}", ""]
    OUTPUT.write_text("\n".join(lines), encoding="utf-8", newline="")
    print(f"Wrote {OUTPUT.relative_to(ROOT)}: {len(files)} files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
