// Turns a logic string into the "Items Required" chips the tooltip shows: one per
// thing you need, each marked met or missing, with an "Any one of" drawn as a
// dashed group of its ways in.
//
// Reading the tree rather than the string is the whole point: it is what lets a
// token be drawn as an alternative you do not need (gray) instead of one you are
// missing (red). See logicParser.js for the three states.
(function () {
    "use strict";

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

    // One bullet per thing you need. Nested & is flattened because the region's
    // entry logic and the check's own are joined with one, and "A and B" on a
    // single bullet reads as one requirement rather than two.
    function bulletTerms(annotated) {
        if (annotated.node.type !== "and") return [annotated];
        return annotated.children.flatMap(bulletTerms);
    }

    // Counts of one item among the bullets merge into the highest, since that is
    // the one the check needs: a region's entry and a check inside it counting the
    // same item against different settings would otherwise be two lines. Inside an
    // | the counts are alternatives, so only bullets merge. A target that can't be read wins, because its comparison is unmet.
    function mergeCounts(terms, resolve) {
        const kept = [];
        const byItem = new Map();

        terms.forEach(term => {
            if (term.node.type !== "compare") {
                kept.push(term);
                return;
            }
            const item = term.node.left.id;
            const current = byItem.get(item);
            if (!current) {
                byItem.set(item, term);
                kept.push(term);
                return;
            }
            const currentTarget = targetOf(current.node, resolve);
            const target = targetOf(term.node, resolve);
            if (typeof currentTarget === "number" && (typeof target !== "number" || target > currentTarget)) {
                kept[kept.indexOf(current)] = term;
                byItem.set(item, term);
            }
        });

        return kept;
    }

    // ---------- What another bullet already asks for ----------

    // A region's entry often offers several ways in, and a check may need one of
    // their items anyway. Every bullet is required, so an item one bullet asks for
    // outright can be taken as given in the others: an either/or offering it is
    // already met and goes, and a way in that includes it loses that part. Both
    // keep the meaning exactly, so no mark can change.
    function leafKey(node) {
        if (node.type === "token") return `token:${node.id}`;
        if (node.type === "compare") {
            const target = node.right.type === "number" ? node.right.value : `setting:${node.right.id}`;
            return `count:${node.left.id}>=${target}`;
        }
        return null;
    }

    // The node with the given items taken out, or null when they already meet it.
    // Builds new nodes and never touches the parsed ones, which LogicParser caches.
    function withoutGiven(node, given) {
        if (leafKey(node)) return given.has(leafKey(node)) ? null : node;

        const kept = [];
        for (const child of node.children) {
            const rest = withoutGiven(child, given);
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

    function withoutRepeats(terms, resolve) {
        let current = terms;
        // Another pass whenever one shrinks a bullet to a single item, which is then
        // given to the rest in turn.
        for (let pass = 0; pass < terms.length; pass++) {
            const given = new Set(current.map(term => leafKey(term.node)).filter(Boolean));
            let changed = false;
            const next = [];
            current.forEach(term => {
                if (leafKey(term.node)) {
                    next.push(term);
                    return;
                }
                const rest = withoutGiven(term.node, given);
                if (rest === term.node) {
                    next.push(term);
                    return;
                }
                changed = true;
                if (rest !== null) next.push(window.LogicParser.annotate(rest, resolve, true));
            });
            current = next;
            if (!changed) break;
        }
        return current;
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
        const parts = route.map(part => window.LogicParser.annotate(part, resolve, required));
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

        const terms = withoutRepeats(mergeCounts(bulletTerms(annotated), resolve), resolve);
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

    window.RequirementsView = { render };
})();
