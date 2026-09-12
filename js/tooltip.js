// A tooltip that can hold markup, which the native title attribute cannot.
//
// It knows nothing about items or logic: an owner registers a selector and a
// builder, and gets called when one of its elements needs describing. That is
// what lets the item grid show song notes and the location list show
// requirements through the same element.
//
// Two ways in. On a pointer it follows the cursor on hover. On touch there is no
// hover and a tap on a check toggles it, so the location list gives each check a
// button that *pins* the tooltip to the bottom of the screen instead. Pinned
// mode is deliberately not gated on hover capability — it is driven by a real
// click, so it works on a mouse too.
//
// Binding is delegated from document on purpose. A .region-group is *moved*
// between the sidebar and the map overlay, and delegation survives that with no
// rebinding — see ARCHITECTURE.md, desktop vs mobile.
(function () {
    "use strict";

    const SHOW_DELAY_MS = 120;
    const POINTER_GAP = 16;
    const EDGE_MARGIN = 8;

    const registrations = [];
    let tooltipEl = null;
    let activeTarget = null;
    let activeBuild = null;
    let pinned = false;
    let showTimer = null;
    let lastPointer = { x: 0, y: 0 };

    const pointerHasHover = () =>
        window.matchMedia && window.matchMedia("(hover: hover)").matches;

    function ensureElement() {
        if (tooltipEl) return tooltipEl;
        tooltipEl = document.createElement("div");
        tooltipEl.className = "tracker-tooltip";
        tooltipEl.hidden = true;
        // Announced by the owner's aria-label instead: the hover tooltip follows
        // the pointer and is meaningless to a screen reader.
        tooltipEl.setAttribute("aria-hidden", "true");
        document.body.appendChild(tooltipEl);
        return tooltipEl;
    }

    // Pinned placement is a CSS concern — the panel docks to the bottom of the
    // viewport, so there is nothing to compute.
    function position() {
        if (!tooltipEl || tooltipEl.hidden || pinned) return;

        const { width, height } = tooltipEl.getBoundingClientRect();
        let x = lastPointer.x + POINTER_GAP;
        let y = lastPointer.y + POINTER_GAP;

        // Song notes images are wide, so running off the right edge is the normal
        // case near the item grid rather than an edge case.
        if (x + width > window.innerWidth - EDGE_MARGIN) {
            x = lastPointer.x - width - POINTER_GAP;
        }
        if (y + height > window.innerHeight - EDGE_MARGIN) {
            y = lastPointer.y - height - POINTER_GAP;
        }

        tooltipEl.style.left = `${Math.max(EDGE_MARGIN, x)}px`;
        tooltipEl.style.top = `${Math.max(EDGE_MARGIN, y)}px`;
    }

    // A builder that throws closes the tooltip and is named once. Left to escape,
    // the throw lands after pin() has docked the panel, leaving that state behind
    // with nothing drawn; and render() runs on every click, so logging each time
    // would bury the console.
    const failedBuilders = new Set();

    function render() {
        if (!activeTarget || !activeBuild) return hide();

        const el = ensureElement();
        try {
            const content = activeBuild(activeTarget, { pinned });
            if (!content) return hide();
            el.innerHTML = "";
            el.appendChild(content);
        } catch (error) {
            if (!failedBuilders.has(activeBuild)) {
                failedBuilders.add(activeBuild);
                console.error("Tooltip: a builder threw, so its tooltip stays closed.", error);
            }
            return hide();
        }

        el.classList.toggle("docked", pinned);
        el.hidden = false;
        position();
    }

    function hide() {
        clearTimeout(showTimer);
        if (pinned) unpin();
        activeTarget = null;
        activeBuild = null;
        if (tooltipEl) {
            tooltipEl.hidden = true;
            tooltipEl.innerHTML = "";
        }
    }

    function findRegistration(node) {
        for (const entry of registrations) {
            const match = node.closest(entry.selector);
            if (match) return { target: match, build: entry.build };
        }
        return null;
    }

    // ---- pinned mode -------------------------------------------------------

    function markAnchor(element, open) {
        const button = element && element.querySelector("[aria-expanded]");
        if (button) button.setAttribute("aria-expanded", String(open));
    }

    function pin(element) {
        const found = findRegistration(element);
        if (!found) return;

        clearTimeout(showTimer);
        markAnchor(activeTarget, false);

        pinned = true;
        activeTarget = found.target;
        activeBuild = found.build;
        // The back-to-top button sits where the panel docks, so it stands down
        // while the panel is up.
        document.body.classList.add("tooltip-docked");
        markAnchor(activeTarget, true);
        render();
    }

    function unpin() {
        if (!pinned) return;
        markAnchor(activeTarget, false);
        pinned = false;
        document.body.classList.remove("tooltip-docked");
        if (tooltipEl) {
            tooltipEl.classList.remove("docked");
            tooltipEl.hidden = true;
            tooltipEl.innerHTML = "";
        }
        activeTarget = null;
        activeBuild = null;
    }

    // Anything that activates a control closes the panel, and still does whatever
    // it normally does. Swallowing the tap that lands on a check would stop it
    // completing, which reads as the app ignoring you — one rule for every target
    // beats an exception you have to know about.
    //
    // `click`, not `pointerdown`: a keyboard activates a control with a click and
    // no pointer event, and a finger that starts a scroll fires `pointerdown` but
    // never a click, so scrolling the list leaves the panel up.
    document.addEventListener("click", (event) => {
        if (!pinned || !(event.target instanceof Element)) return;
        if (tooltipEl && tooltipEl.contains(event.target)) return;

        // The anchor's own button toggles; let its click handler do that.
        if (event.target.closest(".region-check-info")) return;

        unpin();
    }, true);

    // Focus is left alone: pinning from the keyboard never moved it off the info
    // button, so it is already where a keyboard user expects to be.
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        if (pinned) unpin();
        else if (activeTarget) hide();
    });

    // A pinned panel is mobile UI. Crossing to desktop leaves it stranded over a
    // layout with no button to close it with.
    //
    // The test is whether the anchor's button is still drawn, rather than a
    // breakpoint this file would then have to know: CSS hides the button above
    // the breakpoint, so asking the button is asking CSS.
    window.addEventListener("resize", () => {
        if (!pinned) return;
        const button = activeTarget && activeTarget.querySelector(".region-check-info");
        if (!button || getComputedStyle(button).display === "none") unpin();
    });

    // ---- hover mode --------------------------------------------------------

    document.addEventListener("mouseover", (event) => {
        if (pinned || !pointerHasHover() || !registrations.length) return;
        if (!(event.target instanceof Element)) return;

        const found = findRegistration(event.target);
        if (!found) {
            if (activeTarget) hide();
            return;
        }
        if (found.target === activeTarget) return;

        clearTimeout(showTimer);
        activeTarget = found.target;
        activeBuild = found.build;
        showTimer = setTimeout(render, SHOW_DELAY_MS);
    });

    document.addEventListener("mousemove", (event) => {
        lastPointer = { x: event.clientX, y: event.clientY };
        position();
    });

    document.addEventListener("mouseout", (event) => {
        if (pinned || !activeTarget) return;
        // relatedTarget is where the pointer went; staying inside the same element
        // is not a leave.
        const to = event.relatedTarget;
        if (to instanceof Element && activeTarget.contains(to)) return;
        hide();
    });

    // The thing being described can change without the pointer moving: clicking
    // an item slot advances it, and clicking anything re-runs the logic sweep.
    // Redrawing in place beats a tooltip that quietly describes the last state.
    const refresh = () => { if (activeTarget && tooltipEl && !tooltipEl.hidden) render(); };
    document.addEventListener("click", refresh);
    window.addEventListener("trackerStateUpdated", refresh);
    window.addEventListener("trackerChecksUpdated", refresh);

    // Scrolling moves the target out from under a pointer that never moved. A
    // pinned panel is fixed to the viewport, so scrolling leaves it where it is.
    window.addEventListener("scroll", () => { if (!pinned) hide(); }, true);

    window.Tooltip = {
        // build(element, { pinned }) returns a Node to show, or null for nothing.
        // Registration order is match order, so register the more specific
        // selector first.
        register(selector, build) {
            registrations.push({ selector, build });
        },
        // For content that changes size after it is shown — an image inside the
        // tooltip has no height until it loads, and the edge flip measured the
        // box before that.
        reposition: position,
        pin,
        unpin,
        togglePin(element) {
            if (pinned && activeTarget === element) unpin();
            else pin(element);
        },
        hide
    };
})();
