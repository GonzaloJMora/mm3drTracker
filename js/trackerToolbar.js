// The tracker toolbar: the view toggles, and Back to Settings. A save carries the
// toggles, and a loaded one sets them. They are also kept in this browser's
// storage, which is what a new tracker starts from. Each toggle button names the
// class it puts on <body> and its storage name in its own data attributes, so a new
// toggle is markup and CSS, plus a reader below if other files need to ask about it.
//
// Loaded before the trackers, so their first sweep already knows what is hidden.
// See ARCHITECTURE.md, *Hiding checks*.
(function () {
    "use strict";

    // Storage can throw instead of coming back empty — a private window, or a
    // browser set to block site data — and a preference is not worth an error.
    function readSaved(key) {
        try {
            return window.localStorage.getItem(key) === "true";
        } catch (error) {
            return false;
        }
    }

    function save(key, on) {
        try {
            window.localStorage.setItem(key, String(on));
        } catch (error) {
            // It still applies to this page; it just is not remembered.
        }
    }

    // A save's value, keyed by button id, comes as plain values rather than inside
    // the code: this runs before any data has loaded.
    const handed = window.TrackerLaunch ? window.TrackerLaunch.readSave() : null;
    const savedView = handed && handed.view && typeof handed.view === "object" ? handed.view : {};

    const toggles = Array.from(document.querySelectorAll("[data-view-toggle]"), button => ({
        button,
        bodyClass: button.dataset.viewToggle,
        storageKey: window.StorageKeys.key(button.dataset.storageKey),
        on: typeof savedView[button.id] === "boolean" ? savedView[button.id] : readSaved(window.StorageKeys.key(button.dataset.storageKey))
    }));

    function apply(toggle) {
        document.body.classList.toggle(toggle.bodyClass, toggle.on);
        toggle.button.setAttribute("aria-pressed", String(toggle.on));
    }

    // Asked by button id, so renaming a class in tracker.html can't leave a reader
    // asking for the old one.
    const isOn = buttonId => {
        const toggle = toggles.find(entry => entry.button.id === buttonId);
        return Boolean(toggle && toggle.on);
    };
    window.TrackerView = {
        hidesNonRandomized: () => isOn("toggle-non-randomized"),
        showsOnlyAccessible: () => isOn("toggle-only-accessible"),
        // Button id -> on, for a save.
        snapshot() {
            const view = {};
            toggles.forEach(toggle => { view[toggle.button.id] = toggle.on; });
            return view;
        }
    };

    toggles.forEach(toggle => {
        apply(toggle);
        toggle.button.addEventListener("click", () => {
            toggle.on = !toggle.on;
            save(toggle.storageKey, toggle.on);
            apply(toggle);
            window.dispatchEvent(new CustomEvent("trackerViewChanged", {
                detail: {
                    hidesNonRandomized: window.TrackerView.hidesNonRandomized(),
                    showsOnlyAccessible: window.TrackerView.showsOnlyAccessible()
                }
            }));
        });
    });

    // No confirm while this tab autosaves: leaving saves the run on the way out, and
    // Load From Autosave on the settings page brings it back. A tab another one took
    // the autosave from can't be brought back from the settings page once it
    // leaves: that loads only what the stored slots hold.
    const back = document.getElementById("back-to-settings");
    if (back) {
        back.addEventListener("click", () => {
            const save = window.TrackerSave;
            if (save && save.available() && !save.ownsAutosave() &&
                !window.confirm("This tab isn't autosaving, so leaving loses what's marked here. To keep it, " +
                    "use Export or Autosave This Tab first. Leave anyway?")) return;
            window.TrackerLaunch.toSettings();
        });
    }
})();
