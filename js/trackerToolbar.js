// The tracker toolbar: the view toggles, and Launch New Tracker. A toggle is a
// preference rather than part of a run, so it is kept in this browser's storage
// and carries over to every tracker. Each toggle button names the class it puts on
// <body> and its storage key in its own data attributes, so a new toggle is markup
// and CSS, plus a reader below if other files need to ask about it.
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

    const toggles = Array.from(document.querySelectorAll("[data-view-toggle]"), button => ({
        button,
        bodyClass: button.dataset.viewToggle,
        storageKey: button.dataset.storageKey,
        on: readSaved(button.dataset.storageKey)
    }));

    function apply(toggle) {
        document.body.classList.toggle(toggle.bodyClass, toggle.on);
        toggle.button.setAttribute("aria-pressed", String(toggle.on));
    }

    // Asked by button id, with the class read off that button, so renaming a class
    // in tracker.html can't leave a reader asking for the old one.
    const isOn = buttonId => {
        const toggle = toggles.find(entry => entry.button.id === buttonId);
        return Boolean(toggle) && document.body.classList.contains(toggle.bodyClass);
    };
    window.TrackerView = {
        hidesNonRandomized: () => isOn("toggle-non-randomized"),
        showsOnlyAccessible: () => isOn("toggle-only-accessible")
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

    // Nothing on the tracker is saved yet, so leaving loses what is marked on it.
    const launch = document.getElementById("launch-new-tracker");
    if (launch) {
        launch.addEventListener("click", () => {
            if (window.confirm("Launch a new tracker? Everything marked on this one will be lost.")) {
                window.location.href = "index.html";
            }
        });
    }
})();
