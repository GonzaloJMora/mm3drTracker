// One control per setting class, for the settings page. A new class is a register
// call here plus its value rules in settingsState.js's CLASSES.
//
// A factory takes the setting's description (SettingsState.describe) and a
// callback for a new value, and returns { element, update(value, locked) }. The
// page owns the label and the lock note; a factory only owns its input.
(function () {
    "use strict";

    const factories = new Map();

    function register(className, factory) {
        factories.set(className, factory);
    }

    function create(description, onChange) {
        const factory = factories.get(description.class);
        return factory ? factory(description, onChange) : null;
    }

    // A slider: the checkbox stays the real control, invisible over a track drawn in
    // settingsPage.css.
    register("toggle", (description, onChange) => {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.setAttribute("role", "switch");
        input.addEventListener("change", () => onChange(input.checked));
        const wrapper = document.createElement("span");
        wrapper.className = "setting-switch";
        const track = document.createElement("span");
        track.className = "setting-switch-track";
        wrapper.append(input, track);
        return {
            element: wrapper,
            update(value, locked) {
                input.checked = value === true;
                input.disabled = locked;
            }
        };
    });

    register("dropdown", (description, onChange) => {
        const select = document.createElement("select");
        description.options.forEach(option => {
            const node = document.createElement("option");
            node.value = option.id;
            node.textContent = option.name;
            select.appendChild(node);
        });
        select.addEventListener("change", () => onChange(select.value));
        return {
            element: select,
            update(value, locked) {
                select.value = value;
                select.disabled = locked;
            }
        };
    });

    register("number", (description, onChange) => {
        const input = document.createElement("input");
        input.type = "number";
        input.min = description.min;
        input.max = description.max;
        input.step = 1;
        input.inputMode = "numeric";
        // Focus selects the number so typing replaces it. The mouseup that ends a
        // focusing click would clear that selection straight away, so it is ignored.
        let focusingClick = false;
        input.addEventListener("mousedown", () => {
            focusingClick = document.activeElement !== input;
        });
        input.addEventListener("focus", () => input.select());
        input.addEventListener("mouseup", event => {
            if (focusingClick) event.preventDefault();
            focusingClick = false;
        });
        // Committed on change and clamped, so a half-typed or out-of-range number
        // never reaches the settings. A cleared or unreadable box goes back to the
        // value it held.
        let current = description.default;
        input.addEventListener("change", () => {
            const typed = Math.round(Number(input.value));
            if (input.value.trim() === "" || !Number.isFinite(typed)) {
                input.value = current;
                return;
            }
            const value = Math.min(description.max, Math.max(description.min, typed));
            input.value = value;
            onChange(value);
        });
        return {
            element: input,
            update(value, locked) {
                current = value;
                input.value = value;
                input.disabled = locked;
            }
        };
    });

    window.SettingControls = { register, create };
})();
