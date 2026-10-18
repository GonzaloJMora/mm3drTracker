// Turns a logic string into the "Items Required" chips the tooltip shows: one per
// thing you need, each marked met or missing, with an "Any one of" drawn as a
// dashed group of its ways in.
//
// Reading the tree rather than the string is the whole point: it is what lets a
// token be drawn as an alternative you do not need (gray) instead of one you are
// missing (red). See logicParser.js for the three states.
(function (root) {
    "use strict";

    const parser = () => root.LogicParser || require("./logicParser.js");

    // A top-level & becomes one bullet per term; anything nested renders inline,
    // because "A or B" reads better on one line than as two bullets.
    // The exception is an either/or whose alternatives have parts of their own,
    // which render() splits into routes.
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
            // "Tokens 12/30" says more than "... >= 30": the
            // count you already have is the part being asked about.
            const owned = resolve(node.left.id);
            const have = typeof owned === "number" ? owned : Number(Boolean(owned));
            const target = targetOf(node, resolve);
            return `${nameFor(node.left.id)} ${have}/${typeof target === "number" ? target : "?"}`;
        }

        return nameFor(node.id);
    }

    // A setting's number is read as the tooltip draws. One with no number shows as
    // "?", and the comparison it belongs to is unmet.
    function targetOf(node, resolve) {
        return node.right.type === "setting" ? resolve(node.right.id, "setting") : node.right.value;
    }

    // ---------- Simplifying: what the chips list ----------

    // The requirement as the fewest terms that mean exactly the same thing: each
    // step below keeps the & of the terms equal to the tree it started from, so no
    // mark can change. The check's color never goes through here; it comes from the
    // tree as written. tests/node/requirementsView.test.js holds each step to
    // examples worked out by hand, and checks the result against the original for
    // every check in the test world (the game suite does the same for the game's).
    //
    // Returns the terms, plain trees whose & is the tree. Builds new nodes and never
    // touches the parsed ones, which LogicParser caches.
    function simplify(tree, resolve) {
        let terms = bulletTerms(tree);
        // A step can open the way for another (a term shrunk to one item is then
        // given to the rest), so they repeat until nothing changes.
        for (let pass = 0; pass < MAX_PASSES; pass++) {
            const next = splitChoices(dropImplied(dropGiven(terms, resolve)));
            if (next.length === terms.length && next.every((term, index) => term === terms[index])) break;
            terms = next;
        }
        return terms;
    }

    // Every pass removes or splits a term, so a real requirement settles in a few.
    const MAX_PASSES = 20;

    // One term per thing you need. Nested & is flattened because the region's entry
    // logic and the check's own are joined with one, and "A and B" on a single chip
    // reads as one requirement rather than two.
    function bulletTerms(node) {
        return node.type === "and" ? node.children.flatMap(bulletTerms) : [node];
    }

    const itemOf = node => (node.type === "token" ? node.id : node.left.id);

    // How much of its item a leaf asks for: a bare item is 1, a count its target. A
    // target that can't be read is Infinity, because its comparison is never met.
    function demand(node, resolve) {
        if (node.type === "token") return 1;
        const target = targetOf(node, resolve);
        return typeof target === "number" ? target : Infinity;
    }

    // Every term is required, so what one term asks for outright is given to the
    // others. Of two outright asks for one item, the higher stays (Small Key 1/2,
    // never 1/1 beside it). Inside the rest, a leaf asking for no more than is given
    // is already met: an either/or offering it goes, and a way in that includes it
    // loses that part.
    function dropGiven(terms, resolve) {
        const outright = terms.filter(isLeaf);
        const kept = terms.filter((term, index) => !isLeaf(term) || !outright.some(other => other !== term &&
            itemOf(other) === itemOf(term) && (demand(other, resolve) > demand(term, resolve) ||
                (demand(other, resolve) === demand(term, resolve) && terms.indexOf(other) < index))));

        const given = new Map();
        kept.filter(isLeaf).forEach(leaf => given.set(itemOf(leaf), demand(leaf, resolve)));

        const result = [];
        kept.forEach(term => {
            if (isLeaf(term)) {
                result.push(term);
                return;
            }
            const rest = withoutGiven(term, given, resolve);
            if (rest !== null) result.push(...(rest === term ? [term] : bulletTerms(rest)));
        });
        return result.length === terms.length && result.every((term, index) => term === terms[index]) ? terms : result;
    }

    // The node with what is given taken out, or null when that already meets it.
    function withoutGiven(node, given, resolve) {
        if (isLeaf(node)) return given.has(itemOf(node)) && given.get(itemOf(node)) >= demand(node, resolve) ? null : node;

        const kept = [];
        for (const child of node.children) {
            const rest = withoutGiven(child, given, resolve);
            if (rest === null) {
                if (node.type === "or") return null;
                continue;
            }
            if (rest.type === node.type) kept.push(...rest.children);
            else kept.push(rest);
        }
        if (!kept.length) return null;
        if (kept.length === 1) return kept[0];
        const same = kept.length === node.children.length && kept.every((child, i) => child === node.children[i]);
        return same ? node : { type: node.type, children: kept };
    }

    // Whether every inventory meeting `a` meets `b`. A tree with too many ways in to
    // decide counts as not covered, so nothing is dropped on a guess.
    function covers(a, b) {
        try {
            return parser().implies(a, b);
        } catch (error) {
            if (error instanceof RangeError) return false;
            throw error;
        }
    }

    const allOf = terms => (terms.length === 1 ? terms[0] : { type: "and", children: terms });

    // A term the others already cover can never decide anything, so it goes: a
    // room's either/or that a check inside it narrows, which TrackerDebug.
    // impliedLayers() lists. One at a time, so of two terms that cover each other,
    // the first stays. A leaf the others cover is left to dropGiven() and
    // splitChoices(), which keep the item and drop the repeat instead.
    function dropImplied(terms) {
        let kept = terms;
        // From the last, so the term that goes is the later one.
        for (let index = kept.length - 1; index >= 0; index--) {
            const rest = kept.filter((other, at) => at !== index);
            if (!isLeaf(kept[index]) && rest.length && covers(allOf(rest), kept[index])) kept = rest;
        }
        return kept;
    }

    // Inside an either/or: a way in that asks for everything another does and more
    // goes (A, or A and B, is just A), and an item
    // every way in asks for comes out as its own term, since it is needed whichever
    // way is taken.
    function splitChoices(terms) {
        const result = terms.flatMap(term => (term.type === "or" ? splitChoice(term) : [term]));
        return result.length === terms.length && result.every((term, index) => term === terms[index]) ? terms : result;
    }

    function splitChoice(node) {
        const children = node.children.filter((child, index) => !node.children.some((other, at) => at !== index &&
            covers(child, other) && (!covers(other, child) || at < index)));
        if (children.length === 1) return bulletTerms(children[0]);

        const partsOf = child => (child.type === "and" ? child.children : [child]);
        const shared = partsOf(children[0]).filter(part => isLeaf(part) &&
            children.every(child => partsOf(child).some(other => isLeaf(other) && leafKey(other) === leafKey(part))));
        if (!shared.length) return children.length === node.children.length ? [node] : [{ type: "or", children }];

        const keys = new Set(shared.map(leafKey));
        const remainders = children.map(child => partsOf(child).filter(part => !isLeaf(part) || !keys.has(leafKey(part))));
        // A way in that is only the shared items is met by them alone.
        if (remainders.some(parts => !parts.length)) return shared;
        return [...shared, { type: "or", children: remainders.map(allOf) }];
    }

    // The same leaf written the same way, for spotting a shared item.
    function leafKey(node) {
        if (node.type === "token") return `token:${node.id}`;
        const target = node.right.type === "number" ? node.right.value : `setting:${node.right.id}`;
        return `count:${node.left.id}>=${target}`;
    }

    // ---------- Routes ----------

    // Combining a few written alternatives can multiply them into many routes, and
    // past six that list is no easier to read than the one line. A list no longer
    // than what was written never multiplied, so it is always allowed.
    const ROUTE_LIMIT = 6;

    // A plain either/or this long is easier to scan one item per line.
    const LIST_FROM = 4;

    const isLeaf = node => node.type === "token" || node.type === "compare";
    const isPlainChoice = node => node.type === "or" && node.children.every(isLeaf);

    // Every way to meet an either/or. At the top each single item is a way by
    // itself; deeper down, single items stay together as one choice, so an
    // either/or inside a route doesn't multiply into a route per item.
    function routesOf(node, top) {
        if (isLeaf(node)) return [[node]];

        if (node.type === "or") {
            const routes = [];
            let choice = null;
            node.children.forEach(child => {
                if (!isLeaf(child)) {
                    routes.push(...routesOf(child, false));
                } else if (top) {
                    routes.push([child]);
                } else {
                    if (!choice) {
                        choice = { type: "or", children: [] };
                        routes.push([choice]);
                    }
                    choice.children.push(child);
                }
            });
            return routes.map(route => route.map(part =>
                (part.type === "or" && part.children.length === 1 ? part.children[0] : part)));
        }

        return node.children.reduce((sofar, child) => {
            const tails = routesOf(child, false);
            const next = [];
            sofar.forEach(head => tails.forEach(tail => next.push(head.concat(tail))));
            return next;
        }, [[]]);
    }

    function markSpan(kind) {
        const mark = document.createElement("span");
        mark.className = `tooltip-mark tooltip-mark-${kind}`;
        mark.textContent = kind === "met" ? "✓" : "✗";
        return mark;
    }

    // One chip: the mark first, then what it stands for. A tick or a cross on every
    // chip, so whether a requirement is met does not depend on telling red from
    // green.
    function chip(kind, content) {
        const box = document.createElement("span");
        box.className = `tooltip-chip tooltip-chip-${kind}`;
        box.setAttribute("role", "listitem");
        box.appendChild(markSpan(kind));
        const text = document.createElement("span");
        text.className = "tooltip-chip-text";
        content.forEach(node => text.appendChild(node));
        box.appendChild(text);
        return box;
    }

    // Each route is a chip of its own. Once another route meets the requirement,
    // the routes still short are gray rather than red, since nothing on them is
    // needed.
    function renderRoute(route, required, nameFor, resolve) {
        const parts = route.map(part => parser().annotate(part, resolve, required));
        const content = [];

        parts.forEach((part, index) => {
            if (index > 0) {
                const sep = document.createElement("span");
                sep.className = "tooltip-joiner";
                sep.textContent = " and ";
                content.push(sep);
            }
            const choice = part.node.type === "or";
            if (choice) content.push(document.createTextNode("("));
            content.push(renderInline(part, nameFor, resolve, null));
            if (choice) content.push(document.createTextNode(")"));
        });

        const met = parts.every(part => part.satisfied);
        return chip(met ? "met" : required ? "unmet" : "spare", content);
    }

    // data-missing is how many of the requirements are still short, for the heading
    // to say (locationTracker.js).
    function render(annotated, nameFor, resolve) {
        const list = document.createElement("div");
        list.className = "tooltip-chips";
        list.setAttribute("role", "list");

        const terms = simplify(annotated.node, resolve).map(term => parser().annotate(term, resolve, true));
        list.dataset.missing = String(terms.filter(term => !term.satisfied).length);

        terms.forEach(term => {
            const node = term.node;
            const routes = node.type === "or" && (!isPlainChoice(node) || node.children.length >= LIST_FROM)
                ? routesOf(node, true)
                : null;

            // The terms of a top-level AND, so each one is either met or blocking.
            if (routes && routes.length <= Math.max(ROUTE_LIMIT, node.children.length)) {
                const group = document.createElement("span");
                group.className = `tooltip-group tooltip-group-${term.satisfied ? "met" : "unmet"}`;
                group.setAttribute("role", "listitem");

                const label = document.createElement("span");
                label.className = "tooltip-route-label";
                label.textContent = "Any one of";
                group.appendChild(label);

                routes.forEach(route => group.appendChild(renderRoute(route, !term.satisfied, nameFor, resolve)));
                list.appendChild(group);
            } else {
                list.appendChild(chip(term.satisfied ? "met" : "unmet", [renderInline(term, nameFor, resolve, null)]));
            }
        });

        return list;
    }

    const api = { render, simplify };
    root.RequirementsView = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
