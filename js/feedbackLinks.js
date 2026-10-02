// The footer's Report a bug and Suggest a feature links. Each is a plain link to
// its GitHub issue form in the page's markup, so it works even when nothing else
// on the page does; this fills the form in through the link's address as it is
// used. The field names are the forms' field ids in .github/ISSUE_TEMPLATE, and
// tests/node/feedbackForms.test.js holds the two to each other.
//
// First in <head>, so it keeps every warning and error the page prints from the
// start, for the bug form. Nothing is silenced: each still reaches the console.
(function () {
    "use strict";

    const KEPT = 20;
    const MESSAGE_LENGTH = 300;
    // GitHub refuses a new-issue address much past 8 KB. The messages are trimmed,
    // oldest first, until the whole address fits under this.
    const ADDRESS_LENGTH = 6000;

    const messages = [];

    function describe(value) {
        if (typeof value === "string") return value;
        if (value instanceof Error) return `${value.name}: ${value.message}`;
        try {
            return JSON.stringify(value);
        } catch (error) {
            return String(value);
        }
    }

    function keep(level, parts) {
        let text = parts.map(describe).join(" ").trim();
        if (text.length > MESSAGE_LENGTH) text = `${text.slice(0, MESSAGE_LENGTH - 1)}…`;
        messages.push(`[${level}] ${text}`);
        if (messages.length > KEPT) messages.shift();
    }

    ["warn", "error"].forEach(level => {
        const original = console[level];
        console[level] = function (...parts) {
            try {
                keep(level, parts);
            } catch (error) {
                // Keeping a copy must never stop the message itself.
            }
            return original.apply(this, parts);
        };
    });
    window.addEventListener("error", event => keep("uncaught", [event.error || event.message]));
    window.addEventListener("unhandledrejection", event => keep("unhandled", [event.reason]));

    // ---------- What the page knows ----------

    function pageName() {
        return document.documentElement.hasAttribute("data-requires-launch") ? "Tracker" : "Settings page";
    }

    function version() {
        const known = window.TrackerData && window.TrackerData.version;
        return known ? `v${known}` : "unknown (it didn't load)";
    }

    function screen() {
        const layout = window.PhoneLayout ? (window.PhoneLayout.active ? "phone layout" : "desktop layout") : "layout unknown";
        return `${window.innerWidth}x${window.innerHeight} window, ${layout}, pixel ratio ${window.devicePixelRatio}`;
    }

    // A browser's text-size setting moves the root font size away from 16px.
    function textSize() {
        const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
        if (!size) return "unknown";
        return size === 16 ? "normal (16px)" : `${size > 16 ? "larger" : "smaller"} than normal (${size}px)`;
    }

    function installed() {
        const standalone = window.navigator.standalone === true ||
            (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
        return standalone ? "Installed (Home Screen app)" : "In a browser tab";
    }

    // The tracker's current state, or on the settings page the autosave, which is the
    // run the player last had open.
    function saveCode() {
        try {
            if (window.TrackerSave && window.TrackerSave.available()) {
                const result = window.TrackerSave.encode();
                if (result && result.code) return result.code;
            }
            if (window.SaveStore) {
                const autosave = window.SaveStore.read("autosave");
                if (autosave && typeof autosave.code === "string") return `${autosave.code}\n(the autosave, from the settings page)`;
            }
        } catch (error) {
            // Falls through: a report without a code still helps.
        }
        return "";
    }

    // ---------- The addresses ----------

    function fill(link) {
        const form = link.dataset.feedback;
        let address;
        try {
            address = new URL(link.getAttribute("href"), document.baseURI);
        } catch (error) {
            return;
        }
        const values = { version: version(), page: pageName() };
        if (form === "bug") {
            Object.assign(values, {
                browser: navigator.userAgent,
                screen: screen(),
                text_size: textSize(),
                installed: installed(),
                save_code: saveCode()
            });
        }
        Object.keys(values).forEach(key => address.searchParams.set(key, values[key]));

        if (form === "bug") {
            const recent = messages.slice();
            const withMessages = () => {
                address.searchParams.set("messages", recent.length ? recent.join("\n") : "None");
                return address.href;
            };
            while (recent.length && withMessages().length > ADDRESS_LENGTH) recent.shift();
            withMessages();
        }
        link.href = address.href;
    }

    // Filled as the link is used rather than once, so it carries the page as it is
    // at that moment. Each way of opening a link fires one of these first: a click,
    // a middle click, a long press or right click, and keyboard focus.
    ["pointerdown", "click", "auxclick", "contextmenu", "focusin"].forEach(type => {
        document.addEventListener(type, event => {
            const link = event.target instanceof Element && event.target.closest("a[data-feedback]");
            if (link) fill(link);
        }, true);
    });

    window.FeedbackLinks = { fill, messages: () => messages.slice() };
})();
