// Every check's requirement in a world, set beside what the tooltip lists for it
// (RequirementsView.simplify), with the checks where the two don't mean the same.
// The factory suite runs it on the test world, the game suite on the game's data.
// Counts against a setting are read at the setting's default, as the page reads
// them at the current pick.
require("../../js/logicParser.js");
const LogicParser = require("../../js/logicParser.js");
const RequirementsView = require("../../js/requirementsView.js");
const DataChecks = require("../../js/dataChecks.js");

// A setting's count as a plain number, so both sides are compared on numbers.
function withNumbers(node, numberOf) {
    if (node.type === "compare" && node.right.type === "setting") {
        const value = numberOf(node.right.id);
        return typeof value === "number" ? { type: "compare", left: node.left, right: { type: "number", value } } : node;
    }
    if (node.type === "and" || node.type === "or") return { type: node.type, children: node.children.map(child => withNumbers(child, numberOf)) };
    return node;
}

// The minimal ways in, written so two lists can be compared.
const waysOf = tree => LogicParser.waysIn(tree)
    .map(way => [...way].sort().map(([token, count]) => `${token}:${count}`).join(" "))
    .sort();

// Whether a tree is met by an inventory given as token -> count.
const metAt = (tree, have) => LogicParser.isSatisfied(tree, token => have.get(token) || 0);

// The checks whose listed terms don't mean exactly their requirement: two monotone
// requirements are the same exactly when their minimal ways in are, and each way is
// also evaluated, met as it is and unmet one count short, so a fault in waysIn()
// can't make both sides agree.
function differences(assembled) {
    const ctx = DataChecks.context(assembled.data, { fileOf: assembled.fileOf });
    const numberOf = id => {
        const setting = ctx.settings.get(id);
        const option = setting && setting.options && setting.options.get && setting.options.get(setting.default);
        return option ? option.value : undefined;
    };
    const resolve = (token, kind) => (kind === "setting" ? numberOf(token) : undefined);
    const found = [];
    let checked = 0;
    ctx.regions.forEach(region => region.item_checks.forEach(check => {
        const parsed = LogicParser.parse([region.logic, ...(check.group_logic || []), check.logic]);
        if (!parsed) return;
        checked++;
        const tree = withNumbers(parsed, numberOf);
        const terms = RequirementsView.simplify(tree, resolve);
        const listed = terms.length === 1 ? terms[0] : { type: "and", children: terms };
        const before = waysOf(tree);
        const after = waysOf(listed);
        let same = JSON.stringify(before) === JSON.stringify(after);
        LogicParser.waysIn(tree).forEach(way => {
            if (!metAt(tree, way) || !metAt(listed, way)) same = false;
            way.forEach((count, token) => {
                const short = new Map(way).set(token, count - 1);
                if (metAt(tree, short) !== metAt(listed, short)) same = false;
            });
        });
        if (!same) found.push(`${region.region_name} -> ${check.id}: ${before.join(" | ")}  became  ${after.join(" | ")}`);
    }));
    return { checked, found };
}

module.exports = { differences };
