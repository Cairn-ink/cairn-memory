import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "../../../tools/testing/vendor/acorn/acorn.mjs";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const cardReads = new Set(["get", "list"]);
const edgeReads = new Set(["sourceEvidence", "degree", "incoming", "incident"]);
const allowlist = {
  "topics/cards.mjs: documentCards.get(tx, scope, cardId)": "Classifier snapshots and freshness rechecks fence fetched cards; failure receipts use them internally.",
  "topics/cards.mjs: placement.pendingCards(tx, scope, { limit: 5 })": "Pending guards feed the fetched card batch that is fenced before classification.",
  "rationale/store-plan.mjs: store.sourceEvidence(tx, scope, refs)": "Receipt admission enforces Raw and excerpt visibility before evidence is used by rationale.",
  "rationale/store-plan.mjs: store.degree(tx, scope, id)": "The incident count is internal to the insertion limit check.",
  "service/relations-judge.mjs: conflicts.degree(tx, scope, id)": "The degree count is internal to the conflict insertion limit check; no edge content is delivered.",
  "service/relations-judge.mjs: conflicts.degree(tx, scope, candidate.id)": "The degree count is internal to the conflict insertion limit check; no edge content is delivered.",
  "rationale/decision-context.mjs: edges.incoming(tx, selection, memoryId, 'supports-decision', page)":
    "fenced via visibleEdges; decisionContext fences the root before reading or caching it",
  "rationale/decision-context.mjs: edges.incoming(tx, selection, memoryId, 'challenges-premise', page)":
    "fenced via visibleEdges; decisionContext fences the root before reading or caching it",
  "rationale/decision-context.mjs: edges.incoming(tx, selection, id, 'challenges-premise', page)":
    "fenced via visibleEdges; decisionContext fences the root before reading or caching it",
  "service/context-read-assembly-evidence.mjs: documentCards.get(tx, ref.scope, ref.id)":
    "Read only after contextCardVerdict (fresh visibilityInputs + documentCardVisible in the same Tx); the card's id and scope are rechecked, and each amendment is gated by documentCardAmendmentVisible on its own Raw source before delivery.",
};

function walk(node, visit, parent) {
  visit(node, parent);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (child?.type) walk(child, visit, node);
    } else if (value?.type) walk(value, visit, node);
  }
}

function key(node, computed) {
  if (!computed && node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && !node.expressions.length) return node.quasis[0].value.cooked;
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = key(node.left, true), right = key(node.right, true);
    if (left !== undefined && right !== undefined) return left + right;
  }
}

const unchain = (node) => node?.type === "ChainExpression" ? node.expression : node;
const binding = (node) => node?.type === "AssignmentPattern" ? node.left : node;

function scan(source, path) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
  const cardStores = new Set(["documentCards"]);
  const isCardStore = (expression) => {
    const node = unchain(expression);
    return node?.type === "Identifier" && cardStores.has(node.name) ||
      node?.type === "MemberExpression" && key(node.property, node.computed) === "documentCards";
  };

  // Follow simple aliases and destructuring without relying on the current receiver spelling.
  let size;
  do {
    size = cardStores.size;
    walk(ast, (node, parent) => {
      const target = binding(node.value ?? node.id ?? node.left);
      if (target?.type !== "Identifier") return;
      if (parent?.type === "ObjectPattern" && node.type === "Property" && key(node.key, node.computed) === "documentCards" ||
          node.type === "VariableDeclarator" && isCardStore(node.init) ||
          node.type === "AssignmentExpression" && node.operator === "=" && isCardStore(node.right)) {
        cardStores.add(target.name);
      }
    });
  } while (size !== cardStores.size);

  const sites = [];
  const record = (node) => sites.push({
    id: `${path}: ${source.slice(node.start, node.end).replace(/\s+/gu, " ")}`,
    line: node.loc.start.line,
  });
  walk(ast, (node, parent) => {
    if (node.type === "Property" && parent?.type === "ObjectPattern") {
      const name = key(node.key, node.computed);
      if (name === "pendingCards" || edgeReads.has(name)) record(node);
    }
    if (node.type === "VariableDeclarator" && node.id.type === "ObjectPattern" && isCardStore(node.init) ||
        node.type === "AssignmentExpression" && node.left.type === "ObjectPattern" && isCardStore(node.right)) {
      for (const entry of (node.id ?? node.left).properties) {
        if (entry.type === "RestElement") { record(entry); continue; }
        const name = key(entry.key, entry.computed);
        if (cardReads.has(name) || name === undefined) record(entry);
      }
    }
    if (node.type !== "MemberExpression") return;
    const name = key(node.property, node.computed);
    const receiver = unchain(node.object);
    if (path === "privacy/fact-match.mjs" && receiver.name === "snapshot" && name === "incoming") return;
    if (path === "rationale/store-plan.mjs" && receiver.name === "RATIONALE_LIMITS" && name === "degree") return;
    if (name === "pendingCards" || edgeReads.has(name) ||
        isCardStore(receiver) && (cardReads.has(name) || name === undefined)) {
      // Capture method references too, so extracting a read before calling it still requires review.
      record(parent?.type === "CallExpression" && parent.callee === node ? parent : node);
    }
  });
  return sites;
}

