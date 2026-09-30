// Loading a save on the settings page: Load From Autosave and its chooser between
// the autosave and the previous run, Load From File (a file or a pasted code), what
// a loaded save says about itself, and Resume Tracker. A loaded save's settings are
// held in SettingsState, which settingsPage.js draws; this file hands the rest of
// the save to the tracker. See ARCHITECTURE.md, *Saving*.
(function () {
    "use strict";

    // Where a save came from, as the messages name it.
    const SOURCES = {
        autosave: "the current run",
        previousRun: "the previous run",
        backup: "the backup",
        file: "the file",
        paste: "the pasted code"
    };

    // What a refused save says, by SaveCodec's reason and this file's own.
    const REFUSALS = {
        "not-a-save": "isn't a save from this tracker",
        "not-a-code": "isn't a save, or is too damaged to read",
        "damaged": "is damaged: part of it is missing or was changed",
        "newer": "was made by a newer version of the tracker, which this one can't read",
        "unknown-format": "is in a format this tracker doesn't know",
        "empty": "is empty",
        "too-large": "is far too large to be a save"
    };

    // A save is well under a kilobyte, so anything this size is something else,
    // like a photo picked by mistake, and isn't read at all.
    const MAX_FILE_BYTES = 64 * 1024;

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function button(label, onClick, className = "toolbar-btn") {
        const node = element("button", className, label);
        node.type = "button";
        node.addEventListener("click", onClick);
        return node;
    }

    function capitalized(text) {
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    function summary(record) {
        const parts = [];
        const date = new Date(record.savedAt);
        if (record.savedAt && !Number.isNaN(date.getTime())) {
            parts.push(`Saved ${date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`);
        }
        const progress = record.progress;
        if (progress && Number.isInteger(progress.checked) && Number.isInteger(progress.total)) {
            parts.push(`${progress.checked} of ${progress.total} checked`);
        }
        if (record.version) parts.push(`v${record.version}`);
        return parts.join(" · ");
    }

    function openDialog(id, title, build) {
        const dialog = element("dialog", "save-dialog");
        dialog.id = id;
        dialog.appendChild(element("h2", null, title));
        build(dialog);
        const cancel = button("Cancel", () => dialog.close(), "toolbar-btn save-dialog-close");
        dialog.appendChild(cancel);
        dialog.addEventListener("close", () => dialog.remove());
        document.body.appendChild(dialog);
        dialog.showModal();
        return dialog;
    }

    window.TrackerData.onReady(data => {
        const settings = window.SettingsState;
        const store = window.SaveStore;
        const autosaveButton = document.getElementById("load-autosave");
        const fileButton = document.getElementById("load-file");
        const resumeButton = document.getElementById("resume-tracker");
        const layout = data.saveLayout;
        if (!autosaveButton || !fileButton || !resumeButton || !layout || window.SaveCodec.layoutProblems(layout).length) return;

        // { runId, save, code, source } while a save is loaded.
        let loaded = null;
        let resuming = false;

        const readable = slot => {
            const record = store.read(slot);
            return record && !record.unreadable ? record : null;
        };

        function refreshAutosaveButton() {
            autosaveButton.disabled = !store.read("autosave") && !readable("previousRun");
        }

        // ---------- The message above the settings ----------

        function showMessage(lines, action) {
            const main = document.querySelector("main");
            if (!main) return;
            clearMessage();
            const note = element("div");
            note.id = "save-load-message";
            lines.forEach(line => note.appendChild(element("p", null, line)));
            if (action) note.appendChild(button(action.label, action.run));
            main.insertBefore(note, main.firstChild);
        }

        function clearMessage() {
            const note = document.getElementById("save-load-message");
            if (note) note.remove();
        }

        // ---------- Loading ----------

        function refuse(source, reason) {
            const backup = source === "autosave" ? readable("backup") : null;
            showMessage(
                [`${capitalized(SOURCES[source])} ${REFUSALS[reason] || "can't be read"}, so nothing was loaded.`],
                backup ? { label: "Load the Backup", run: () => load(backup, "backup") } : null
            );
        }

        // record is a stored record, a file's wrapper, or { code } for a bare code.
        async function load(record, source) {
            let result;
            let code;
            try {
                code = window.SaveCodec.unwrap(record, layout);
                result = await window.SaveCodec.decode(code, { layoutFor: window.TrackerData.saveLayoutFor, current: layout });
            } catch (error) {
                if (!(error instanceof window.SaveCodec.SaveError)) console.error("loadSave: could not read the save", error);
                refuse(source, error.reason);
                return;
            }

            const defaulted = settings.holdFromSave(result.snapshot.settings, result.missing.settings);
            const droppedChecks = result.dropped.checks.length;
            const updated = result.format < layout.format || defaulted.length > 0 ||
                Object.values(result.dropped).some(list => list.length);
            const fromOutside = source === "file" || source === "paste";

            // An autosave's original stays until the updated one has loaded cleanly,
            // which the tracker's first autosave shows. A file is its own backup.
            if (updated && source === "autosave") store.write("backup", record);

            // A file starts a run of its own here, so resuming it can never write over
            // newer progress in the autosave: that becomes the previous run.
            loaded = {
                runId: !fromOutside && typeof record.runId === "string" ? record.runId : store.newRunId(),
                save: { slots: result.snapshot.slots, checks: result.snapshot.checks, view: result.snapshot.view },
                code,
                source
            };
            resumeButton.hidden = false;

            const about = summary(record);
            const lines = [`Loaded ${SOURCES[source]}${about ? `: ${about}` : ""}. Its settings are locked; ` +
                "Resume Tracker carries on the run."];
            if (updated) {
                lines.push(`It was made by ${record.version ? `version ${record.version}` : "an earlier version"} and has ` +
                    "been updated to this one.");
                // Says where the yellow is, since a slot's own note is a hover tooltip a
                // phone never shows. Named only while the list is short.
                if (defaulted.length) {
                    const one = defaulted.length === 1;
                    const inSlots = defaulted.some(id => settings.describe(id).slot);
                    const inRows = defaulted.some(id => !settings.describe(id).slot);
                    // Rows aren't placed by name: on a phone the inventory options sit
                    // under the grids, not in the settings list.
                    const where = inRows && inSlots ? "below, including slots in the Starting Items grids"
                        : inSlots ? "in the Starting Items grids" : "below";
                    const names = defaulted.length <= 5 ? `: ${defaulted.map(id => settings.describe(id).name).join(", ")}` : "";
                    lines.push(`${defaulted.length} setting${one ? " wasn't" : "s weren't"} in it and took the default. ` +
                        `${one ? "It's" : "They're"} marked in yellow ${where}, and can still be changed. ` +
                        `Check ${one ? "it matches" : "they match"} your seed${names}.`);
                }
                if (droppedChecks) {
                    lines.push(`${droppedChecks} checked location${droppedChecks === 1 ? " is" : "s are"} no longer in the ` +
                        "tracker and " + (droppedChecks === 1 ? "was" : "were") + " left out.");
                }
                if (fromOutside) lines.push("After resuming, use Export in the tracker to keep an updated copy of this save.");
            }
            showMessage(lines);
        }

        function loadSlot(slot) {
            const record = store.read(slot);
            if (!record) return;
            if (record.unreadable) refuse(slot, "not-a-save");
            else load(record, slot);
        }

        // A file's text or a pasted code: a wrapper, or a bare code.
        function loadText(text, source) {
            const trimmed = text.trim();
            if (!trimmed) {
                refuse(source, "empty");
                return;
            }
            if (!trimmed.startsWith("{")) {
                load({ code: trimmed, app: layout.app }, source);
                return;
            }
            let record;
            try {
                record = JSON.parse(trimmed);
            } catch (error) {
                refuse(source, "not-a-save");
                return;
            }
            if (!record || typeof record !== "object") refuse(source, "not-a-save");
            else load(record, source);
        }

        // ---------- The chooser ----------

        function openChooser() {
            openDialog("autosave-chooser", "Load From Autosave", dialog => {
                ["autosave", "previousRun"].forEach(slot => {
                    const record = store.read(slot);
                    if (!record) return;
                    const row = element("div", "save-dialog-row");
                    const text = element("div", "save-dialog-text");
                    text.appendChild(element("strong", null, capitalized(SOURCES[slot])));
                    text.appendChild(element("span", null, record.unreadable ? "Can't be read" : summary(record)));
                    row.appendChild(text);
                    const loadButton = button("Load", () => {
                        dialog.close();
                        loadSlot(slot);
                    });
                    loadButton.disabled = Boolean(record.unreadable);
                    row.appendChild(loadButton);
                    dialog.appendChild(row);
                });
            });
        }

        autosaveButton.addEventListener("click", () => {
            if (readable("previousRun")) openChooser();
            else loadSlot("autosave");
        });

        // ---------- Load From File ----------

        fileButton.disabled = false;
        fileButton.addEventListener("click", () => {
            openDialog("load-file-dialog", "Load From File", dialog => {
                dialog.appendChild(element("p", null,
                    "Choose a save file exported from the tracker, or paste a save code."));

                // The input stays out of sight behind a button that looks like the rest.
                const input = element("input");
                input.type = "file";
                input.accept = ".json,.txt,application/json,text/plain";
                input.hidden = true;
                input.addEventListener("change", () => {
                    const file = input.files && input.files[0];
                    if (!file) return;
                    dialog.close();
                    if (file.size > MAX_FILE_BYTES) {
                        refuse("file", "too-large");
                        return;
                    }
                    file.text().then(text => loadText(text, "file"), () => refuse("file", "not-a-save"));
                });
                const choose = element("div", "save-dialog-actions");
                choose.append(button("Choose File", () => input.click()), input);
                dialog.appendChild(choose);

                const paste = element("textarea", "save-code");
                paste.rows = 3;
                paste.placeholder = "Paste a save code here";
                paste.setAttribute("aria-label", "Save code");
                const loadPasted = button("Load Code", () => {
                    dialog.close();
                    loadText(paste.value, "paste");
                });
                loadPasted.disabled = true;
                paste.addEventListener("input", () => { loadPasted.disabled = !paste.value.trim(); });
                // A code never holds a line break, so Enter loads it rather than adding one.
                paste.addEventListener("keydown", event => {
                    if (event.key !== "Enter" || event.isComposing) return;
                    event.preventDefault();
                    if (!loadPasted.disabled) loadPasted.click();
                });
                const pasteRow = element("div", "save-dialog-actions");
                pasteRow.appendChild(loadPasted);
                dialog.append(paste, pasteRow);
            });
        });

        // ---------- Resume ----------

        // The run can move on after it was loaded, in another tab or through the
        // browser's Back and Forward, so Resume carries on from the newest copy
        // stored rather than from what was read at load. Resolves { slot, record } for
        // the copy found, { slot: null } when no slot holds the run, and false when
        // that copy can't be read, which has already been said.
        async function catchUp() {
            // Both slots can hold the run, after Autosave This Tab in a second tab on
            // it, and the one the save was loaded from is the one chosen.
            const order = loaded.source === "previousRun" ? ["previousRun", "autosave"] : ["autosave", "previousRun"];
            const slot = order.find(name => {
                const record = readable(name);
                return record && record.runId === loaded.runId;
            });
            if (!slot) return { slot: null };
            const record = readable(slot);
            let result;
            try {
                const code = window.SaveCodec.unwrap(record, layout);
                if (code === loaded.code) return { slot, record };
                result = await window.SaveCodec.decode(code, { layoutFor: window.TrackerData.saveLayoutFor, current: layout });
            } catch (error) {
                // The backup was loaded because the stored copy wouldn't read, so one
                // that still won't is passed over rather than refused again.
                if (loaded.source === "backup") return { slot: null };
                refuse(slot, error.reason);
                return false;
            }
            settings.holdFromSave(result.snapshot.settings, result.missing.settings);
            loaded.save = { slots: result.snapshot.slots, checks: result.snapshot.checks, view: result.snapshot.view };
            return { slot, record };
        }

        async function resume() {
            const found = await catchUp();
            if (!found) return;
            const current = readable("autosave");
            if (found.slot === "previousRun") {
                // Another run took the autosave since: the two trade places, so neither
                // is lost and this run's newest copy isn't overwritten by the other.
                if (current) store.write("previousRun", current);
                else store.remove("previousRun");
                store.write("autosave", found.record);
            } else if (current && current.runId !== loaded.runId) {
                // Carrying on a run that isn't the one in the autosave keeps the
                // autosave as the previous run.
                store.moveToPreviousRun();
            }
            // The copy resumed is this tab's, and another copy of the run is another tab's.
            const stamp = found.record ? found.record.savedAt : null;
            if (!window.TrackerLaunch.open(settings.picks(), { runId: loaded.runId, save: loaded.save, stamp })) {
                showMessage(["This browser can't store the save to hand it to the tracker, so it can't be resumed here."]);
            }
        }

        resumeButton.addEventListener("click", async () => {
            if (!loaded || resuming) return;
            resuming = true;
            resumeButton.disabled = true;
            try {
                await resume();
            } finally {
                resuming = false;
                resumeButton.disabled = false;
            }
        });

        // Reset to Defaults and Launch New Tracker let go of the save (settingsPage.js).
        window.addEventListener("settingsChanged", event => {
            if (!event.detail || (!event.detail.reset && !event.detail.released)) return;
            loaded = null;
            resumeButton.hidden = true;
            clearMessage();
        });

        // Another tab can autosave or start a run while this page is open.
        store.onOtherTabChange("autosave", refreshAutosaveButton);
        store.onOtherTabChange("previousRun", refreshAutosaveButton);
        refreshAutosaveButton();

        const debug = window.TrackerDebug;
        if (debug) {
            // Puts text into a save slot as it is, for trying saves out.
            debug.putSave = (text, slot = "autosave") => {
                const ok = store.writeRaw(slot, typeof text === "string" ? text : JSON.stringify(text));
                refreshAutosaveButton();
                return ok;
            };
        }
    });
})();
