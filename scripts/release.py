"""Cut a release of the tracker.

Bumps data/version.json and adds the release's entry to the top of
documentation/changelog.md, asking for everything it needs. Nothing here commits,
tags or pushes: .github/workflows/release.yml tags the release once the bump
reaches main. See README.md, Releasing.

    python scripts/release.py                 interactive release (release.bat runs this)
    python scripts/release.py version         print the current version
    python scripts/release.py notes 0.12.1    print that version's changelog entry

The last two are what the workflow calls, so the changelog format is written and
read in this one file.
"""

import datetime
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION_FILE = ROOT / "data" / "version.json"
CHANGELOG_FILE = ROOT / "documentation" / "changelog.md"

VERSION_PATTERN = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
HEADING_PREFIX = "## Version: "
SEPARATOR = "---"

# The same three rules as the table in README.md, Versioning. Change both together.
RELEASE_TYPES = [
    ("Major", "Saves from an earlier major version no longer load"),
    ("Minor", "Bigger than a hotfix, and existing saves still load"),
    ("Hotfix", "Bug fixes only"),
]

FINISH_HINT = "One per line. Press Enter on an empty line when you're done."


class ReleaseError(Exception):
    """A problem with the files, reported in one line rather than a traceback."""


def rel(path):
    return path.relative_to(ROOT).as_posix()


def write_text(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


# ---------- version.json ----------

def read_version_data():
    try:
        data = json.loads(VERSION_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ReleaseError(f"{rel(VERSION_FILE)} does not exist.")
    except json.JSONDecodeError as error:
        raise ReleaseError(f"{rel(VERSION_FILE)} is not valid JSON ({error}).")
    version = data.get("version") if isinstance(data, dict) else None
    if not isinstance(version, str) or not VERSION_PATTERN.match(version):
        raise ReleaseError(f'{rel(VERSION_FILE)} needs a "version" of the form x.y.z.')
    return data


def bump(version, kind):
    major, minor, hotfix = (int(part) for part in VERSION_PATTERN.match(version).groups())
    if kind == "Major":
        return f"{major + 1}.0.0"
    if kind == "Minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{hotfix + 1}"


# ---------- changelog.md ----------

def read_changelog():
    try:
        return CHANGELOG_FILE.read_text(encoding="utf-8").replace("\r\n", "\n")
    except FileNotFoundError:
        raise ReleaseError(f"{rel(CHANGELOG_FILE)} does not exist.")


def is_heading(line, version=None):
    if not line.startswith(HEADING_PREFIX):
        return False
    return version is None or line[len(HEADING_PREFIX):].strip() == f"v{version}"


def find_entry(changelog, version):
    """The lines of that version's entry, heading first, or None if it has none."""
    lines = changelog.split("\n")
    for start, line in enumerate(lines):
        if is_heading(line, version):
            end = start + 1
            while end < len(lines) and lines[end].strip() != SEPARATOR and not is_heading(lines[end]):
                end += 1
            return lines[start:end]
    return None


def format_entry(version, date, changes, notes):
    # Keep the blank line before the separator: markdown reads "---" directly under
    # a line of text as an underline and turns that line into a heading.
    lines = [f"{HEADING_PREFIX}v{version}", "", f"**Released:** {date}", "", "**Changes:**"]
    lines += [f"- {change}" for change in changes]
    lines += ["", "**Notes:**"]
    lines += [f"- {note}" for note in notes]
    lines += ["", SEPARATOR, ""]
    return "\n".join(lines)


def insert_entry(changelog, entry):
    """Newest first: the entry goes above the first existing one."""
    lines = changelog.split("\n")
    for index, line in enumerate(lines):
        if is_heading(line):
            before = "\n".join(lines[:index])
            return (before + "\n" if index else "") + entry + "\n" + "\n".join(lines[index:])
    return changelog.rstrip("\n") + "\n\n" + entry


# ---------- prompts ----------

def ask(prompt):
    return input(prompt).strip()


def ask_yes_no(question):
    while True:
        answer = ask(f"{question} (y/n): ").lower()
        if answer in ("y", "yes"):
            return True
        if answer in ("n", "no"):
            return False
        print("  Type y or n.")


def ask_release_type(current):
    print(f"Current version: {current}")
    print()
    print("What kind of release is this?")
    for number, (kind, rule) in enumerate(RELEASE_TYPES, start=1):
        print(f"  {number}) {kind:<6}  ->  {bump(current, kind):<9} {rule}")
    choices = [str(number) for number in range(1, len(RELEASE_TYPES) + 1)]
    choice_text = f"{', '.join(choices[:-1])} or {choices[-1]}"
    while True:
        answer = ask(f"Choose {choice_text}: ")
        if answer in choices:
            return RELEASE_TYPES[int(answer) - 1][0]
        print(f"  Type {choice_text}.")


def ask_list(label, at_least_one):
    """One item per prompt until an empty line. A typed "- " bullet is dropped."""
    items = []
    while True:
        item = re.sub(r"^[-*]\s+", "", ask(f"{label} {len(items) + 1}: "))
        if item:
            items.append(item)
        elif items or not at_least_one:
            return items
        else:
            print(f"  A release needs at least one {label.lower()}.")


# ---------- modes ----------

def release():
    version_data = read_version_data()
    changelog = read_changelog()
    current = version_data["version"]

    print("MM3D Randomizer Tracker - new release")
    print()
    kind = ask_release_type(current)
    new_version = bump(current, kind)
    # Checked before any typing, not after it.
    if find_entry(changelog, new_version) is not None:
        raise ReleaseError(f"{rel(CHANGELOG_FILE)} already has an entry for v{new_version}.")

    print()
    print(f"What changed in v{new_version}? {FINISH_HINT}")
    changes = ask_list("Change", at_least_one=True)

    print()
    notes = []
    if ask_yes_no("Add any notes to this release?"):
        print(f"Notes for v{new_version}. {FINISH_HINT}")
        notes = ask_list("Note", at_least_one=False)

    entry = format_entry(new_version, datetime.date.today().strftime("%m/%d/%Y"), changes, notes)
    print()
    print(f"This sets {rel(VERSION_FILE)} to {new_version} (from {current}) "
          f"and adds this entry to {rel(CHANGELOG_FILE)}:")
    print()
    print(entry)
    if not ask_yes_no("Write this release?"):
        print("Cancelled. Nothing was written.")
        return

    # Changelog first: if the second write then fails, a rerun stops at the entry
    # that already exists instead of bumping the version a second time.
    write_text(CHANGELOG_FILE, insert_entry(changelog, entry))
    version_data["version"] = new_version
    write_text(VERSION_FILE, json.dumps(version_data, indent=2) + "\n")

    print()
    print(f"Wrote v{new_version} to {rel(VERSION_FILE)} and {rel(CHANGELOG_FILE)}.")
    print("Next: review with git diff, then commit and push to main. The release workflow")
    print(f"tags that commit v{new_version} and publishes this entry as its release notes.")


def print_notes(version):
    if version.startswith("v"):
        version = version[1:]
    entry = find_entry(read_changelog(), version)
    if entry is None:
        raise ReleaseError(f"{rel(CHANGELOG_FILE)} has no entry for v{version}.")
    # The release is already titled with the version, so the heading is dropped.
    print("\n".join(entry[1:]).strip())


def main(args):
    try:
        if not args:
            release()
        elif args == ["version"]:
            print(read_version_data()["version"])
        elif len(args) == 2 and args[0] == "notes":
            print_notes(args[1])
        else:
            print(__doc__.strip())
            return 2
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
