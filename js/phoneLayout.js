// Whether the page is in the phone layout, for the scripts that move things across
// the breakpoint. The width is --mobile-breakpoint in common.css, so JS and CSS can't
// disagree about where the phone layout starts. See ARCHITECTURE.md, *Desktop vs
// mobile*.
(function () {
    "use strict";

    let query = null;

    // Made on first use rather than at load, so the stylesheet is in by then. The
    // literal is a fallback for a stylesheet that failed to load.
    function media() {
        if (!query) {
            const width = getComputedStyle(document.documentElement).getPropertyValue("--mobile-breakpoint").trim() || "1499px";
            query = window.matchMedia(`(max-width: ${width})`);
        }
        return query;
    }

    window.PhoneLayout = {
        get active() {
            return media().matches;
        },
        onChange(listener) {
            media().addEventListener("change", listener);
        }
    };
})();
