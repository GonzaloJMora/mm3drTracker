// The settings page: the randomizer settings in one panel in menu order, and the
// starting items drawn as the tracker's own grids, showing the state the tracker
// will open with. A slot one setting controls steps through that setting's choices
// when clicked; the item grids section's other settings end the settings panel on
// desktop and sit under the grids on a phone. Edits apply as they are made. See
// ARCHITECTURE.md, *The settings page*.
(function () {
    "use strict";

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function valueName(description, value) {
        if (description.class === "toggle") return value ? "On" : "Off";
        if (description.class === "dropdown") {
            const option = description.options.find(entry => entry.id === value);
            return option ? option.name : String(value);
        }
        return String(value);
    }

    function lockNote(settings, id) {
        const causes = settings.lockedBy(id).map(cause => {
            const description = settings.describe(cause.id);
            return `${description.name}: ${valueName(description, cause.value)}`;
        });
        return causes.length ? `Locked by ${causes.join(", ")}` : "Locked";
    }

    function showStorageWarning() {
        const main = document.querySelector("main");
        if (!main || document.getElementById("settings-storage-warning")) return;
        const note = element("div", null,
            "This browser can't store the settings picked here, so they can't reach " +
            "the tracker, and it will open with the default settings.");
        note.id = "settings-storage-warning";
        main.insertBefore(note, main.firstChild);
    }

    // A section without an item grids view has nothing for the Starting Items half
    // to show, so that half and its tab go.
    function removeStartingHalf() {
        document.querySelectorAll('[data-section="starting-section"], #starting-section')
            .forEach(node => node.remove());
    }

    window.TrackerData.onReady(({ config, items }) => {
        const settings = window.SettingsState;
        const list = document.getElementById("settings-list");
        const gridContainer = document.querySelector("#starting-section .grid-container");
        const extras = document.getElementById("starting-extras");
        if (!list) return;

        const rows = [];
        const counts = [];
        const slots = [];
        // The item grids section's settings that no slot shows: one block of rows
        // that placeOptions() moves between the settings panel and the grids.
        let optionsBlock = null;
        let optionIds = [];
        const optionsInPanel = () => Boolean(optionsBlock) && optionsBlock.parentElement === list;

        function buildRow(id) {
            const description = settings.describe(id);
            const control = window.SettingControls.create(description, value => settings.set(id, value));
            if (!control) {
                console.warn(`SettingsPage: there is no control for class "${description.class}", so "${id}" can't be changed here.`);
                return null;
            }
            const row = element("div", "setting-row");
            const label = element("label");
            label.append(element("span", "setting-name", description.name), control.element);
            const note = element("span", "setting-lock-note");
            note.hidden = true;
            row.append(label, note);
            rows.push({ id, description, control, row, note });
            return row;
        }

        // idsNow is a function because which settings a heading covers depends on
        // where the inventory options currently sit.
        function addCount(heading, idsNow) {
            const count = element("span", "settings-count");
            heading.appendChild(count);
            counts.push({ idsNow, count });
        }

        function buildBlock(title, groups) {
            const block = element("div", "settings-block");
            const heading = element("h3");
            heading.appendChild(element("span", null, title));
            block.appendChild(heading);
            const ids = groups.flatMap(group => group.ids);
            addCount(heading, () => ids);
            groups.forEach(group => {
                const wrapper = element("div", "settings-group");
                if (group.name && group.ids.length && group.name !== title) wrapper.appendChild(element("h4", null, group.name));
                group.ids.forEach(id => {
                    const row = buildRow(id);
                    if (row) wrapper.appendChild(row);
                });
                block.appendChild(wrapper);
            });
            return block;
        }

        // ---------- The settings panel ----------

        let gridSection = null;
        const listed = [];
        settings.sections().forEach(section => {
            if (section.view === "item_grids") {
                gridSection = section;
                return;
            }
            const ids = section.groups.flatMap(group => group.ids);
            if (!ids.length) return;
            listed.push(...ids);
            list.appendChild(buildBlock(section.name, section.groups));
        });

        const panelTitle = document.getElementById("settings-panel-title");
        if (panelTitle) addCount(panelTitle, () => (optionsInPanel() ? listed.concat(optionIds) : listed));

        // ---------- Starting items ----------

        if (!gridSection || !gridContainer || !extras) {
            removeStartingHalf();
        } else {
            const title = document.getElementById("starting-items-title");
            const gridIds = gridSection.groups.flatMap(group => group.ids);
            if (title) addCount(title, () => (optionsInPanel() ? gridIds.filter(id => !optionIds.includes(id)) : gridIds));

            try {
                window.GameState.init(items, config, settings.startingItems());
                const itemMap = window.ItemGrids.itemMap(items);
                // Song notes are for playing a song, which nothing here asks for.
                window.ItemGrids.render(gridContainer, config, itemMap, { notes: false }).forEach((view, slotId) => {
                    const { controller, setters } = settings.slotSettings(slotId);
                    const role = controller ? "starting-choice" : setters.length ? "set-elsewhere" : "not-starting";
                    view.slot.classList.add(role);
                    view.slot.addEventListener("contextmenu", event => event.preventDefault());
                    if (controller) {
                        view.slot.addEventListener("click", event => {
                            event.preventDefault();
                            settings.step(controller, 1);
                        });
                        view.slot.addEventListener("contextmenu", () => settings.step(controller, -1));
                    }
                    slots.push({ view, slotId, controller, setters });
                });
            } catch (error) {
                console.error("SettingsPage: could not draw the starting items", error);
            }

            // The settings no slot shows, under the section's name and their own group
            // names. placeOptions() below puts the block where it belongs.
            const optionGroups = gridSection.groups
                .map(group => ({ name: group.name, ids: group.ids.filter(id => !settings.describe(id).slot) }))
                .filter(group => group.ids.length);
            if (optionGroups.length) {
                optionIds = optionGroups.flatMap(group => group.ids);
                optionsBlock = buildBlock(gridSection.name, optionGroups);
            } else {
                extras.remove();
            }
        }

        // ---------- Redrawing ----------

        // Settings that differ only by a trailing number, like Bottle Slot 1 to 7,
        // are named once, by the name they share.
        function namesOf(ids) {
            const names = ids.map(id => settings.describe(id).name);
            const stem = name => name.replace(/\s+\d+$/, "");
            const shared = name => names.filter(other => stem(other) === stem(name)).length > 1;
            return [...new Set(names.map(name => (shared(name) ? stem(name) : name)))].join(", ");
        }

        function slotNote({ controller, setters }) {
            if (controller) {
                if (settings.isForced(controller)) return lockNote(settings, controller);
                return setters.length ? `Also set by ${namesOf(setters)}` : "";
            }
            return setters.length ? `Set by ${namesOf(setters)}` : "Not a starting item";
        }

        function refresh() {
            // Changed means picked: what Launch hands over and Reset clears. A value
            // a lock forces shows as the lock instead.
            const picked = settings.picks();
            const isPicked = id => Object.prototype.hasOwnProperty.call(picked, id);
            rows.forEach(({ id, control, row, note }) => {
                const value = settings.get(id);
                const locked = settings.isForced(id);
                control.update(value, locked);
                row.classList.toggle("changed", isPicked(id));
                note.textContent = locked ? lockNote(settings, id) : "";
                note.hidden = !locked;
            });

            counts.forEach(({ idsNow, count }) => {
                const changed = idsNow().filter(isPicked).length;
                count.textContent = changed ? `${changed} changed` : "";
            });

            if (!slots.length) return;
            window.GameState.init(items, config, settings.startingItems());
            slots.forEach(entry => {
                const { view, slotId, controller } = entry;
                window.ItemGrids.draw(view, window.GameState.slotValue(slotId));

                if (controller) {
                    const description = settings.describe(controller);
                    const value = settings.get(controller);
                    view.slot.classList.toggle("locked-on", settings.isForced(controller));
                    if (description.labelsInSlot && description.slotChoices.includes(value)) {
                        view.counterNode.innerText = valueName(description, value);
                        // Green at the top choice, like the tracker's own size slots,
                        // since the next click wraps back to nothing.
                        const top = description.slotChoices[description.slotChoices.length - 1];
                        if (value === top) view.counterNode.classList.add("max-count");
                    }
                }

                const note = slotNote(entry);
                if (note) view.slot.dataset.tooltipNote = note;
                else delete view.slot.dataset.tooltipNote;
            });
        }

        window.addEventListener("settingsChanged", refresh);

        // The inventory options are the settings panel's last section on desktop,
        // and sit under the grids in the phone layout, where they belong to the
        // Starting Items tab. The one block of rows moves between the two, the way
        // the map overlay moves a region, so there is never a second copy to keep
        // in step. The breakpoint is read from CSS, like locationMap.js does.
        const phoneLayout = window.matchMedia(`(max-width: ${
            getComputedStyle(document.documentElement).getPropertyValue("--mobile-breakpoint").trim() || "1499px"
        })`);

        function placeOptions() {
            if (optionsBlock) {
                (phoneLayout.matches ? extras : list).appendChild(optionsBlock);
                extras.hidden = !extras.contains(optionsBlock);
            }
            refresh();
        }

        placeOptions();
        phoneLayout.addEventListener("change", placeOptions);

        const reset = document.getElementById("reset-settings");
        if (reset) {
            reset.addEventListener("click", () => {
                if (window.confirm("Reset every setting to its default?")) settings.reset();
            });
            reset.disabled = false;
        }

        const launch = document.getElementById("launch-new-tracker");
        if (launch) {
            launch.addEventListener("click", () => {
                if (window.TrackerLaunch.write(settings.picks())) {
                    window.location.href = "tracker.html";
                    return;
                }
                // The check at load can pass while these picks still don't fit, so
                // the warning may be news, and the picks are asked about before they go.
                showStorageWarning();
                if (window.confirm("This browser can't store these settings, so they can't reach the tracker. Open the tracker with the default settings?")) {
                    window.location.href = window.TrackerLaunch.defaultsUrl;
                }
            });
            launch.disabled = false;
        }

        if (!window.TrackerLaunch.storageWorks()) showStorageWarning();
    });
})();
