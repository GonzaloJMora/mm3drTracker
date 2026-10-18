// The footer's Report a bug and Suggest a feature links: each opens its GitHub form
// with what the page knows filled in, under the forms' own field ids.
const fs = require("fs");
const path = require("path");
const { test, expect, openSettings, launchTracker, slot, DESKTOP, readWorld } = require("./fixtures");

const ROOT = path.join(__dirname, "..", "..");
const version = readWorld("version.json").version;

// The field ids a form has, read from its file in .github/ISSUE_TEMPLATE.
function formFields(file) {
    const text = fs.readFileSync(path.join(ROOT, ".github", "ISSUE_TEMPLATE", file), "utf8");
    return [...text.matchAll(/^\s+id: (\w+)\s*$/gm)].map(match => match[1]);
}

// A link's address once the page has filled it in, as focusing it does.
async function filled(page, form) {
    const link = page.locator(`#app-footer a[data-feedback="${form}"]`);
    await link.focus();
    return new URL(await link.getAttribute("href"));
}

// Every value the link fills in is a field the form has; template picks the form.
function unknownFields(address, file) {
    const fields = formFields(file);
    return [...address.searchParams.keys()].filter(key => key !== "template" && !fields.includes(key));
}

test.describe("Feedback links", () => {
    test("Report a bug on the tracker carries the version, the window, the save and recent warnings", { tag: "@smoke" }, async ({ page, allowConsole }) => {
        allowConsole.push(/made-up warning for the bug report/);
        await launchTracker(page);
        await slot(page, "bow").click();
        await page.evaluate(() => console.warn("made-up warning for the bug report"));

        const address = await filled(page, "bug");
        expect(address.origin + address.pathname).toBe("https://github.com/GonzaloJMora/mm3drTracker/issues/new");
        expect(unknownFields(address, "bug_report.yml")).toEqual([]);
        const field = name => address.searchParams.get(name);
        expect(field("template")).toBe("bug_report.yml");
        expect(field("version")).toBe(`v${version}`);
        expect(field("page")).toBe("Tracker");
        expect(field("browser")).toBeTruthy();
        expect(field("screen")).toContain(`${DESKTOP.width}x${DESKTOP.height} window, desktop layout`);
        expect(field("text_size")).toBe("normal (16px)");
        expect(field("installed")).toBe("In a browser tab");
        expect(field("messages")).toContain("made-up warning for the bug report");

        // The save code opens the tracker exactly as it is. Compared by value: a save
        // lists its fields in save-layout order, the page in settings.json order.
        const { decoded, live } = await page.evaluate(async code => ({
            decoded: (await window.TrackerSave.decode(code)).snapshot,
            live: window.TrackerSave.snapshot()
        }), field("save_code"));
        expect(Object.assign({}, decoded, { checks: [...decoded.checks].sort() }))
            .toEqual(Object.assign({}, live, { checks: [...live.checks].sort() }));
    });

    test("on the settings page both links name the page, and the feature form gets only what it asks for", async ({ page }) => {
        await openSettings(page);
        const bug = await filled(page, "bug");
        expect(bug.searchParams.get("page")).toBe("Settings page");

        const feature = await filled(page, "feature");
        expect(feature.searchParams.get("template")).toBe("feature_request.yml");
        expect(unknownFields(feature, "feature_request.yml")).toEqual([]);
        expect([...feature.searchParams.keys()].sort()).toEqual(["page", "template", "version"]);
    });

    test("a page full of long errors still gives an address GitHub accepts, keeping the latest", async ({ page, allowConsole }) => {
        allowConsole.push(/flood \d+/);
        await openSettings(page);
        await page.evaluate(() => {
            for (let i = 0; i < 100; i++) console.error(`flood ${i} ${"x".repeat(1000)}`);
        });
        const address = await filled(page, "bug");
        expect(address.href.length).toBeLessThanOrEqual(6000);
        expect(address.searchParams.get("messages")).toContain("flood 99");
    });

    // Tapped, in WebKit too: a tap doesn't focus a link, so on an iPhone only the
    // pointerdown and click listeners fill it in.
    test.describe("on a touch screen", () => {
        test.use({ hasTouch: true });

        test("tapping a link opens the form in a new tab, filled in, and leaves the tracker as it was", { tag: "@webkit" }, async ({ page, context }) => {
            await context.route("https://github.com/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<title>form</title>" }));
            await launchTracker(page);
            const [form] = await Promise.all([
                context.waitForEvent("page"),
                page.locator('#app-footer a[data-feedback="bug"]').tap()
            ]);
            await form.waitForLoadState();
            const address = new URL(form.url());
            expect(address.searchParams.get("template")).toBe("bug_report.yml");
            expect(address.searchParams.get("version")).toBe(`v${version}`);
            expect(page.url()).toMatch(/tracker\.html/);
        });
    });
});
