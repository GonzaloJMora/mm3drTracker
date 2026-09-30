// window.SaveCodec — turns a tracker's state into a save code and back. No DOM
// and no data of its own, so Node can run it too.
//
// A snapshot is plain named values:
//   { settings: { id: value }, slots: { id: number }, checks: [ids], view: { id: bool } }
// A layout (data/saveLayout.json) says which bits hold which of them. How the code
// is built, and why bits never move: ARCHITECTURE.md, *Saving*.
(function (root) {
    "use strict";

    const HEADER_BITS = 16;
    const MAX_FIELD_BITS = 16;
    const KINDS = new Set(["setting", "slot", "check", "view", "retired"]);

    class SaveError extends Error {
        // reason is one of: "not-a-save", "not-a-code", "damaged", "newer", "unknown-format".
        constructor(reason, message) {
            super(message);
            this.name = "SaveError";
            this.reason = reason;
        }
    }

    // ---------- CRC-32, so a mistyped or cut-short code is refused ----------

    const CRC_TABLE = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    // ---------- Bits and text ----------

    function writeBits(bits, value, width) {
        for (let i = width - 1; i >= 0; i--) bits.push(Math.floor(value / 2 ** i) % 2);
    }

    function toBytes(bits) {
        const bytes = new Uint8Array(Math.ceil(bits.length / 8));
        bits.forEach((bit, i) => { if (bit) bytes[i >> 3] |= 0x80 >> (i & 7); });
        return bytes;
    }

    function toBase64Url(bytes) {
        let binary = "";
        bytes.forEach(byte => { binary += String.fromCharCode(byte); });
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    function fromBase64Url(text) {
        if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new SaveError("not-a-code", "The code has characters a save code never has.");
        const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
        let binary;
        try {
            binary = atob(padded);
        } catch (error) {
            throw new SaveError("not-a-code", "The code is not the right length to be a save code.");
        }
        return Uint8Array.from(binary, ch => ch.charCodeAt(0));
    }

    function bitReader(bytes, totalBits) {
        let at = 0;
        return {
            left: () => totalBits - at,
            read(width) {
                let value = 0;
                for (let i = 0; i < width; i++, at++) {
                    value = value * 2 + ((bytes[at >> 3] >> (7 - (at & 7))) & 1);
                }
                return value;
            }
        };
    }

    // ---------- Layouts ----------

    const keyOf = field => `${field.kind}:${field.id}`;

    // Every way a layout can be unusable, as readable lines. Empty means usable.
    function layoutProblems(layout) {
        const problems = [];
        if (!layout || typeof layout !== "object") return ["the layout is not an object"];
        if (typeof layout.app !== "string" || layout.app === "") problems.push('it has no "app" name');
        if (!Number.isInteger(layout.format) || layout.format < 1 || layout.format >= 2 ** HEADER_BITS) {
            problems.push(`its "format" must be a whole number from 1 to ${2 ** HEADER_BITS - 1}`);
        }
        if (!Array.isArray(layout.fields)) return problems.concat('it has no "fields" list');
        if (layout.fields.length >= 2 ** HEADER_BITS) problems.push("it has more fields than a code can count");
        const seen = new Set();
        layout.fields.forEach((field, index) => {
            const where = `fields[${index}]`;
            if (!field || !KINDS.has(field.kind)) {
                problems.push(`${where} has no kind this tracker knows`);
                return;
            }
            if (!Number.isInteger(field.bits) || field.bits < 1 || field.bits > MAX_FIELD_BITS) {
                problems.push(`${where} needs "bits" from 1 to ${MAX_FIELD_BITS}`);
            }
            if (field.kind === "retired") return;
            if (typeof field.id !== "string" || field.id === "") {
                problems.push(`${where} has no id`);
                return;
            }
            if (seen.has(keyOf(field))) problems.push(`${field.kind} "${field.id}" is in the layout twice`);
            seen.add(keyOf(field));
            if (field.options !== undefined && (!Array.isArray(field.options) || field.options.length > 2 ** field.bits)) {
                problems.push(`${field.kind} "${field.id}" has more options than its bits hold`);
            }
            if (field.min !== undefined && !Number.isInteger(field.min)) problems.push(`${field.kind} "${field.id}" has a "min" that isn't a whole number`);
            if ((field.kind === "check" || field.kind === "view") && field.bits !== 1) {
                problems.push(`${field.kind} "${field.id}" needs exactly 1 bit`);
            }
        });
        return problems;
    }

    // ---------- Encoding ----------

    // Returns { code, problems }. A value the layout can't hold is written as the
    // nearest it can and named in problems, so a save is never refused outright.
    function encode(snapshot, layout) {
        const problems = [];
        const settings = snapshot.settings || {};
        const slots = snapshot.slots || {};
        const view = snapshot.view || {};
        const checks = new Set(snapshot.checks || []);
        const bits = [];

        writeBits(bits, layout.format, HEADER_BITS);
        writeBits(bits, layout.fields.length, HEADER_BITS);

        const numeric = (field, value) => {
            const low = field.min || 0;
            const top = 2 ** field.bits - 1;
            if (!Number.isInteger(value)) {
                problems.push(`${field.kind} "${field.id}" has no whole-number value (${JSON.stringify(value)}), so 0 is saved`);
                return 0;
            }
            const raw = value - low;
            if (raw < 0 || raw > top) {
                problems.push(`${field.kind} "${field.id}" is ${value}, which its field can't hold`);
                return Math.min(Math.max(raw, 0), top);
            }
            return raw;
        };

        layout.fields.forEach(field => {
            let raw = 0;
            if (field.kind === "check") {
                raw = checks.has(field.id) ? 1 : 0;
            } else if (field.kind === "view") {
                raw = view[field.id] ? 1 : 0;
            } else if (field.kind === "setting" || field.kind === "slot") {
                const value = (field.kind === "setting" ? settings : slots)[field.id];
                if (Array.isArray(field.options)) {
                    raw = field.options.indexOf(value);
                    if (raw < 0) {
                        problems.push(`${field.kind} "${field.id}" is ${JSON.stringify(value)}, which is not in its layout options`);
                        raw = 0;
                    }
                } else {
                    raw = numeric(field, value);
                }
            }
            writeBits(bits, raw, field.bits);
        });

        const payload = toBytes(bits);
        const crc = crc32(payload);
        const bytes = new Uint8Array(payload.length + 4);
        bytes.set(payload);
        [24, 16, 8, 0].forEach((shift, i) => { bytes[payload.length + i] = (crc >>> shift) & 0xFF; });
        return { code: toBase64Url(bytes), problems };
    }

    // ---------- Decoding ----------

    function emptySnapshot() {
        return { settings: {}, slots: {}, checks: [], view: {} };
    }

    function emptyLists() {
        return { settings: [], slots: [], checks: [], view: [] };
    }

    const GROUP = { setting: "settings", slot: "slots", check: "checks", view: "view" };

    // Reads a code with the layout of the format it was written in, then compares
    // it with the current layout. layoutFor(format) returns that format's layout, or
    // a promise of it; current is the layout this app writes.
    //
    // Resolves to { format, snapshot, missing, dropped }:
    //   missing: what the current layout has that the save doesn't, so it takes a
    //            default (a setting whose saved option no longer exists included);
    //   dropped: what the save holds that no longer exists.
    async function decode(code, { layoutFor, current }) {
        const bytes = fromBase64Url(String(code).trim());
        if (bytes.length < 8) throw new SaveError("not-a-code", "The code is too short to be a save.");

        const payload = bytes.subarray(0, bytes.length - 4);
        const stored = bytes.subarray(bytes.length - 4).reduce((value, byte) => value * 256 + byte, 0);
        if (crc32(payload) !== stored) {
            throw new SaveError("damaged", "The code is damaged: part of it is missing or mistyped.");
        }

        const reader = bitReader(payload, payload.length * 8);
        const format = reader.read(HEADER_BITS);
        if (format > current.format) {
            throw new SaveError("newer", `The save was made by a newer version of the tracker (format ${format}), which this one can't read.`);
        }
        const layout = format === current.format ? current : await layoutFor(format);
        if (!layout || layoutProblems(layout).length) {
            throw new SaveError("unknown-format", `The save's format (${format}) is not one this tracker knows.`);
        }
        const count = reader.read(HEADER_BITS);
        if (count > layout.fields.length) {
            throw new SaveError("damaged", "The code says it holds more than its own format has.");
        }

        const snapshot = emptySnapshot();
        const missing = emptyLists();
        const dropped = emptyLists();
        const readKeys = new Set();

        for (let i = 0; i < count; i++) {
            const field = layout.fields[i];
            if (reader.left() < field.bits) throw new SaveError("damaged", "The code ends before everything it says it holds.");
            const raw = reader.read(field.bits);
            if (field.kind === "retired") continue;
            readKeys.add(keyOf(field));

            if (field.kind === "check") {
                if (raw) snapshot.checks.push(field.id);
            } else if (field.kind === "view") {
                snapshot.view[field.id] = raw === 1;
            } else if (Array.isArray(field.options)) {
                if (raw < field.options.length) snapshot[GROUP[field.kind]][field.id] = field.options[raw];
                else readKeys.delete(keyOf(field));
            } else {
                snapshot[GROUP[field.kind]][field.id] = (field.min || 0) + raw;
            }
        }

        // Against the current layout: fields renamed or retired since become dropped,
        // and a setting option that is gone takes the default.
        const now = new Map(current.fields.filter(field => field.kind !== "retired").map(field => [keyOf(field), field]));
        Object.keys(GROUP).forEach(kind => {
            const group = GROUP[kind];
            if (kind === "check") {
                snapshot.checks = snapshot.checks.filter(id => {
                    if (now.has(`check:${id}`)) return true;
                    dropped.checks.push(id);
                    return false;
                });
                return;
            }
            Object.keys(snapshot[group]).forEach(id => {
                const field = now.get(`${kind}:${id}`);
                if (!field) {
                    dropped[group].push(id);
                    delete snapshot[group][id];
                } else if (Array.isArray(field.options) && !field.options.includes(snapshot[group][id])) {
                    delete snapshot[group][id];
                    readKeys.delete(`${kind}:${id}`);
                }
            });
        });
        now.forEach((field, key) => {
            if (!readKeys.has(key)) missing[GROUP[field.kind]].push(field.id);
        });

        return { format, snapshot, missing, dropped };
    }

    // ---------- The readable wrapper around a code ----------

    // What an autosave and an exported file hold. Only code is read back; the rest
    // is there for a person opening the file.
    function wrap(code, layout, { version = null, savedAt = new Date().toISOString() } = {}) {
        return { app: layout.app, format: layout.format, version, savedAt, code };
    }

    // A wrapper as text or as an object, or a bare code. Returns the code.
    function unwrap(input, layout) {
        let value = input;
        if (typeof value === "string") {
            const text = value.trim();
            if (!text.startsWith("{")) return text;
            try {
                value = JSON.parse(text);
            } catch (error) {
                throw new SaveError("not-a-save", "This file is not a save.");
            }
        }
        if (!value || typeof value !== "object" || typeof value.code !== "string") {
            throw new SaveError("not-a-save", "This file is not a save.");
        }
        if (value.app !== layout.app) {
            throw new SaveError("not-a-save", `This save is from ${JSON.stringify(value.app)}, not this tracker.`);
        }
        return value.code.trim();
    }

    const api = { encode, decode, wrap, unwrap, layoutProblems, SaveError };
    root.SaveCodec = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
