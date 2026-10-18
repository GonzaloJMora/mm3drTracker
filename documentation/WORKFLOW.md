# Workflow

How work gets from a branch to the live site: branches and logging changes, version
numbers, and cutting a release.

## Branches

Work happens on `develop`; `main` only changes at a release, and the live site is
published from it. Nothing is pushed straight to either: every change lands through a
pull request.

1. Branch off the latest `develop`, named `feature/<what_it_adds>` or
   `bugfix/<what_it_fixes>`, in snake_case.
2. Log what the branch changes as you go, with the branch changes script:
   - **Windows:** double-click `scripts/release/logBranchChanges.bat`, or run `python scripts/release/logBranchChanges.py`
   - **macOS / Linux:** `python3 scripts/release/logBranchChanges.py`
3. Open a pull request into `develop`. The tests (TESTING.md) run on it, and it can
   only merge once they pass on the latest `develop`: if `develop` moves while it is
   open, use **Update branch** and let them run again.
4. Merge with **Squash and merge**, so the branch lands on `develop` as one commit.

**Log what a player would notice**, one line each: a feature added, a bug fixed. The
steps, the files touched and the tests run don't get lines, and neither does a fix to
something the branch itself added. The script refuses to run on `main`, `develop` or a
`release/` branch, since changes are logged on the branch that makes them. It asks for
the changes one per line, finished with an empty line, then for any notes, and writes
them to `documentation/unreleased/<branch>.md`. Run it again whenever there is more: it
shows what the file holds and adds to it. Commit the file with the work. It is plain
markdown, so correcting a line is an ordinary edit, and a long line can wrap onto
indented lines, which the release joins back up.

**Each branch has a file of its own**, so two open pull requests never edit the same
one; the next release gathers them all. The file records the branch that started it,
and the script won't add to a file another branch started, since two branch names can
make the same file name (`feature/foo` and `feature-foo`).

**File names are case-sensitive on the live site**, though not on Windows or macOS:
`bow.png` and `Bow.png` are one file on your machine and two once deployed. To change
only the case of a name, rename it with `git mv old-name New-Name`; a rename in the
file browser isn't seen by git. The tests run on Linux in CI, so a reference with the
wrong case fails there.

## Versioning

Releases are numbered `x.y.z`:

| Part | Bumped when |
|---|---|
| `x` — major | Saves from earlier versions can no longer be brought up to date |
| `y` — minor | A new feature is added, and earlier saves still load |
| `z` — hotfix | Bug fixes only: nothing new, and earlier saves still load |

A release takes the highest part that applies: a new feature alongside some fixes is
minor, and a change that leaves old saves behind is major whatever else is in it.
`scripts/release/release.py` shows these same three rules when it asks for the release
type, so a change to one is made in both places.

The number lives only in `data/version.json`. The page shows it in the footer and the
load-error report, and `documentation/changelog.md` records what each version changed.
Neither is edited by hand: the release script writes both.

## Releasing

A release takes two pull requests, made once everything going into it has merged into
`develop`:

1. Branch off the latest `develop`, named `release/vX.Y.Z` after the version it will
   be.
2. Run the release script:
   - **Windows:** double-click `scripts/release/release.bat`, or run `python scripts/release/release.py`
   - **macOS / Linux:** `python3 scripts/release/release.py`
3. Review the result with `git diff`, commit it, open a pull request into `develop`,
   and squash and merge it once the tests pass.
4. Open a pull request from `develop` into `main`, and merge it with **Create a merge
   commit**. Never squash or rebase this one: either gives `main` new copies of
   `develop`'s commits, and the two branches drift apart for good.

The script lists the files waiting in `documentation/unreleased/` and asks whether this
is a major, minor or hotfix release, each option showing its rule and the version it
would produce. It shows the finished entry and asks before writing anything; on yes it
adds the entry, dated today, to the top of the changelog, deletes the files it read, and
sets the new version. It never commits, tags or pushes. With nothing logged, it stops
and says so. It checks first that the logged files can be deleted, so a read-only one
stops it before anything is written, and if a release stops partway, the next run offers
to finish it.

Merge nothing else into `develop` between the two pull requests. One that merges in
between ships in the release, but its logged changes wait for the next entry.

When the merge into `main` lands, two workflows run. The
[release workflow](../.github/workflows/release.yml) sees a version with no tag yet, tags
that commit `vx.y.z`, and publishes a GitHub release with the changelog entry as its
notes; with no entry for the version it fails and nothing is tagged. The
[deploy workflow](../.github/workflows/deploy.yml) runs the full test suite again, then
publishes the site. Leave the changelog's `## Version: vx.y.z` lines exactly as the
script writes them: they are how the workflow finds an entry.

**What gets published is a built copy, not the repo.** `scripts/release/buildSite.py`
copies only the files the pages use (the list in `data/offline.json`, plus the offline
worker) into `_site/`, and stamps every script and stylesheet address with the version,
so a browser can't pair a script it still holds from the last version with new data
(OFFLINE.md). Build it locally to see exactly what goes out; the tests check the build
on every pull request.
