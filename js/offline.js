// The offline copy's page side, on both pages: registers offlineWorker.js, or removes it and its
// stored copy when data/offline.json's "enabled" is false; asks for persistent
// storage when the tracker runs as an installed app; and on an iPhone or iPad, once,
// suggests adding it to the Home Screen. See ARCHITECTURE.md, *Offline*.
(function () {
    "use strict";

    // Remembers that the Home Screen tip was closed. A convenience, so a browser that
    // won't store it just shows the tip again.
    const HINT_KEY = window.StorageKeys.key("homeScreenTipClosed");

    // The worker serving this page is told first, so it stops storing what the page
    // still loads; then every registration and stored copy goes.
    function removeOfflineCopy() {
        if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: "switch-off" });
        navigator.serviceWorker.getRegistrations()
            .then(registrations => registrations.forEach(registration => registration.unregister()))
            .catch(() => {});
        if (window.caches) {
            caches.keys()
                .then(keys => keys.filter(key => key.startsWith("offline:")).forEach(key => caches.delete(key)))
                .catch(() => {});
        }
    }

    function registerOfflineCopy() {
        navigator.serviceWorker.register("offlineWorker.js")
            .then(() => navigator.serviceWorker.ready)
            .then(registration => {
                if (registration.active) registration.active.postMessage({ type: "refresh" });
            })
            .catch(error => console.warn("offline: the offline copy could not be set up", error));
    }

    // Installed as an app, browsers grant this without asking. In a tab, Firefox
    // would ask with a prompt, so a tab never asks.
    function askToKeepStorage() {
        const installed = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
        if (installed && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    }

    // Safari on an iPhone or iPad clears a site's storage after days without a visit;
    // a Home Screen app doesn't. The device is checked, not the browser, so the tip
    // shows in every browser there: they all run on Safari's engine. An iPad reports
    // itself as a Mac, so touch tells it apart.
    function showHomeScreenTip() {
        const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
        if (!ios || navigator.standalone === true) return;
        try {
            if (window.localStorage.getItem(HINT_KEY) === "true") return;
        } catch (error) {
            // Shown, then.
        }
        const main = document.querySelector("main");
        if (!main) return;
        const tip = document.createElement("div");
        tip.id = "home-screen-tip";
        tip.appendChild(document.createTextNode(
            "Tip: add the tracker to your Home Screen so it works offline and keeps your progress. " +
            "Tap Share, then Add to Home Screen. "));
        const close = document.createElement("button");
        close.type = "button";
        close.className = "toolbar-btn";
        close.textContent = "Got It";
        close.addEventListener("click", () => {
            try {
                window.localStorage.setItem(HINT_KEY, "true");
            } catch (error) {
                // It still goes for now.
            }
            tip.remove();
        });
        tip.appendChild(close);
        main.insertBefore(tip, main.firstChild);
    }

    window.TrackerData.onReady(data => {
        // A service worker needs a secure page: HTTPS, or localhost.
        if ("serviceWorker" in navigator && window.isSecureContext) {
            if (data.offline && data.offline.enabled === false) removeOfflineCopy();
            else if (data.offline) registerOfflineCopy();
        }
        askToKeepStorage();
        showHomeScreenTip();
    });
})();
