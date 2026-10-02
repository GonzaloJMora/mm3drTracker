"""Build the site that gets published: only what the pages use, with script and
stylesheet addresses stamped with the version.

Copies every file data/offline.json lists, plus offlineWorker.js (the browser
fetches it itself, so the list leaves it out), into _site/. In the two pages,
js/foo.js becomes js/foo.js?v=<version> and css/foo.css likewise, so a release
gives every script a new address and a browser can't pair an old one from its
memory with new data. The repo's own files are never changed. See README.md,
Releasing.

    python scripts/buildSite.py                 build into _site/
    python scripts/buildSite.py --out DIR       build somewhere else
"""

import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "_site"
WORKER = "offlineWorker.js"

# A script or stylesheet the page loads from js/ or css/, not yet stamped.
LOCAL_ASSET = re.compile(r'((?:src|href)=")((?:js|css)/[^"?#]+\.(?:js|css))(")')


class BuildError(Exception):
    pass


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def stamp(html, version):
    return LOCAL_ASSET.sub(lambda match: f"{match.group(1)}{match.group(2)}?v={version}{match.group(3)}", html)


def clear(out):
    if out == ROOT or ROOT.is_relative_to(out):
        raise BuildError(f"{out} holds the repo itself, so it can't be built into.")
    if not out.exists():
        return
    # Only an earlier build is ever deleted, never a folder that happens to be named.
    if any(out.iterdir()) and not (out / WORKER).exists():
        raise BuildError(f"{out} isn't empty and isn't an earlier build, so it was left alone.")
    shutil.rmtree(out)


def build(out):
    version = read_json(ROOT / "data" / "version.json")["version"]
    files = [name for name in read_json(ROOT / "data" / "offline.json")["files"] if name != "./"]
    files.append(WORKER)

    missing = [name for name in files if not (ROOT / name).is_file()]
    if missing:
        raise BuildError("data/offline.json lists files that don't exist: " + ", ".join(missing) +
                         ". Run scripts/updateOfflineFiles.py.")

    clear(out)
    for name in files:
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if name.endswith(".html"):
            text = (ROOT / name).read_text(encoding="utf-8")
            target.write_text(stamp(text, version), encoding="utf-8", newline="")
        else:
            shutil.copyfile(ROOT / name, target)
    return version, len(files)


def main(args):
    out = DEFAULT_OUT
    if args[:1] == ["--out"] and len(args) == 2:
        out = Path(args[1]).resolve()
    elif args:
        print("Usage: python scripts/buildSite.py [--out DIR]")
        return 2
    try:
        version, count = build(out)
    except BuildError as error:
        print(f"Stopped: {error}")
        return 1
    print(f"Built {count} files into {out} for version {version}.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
