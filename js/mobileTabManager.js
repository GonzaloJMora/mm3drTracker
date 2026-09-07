// Driven by the data-tab / data-section attributes in index.html, never by button
// position — keying off nth-child means reordering the buttons silently switches
// the wrong panel. Adding a tab is a button plus its section, with no change here.

// How far down each tab was scrolled when you left it. Deliberately in memory
// only: this is where you were looking, not what you have collected, and it has
// no business in the Phase 4 save file.
const tabScrollPositions = {};

function activeTabName() {
    const active = document.querySelector('.tab-btn.active');
    return active ? active.dataset.tab : null;
}

function switchMobileTab(tabName) {
    const previous = activeTabName();
    const changed = previous !== tabName;

    if (changed && previous) {
        tabScrollPositions[previous] = window.scrollY;
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        const isActive = btn.dataset.tab === tabName;
        btn.classList.toggle('active', isActive);

        const section = document.getElementById(btn.dataset.section);
        if (section) section.classList.toggle('active-section', isActive);
    });

    if (changed) {
        // The sections have already swapped by this point, so the page is at its
        // new height and the browser clamps this on its own if the tab you are
        // arriving at is shorter than the position you left it at.
        window.scrollTo(0, tabScrollPositions[tabName] || 0);
        updateBackToTop();
    }
}

// ---------- Back to top ----------

// The button lives in index.html and is hidden above the mobile breakpoint by
// CSS; its glyph is CSS too (#back-to-top::after), the same way the region
// accordion arrow works, so no character is written from JS.
function updateBackToTop() {
    const button = document.getElementById('back-to-top');
    if (!button) return;
    // Half a screen. A full screen sounds right but hides the button on the
    // shorter tab, which only scrolls a bit over one screenful to begin with.
    button.classList.toggle('visible', window.scrollY > window.innerHeight / 2);
}

function setupBackToTop() {
    const button = document.getElementById('back-to-top');
    if (!button) return;

    // Not behavior:'smooth'. Smooth scrolling runs on the same frame loop as rAF,
    // which stops for a window that isn't being painted — so the button would do
    // nothing exactly when someone jabs at it.
    button.addEventListener('click', () => window.scrollTo(0, 0));
    window.addEventListener('scroll', updateBackToTop, { passive: true });
    // Resize as well as scroll. The threshold is half the window height, so a
    // resize moves it - and without this, crossing the breakpoint into mobile
    // while already scrolled down leaves the button hidden until you scroll again.
    window.addEventListener('resize', updateBackToTop);
    updateBackToTop();
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchMobileTab(btn.dataset.tab));
    });

    setupBackToTop();
});
