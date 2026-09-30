// window.TrackerSave — the tracker's state as a save code, and the autosave.
// Collects the snapshot from each owner (SettingsState, GameState, ItemCheckState,
// TrackerView), encodes it through SaveCodec, and keeps it in SaveStore's autosave
// and in this tab's handoff, so a reload opens where the run is. At load it checks
// that the save layout covers everything there is to save. See ARCHITECTURE.md,
// *Saving*.
(function () {
    "use strict";

    // Long enough that a burst of clicks is one write, short enough that closing
    // the page right after a click still has it (the page-hide write covers the rest).
    const AUTOSAVE_DELAY_MS = 500;

    let layout = null;
    let runId = null;
    // The savedAt of the autosave this tab last wrote or resumed from, kept in its
    // handoff: two tabs can hold the same run, and only this copy is this tab's.
    let stamp = null;
    // This tab writes the autosave only while it owns it: from the start when the
    // autosave is empty or already this tab's copy, and until another tab writes it.
    let owns = false;
    // Which banner a tab that doesn't own the autosave shows, so a change in the
    // slots redraws it only when the case changes.
    let shownCase = null;
    // Set once TrackerDebug.openSave has handed a different run to the next page, so
    // nothing this one writes on the way out replaces that.
    let handingOver = false;
    let timer = null;
    let backupChecked = false;
    let warnedProblems = false;
    let warnedFailure = false;

    function snapshot() {
        return {
            settings: window.SettingsState.snapshot(),
            slots: window.GameState.snapshot(),
            checks: window.ItemCheckState.snapshot(),
            view: window.TrackerView.snapshot()
        };
    }

    // { code, problems }, or null while saving is off.
    function encode(state = snapshot()) {
        return layout ? window.SaveCodec.encode(state, layout) : null;
    }

    function decode(code) {
        if (!layout) return Promise.reject(new Error("Saving is off: there is no save layout."));
        return window.SaveCodec.decode(code, { layoutFor: window.TrackerData.saveLayoutFor, current: layout });
    }

    // ---------- Autosave ----------

    // The run as it stands, as SaveStore keeps it and Export writes it: the wrapper
    // plus the run and how far along it is. Null while saving is off.
    function record() {
        if (!layout) return null;
        const state = snapshot();
        const result = encode(state);
        if (result.problems.length && !warnedProblems) {
            warnedProblems = true;
            console.warn("TrackerSave: part of this run can't be saved as it is.", result.problems);
        }
        return {
            state,
            record: Object.assign(window.SaveCodec.wrap(result.code, layout, { version: window.TrackerData.version }), {
                runId,
                progress: window.ItemCheckState.progress(window.TrackerView.hidesNonRandomized())
            })
        };
    }

    function writeNow() {
        clearTimeout(timer);
        timer = null;
        if (!layout || handingOver) return;

        const current = record();
        if (owns) {
            const saved = Object.assign({}, current.record, { writer: window.SaveStore.tabId });
            if (window.SaveStore.write("autosave", saved)) {
                stamp = saved.savedAt;
                // An autosave updated from an older format keeps its original as a
                // backup until the updated one has loaded cleanly, which this write shows.
                if (!backupChecked) {
                    backupChecked = true;
                    const backup = window.SaveStore.read("backup");
                    if (backup && backup.runId === runId) window.SaveStore.remove("backup");
                }
            } else if (!warnedFailure) {
                warnedFailure = true;
                showBanner("This browser won't let the tracker autosave, so progress here isn't being kept.");
            }
        }

        // The handoff belongs to this tab alone, so it is kept up to date even while
        // another tab holds the autosave: a reload then keeps this tab's progress.
        // After the autosave, so its stamp names the copy just written.
        const state = current.state;
        window.TrackerLaunch.updateSave(window.SettingsState.picks(), {
            runId,
            stamp,
            save: { slots: state.slots, checks: state.checks, view: state.view }
        });
    }

    function schedule() {
        if (!layout) return;
        clearTimeout(timer);
        timer = setTimeout(writeNow, AUTOSAVE_DELAY_MS);
    }

    // ---------- The banner ----------

    function showBanner(text, takeOver = false) {
        const main = document.querySelector("main");
        if (!main) return;
        let note = document.getElementById("autosave-warning");
        if (!note) {
            note = document.createElement("div");
            note.id = "autosave-warning";
            main.insertBefore(note, main.firstChild);
        }
        note.textContent = text + " ";
        if (takeOver) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "toolbar-btn";
            button.textContent = "Autosave This Tab";
            // Whatever the autosave holds becomes the previous run, replacing what
            // is there; each banner's text says which copy that is.
            button.addEventListener("click", () => {
                window.SaveStore.moveToPreviousRun({ keepAutosave: true });
                owns = true;
                shownCase = null;
                writeNow();
                note.remove();
            });
            note.appendChild(button);
        }
    }

    const BANNERS = {
        "this run": "This run was saved from another tab, so this tab has stopped autosaving rather than overwrite it. " +
            "To carry on from that save here, go Back to Settings and Load From Autosave. Or keep this tab's " +
            "progress, and the other tab's becomes the previous run:",
        "another run": "The autosave holds a different run, so this tab isn't autosaving. To autosave this run instead, " +
            "the other one becomes the previous run:",
        "previous run": "The autosave holds a different run, and another tab's copy of this run is now the previous " +
            "run. To carry on from that copy, go Back to Settings and Load From Autosave. To keep this tab's progress " +
            "instead, the other run becomes the previous run, replacing that copy:"
    };

    function stopOwning(which) {
        owns = false;
        clearTimeout(timer);
        timer = null;
        shownCase = which;
        showBanner(BANNERS[which], true);
    }

    // Whose the autosave is: "this tab" when it is empty, unreadable or this tab's
    // copy; "this run" when another tab has moved the same run on since; "another
    // run" otherwise. With no stamp (a new run, a file) the run alone decides.
    function autosaveHolder() {
        const current = window.SaveStore.read("autosave");
        if (!current || current.unreadable) return "this tab";
        if (current.runId !== runId) return "another run";
        return stamp && current.savedAt !== stamp ? "this run" : "this tab";
    }

    // Another tab's copy of this run in the previous run, which Autosave This Tab
    // would replace.
    function newerCopyInPrevious() {
        const previous = window.SaveStore.read("previousRun");
        return Boolean(previous && !previous.unreadable && previous.runId === runId && previous.savedAt !== stamp);
    }

    // autosaveHolder(), with "another run" split out as "previous run" when that
    // would cost another tab's copy of this run.
    function bannerCase() {
        const holder = autosaveHolder();
        if (holder !== "another run") return holder;
        return newerCopyInPrevious() ? "previous run" : "another run";
    }

    // The slots changed, or the page came back: a banner describes them as they are
    // now, and an owner that has lost the autosave stops. An empty autosave, while
    // a new run starts, changes nothing yet.
    function recheck() {
        const which = bannerCase();
        if (which !== "this tab" && which !== shownCase) stopOwning(which);
    }

    function startAutosave() {
        runId = window.TrackerLaunch.readRunId() || window.SaveStore.newRunId();
        stamp = window.TrackerLaunch.readStamp();
        const which = bannerCase();
        if (which === "this tab") {
            owns = true;
            writeNow();
        } else {
            stopOwning(which);
        }

        ["trackerStateUpdated", "trackerChecksUpdated", "trackerViewChanged"].forEach(name => window.addEventListener(name, schedule));
        // iPhone can close a background tab before a scheduled write runs.
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") writeNow();
        });
        window.addEventListener("pagehide", writeNow);
        // A page the browser brings back with Back or Forward may have missed another
        // tab's writes while it was away: not every browser delivers them late.
        window.addEventListener("pageshow", event => {
            if (event.persisted) recheck();
        });

        window.SaveStore.onOtherTabChange("autosave", record => {
            if (!owns) {
                recheck();
                return;
            }
            if (record && record.writer === window.SaveStore.tabId) return;
            // Emptied means a new run is starting, so this one is no longer the autosave's.
            stopOwning(record && record.runId === runId ? "this run" : newerCopyInPrevious() ? "previous run" : "another run");
        });
        window.SaveStore.onOtherTabChange("previousRun", () => {
            if (!owns) recheck();
        });
    }

    // ---------- Checking the layout ----------

    // What the layout leaves out or can't hold. Anything missing is simply not
    // saved, so each is named once rather than turning saving off.
    function coverageProblems() {
        const problems = [];
        const fields = new Map(layout.fields.filter(field => field.kind !== "retired")
            .map(field => [`${field.kind}:${field.id}`, field]));
        const fieldFor = (kind, id) => {
            const field = fields.get(`${kind}:${id}`);
            if (!field) problems.push(`${kind} "${id}" is not in it, so it is not saved`);
            return field;
        };
        const holds = (field, low, high) => low >= (field.min || 0) && high - (field.min || 0) < 2 ** field.bits;

        window.SettingsState.list().forEach(({ id }) => {
            const field = fieldFor("setting", id);
            if (!field) return;
            const setting = window.SettingsState.describe(id);
            if (setting.class === "number") {
                if (!holds(field, setting.min, setting.max)) problems.push(`setting "${id}" runs ${setting.min} to ${setting.max}, which its field can't hold`);
                return;
            }
            const values = setting.class === "toggle" ? [false, true] : setting.options.map(option => option.id);
            const absent = values.filter(value => !(field.options || []).includes(value));
            if (absent.length) problems.push(`setting "${id}" has ${absent.map(v => JSON.stringify(v)).join(", ")}, which its field doesn't list`);
        });

        Object.keys(window.TrackerView.snapshot()).forEach(id => fieldFor("view", id));

        const state = window.GameState;
        state.gridSlots().forEach(id => {
            const field = fieldFor("slot", id);
            if (!field) return;
            const { low, high } = state.slotBounds(state.config, id);
            if (!holds(field, low, high)) problems.push(`slot "${id}" runs ${low} to ${high}, which its field can't hold`);
        });

        window.ItemCheckState.checkIds().forEach(id => fieldFor("check", id));
        return problems;
    }

    // After locationTracker.js's onReady, so every owner has its state, and its
    // first sweep has run: the first autosave is the state the tracker opened with.
    window.TrackerData.onReady(data => {
        if (!data.saveLayout) return;
        const shape = window.SaveCodec.layoutProblems(data.saveLayout);
        if (shape.length) {
            console.warn(`TrackerSave: data/saveLayout.json can't be used, so saving and loading are off. ${shape.length} problem(s):`);
            shape.forEach(line => console.warn(`  ${line}`));
            return;
        }
        layout = data.saveLayout;
        // One identity under two names: a save's "app" says whose save it is, the
        // page's tracker id where this browser keeps it (storageKeys.js).
        if (layout.app !== window.StorageKeys.trackerId) {
            console.warn(`TrackerSave: data/saveLayout.json's "app" is ${JSON.stringify(layout.app)}, but the page's tracker-id is ` +
                `${JSON.stringify(window.StorageKeys.trackerId)}. Give both the same name.`);
        }

        try {
            const problems = coverageProblems();
            if (problems.length) {
                console.warn(`TrackerSave: ${problems.length} problem(s) in data/saveLayout.json. Run scripts/updateSaveLayout.py.`);
                problems.forEach(line => console.warn(`  ${line}`));
            }
        } catch (error) {
            console.error("TrackerSave: could not compare the save layout with the data", error);
        }

        try {
            startAutosave();
        } catch (error) {
            console.error("TrackerSave: could not start autosaving", error);
        }

        const debug = window.TrackerDebug;
        if (!debug) return;
        debug.saveCode = () => {
            const result = encode();
            if (result && result.problems.length) console.warn("TrackerSave:", result.problems);
            return result && result.code;
        };
        debug.decodeSave = decode;
        // Opens a fresh tracker from a code as a new run, much as loading a save does.
        debug.openSave = async code => {
            const { snapshot: saved } = await decode(code);
            // Or this page's save on the way out would overwrite the handoff below.
            handingOver = true;
            owns = false;
            clearTimeout(timer);
            window.SaveStore.moveToPreviousRun();
            window.TrackerLaunch.open(saved.settings, {
                runId: window.SaveStore.newRunId(),
                save: { slots: saved.slots, checks: saved.checks, view: saved.view }
            });
        };
    });

    window.TrackerSave = {
        available: () => layout !== null,
        // False while another tab holds the autosave, or saving is off.
        ownsAutosave: () => layout !== null && owns,
        layout: () => layout,
        snapshot,
        record: () => { const current = record(); return current && current.record; },
        encode,
        decode,
        saveNow: writeNow
    };
})();
