// Launching the tracker from the settings page, and the handoff between them: the
// settings picked on the one, read by the other. Kept in sessionStorage, so it
// belongs to this tab and survives a reload of either page. The two pages' addresses
// live here and nowhere else.
//
// Loaded in <head> on both pages, after storageKeys.js. The tracker marks <html> with
// data-requires-launch, and opened with nothing handed over and no ?defaults it
// leaves for the settings page here, before its body has drawn. See
// ARCHITECTURE.md, *Pages*.
(function () {
    "use strict";

    const KEY = window.StorageKeys.key("launch");
    const PROBE = KEY + ".probe";
    const SETTINGS_PAGE = "index.html";
    const TRACKER_PAGE = "tracker.html";
    // The settings page opens the tracker with this when it couldn't hand the picks
    // over, so the tracker starts on the defaults instead of sending the reader back.
    const DEFAULTS_URL = TRACKER_PAGE + "?defaults";

    function opensOnDefaults() {
        return new URLSearchParams(window.location.search).has("defaults");
    }

    // Named once per page rather than on every read.
    let warnedUnreadable = false;

    // Whether a handoff can be kept here at all. Asked by writing, because a browser
    // can read storage and still refuse a write — full storage, or a private mode
    // with no space — and a read alone calls that working.
    function storageUsable() {
        try {
            window.sessionStorage.setItem(PROBE, "1");
            window.sessionStorage.removeItem(PROBE);
            return true;
        } catch (error) {
            return false;
        }
    }

    const isPlainObject = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);

    function handoff(picks, { runId = null, save = null, stamp = null } = {}) {
        const data = { picks };
        if (runId) data.runId = runId;
        if (save) data.save = save;
        if (stamp) data.stamp = stamp;
        return JSON.stringify(data);
    }

    // The whole handoff, or null when there is none or it can't be read.
    function readHandoff() {
        // An older handoff that couldn't be removed must not pass for this launch.
        if (opensOnDefaults()) return null;
        let raw;
        try {
            raw = window.sessionStorage.getItem(KEY);
        } catch (error) {
            return null;
        }
        if (raw === null) return null;
        try {
            const data = JSON.parse(raw);
            if (isPlainObject(data) && isPlainObject(data.picks)) return data;
        } catch (error) {
            // Falls through to the warning.
        }
        if (!warnedUnreadable) {
            warnedUnreadable = true;
            console.warn("TrackerLaunch: the handed-over settings can't be read, so the defaults are used.");
        }
        return null;
    }

    window.TrackerLaunch = {
        // The picks from the last launch in this tab, as { settingId: value }, or
        // null when there are none or they can't be read.
        read() {
            const data = readHandoff();
            return data ? data.picks : null;
        },

        // A save handed over with the picks, as named values: { slots, checks, view }.
        // Null for a new tracker. Its settings travel as the picks, not in here.
        readSave() {
            const data = readHandoff();
            return data && isPlainObject(data.save) ? data.save : null;
        },

        // The run this tab's tracker belongs to, which its autosave carries. Null
        // when the handoff has none.
        readRunId() {
            const data = readHandoff();
            return data && typeof data.runId === "string" ? data.runId : null;
        },

        // The savedAt of the autosave this tab last wrote or resumed from. Another
        // copy of the same run in the autosave is another tab's. Null when none.
        readStamp() {
            const data = readHandoff();
            return data && typeof data.stamp === "string" ? data.stamp : null;
        },

        // False when these picks can't be kept. An older handoff is removed then, so
        // the tracker opens on the defaults rather than on an earlier launch's
        // settings that would pass for these. A save, when given, is what readSave()
        // returns, and a stamp what readStamp() returns.
        write(picks, options) {
            try {
                window.sessionStorage.setItem(KEY, handoff(picks, options));
                return true;
            } catch (error) {
                try {
                    window.sessionStorage.removeItem(KEY);
                } catch (removeError) {
                    // Nothing more to try.
                }
                return false;
            }
        },

        // The tracker keeps the handoff up to date as it autosaves, so a reload opens
        // where the run is rather than where it was opened. The page hands over its
        // own picks rather than keeping the ones it finds: one the browser brings
        // back with Back finds the handoff of a later launch in this tab.
        updateSave(picks, options) {
            if (opensOnDefaults()) return false;
            try {
                window.sessionStorage.setItem(KEY, handoff(picks, options));
                return true;
            } catch (error) {
                return false;
            }
        },

        // Hands the picks (and a save, when given) over and opens the tracker. False,
        // opening nothing, when they can't be kept.
        open(picks, options) {
            if (!this.write(picks, options)) return false;
            window.location.href = TRACKER_PAGE;
            return true;
        },

        openOnDefaults() {
            window.location.href = DEFAULTS_URL;
        },

        toSettings() {
            window.location.href = SETTINGS_PAGE;
        },

        storageWorks: storageUsable
    };

    // Only the settings page's own write knows whether the picks fit, so it is what
    // decides between a handoff and DEFAULTS_URL. Testing storage again here asks a
    // different question: a small test value can fit where the picks didn't.
    if (document.documentElement.hasAttribute("data-requires-launch") && !opensOnDefaults()) {
        let handedOver = false;
        try {
            handedOver = window.sessionStorage.getItem(KEY) !== null;
        } catch (error) {
            // Unreadable storage holds no handoff.
        }
        if (!handedOver) {
            // The body keeps parsing until the new page arrives; hidden, it can't flash.
            document.documentElement.style.visibility = "hidden";
            window.location.replace(SETTINGS_PAGE);
        }
    }
})();
