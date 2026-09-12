"""Log what this branch changes, for the next release's changelog entry.

Writes documentation/unreleased/<branch>.md, starting it on the first run and
adding to it on every run after, so it can be kept up as the work goes. Commit
it with the work; scripts/release.py moves every branch's file into the
changelog when a release is cut. See README.md, Workflow.

    python scripts/logBranchChanges.py        (logBranchChanges.bat runs this)
"""

import re
import subprocess
import sys

# Importing release.py would otherwise leave scripts/__pycache__ in the working
# tree, and nothing ignores it.
sys.dont_write_bytecode = True

from release import (BULLET, ROOT, UNRELEASED_DIR, ReleaseError, ask, ask_yes_no,
                     format_unreleased_file, plural, read_unreleased_file, rel, write_text)

FINISH_HINT = "One per line. Press Enter on an empty line when you're done."


def current_branch():
    try:
        result = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"],
                                cwd=ROOT, capture_output=True, text=True)
    except FileNotFoundError:
        raise ReleaseError("git is needed to name the file after the branch.")
    branch = result.stdout.strip()
    if result.returncode != 0 or not branch:
        raise ReleaseError("Could not read the current branch from git.")
    if branch == "HEAD":
        raise ReleaseError("No branch is checked out. Check out the branch the changes are on.")
    if branch == "main":
        raise ReleaseError("This is main. Changes are logged on the branch that makes them, "
                           "so branch off main first (README.md, Workflow).")
    return branch


def file_for(branch):
    # Git allows characters in a branch name that Windows does not allow in a file
    # name, and the slash in bugfix/... would otherwise make a folder.
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", branch).strip("-.")
    if not name:
        raise ReleaseError(f'Could not make a file name out of the branch "{branch}".')
    return UNRELEASED_DIR / f"{name}.md"


def ask_list(label):
    """One item per prompt until an empty line. A typed "- " bullet is dropped."""
    items = []
    while True:
        item = BULLET.sub("", ask(f"{label} {len(items) + 1}: "))
        if not item:
            return items
        items.append(item)


def log_changes():
    branch = current_branch()
    path = file_for(branch)
    exists = path.exists()
    # Read before asking anything, so a file that can't be read is reported
    # before the typing rather than after it.
    changes, notes = read_unreleased_file(path) if exists else ([], [])

    print(f"MM3D Randomizer Tracker - log changes for {branch}")
    print()
    if exists:
        print(f"Adding to {rel(path)}, which has {plural(len(changes), 'change')} "
              f"and {plural(len(notes), 'note')} so far:")
        for change in changes:
            print(f"  - {change}")
        for note in notes:
            print(f"  - (note) {note}")
    else:
        print(f"Starting {rel(path)}.")

    print()
    print(f"What did this branch change? {FINISH_HINT}")
    new_changes = ask_list("Change")

    print()
    new_notes = []
    if ask_yes_no("Add any notes?"):
        print(f"Notes. {FINISH_HINT}")
        new_notes = ask_list("Note")

    if not new_changes and not new_notes:
        print("Nothing entered. Nothing was written.")
        return

    UNRELEASED_DIR.mkdir(parents=True, exist_ok=True)
    write_text(path, format_unreleased_file(changes + new_changes, notes + new_notes))

    print()
    print(f"Added {plural(len(new_changes), 'change')} and {plural(len(new_notes), 'note')} "
          f"to {rel(path)}.")
    print("Commit it with the work, and run this again whenever there is more to log.")


def main(args):
    if args:
        print(__doc__.strip())
        return 2
    try:
        log_changes()
    except ReleaseError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print()
        print("Cancelled. Nothing was written.")
        return 1
    return 0


if __name__ == "__main__":
    # Entries hold whatever was typed, and output redirected to a file on Windows
    # otherwise falls back to a code page that cannot encode all of it.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
