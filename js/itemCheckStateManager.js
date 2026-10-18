// window.ItemCheckState — which locations are completed, the source of truth a save
// reads and writes. No DOM: locationTracker.js draws the rows from it.
//
// A location is one check id, or every id in a check_group with it: those tick
// off together and count once. Which ids those are is DataModel.locationsOf().
(function () {
    "use strict";

    // Check id -> its location key. The key is an id from the location, internal
    // only: saves name check ids, never these.
    const locationOf = new Map();
    // Location key -> every check id in it.
    const members = new Map();
    const completed = new Set();
    // Completed ids from a save that no rendered check stands for, such as a region
    // whose file failed to load. Kept in every save so the next load that has them
    // shows them again, and never counted.
    const unplaced = new Set();
    // Check id -> { accessible, vanilla } from the last sweep. Derived, like
    // GameState.tokens, and never saved.
    let statuses = new Map();

    function keyOf(id) {
        return locationOf.has(id) ? locationOf.get(id) : id;
    }

    window.ItemCheckState = {
        // Called once with the regions that rendered, before the first sweep, and a
        // save's completed check ids if the tracker was opened from one. Draws
        // nothing: locationTracker.js puts `completed` on those rows itself.
        init(regions, checkGroups, completedIds = []) {
            locationOf.clear();
            members.clear();
            completed.clear();
            unplaced.clear();
            statuses = new Map();

            // Which checks are one location is DataModel's to say, so the data checks
            // ("vanilla-agreement") compare exactly the locations this ticks.
            const ids = regions.flatMap(region => (region.item_checks || []).map(check => check.id));
            window.DataModel.locationsOf(ids, checkGroups).forEach((key, id) => {
                locationOf.set(id, key);
                if (!members.has(key)) members.set(key, []);
                members.get(key).push(id);
            });

            // A check_group with a rendered member already carries the location, and
            // keeping the absent id as well would tick it again after an untick.
            const grouped = new Set((checkGroups || []).filter(group => group.some(id => locationOf.has(id))).flat());
            (completedIds || []).forEach(id => {
                if (locationOf.has(id)) completed.add(keyOf(id));
                else if (!grouped.has(id)) unplaced.add(id);
            });
            if (unplaced.size) {
                console.warn(`ItemCheckState: the save marks ${unplaced.size} check(s) this tracker doesn't show, kept in the save: ${[...unplaced].join(", ")}`);
            }
        },

        // Every completed check id, for a save: each id of a completed location, and
        // the saved ones no rendered check stands for.
        snapshot() {
            return this.completedIds().concat([...unplaced]);
        },

        // Every rendered check id, in render order.
        checkIds() {
            return [...locationOf.keys()];
        },

        locationKey: keyOf,

        // Every check id that is the same location as this one, itself included.
        linkedIds(id) {
            return (members.get(keyOf(id)) || [id]).slice();
        },

        isCompleted(id) {
            return completed.has(keyOf(id));
        },

        // Fires checkCompletionChanged with every id of the location, and only
        // when something moved.
        setCompleted(id, value) {
            const key = keyOf(id);
            if (completed.has(key) === Boolean(value)) return false;
            if (value) completed.add(key);
            else completed.delete(key);
            window.dispatchEvent(new CustomEvent("checkCompletionChanged", {
                detail: { ids: this.linkedIds(id) }
            }));
            return true;
        },

        toggle(id) {
            const value = !this.isCompleted(id);
            this.setCompleted(id, value);
            return value;
        },

        // Replaces every status at once: a sweep hands over the whole map.
        setStatuses(map) {
            statuses = map;
        },

        status(id) {
            return statuses.get(id) || { accessible: false, vanilla: false };
        },

        // Checks counted as locations, the one rule every count on the page uses: a
        // location counts once however many of its checks are listed, it is
        // accessible or non-randomized if any of them is, and with non-randomized
        // checks hidden those checks drop out, so a location counts only through a
        // randomized one. entries are { id, accessible, vanilla }. Remaining is what
        // isn't completed; locations lists each one for a caller that colors by them.
        count(entries, hideNonRandomized = false) {
            const locations = new Map();
            entries.forEach(({ id, accessible, vanilla }) => {
                if (hideNonRandomized && vanilla) return;
                const key = keyOf(id);
                const seen = locations.get(key);
                locations.set(key, {
                    completed: completed.has(key),
                    accessible: Boolean(accessible) || Boolean(seen && seen.accessible),
                    vanilla: Boolean(vanilla) || Boolean(seen && seen.vanilla)
                });
            });
            let checked = 0;
            let open = 0;
            locations.forEach(location => {
                if (location.completed) checked++;
                else if (location.accessible) open++;
            });
            return { total: locations.size, checked, accessible: open, remaining: locations.size - checked, locations: [...locations.values()] };
        },

        // Every check on the page counted, by its status from the last sweep.
        overall(hideNonRandomized = false) {
            return this.count(this.checkIds().map(id => Object.assign({ id }, this.status(id))), hideNonRandomized);
        },

        // Completed locations out of all of them, for a save's summary.
        progress(hideNonRandomized = false) {
            const { checked, total } = this.overall(hideNonRandomized);
            return { checked, total };
        },

        completedIds() {
            return this.checkIds().filter(id => this.isCompleted(id));
        }
    };

    // TrackerDebug is gameStateManager.js's object, so it's reached for once the data
    // is in (ARCHITECTURE.md, *Contracts and couplings*).
    window.TrackerData.onReady(() => {
        if (window.TrackerDebug) {
            window.TrackerDebug.completedChecks = () => window.ItemCheckState.completedIds();
        }
    });
})();
