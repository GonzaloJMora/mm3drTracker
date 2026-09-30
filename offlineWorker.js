// The offline copy. Online, every request is asked of the site rather than taken
// from the browser's cache, and the answer is stored; offline, or when the site
// takes too long to answer or fails with a server error, the stored copy answers
// instead. The whole site is stored on the first visit, from the list in
// data/offline.json, and re-checked in the background at most once an hour. It
// lives at the site's root so it covers both pages. See ARCHITECTURE.md, *Offline*.
"use strict";

const CACHE = "offline:" + self.registration.scope;
const LIST = new URL("data/offline.json", self.registration.scope).href;
// Airplane mode fails at once; this is for a connection that neither fails nor answers.
const NETWORK_TIMEOUT_MS = 4000;
const REFRESH_EVERY_MS = 60 * 60 * 1000;
const REFRESHED_KEY = new URL("__offline-refreshed__", self.registration.scope).href;
// Once switched off, requests go straight to the site and nothing is stored, or the
// pages this worker still serves would store the copy again as it is deleted.
let switchedOff = false;

async function switchOff() {
    switchedOff = true;
    await caches.delete(CACHE);
    await self.registration.unregister();
}

// A redirected response can't answer a navigation, and GitHub Pages redirects a
// folder address without its slash, so what gets stored is a plain copy.
async function storable(response) {
    if (!response.redirected) return response;
    return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers: response.headers });
}

async function store(cache, request, response) {
    if (response && response.ok && response.type === "basic") await cache.put(request, await storable(response.clone()));
}

// Stores every listed file. "no-cache" has the browser ask the site whether each
// file changed, so an unchanged one costs a short reply rather than the file. One
// failed file doesn't stop the rest. Returns false when the off switch is set.
async function storeEverything() {
    const response = await fetch(LIST, { cache: "no-cache" });
    const list = await response.json();
    const cache = await caches.open(CACHE);
    if (list.enabled === false) {
        await switchOff();
        return false;
    }
    await Promise.allSettled((list.files || []).map(async file => {
        const url = new URL(file, self.registration.scope).href;
        await store(cache, url, await fetch(url, { cache: "no-cache" }));
    }));
    await cache.put(REFRESHED_KEY, new Response(String(Date.now())));
    return true;
}

async function refreshIfDue() {
    const cache = await caches.open(CACHE);
    const stamp = await cache.match(REFRESHED_KEY);
    const last = stamp ? Number(await stamp.text()) : 0;
    if (Date.now() - last > REFRESH_EVERY_MS) await storeEverything();
}

self.addEventListener("install", event => {
    // Installs even if storing fails partway: the next refresh fills the gaps.
    event.waitUntil(storeEverything().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
    event.waitUntil(self.clients.claim());
});

// A page asks after it loads; nothing is refreshed while nobody is using the site.
// The off switch arrives the same way, from a page that read data/offline.json.
self.addEventListener("message", event => {
    const type = event.data && event.data.type;
    if (type === "refresh" && !switchedOff) event.waitUntil(refreshIfDue().catch(() => {}));
    if (type === "switch-off") event.waitUntil(switchOff().catch(() => {}));
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (switchedOff || request.method !== "GET" || !request.url.startsWith(self.registration.scope)) return;

    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        // Asked of the site rather than taken from the browser's cache, which can keep
        // a file for minutes after a release and hand a page old scripts beside new
        // data. A copy that can't be stored, with storage full, still answers the page.
        const fromNetwork = fetch(new Request(request, { cache: "no-cache" })).then(async response => {
            if (!switchedOff) await store(cache, request, response).catch(() => {});
            return response;
        });
        // A late answer still updates the stored copy after the stored one was used.
        event.waitUntil(fromNetwork.catch(() => {}));

        const timedOut = new Promise(resolve => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
        const answer = await Promise.race([fromNetwork.catch(() => null), timedOut]);
        // A server error is the site failing, not the file changing, so a stored copy
        // beats it. A 404 still goes through: that file is gone from the site.
        if (answer && answer.status < 500) return answer;

        // ignoreSearch, so tracker.html?defaults finds tracker.html.
        const stored = await cache.match(request, { ignoreSearch: true });
        if (stored) return stored;
        return fromNetwork;
    })());
});
