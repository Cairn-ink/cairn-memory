import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { PRIVACY_MATCH_CASES, runCase } from "@cairn-ink/conformance";
import { CoreError } from "@cairn-ink/core";

const adapterURL = new URL("../src/index.mjs", import.meta.url);
const hashSessionKey = (client, sessionId) =>
  createHash("sha256").update(JSON.stringify([client, sessionId])).digest("hex");

/** Load each variant through the adapter's normal entry point with one mutated dependency. */
async function mutantFactory(name, replacements, sessionRefs = "plain", moduleName = "fact-match") {
  const entry = new URL(adapterURL);
  const specifier = `./${moduleName}.mjs`;
  const module = new URL(specifier, adapterURL);
  let source = readFileSync(module, "utf8");
  const variant = JSON.stringify([name, sessionRefs]);
  entry.searchParams.set("variant", variant);
  module.searchParams.set("variant", variant);

  for (const [before, after] of replacements) {
    assert.equal(source.split(before).length, 2, `Expected a single mutation site for ${name}`);
    source = source.replace(before, () => after);
  }
  const hooks = registerHooks({
    resolve(request, context, nextResolve) {
      if (context.parentURL === entry.href && request === specifier) {
        return nextResolve(module.href, context);
      }
      return nextResolve(request, context);
    },
    load(url, context, nextLoad) {
      if (url === module.href) return { format: "module", source, shortCircuit: true };
      return nextLoad(url, context);
    },
  });
  let createVariant;
  try {
    ({ createMemoryAdapter: createVariant } = await import(entry.href));
  } finally {
    hooks.deregister();
  }
  return {
    name,
    async open({ capabilities }) {
      const adapter = createVariant({ capabilities, sessionRefs, hashSessionKey });
      return {
        adapter, sessionRefs, harness: { ...adapter.harness, hashSessionKey },
        nativeErrorMap: adapter.nativeErrorMap, busyNativeCodes: [], embeddingDimensions: null,
        async close() {},
      };
    },
  };
}

const client = "test-client";
const sessionId = "test-session";
const source = { kind: "capture", client, sessionId };
const receipt = { client, sessionId, messageId: "test-message", role: "user", occurredAtMs: 5 };
const saved = { kind: "mcp", client: null, sessionId: null };
const textHash = "sha256:" + "a".repeat(64);
const digest = { alg: "sha256", value: textHash.slice(7), pipeline: "core", redactionVersion: 1, keyId: null };

function seed(ctx, fact) {
  return ctx.harness.seedFact(ctx.owner, { owner: ctx.owner, actionId: "test-fact", origin: "forget", ...fact });
}

function seedText(ctx, mode = "exact") {
  const text = { digests: [digest] };
  if (mode === "full") Object.assign(text, { shingles: ["aa"], keyId: "test-key", embedding: ctx.vec(0) });
  return seed(ctx, { kind: "text", mode, text });
}

function seedSession(ctx) {
  return seed(ctx, { kind: "session", session: { client, sessionId } });
}

function seedWindow(ctx) {
  return seed(ctx, { kind: "window", client, window: { startMs: 10, endMs: 20 }, unknownTime: true });
}

async function insert(ctx) {
  const { uow, memories } = ctx.adapter;
  const content = { kind: "fact", origin: "inferred", text: "test memory", textHash, source, confidence: 1, embedding: null };
  const { id } = await uow.run(ctx.owner, {}, (tx) => memories.insert(tx, ctx.scope(null), content, [receipt], 1));
  return id;
}

async function visible(ctx, id) {
  const { uow, fence } = ctx.adapter;
  const scope = { owner: ctx.owner, namespaces: [null] };
  const refs = [{ type: "memory", id, namespace: null }];
  return (await uow.run(ctx.owner, { readOnly: true }, (tx) => fence.assertVisible(tx, scope, refs))).length > 0;
}

// Each naive case exercises the affected port without the condition that exposes the mutant.
async function exactHidden(ctx, mode) {
  const id = await insert(ctx);
  await seedText(ctx, mode);
  assert.equal(await visible(ctx, id), false);
}

async function outsideWindowVisible(ctx) {
  const id = await insert(ctx);
  await seedWindow(ctx);
  assert.equal(await visible(ctx, id), true);
}

async function matchingReceiptAndSourceHidden(ctx) {
  const id = await insert(ctx);
  await seedSession(ctx);
  assert.equal(await visible(ctx, id), false);
}

