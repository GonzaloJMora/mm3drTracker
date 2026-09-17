// The handoff between the settings page and the tracker: the settings picked on
// the one, read by the other. Kept in sessionStorage, so it belongs to this tab and
// survives a reload of either page.
//
// Loaded in <head> on both pages. The tracker marks <html> with
// data-requires-launch, and opened with nothing handed over and no ?defaults it
// leaves for the settings page here, before its body has drawn. See
// ARCHITECTURE.md, *Pages*.
(function () {
    "use strict";

    const KEY = "mm3drTracker.v0.launch";
    const PROBE = KEY + ".probe";
    // The settings page opens the tracker with this when it couldn't hand the picks
    // over, so the tracker starts on the defaults instead of sending the reader back.
    const DEFAULTS_URL = "tracker.html?defaults";

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

    window.TrackerLaunch = {
        // The picks from the last launch in this tab, as { settingId: value }, or
        // null when there are none or they can't be read.
        read() {
            // An older handoff that couldn't be removed must not pass for these picks.
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
                if (data && data.picks && typeof data.picks === "object" && !Array.isArray(data.picks)) {
                    return data.picks;
                }
            } catch (error) {
                // Falls through to the warning.
            }
            if (!warnedUnreadable) {
                warnedUnreadable = true;
                console.warn("TrackerLaunch: the handed-over settings can't be read, so the defaults are used.");
            }
            return null;
        },

        // False when these picks can't be kept. An older handoff is removed then, so
        // the tracker opens on the defaults rather than on an earlier launch's
        // settings that would pass for these.
        write(picks) {
            try {
                window.sessionStorage.setItem(KEY, JSON.stringify({ picks }));
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

        storageWorks: storageUsable,
        defaultsUrl: DEFAULTS_URL
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
            window.location.replace("index.html");
        }
    }
})();
