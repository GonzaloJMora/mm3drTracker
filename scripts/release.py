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
import os
import re
import sys
import uuid
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
BRANCH_COMMENT = re.compile(r"^<!-- Branch: (.+) -->$")

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
        data = json.loads(VERSION_FILE.read_text(encoding="utf-8-sig"))
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


def version_key(version):
    return tuple(int(part) for part in VERSION_PATTERN.match(version).groups())


# ---------- changelog.md ----------

def read_changelog():
    try:
        return CHANGELOG_FILE.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
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


def newest_entry_version(changelog):
    """The version of the topmost entry, or None when there is none to read."""
    for line in changelog.split("\n"):
        if is_heading(line):
            version = line[len(HEADING_PREFIX):].strip()
            version = version[1:] if version.startswith("v") else version
            return version if VERSION_PATTERN.match(version) else None
    return None


def format_entry(version, date, changes, notes):
    # Keep the blank line before the separator: markdown reads "---" directly under
    # a line of text as an underline and turns that line into a heading.
    lines = [f"{HEADING_PREFIX}v{version}", "", f"**Released:** {date}", "", CHANGES_LABEL]
    lines += [f"- {change}" for change in changes]
    # Only when there are some: an empty heading would be published as the last
    # line of the release notes.
    if notes:
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
    """(changes, notes) from one branch's file. A line that is neither a bullet
    under one of the two labels nor an indented line carrying the bullet above on
    is an error, not something to drop on the way to a release."""
    changes, notes = [], []
    section = None
    text = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
    for number, raw in enumerate(text.split("\n"), start=1):
        line = raw.strip()
        if not line or (line.startswith("<!--") and line.endswith("-->")):
            continue
        if line == CHANGES_LABEL:
            section = changes
        elif line == NOTES_LABEL:
            section = notes
        elif section is not None and BULLET.match(line):
            section.append(BULLET.sub("", line))
        elif section and raw[:1] in (" ", "\t"):
            # A bullet wrapped by hand: the indented line carries on the one above.
            section[-1] += " " + line
        else:
            raise ReleaseError(f"{rel(path)} line {number} is not a bullet under "
                               f"{CHANGES_LABEL} or {NOTES_LABEL}: {line}")
    return changes, notes


def branch_of_unreleased_file(path):
    """The branch that started the file, or None for a file that doesn't say."""
    for line in path.read_text(encoding="utf-8-sig").replace("\r\n", "\n").split("\n"):
        match = BRANCH_COMMENT.match(line.strip())
        if match:
            return match.group(1)
    return None


def format_unreleased_file(changes, notes, branch=None):
    lines = [UNRELEASED_COMMENT]
    if branch:
        lines.append(f"<!-- Branch: {branch} -->")
    lines += ["", CHANGES_LABEL]
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


def undeletable(paths):
    """The logged files that can't be deleted, found by renaming each one and back:
    a rename is refused by the same locks and permissions as a delete, which
    os.access can't see. Windows still renames a read-only file it won't delete."""
    blocked = []
    for path in paths:
        if os.name == "nt" and not os.access(path, os.W_OK):
            blocked.append(path)
            continue
        probe = path.with_name(f"{path.name}.{uuid.uuid4().hex[:8]}.releasecheck")
        try:
            path.rename(probe)
        except OSError:
            blocked.append(path)
            continue
        try:
            probe.rename(path)
        except OSError as error:
            raise ReleaseError(f"{rel(probe)} couldn't be renamed back to {path.name} "
                               f"({error.strerror or error}), so nothing was written. "
                               "Rename it back by hand and run this again.")
    return blocked


def refuse_undeletable(paths):
    blocked = undeletable(paths)
    if blocked:
        raise ReleaseError(f"{', '.join(rel(path) for path in blocked)} can't be deleted (read-only, or open "
                           "in another program?), so nothing was written. Fix that and run this again.")


def delete_logged(paths, version):
    # The check above can pass and a file still be locked by the time it is deleted.
    # The entry is already written then, which is the release the next run finishes.
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError as error:
            raise ReleaseError(f"The v{version} entry is in {rel(CHANGELOG_FILE)}, but {rel(path)} couldn't be "
                               f"deleted ({error.strerror or error}). Close whatever has it open and run this "
                               "again to finish the release.")


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

def print_next_steps(version):
    print("Next: review with git diff, commit, and open a pull request. Once it merges, the")
    print(f"release workflow tags that commit v{version} and publishes this entry as its "
          "release notes.")


def finish_interrupted(version_data, changelog, unreleased, newest):
    """Deletes the logged files the entry for newest already holds, and bumps the
    version to it. A file with anything the entry doesn't hold arrived after that
    release and waits for the next one."""
    current = version_data["version"]
    entry = {line.strip() for line in find_entry(changelog, newest)}
    released, waiting = [], []
    for path in unreleased:
        changes, notes = read_unreleased_file(path)
        (released if all(f"- {item}" in entry for item in changes + notes) else waiting).append(path)

    print("MM3D Randomizer Tracker - new release")
    print()
    print(f"A release to v{newest} started but didn't finish: {rel(CHANGELOG_FILE)} has its entry, "
          f"but {rel(VERSION_FILE)} is still {current}.")
    if released:
        print(f"Its logged files still to delete: {', '.join(path.name for path in released)}")
    if waiting:
        print(f"Not part of it, so left for the next release: {', '.join(path.name for path in waiting)}")
    print()
    refuse_undeletable(released)
    if not ask_yes_no(f"Finish releasing v{newest}?"):
        print("Canceled. Nothing was written.")
        return

    delete_logged(released, newest)
    version_data["version"] = newest
    write_text(VERSION_FILE, json.dumps(version_data, indent=2) + "\n")

    print()
    print(f"Finished v{newest}: set {rel(VERSION_FILE)} to {newest} and deleted the logged files "
          "it came from.")
    print_next_steps(newest)


def release():
    version_data = read_version_data()
    changelog = read_changelog()
    unreleased, changes, notes = read_unreleased()
    current = version_data["version"]

    # A newest entry ahead of version.json is a release that stopped partway.
    # Starting another from here would put the same changes in the changelog twice.
    newest = newest_entry_version(changelog)
    if newest and version_key(newest) > version_key(current):
        finish_interrupted(version_data, changelog, unreleased, newest)
        return

    if not changes:
        raise ReleaseError(f"Nothing to release: no changes are logged in {rel(UNRELEASED_DIR)}. "
                           "Each branch logs its own with scripts/logBranchChanges.py.")
    # Before anything is asked, so before anything is written.
    refuse_undeletable(unreleased)

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
        print("Canceled. Nothing was written.")
        return

    # Changelog first and version last, so a failure in between leaves the entry
    # ahead of version.json, which the next run finishes. Bumped with the logged
    # files still in place, a rerun would release them again under the next number.
    write_text(CHANGELOG_FILE, insert_entry(changelog, entry))
    delete_logged(unreleased, new_version)
    version_data["version"] = new_version
    write_text(VERSION_FILE, json.dumps(version_data, indent=2) + "\n")

    print()
    print(f"Wrote v{new_version} to {rel(VERSION_FILE)} and {rel(CHANGELOG_FILE)}, and deleted "
          f"the logged files.")
    print_next_steps(new_version)


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
        print("Canceled. Nothing was written.")
        return 1
    return 0


if __name__ == "__main__":
    # Entries hold whatever was typed, and output redirected to a file on Windows
    # otherwise falls back to a code page that cannot encode all of it.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