function assertInventory(sites, inventory) {
  const remaining = new Set(Object.keys(inventory));
  const unlisted = sites.filter(({ id }) => !remaining.delete(id));
  assert.deepEqual({ unlisted, missing: [...remaining] }, { unlisted: [], missing: [] }, "Delivery fence call sites changed");
}

test("core delivery reads match the reviewed fence caller inventory", async () => {
  const paths = (await readdir(sourceRoot, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.[cm]?js$/u.test(entry.name))
    .map(({ parentPath, name }) => join(parentPath, name)).sort();
  const sites = await Promise.all(paths.map(async (path) => scan(await readFile(path, "utf8"),
    relative(sourceRoot, path).split(sep).join("/"))));
  assertInventory(sites.flat(), allowlist);
});

test("scanner finds delivery reads through optional, computed and aliased access", () => {
  const source = [
    'const string = "documentCards.get(tx, scope, id)";',
    "// edges.incoming(tx, scope, id)",
    "const { documentCards: cards } = storage;",
    "const alias = cards;",
    "const { list: listCards } = alias;",
    "alias?.['get']?.(tx, scope, id);",
    "storage.documentCards[`list`](tx, scope);",
    "const readEdges = edgePort.incident;",
    "edgePort['in' + 'coming'](tx, scope, id);",
    "placement.pendingCards(tx, scope, page);",
    "unrelatedMap.get(id);",
  ].join("\n");
  assert.deepEqual(scan(source, "fixture.mjs"), [
    { id: "fixture.mjs: list: listCards", line: 5 },
    { id: "fixture.mjs: alias?.['get']?.(tx, scope, id)", line: 6 },
    { id: "fixture.mjs: storage.documentCards[`list`](tx, scope)", line: 7 },
    { id: "fixture.mjs: edgePort.incident", line: 8 },
    { id: "fixture.mjs: edgePort['in' + 'coming'](tx, scope, id)", line: 9 },
    { id: "fixture.mjs: placement.pendingCards(tx, scope, page)", line: 10 },
  ]);
});

test("inventory rejects new, duplicate and missing call sites", () => {
  const source = "documentCards.get(tx, scope, id);";
  const id = "fixture.mjs: documentCards.get(tx, scope, id)";
  const inventory = { [id]: "Fixture justification." };
  const check = (fixture) => assertInventory(scan(fixture, "fixture.mjs"), inventory);
  assert.doesNotThrow(() => check(source));
  assert.throws(() => check(source + " edges.incident(tx, scope, id);"), {
    actual: { unlisted: [{ id: "fixture.mjs: edges.incident(tx, scope, id)", line: 1 }], missing: [] },
  });
  assert.throws(() => check(source + source), { actual: { unlisted: [{ id, line: 1 }], missing: [] } });
  assert.throws(() => check(""), { actual: { unlisted: [], missing: [id] } });
});
