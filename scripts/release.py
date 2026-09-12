"""Cut a release of the tracker.

Gathers what each branch logged in documentation/unreleased/ (see
scripts/logBranchChanges.py) into a new entry at the top of
documentation/changelog.md, deletes the files it read and bumps
data/version.json. Nothing here commits, tags or pushes: the result goes in a
pull request, and .github/workflows/release.yml tags the release once that
merges. See README.md, Releasing.

    python scripts/release.py                 interactive release (release.bat runs this)
    python scripts/release.py version         print the current version
    python scripts/release.py notes 0.12.1    print that version's changelog entry

The last two are what the workflow calls. The changelog and the unreleased files
are both written and read in this one file, so each format has one owner.
"""

import datetime
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION_FILE = ROOT / "data" / "version.json"
CHANGELOG_FILE = ROOT / "documentation" / "changelog.md"

# One file per branch, so two open pull requests never edit the same file. Don't
# fold them into one shared file with merge=union in .gitattributes: rebasing a
# branch cut before a release silently restores the lines that release shipped.
UNRELEASED_DIR = ROOT / "documentation" / "unreleased"

VERSION_PATTERN = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
HEADING_PREFIX = "## Version: "
CHANGES_LABEL = "**Changes:**"
NOTES_LABEL = "**Notes:**"
SEPARATOR = "---"
BULLET = re.compile(r"^[-*]\s+")
UNRELEASED_COMMENT = ("<!-- Logged by scripts/logBranchChanges.py. scripts/release.py moves "
                      "these into changelog.md and deletes this file. -->")

# The same three rules as the table in README.md, Versioning. Change both together.
RELEASE_TYPES = [
    ("Major", "Saves from an earlier major version no longer load"),
    ("Minor", "Bigger than a hotfix, and existing saves still load"),
    ("Hotfix", "Bug fixes only"),
]


class ReleaseError(Exception):
    """A problem with the files, reported in one line rather than a traceback."""


def rel(path):
    return path.relative_to(ROOT).as_posix()


def plural(count, word):
    return f"{count} {word}{'' if count == 1 else 's'}"


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
    lines = [f"{HEADING_PREFIX}v{version}", "", f"**Released:** {date}", "", CHANGES_LABEL]
    lines += [f"- {change}" for change in changes]
    lines += ["", NOTES_LABEL]
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


# ---------- documentation/unreleased/ ----------

def read_unreleased_file(path):
    """(changes, notes) from one branch's file. A line that is not a bullet under
    one of the two labels is an error, not something to drop on the way to a
    release."""
    changes, notes = [], []
    section = None
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    for number, line in enumerate(text.split("\n"), start=1):
        line = line.strip()
        if not line or (line.startswith("<!--") and line.endswith("-->")):
            continue
        if line == CHANGES_LABEL:
            section = changes
        elif line == NOTES_LABEL:
            section = notes
        elif section is not None and BULLET.match(line):
            section.append(BULLET.sub("", line))
        else:
            raise ReleaseError(f"{rel(path)} line {number} is not a bullet under "
                               f"{CHANGES_LABEL} or {NOTES_LABEL}: {line}")
    return changes, notes


def format_unreleased_file(changes, notes):
    lines = [UNRELEASED_COMMENT, "", CHANGES_LABEL]
    lines += [f"- {change}" for change in changes]
    lines += ["", NOTES_LABEL]
    lines += [f"- {note}" for note in notes]
    return "\n".join(lines) + "\n"


def read_unreleased():
    """Every branch's file in name order, and their changes and notes combined."""
    paths = sorted(UNRELEASED_DIR.glob("*.md")) if UNRELEASED_DIR.is_dir() else []
    changes, notes = [], []
    for path in paths:
        file_changes, file_notes = read_unreleased_file(path)
        changes += file_changes
        notes += file_notes
    return paths, changes, notes


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


# ---------- modes ----------

def release():
    version_data = read_version_data()
    changelog = read_changelog()
    unreleased, changes, notes = read_unreleased()
    current = version_data["version"]

    if not changes:
        raise ReleaseError(f"Nothing to release: no changes are logged in {rel(UNRELEASED_DIR)}. "
                           "Each branch logs its own with scripts/logBranchChanges.py.")

    print("MM3D Randomizer Tracker - new release")
    print()
    print(f"Logged in {rel(UNRELEASED_DIR)}: {', '.join(path.name for path in unreleased)}")
    print()
    kind = ask_release_type(current)
    new_version = bump(current, kind)
    if find_entry(changelog, new_version) is not None:
        raise ReleaseError(f"{rel(CHANGELOG_FILE)} already has an entry for v{new_version}.")

    entry = format_entry(new_version, datetime.date.today().strftime("%m/%d/%Y"), changes, notes)
    print()
    print(f"This sets {rel(VERSION_FILE)} to {new_version} (from {current}), adds this entry to "
          f"{rel(CHANGELOG_FILE)} and deletes the {plural(len(unreleased), 'file')} it came from:")
    print()
    print(entry)
    if not ask_yes_no("Write this release?"):
        print("Cancelled. Nothing was written.")
        return

    # Changelog first, so a rerun after a failure stops at the entry that already
    # exists. Version last: bumped with the logged files still in place, a rerun
    # would release them again under the next number.
    write_text(CHANGELOG_FILE, insert_entry(changelog, entry))
    for path in unreleased:
        path.unlink()
    version_data["version"] = new_version
    write_text(VERSION_FILE, json.dumps(version_data, indent=2) + "\n")

    print()
    print(f"Wrote v{new_version} to {rel(VERSION_FILE)} and {rel(CHANGELOG_FILE)}, and deleted "
          f"the logged files.")
    print("Next: review with git diff, commit, and open a pull request. Once it merges, the")
    print(f"release workflow tags that commit v{new_version} and publishes this entry as its "
          "release notes.")


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
