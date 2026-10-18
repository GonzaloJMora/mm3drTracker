// Every pointer to the docs, from the code or from another doc, written
// `NAME.md, *Heading*`, names a heading that exists, and every doc named exists, so
// renaming a section or a doc can't leave pointers to nothing. A name is looked up in documentation/ first, except README.md, which is
// the repo's own (documentation/README.md is only the index). The frozen save
// fixtures are left alone, since they are never edited.
const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const ROOT = path.join(__dirname, "..", "..");
const SEARCHED = ["js", "css", "scripts", "tests", ".github", "documentation", "index.html", "tracker.html", "offlineWorker.js", "playwright.config.js", "README.md"];
// This file is skipped too: its own examples would read as pointers.
// The changelog and the unreleased notes are history, and name what was true then.
const SKIPPED = [path.join("tests", "game", "fixtures"), path.join("tests", "node", "docReferences.test.js"),
    path.join("documentation", "changelog.md"), path.join("documentation", "unreleased")];
const EXTENSIONS = [".js", ".css", ".html", ".py", ".bat", ".yml", ".md"];

function files(entry) {
    const full = path.join(ROOT, entry);
    if (SKIPPED.some(skip => entry.startsWith(skip))) return [];
    if (!fs.existsSync(full)) return [];
    if (fs.statSync(full).isFile()) return EXTENSIONS.includes(path.extname(entry)) ? [entry] : [];
    return fs.readdirSync(full).flatMap(name => files(path.join(entry, name)));
}

function docPath(name) {
    if (name === "README.md") return path.join(ROOT, name);
    const inDocs = path.join(ROOT, "documentation", name);
    return fs.existsSync(inDocs) ? inDocs : path.join(ROOT, name);
}

const headings = new Map();
function headingsOf(name) {
    if (!headings.has(name)) {
        const file = docPath(name);
        const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
        headings.set(name, text === null ? null : [...text.matchAll(/^#{1,6} (.+)$/gm)].map(match => match[1].trim()));
    }
    return headings.get(name);
}

// A pointer wrapped across comment lines reads as one line.
const unwrap = text => text.replace(/\s*\r?\n\s*(?:\/\/|#|rem\b)?\s*/g, " ");

function references() {
    const found = [];
    const loose = [];
    const named = [];
    SEARCHED.flatMap(files).forEach(file => {
        const text = fs.readFileSync(path.join(ROOT, file), "utf8");
        for (const match of text.matchAll(/([A-Za-z_]+\.md),((?:\s*(?:and\s+)?\*[^*]+\*,?)+)/g)) {
            for (const part of match[2].matchAll(/\*([^*]+)\*/g)) {
                found.push({ file, doc: match[1], heading: unwrap(part[1]).trim() });
            }
        }
        // A doc named on its own, outside a quoted string (a test listing file names).
        for (const match of text.matchAll(/(?<!["'/\w])([A-Z][A-Z_]+\.md)\b/g)) named.push({ file, doc: match[1] });
        // Written another way, and so out of this test's sight.
        for (const match of text.matchAll(/([A-Za-z_]+\.md), ?(?:"|[A-Z§])/g)) loose.push(`${file}: ${match[0]}`);
    });
    return { found, loose, named };
}

test.describe("Doc references", () => {
    test("every pointer from the code names a heading that exists", () => {
        const { found } = references();
        expect(found.length).toBeGreaterThan(20);
        const broken = found.filter(({ doc, heading }) => {
            const list = headingsOf(doc);
            return !list || !list.includes(heading);
        }).map(({ file, doc, heading }) => `${file}: ${doc}, *${heading}*`);
        expect(broken, "rename the pointer to the heading's current name").toEqual([]);
    });

    test("every doc a pointer names exists", () => {
        const { named } = references();
        expect(named.length).toBeGreaterThan(20);
        const missing = named.filter(({ doc }) => headingsOf(doc) === null).map(({ file, doc }) => `${file}: ${doc}`);
        expect(missing).toEqual([]);
    });

    test("every pointer is written as NAME.md, *Heading*", () => {
        expect(references().loose, "write it as NAME.md, *Heading* so the test above can check it").toEqual([]);
    });
});
