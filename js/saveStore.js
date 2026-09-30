// window.SaveStore — where saves are kept in this browser: the autosave, the run
// before it, and the backup of an autosave that was just updated from an older
// format. The one file that touches those keys, on both pages. Each holds
// SaveCodec's wrapper plus the run it belongs to, the tab that wrote it and how
// far along it was. See ARCHITECTURE.md, *Saving*.
(function () {
    "use strict";

    // The keys carry no version: the format is inside each save.
    const KEYS = {
        autosave: window.StorageKeys.key("autosave"),
        previousRun: window.StorageKeys.key("previousRun"),
        backup: window.StorageKeys.key("autosaveBackup")
    };

    function randomId() {
        const bytes = new Uint8Array(8);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    }

    // Tells a write from this page apart from one made in another tab.
    const tabId = randomId();

    // A record, or null when there is none. One that isn't a readable record comes
    // back as { unreadable: true }, so a page can say so rather than act as if
    // nothing was saved.
    function read(slot) {
        let raw;
        try {
            raw = window.localStorage.getItem(KEYS[slot]);
        } catch (error) {
            return null;
        }
        if (raw === null) return null;
        try {
            const record = JSON.parse(raw);
            if (record && typeof record === "object" && typeof record.code === "string") return record;
        } catch (error) {
            // Falls through.
        }
        return { unreadable: true, raw };
    }

    // False when the browser refuses: full storage, or site data blocked.
    function write(slot, record) {
        try {
            window.localStorage.setItem(KEYS[slot], JSON.stringify(record));
            return true;
        } catch (error) {
            return false;
        }
    }

    // Text as it is, for putting a test save in place from the console.
    function writeRaw(slot, text) {
        try {
            window.localStorage.setItem(KEYS[slot], text);
            return true;
        } catch (error) {
            return false;
        }
    }

    function remove(slot) {
        try {
            window.localStorage.removeItem(KEYS[slot]);
        } catch (error) {
            // Nothing more to try.
        }
    }

    window.SaveStore = {
        tabId,
        newRunId: randomId,
        read,
        write,
        writeRaw,
        remove,

        // A new run is starting: the autosave becomes the previous run, replacing
        // the one there, and the autosave slot is left empty for the new run. With
        // keepAutosave the caller writes over it straight away instead, so another
        // tab never sees it empty.
        moveToPreviousRun({ keepAutosave = false } = {}) {
            const current = read("autosave");
            if (!current || current.unreadable) return false;
            const moved = write("previousRun", current);
            if (moved && !keepAutosave) remove("autosave");
            return moved;
        },

        // Calls back when another tab changes a slot, with the new record or null.
        onOtherTabChange(slot, callback) {
            window.addEventListener("storage", event => {
                if (event.key !== KEYS[slot]) return;
                callback(event.newValue === null ? null : read(slot));
            });
        }
    };
})();