async function primaryDigestBlocked(ctx) {
  await seedText(ctx, "full");
  const { uow, memories } = ctx.adapter;
  await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
    for (const mode of ["hash", "full"]) {
      const result = await memories.readWritePolicy(tx, ctx.scope(null), [{ textHash }], saved, mode);
      assert.deepEqual(result.blockedPositions, [0]);
    }
  });
}

async function completeWriteSessionBlocked(ctx) {
  await seedSession(ctx);
  const { uow, memories } = ctx.adapter;
  const result = await uow.run(ctx.owner, { readOnly: true }, (tx) =>
    memories.readWritePolicy(tx, ctx.scope(null), [{ textHash }], source, "full"));
  assert.equal(result.blockedSession, true);
}

async function knownTimeBlocked(ctx) {
  await seedWindow(ctx);
  const { uow, suppressions } = ctx.adapter;
  const result = await uow.run(ctx.owner, { readOnly: true }, (tx) =>
    suppressions.snapshot(tx, ctx.scope(null), { client, sessionId, occurredAtMs: [5, 15] }));
  assert.deepEqual(result.blockedMessages, [1]);
}

async function comparableFactReturned(ctx) {
  const memoryId = await insert(ctx);
  await seedText(ctx);
  const { uow, suppressions } = ctx.adapter;
  const facts = await uow.run(ctx.owner, { readOnly: true }, (tx) =>
    suppressions.factsFor(tx, ctx.scope(null), { memoryId }));
  assert.deepEqual(facts.map(({ fact }) => fact.kind), ["text"]);
}

const directRowMatch = "factHidesRow(stored, candidate, policy) !== false";
const receiptRowMatch = "factHidesRow(stored, { ...candidate, source: { client, sessionId, occurredAtMs } }, policy) !== false";
const matchReceipts = `return receipts.some(({ client, sessionId, occurredAtMs }) => client &&
              ${receiptRowMatch});`;
const scopedTextFact = `[...state.facts.values()].some(({ fact }) =>
            fact.kind === "text" && fact.owner === scope.owner && (fact.namespace ?? null) === scope.namespace)`;
const mutants = [
  ["ineligible row visible", "K-HIDE-2", exactHidden, /Incomparable digest must hide the row/, [
    [directRowMatch, directRowMatch.replace("!== false", "=== true")],
    [receiptRowMatch, receiptRowMatch.replace("!== false", "=== true")],
  ]],
  ["window applied to memory", "K-HIDE-4", outsideWindowVisible, /Window fact must keep a memory/, [
    ['case "session":', 'case "window":\n          case "session":'],
  ]],
  ["session applied without receipts", "K-HIDE-3", matchingReceiptAndSourceHidden, /Receipt-less MCP row must stay visible/, [
    [matchReceipts, `if (receipts.length === 0) return ${directRowMatch};\n            ${matchReceipts}`],
  ]],
  ["session checked against row source", "K-HIDE-3", matchingReceiptAndSourceHidden, /Matching receipt must hide the row/, [
    [matchReceipts, `return row.source.client != null &&
              factHidesRow(stored, { ...candidate, source: row.source }, policy) !== false;`],
  ]],
  ["row shingle policy omitted", "K-HIDE-2", (ctx) => exactHidden(ctx, "full"), /Stored shingles alone must leave an unrelated row visible/, [
    ["rowShingles: false, ", ""],
  ]],
  ["write modes swapped", "K-WRITE-1", primaryDigestBlocked, /Hash mode must admit a distance-only match/, [
    ['mode === "hash" ? "explicitSave" : "capture"', 'mode === "hash" ? "capture" : "explicitSave"'],
  ]],
  ["session-less save blocked", "K-WRITE-2", completeWriteSessionBlocked, /Explicit save without a session must be admitted/, [
    ["client != null && sessionId != null && sessions.some", "client != null && sessions.some"],
  ]],
  ["snapshot ignores unknown time", "K-SNAP-F1", knownTimeBlocked, /All-client window must block inside and unknown times/, [
    ["of occurredAtMs.entries()) {", "of occurredAtMs.entries()) {\n            if (time === null) continue;"],
  ]],
  ["factsFor drops ineligible facts", "K-FACTSFOR-1", comparableFactReturned, /factsFor must include ineligible facts/, [
    ["function rowMatcher({ row, receipts })", "function rowMatcher({ row, receipts }, hides = (result) => result !== false)"],
    [directRowMatch, `hides(${directRowMatch.replace(" !== false", "")})`],
    [receiptRowMatch, `hides(${receiptRowMatch.replace(" !== false", "")})`],
    ["entry ? scoped.filter(rowMatcher(entry))", "entry ? scoped.filter(rowMatcher(entry, (result) => result === true))"],
  ]],
  ["legacy digest omitted", "K-WRITE-1", primaryDigestBlocked, /Exact digest must block the primary and legacy query positions/, [
    ["if (legacyHash !== undefined && legacyHash !== textHash)", "if (false)"],
  ]],
  ["session refusal moved to positions", "K-WRITE-2", completeWriteSessionBlocked, /Explicit save without a session must have no blocked positions/, [
    ["          blockedPositions,", `          blockedPositions: mode === "hash" && source.sessionId === null &&
            policy.blocksSession(source.client, "") ? [0] : blockedPositions,`],
  ], "memory-store"],
  ["duplicate groups cleared under a text fact", "K-WRITE-1", primaryDigestBlocked, /Visible exact duplicate must be retained/, [
    ["matches: duplicates,", `matches: ${scopedTextFact} ? batch.map(() => []) : duplicates,`],
    ["return matches(rows, batch, nearDistance);",
      `return ${scopedTextFact} ? batch.map(() => []) : matches(rows, batch, nearDistance);`],
  ], "memory-store"],
  ["receipt checks bypassed in candidate and recent reads", "K-HIDE-3", matchingReceiptAndSourceHidden, /Lexical must return only receipt-visible rows/, [
    ["!policy.hides(entry)) rows.push(entry.row);", "!policy.hides({ ...entry, receipts: [] })) rows.push(entry.row);"],
  ], "retrieval"],
];

