// A static file server for the tests, started by playwright.config.js.
//
// Not `python -m http.server`: it queues only five waiting connections, so a few
// test workers loading pages at once get connections refused, which the page
// reports as "could not be fetched". Nothing is cached, so every load sees the
// files as they are on disk. Usage: node tests/server.js <port>
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.argv[2]) || 8731;

const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8"
};

const server = http.createServer((request, response) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch (error) {
        response.writeHead(400).end();
        return;
    }
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = path.join(ROOT, pathname);
    // Inside the repo, and never a dot-named file or folder such as .git.
    if (!file.startsWith(ROOT + path.sep) || pathname.split("/").some(part => part.startsWith("."))) {
        response.writeHead(404).end();
        return;
    }
    fs.readFile(file, (error, body) => {
        if (error) {
            response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
            return;
        }
        response.writeHead(200, {
            "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
            "Cache-Control": "no-store"
        });
        response.end(request.method === "HEAD" ? undefined : body);
    });
});

server.listen(PORT, "127.0.0.1", 511, () => {
    console.log(`Serving ${ROOT} at http://localhost:${PORT}/`);
});
