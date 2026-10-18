// Every finding of js/dataChecks.js for an assembled data set, as rule id -> lines.
// A string that fails to parse is reported by the parser through console.error; the
// rule says the same, so the parser's line is kept out of the test output.
require("../../js/logicParser.js");
const DataChecks = require("../../js/dataChecks.js");

function findingsOf(assembled) {
    const original = console.error;
    console.error = () => {};
    try {
        const context = DataChecks.context(assembled.data, { fileOf: assembled.fileOf });
        const byRule = {};
        assembled.findings.concat(DataChecks.run(context)).forEach(({ rule, lines }) => {
            byRule[rule] = (byRule[rule] || []).concat(lines);
        });
        return byRule;
    } finally {
        console.error = original;
    }
}

module.exports = { findingsOf };