for (const [label, id, run, failure, replacements, moduleName] of mutants) {
  test(`${id} detects ${label} after the naive case passes`, async () => {
    const testCase = PRIVACY_MATCH_CASES.find((candidate) => candidate.id === id);
    assert.ok(testCase);
    const factory = await mutantFactory(label, replacements, "plain", moduleName);
    assert.equal(await runCase(factory, { id, title: "naive", needs: [], run }), null);
    await assert.rejects(runCase(factory, testCase), failure);
  });
}

for (const [sessionRefs, vectors] of [["hashed", true], ["plain", false]]) {
  test(`privacy matching accepts required embeddings under the ${sessionRefs} profile`, async (t) => {
    const factory = {
      name: "memory requiring embeddings",
      async open({ capabilities }) {
        const adapter = createMemoryAdapter({
          capabilities: { ...capabilities, vectorSuppression: vectors, semanticRetrieval: vectors },
          sessionRefs, hashSessionKey,
        });
        const { memories } = adapter;
        return {
          adapter: {
            ...adapter,
            memories: {
              ...memories,
              async insert(tx, scope, row, receipts, nowMs) {
                if (row.embedding === null) throw new CoreError("invalid_input");
                return memories.insert(tx, scope, row, receipts, nowMs);
              },
            },
          },
          sessionRefs, harness: { ...adapter.harness, hashSessionKey },
          nativeErrorMap: adapter.nativeErrorMap, busyNativeCodes: [], embeddingDimensions: 6,
          async close() {},
        };
      },
    };
    for (const testCase of PRIVACY_MATCH_CASES) {
      await t.test(testCase.id, async (t) => {
        const reason = await runCase(factory, testCase);
        const expected = vectors ? null :
          ({
            "K-HIDE-2": "needs vectorSuppression",
            "K-HIDE-3": "needs semanticRetrieval",
            "K-WRITE-1": "needs vectorSuppression",
            "K-HASH-1": "needs hashed session refs",
          })[testCase.id] ?? null;
        assert.equal(reason, expected);
        if (reason !== null) t.skip(reason);
      });
    }
  });
}

for (const profile of ["plain", "hashed"]) {
  test(`privacy matching accepts reverse fact evaluation under the ${profile} profile`, async () => {
    const factory = await mutantFactory("reverse fact order", [
      ["(fact.namespace ?? null) === scope.namespace);", "(fact.namespace ?? null) === scope.namespace).reverse();"],
    ], profile);
    for (const testCase of PRIVACY_MATCH_CASES) {
      const skip = testCase.id === "K-HASH-1" && profile === "plain" ? "needs hashed session refs" : null;
      assert.equal(await runCase(factory, testCase), skip, testCase.id);
    }
  });
}
