// The header in the phone layout: a bar frozen at the top, whose menu button opens
// the toolbar as a menu. The same toolbar buttons serve both layouts, so their
// handlers and states need nothing from here. A button marked data-menu-keep-out
// shows under the bar instead of in the menu. On desktop none of this applies and
// the toolbar sits in the header as usual. See ARCHITECTURE.md, *The phone layout*.
(function () {
    "use strict";

    // A bar frozen at the top must never take the screen over. At the largest text
    // sizes it can grow past this share of the window, and then it scrolls away with
    // the page like any header.
    const MAX_FROZEN_SHARE = 0.25;

    document.addEventListener("DOMContentLoaded", () => {
        const header = document.querySelector("header");
        const button = document.getElementById("header-menu-button");
        const toolbar = document.getElementById("tracker-toolbar");
        const keepOut = document.getElementById("header-keep-out");
        if (!header || !button || !toolbar) return;

        // Each kept-out button goes back where it came from on desktop.
        const keptOut = [...toolbar.querySelectorAll("[data-menu-keep-out]")]
            .map(node => ({ node, next: node.nextElementSibling }));

        const isOpen = () => header.classList.contains("menu-open");

        function setOpen(open) {
            header.classList.toggle("menu-open", open);
            button.setAttribute("aria-expanded", String(open));
            if (open) {
                // A loose bar can be taller than the window, leaving the menu below it.
                toolbar.scrollIntoView({ block: "nearest" });
                const first = [...toolbar.querySelectorAll("button")].find(b => !b.disabled && b.offsetParent !== null);
                if (first) first.focus({ preventScroll: true });
            }
        }

        function placeKeptOut() {
            keptOut.forEach(({ node, next }) => {
                if (window.PhoneLayout.active && keepOut) keepOut.appendChild(node);
                else if (next && next.parentElement === toolbar) toolbar.insertBefore(node, next);
                else toolbar.appendChild(node);
            });
        }

        function fitBar() {
            header.classList.remove("bar-loose");
            if (!window.PhoneLayout.active) return;
            header.classList.toggle("bar-loose", header.offsetHeight > window.innerHeight * MAX_FROZEN_SHARE);
        }

        button.addEventListener("click", () => setOpen(!isOpen()));

        // A view toggle keeps the menu open, so its new state shows; any other item is
        // an action, and the menu gets out of its way.
        toolbar.addEventListener("click", event => {
            const item = event.target.closest("button");
            if (!item || !isOpen() || item.hasAttribute("data-view-toggle")) return;
            setOpen(false);
        });

        document.addEventListener("click", event => {
            if (isOpen() && !toolbar.contains(event.target) && !button.contains(event.target)) setOpen(false);
        });

        document.addEventListener("keydown", event => {
            if (event.key !== "Escape" || !isOpen()) return;
            setOpen(false);
            button.focus();
        });

        window.PhoneLayout.onChange(() => {
            setOpen(false);
            placeKeptOut();
            fitBar();
        });
        window.addEventListener("resize", fitBar);
        window.addEventListener("load", fitBar);
        // Text-size changes resize the header without resizing the window.
        if (window.ResizeObserver) new ResizeObserver(fitBar).observe(header);

        placeKeptOut();
        fitBar();
    });
})();
