// The names this tracker keeps things under in the browser's storage. Storage is
// shared by every page on the same site, so each name starts with this tracker's id,
// taken from the page's <meta name="tracker-id">: the one place the game reaches
// storage. It is the same id as "app" in data/saveLayout.json, which saveManager.js
// checks. Loaded first in <head>, since trackerLaunch.js needs a key before anything
// else has run. See ARCHITECTURE.md, *Saving*.
(function () {
    "use strict";

    const FALLBACK_ID = "tracker";

    const meta = document.querySelector('meta[name="tracker-id"]');
    const id = meta ? meta.content.trim() : "";
    if (!id) console.warn(`StorageKeys: the page has no <meta name="tracker-id">, so its storage is kept under "${FALLBACK_ID}".`);
    const trackerId = id || FALLBACK_ID;

    window.StorageKeys = {
        trackerId,
        key: name => `${trackerId}.${name}`
    };
})();
