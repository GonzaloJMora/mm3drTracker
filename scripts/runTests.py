"""Run the test suite, setting up what it needs first. See README.md, Testing.

Needs Node.js (24 or later) and Python 3; everything else it installs itself, into
this repo only: the pinned test packages (npm ci, when node_modules is missing or
older than package-lock.json) and the browsers Playwright drives.

    python scripts/runTests.py                  every test
    python scripts/runTests.py saving           one group (any part of a file name)
    python scripts/runTests.py --headed         watch the browsers
    python scripts/runTests.py --project=chromium

Anything after the script name goes to `playwright test` as it is.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / "package-lock.json"
# npm writes this on every install, so it dates the packages in node_modules.
INSTALLED = ROOT / "node_modules" / ".package-lock.json"
MIN_NODE = 24


def tool(name):
    found = shutil.which(name)
    if not found:
        print(f"{name} wasn't found. Install Node.js {MIN_NODE} or later from https://nodejs.org/ "
              "(it includes npm), then run this again.")
        sys.exit(1)
    return found


def run(command):
    return subprocess.run(command, cwd=ROOT).returncode


def main(args):
    node = tool("node")
    npm = tool("npm")
    npx = tool("npx")

    version = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip()
    try:
        major = int(version.lstrip("v").split(".")[0])
    except ValueError:
        major = 0
    if major < MIN_NODE:
        print(f"Node.js {version or '(unknown version)'} is too old: the tests need {MIN_NODE} or later, "
              "from https://nodejs.org/")
        return 1

    if not INSTALLED.exists() or INSTALLED.stat().st_mtime < LOCK.stat().st_mtime:
        print("Installing the test packages...")
        if run([npm, "ci"]) != 0:
            return 1

    # Quick when the browsers are already there.
    if run([npx, "playwright", "install", "chromium", "firefox", "webkit"]) != 0:
        print("Playwright couldn't install its browsers. On Linux, try: npx playwright install --with-deps")
        return 1

    status = run([npx, "playwright", "test", *args])
    if status != 0:
        print()
        print("Some tests failed. The report shows each failing step, with a trace:")
        print("    npx playwright show-report")
    return status


if __name__ == "__main__":
    os.environ.setdefault("FORCE_COLOR", "1")
    sys.exit(main(sys.argv[1:]))
