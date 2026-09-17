# Changelog

<!-- Entries are added by scripts/release.py (README.md, Releasing), newest first.
     The release workflow finds each one by its "## Version: vx.y.z" line, so leave
     those lines exactly as written. -->

## Version: v0.13.0

**Released:** 09/16/2026

**Changes:**
- added a settings page as the new starting page: pick the settings your seed was generated with and your starting items, then launch a tracker that uses them
- the tracker now starts with the items your settings give you, and those items can't be clicked below where they start
- checks your settings and marks vanilla locations as not randomized, and their tooltip shows the item that's normally there
- added a Hide Non-Randomized Checks button to the tracker
- added a Show Only Accessible Checks button to the tracker's phone layout
- added a Launch New Tracker button to the tracker, to go back and change the settings
- added a script that serves the tracker to other devices on the same network, for testing on external devices (usually for testing on mobile)
- the release script now finishes a release that stopped partway instead of putting the same changes in the changelog twice
- fixed the release workflow reporting a bad version file as a missing changelog entry

**Notes:**
- settings last only for the browser tab they were picked in; a new tab starts from the settings page

---

## Version: v0.12.2

**Released:** 09/12/2026

**Changes:**
- fixed the item requirements popup on iPhone keeping its landscape text size after rotating back to portrait
- added a branch changes script (scripts/logBranchChanges.py) that logs each branch's changes into documentation/unreleased/ as work goes
- the release script now builds the changelog entry from documentation/unreleased/ and deletes those files, instead of asking for the changes
- README.md now describes working on a branch and opening a pull request instead of pushing to main

**Notes:**
- each branch logs its own changes in a separate file, so pull requests open at the same time never conflict over the changelog

---

## Version: v0.12.1

**Released:** 09/12/2026

**Changes:**
- fixed the item requirements popup on iPhone being cut off by the rounded screen corners and home bar
- back to top button, page edges and mobile tabs now stay clear of the iPhone notch and home bar
- version number now shows in the bottom left corner of the page
- load error message now includes the version number
- added a Development section to README.md covering running locally, data, versioning, releasing and contributing
- added data/version.json, a release script, and a workflow that tags each release from its changelog entry

**Notes:**

---

## Version: v0.12.0

**Released:** 09/11/2026

**Changes:**
- updated icons
- updated some item and map images
- item location checks now also use shapes to show status
- added in icon/color legend for item location checks
- map markers now show how many checks are accessible
- hovering over songs (except scarecrow song) now displays notes on desktop only
- hovering over item location checks on desktop now shows required items to access that location
- clicking info button on mobile shows required items to access that location
- general bug fixes

**Notes:**

---

## Version: Pre-v0.12.0

**Released:** Before 09/11/2026

**Changes:**
- reworked location tracking to use a map with clickable markers on desktop
- added in all regions for MM3D with empty item checks
- mobile overhaul
- general cleanup and improvements
- added in architecture documentation to make it easier for other people to understand design decisions
- updated README.md
- added name field to all items in Items.json
- added path to song notes images in Items.json
- item tracker tool tip names now use name field for items
- added all clock town location checks
- added images for song notes (to be used later)
- updated mystery milk image to differentiate it from regular milk item
- added in bomber's code to item tracker and relevant functionality
- renamed gameState.js to gameStateManager.js
- updated display of location tracker on desktop mode
- made it so that you can drag the debug window around the screen
- updated mobile mode to be usable (splits displays into tabs)
- added in a way to track the items that the player has in the back end that gets fed into the location tracker
- location tracker can now use obtained item data to determine whether a location is reachable
- added functionality to track items that count up instead of just toggling
- removed 0 graphic from ZoraEgg.png
- fixed up logic strings for location checks to accommodate rework of game state design
- added in a debug window (toggled with F1) that allows me to see what the back end considers to be in my inventory
- initial setup for color coding the location checks (contains test code for now)
- separated item tracker and location tracker code
- item tracking continuation
- prototype of location tracking
- bit of code cleanup
- adding in .nojekyll to fix deployment issue
- found some bugs I wanted to clean up so I have a clean deployment available
- added first version of tracker with item and mask grids
- fixed StoneStrayFairy naming
- added .gitignore
- added item images to new images directory
- added item list for keywords to link to images
- added item checks for south clock town to aid with initial setup and item check access logic
- initial commit

**Notes:**
- These older versions will not be tagged individually since they had already been released prior to this file's and the versioning scheme's existence
