// Logic strings, parsed into a tree instead of evaluated as text.
//
// The tree is what lets the requirements tooltip say *which* token is blocking
// you: a flattened string can only answer true or false. canAccess() walks the
// same tree, so the tooltip and the tracker can never disagree about a check.
//
// The grammar is only what an additive tracker needs: `&`, `|`, `()`, and one
// threshold test, `item >= count`. `|` binds loosest, then `&`, then the
// comparison. See ARCHITECTURE.md, "Logic strings".
(function () {
    "use strict";

    // Every token keeps its character offset, so an error can point into the
    // string as it is written in the data.
    function tokenize(source) {
        const tokens = [];
        let i = 0;

        while (i < source.length) {
            const rest = source.slice(i);

            if (/\s/.test(source[i])) { i++; continue; }

            if (rest.startsWith(">=")) {
                tokens.push({ type: "compare", pos: i });
                i += 2;
                continue;
            }

            if ("&|()".includes(source[i])) {
                tokens.push({ type: source[i], pos: i });
                i++;
                continue;
            }

            const word = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
            if (word) {
                tokens.push({ type: "token", value: word[0], pos: i });
                i += word[0].length;
                continue;
            }

            const number = rest.match(/^\d+/);
            if (number) {
                tokens.push({ type: "number", value: Number(number[0]), pos: i });
                i += number[0].length;
                continue;
            }

            throw new Error(`unexpected character "${source[i]}" at position ${i}`);
        }

        return tokens;
    }

    function parseTokens(tokens) {
        let position = 0;

        const peek = () => tokens[position];
        const where = () => (peek() ? `at position ${peek().pos}` : "at the end");
        const describe = token => (token.type === "compare" ? ">=" : token.type);

        function parseOr() {
            const children = [parseAnd()];
            while (peek() && peek().type === "|") {
                position++;
                children.push(parseAnd());
            }
            return children.length === 1 ? children[0] : { type: "or", children };
        }

        function parseAnd() {
            const children = [parseComparison()];
            while (peek() && peek().type === "&") {
                position++;
                children.push(parseComparison());
            }
            return children.length === 1 ? children[0] : { type: "and", children };
        }

        // Only `item >= count`. Counting up to a threshold is the one numeric
        // question an additive tracker can ask, so a comparison between groups,
        // one written the other way round, or a number standing on its own is a
        // data bug rather than an exotic rule — it fails here instead of
        // rendering as nonsense.
        function parseComparison() {
            const left = parsePrimary();
            if (!peek() || peek().type !== "compare") return left;

            if (left.type !== "token") {
                throw new Error(`comparison left side must be a token, got ${left.type} ${where()}`);
            }
            position++;

            const count = peek();
            if (!count || count.type !== "number") {
                throw new Error(`expected a number after >= ${where()}`);
            }
            position++;
            return { type: "compare", left, right: { type: "number", value: count.value } };
        }

        function parsePrimary() {
            const next = peek();
            if (!next) throw new Error("expression ended early");

            if (next.type === "(") {
                position++;
                const inner = parseOr();
                if (!peek() || peek().type !== ")") {
                    throw new Error(`expected ) ${where()}`);
                }
                position++;
                return inner;
            }
            if (next.type === "token") {
                position++;
                return { type: "token", id: next.value };
            }
            if (next.type === "number") {
                throw new Error(`a number only belongs after >= ${where()}`);
            }

            throw new Error(`unexpected ${describe(next)} ${where()}`);
        }

        const tree = parseOr();
        if (position < tokens.length) {
            throw new Error(`unexpected ${describe(peek())} ${where()}`);
        }
        return tree;
    }

    // Every sweep re-evaluates every check, so the same handful of strings would
    // otherwise be re-parsed on each click.
    const cache = new Map();

    // A bad string would otherwise fail and log on every sweep. It is named once,
    // then rethrown quietly — the silence does not mean the data was fixed.
    const failures = new Map();

    function parseOne(logic) {
        if (logic === undefined || logic === null) return null;
        if (typeof logic === "string" && logic.trim() === "") return null;
        if (cache.has(logic)) return cache.get(logic);
        if (failures.has(logic)) throw failures.get(logic);

        try {
            if (typeof logic !== "string") throw new Error(`expected text, got ${typeof logic}`);
            const tree = parseTokens(tokenize(logic));
            cache.set(logic, tree);
            return tree;
        } catch (error) {
            failures.set(logic, error);
            console.error(
                `LogicParser: "${logic}" is not valid logic (${error.message}). ` +
                "Suppressing this error message."
            );
            throw error;
        }
    }

    // A list is its parts joined by &. Each part is parsed and cached on its own,
    // so a bad one is named once under the text actually in the data, rather than
    // once per combination under a joined string no file contains.
    function parse(logic) {
        if (!Array.isArray(logic)) return parseOne(logic);

        const trees = logic.map(parseOne).filter(Boolean);
        if (!trees.length) return null;
        return trees.length === 1 ? trees[0] : { type: "and", children: trees };
    }

    // Comparison operands need the value itself, not its truthiness — `hearts>=5`
    // has to see 5, not true.
    function valueOf(node, resolve) {
        return node.type === "token" ? resolve(node.id) : node.value;
    }

    function isSatisfied(node, resolve) {
        switch (node.type) {
            case "or": return node.children.some(child => isSatisfied(child, resolve));
            case "and": return node.children.every(child => isSatisfied(child, resolve));
            case "compare":
                return valueOf(node.left, resolve) >= valueOf(node.right, resolve);
            case "token": return Boolean(resolve(node.id));
        }
        return false;
    }

    // Three states, mirroring how the requirements tooltip reads them: you have
    // it, you need it, or it is an alternative a sibling already covered.
    //
    // `required` is the part that cannot be derived from the node alone — an
    // unsatisfied token inside an OR that some sibling already satisfies is not
    // blocking anything, and saying otherwise paints half the tooltip red.
    function annotate(node, resolve, required) {
        if (required === undefined) required = true;

        const satisfied = isSatisfied(node, resolve);
        const annotated = {
            node,
            satisfied,
            state: satisfied ? "satisfied" : (required ? "blocking" : "optional")
        };

        if (node.type === "and") {
            annotated.children = node.children.map(child => annotate(child, resolve, required));
        } else if (node.type === "or") {
            // A satisfied OR still has to render its unmet alternatives, and they
            // are optional rather than blocking.
            const childRequired = satisfied ? false : required;
            annotated.children = node.children.map(child => annotate(child, resolve, childRequired));
        }

        return annotated;
    }

    window.LogicParser = {
        parse,
        isSatisfied,
        annotate,

        // Empty logic means no requirement, which is how the region files spell
        // "always reachable". Takes a string or a list of strings, like parse().
        evaluate(logic, resolve) {
            const tree = parse(logic);
            if (!tree) return true;
            return isSatisfied(tree, resolve);
        }
    };
})();
