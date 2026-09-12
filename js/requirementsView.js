// Turns a logic string into the "Items Required" list the tooltip shows.
//
// Reading the tree rather than the string is the whole point: it is what lets a
// token be drawn as an alternative you do not need (gray) instead of one you are
// missing (red). See logicParser.js for the three states.
(function () {
    "use strict";

    // A top-level & becomes one bullet per term; anything nested renders inline,
    // because "Bombs or Boomerang" reads better on one line than as two bullets.
    function renderInline(annotated, nameFor, resolve, parentType) {
        const node = annotated.node;

        if (node.type === "or" || node.type === "and") {
            const span = document.createElement("span");
            const joiner = node.type === "or" ? " or " : " and ";

            // Parens only where the grouping is not already obvious from the
            // joiner — a bare list of alternatives does not need them.
            const needsParens = parentType && parentType !== node.type;
            if (needsParens) span.appendChild(document.createTextNode("("));

            annotated.children.forEach((child, index) => {
                if (index > 0) {
                    const sep = document.createElement("span");
                    sep.className = "tooltip-joiner";
                    sep.textContent = joiner;
                    span.appendChild(sep);
                }
                span.appendChild(renderInline(child, nameFor, resolve, node.type));
            });

            if (needsParens) span.appendChild(document.createTextNode(")"));
            return span;
        }

        const leaf = document.createElement("span");
        leaf.className = `tooltip-req tooltip-req-${annotated.state}`;
        leaf.textContent = leafText(annotated, nameFor, resolve);
        return leaf;
    }

    function leafText(annotated, nameFor, resolve) {
        const node = annotated.node;

        if (node.type === "compare") {
            // "Ocean Skulltula Tokens 12/30" says more than "... >= 30": the
            // count you already have is the part being asked about.
            const owned = resolve(node.left.id);
            const have = typeof owned === "number" ? owned : Number(Boolean(owned));
            return `${nameFor(node.left.id)} ${have}/${node.right.value}`;
        }

        return nameFor(node.id);
    }

    // One bullet per thing you need. Nested & is flattened because the region's
    // entry logic and the check's own are joined with one, and "A and B" on a
    // single bullet reads as one requirement rather than two.
    function bulletTerms(annotated) {
        if (annotated.node.type !== "and") return [annotated];
        return annotated.children.flatMap(bulletTerms);
    }

    function render(annotated, nameFor, resolve) {
        const list = document.createElement("ul");
        list.className = "tooltip-req-list";

        const terms = bulletTerms(annotated);

        terms.forEach(term => {
            const item = document.createElement("li");
            item.appendChild(renderInline(term, nameFor, resolve, null));

            // A tick or a cross per bullet, so whether a requirement is met does
            // not depend on telling red from green. Bullets are the terms of a
            // top-level AND, so each one is either met or blocking — the third
            // state only exists among alternatives inside a line.
            const mark = document.createElement("span");
            mark.className = `tooltip-mark tooltip-mark-${term.satisfied ? "met" : "unmet"}`;
            mark.textContent = term.satisfied ? "✓" : "✗";
            item.appendChild(mark);

            list.appendChild(item);
        });

        return list;
    }

    window.RequirementsView = { render };
})();
