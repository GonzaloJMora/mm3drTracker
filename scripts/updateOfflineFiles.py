"""Write data/offline.json: every file the site needs, for the offline copy.

offlineWorker.js stores these on a player's first visit, so the tracker works with no
connection. The list is the pages, the manifest, and everything under css/, js/,
data/ and images/; docs, scripts and repo files stay out, and so does offlineWorker.js, which
the browser fetches itself. A file left off the list is still stored the first
time a page uses it, so a stale list costs completeness, not correctness. The
"enabled" flag is the off switch: set it to false and every page removes the
offline copy on its next visit. See ARCHITECTURE.md, Offline.

    python scripts/updateOfflineFiles.py            write the list
    python scripts/updateOfflineFiles.py --check    only report; exit 1 if out of date
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "data" / "offline.json"
FOLDERS = ["css", "js", "data", "images"]
ROOT_FILES = ["index.html", "tracker.html", "site.webmanifest"]


def current_files():
    # "./" is the site's own address, which serves index.html.
    files = ["./"] + [name for name in ROOT_FILES if (ROOT / name).exists()]
    for folder in FOLDERS:
        for path in sorted((ROOT / folder).rglob("*")):
            if path.is_file() and not path.name.startswith("."):
                files.append(path.relative_to(ROOT).as_posix())
    return files


def main():
    check_only = "--check" in sys.argv[1:]
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
    OUTPUT.write_text("\r\n".join(lines), encoding="utf-8", newline="")
    print(f"Wrote {OUTPUT.relative_to(ROOT)}: {len(files)} files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
