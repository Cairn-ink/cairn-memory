import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { KEYED_DIGEST_CASES, runCase } from "@cairn-ink/conformance";
import { allDigests, coreDigest } from "@cairn-ink/core";

const adapterURL = new URL("../src/index.mjs", import.meta.url);

async function variantFactory(name, mutations, verifyStoredRows = () => {}) {
  const entry = new URL(adapterURL);
  entry.searchParams.set("variant", name);
  const modules = new Map();
  const sources = new Map();
  for (const [module, replacements] of Object.entries(mutations)) {
    const specifier = `./${module}.mjs`;
    const url = new URL(specifier, adapterURL);
    let source = readFileSync(url, "utf8");
    url.searchParams.set("variant", name);
    for (const [before, after, count = 1] of replacements) {
      assert.equal(source.split(before).length - 1, count, `Unexpected mutation sites in ${module}`);
      source = source.replaceAll(before, () => after);
    }
    modules.set(specifier, url.href);
    sources.set(url.href, source);
  }

  const hooks = registerHooks({
    resolve(request, context, nextResolve) {
      if (context.parentURL === entry.href && modules.has(request)) {
        return nextResolve(modules.get(request), context);
      }
      return nextResolve(request, context);
    },
    load(url, context, nextLoad) {
      if (sources.has(url)) return { format: "module", source: sources.get(url), shortCircuit: true };
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
      const adapter = createVariant({ capabilities });
      return {
        adapter, sessionRefs: "plain", harness: adapter.harness,
        nativeErrorMap: adapter.nativeErrorMap, busyNativeCodes: [], embeddingDimensions: null,
        async close() { await verifyStoredRows(adapter.harness); },
      };
    },
  };
}

const matching = "Garden basil";
const unrelated = "Garden thyme";
const source = { kind: "mcp", client: null, sessionId: null };

async function query(ctx, text, key) {
  return { textHash: await ctx.hash(text), digests: await allDigests(text, key) };
}

async function seed(ctx, key) {
  await ctx.harness.seedFact(ctx.owner, {
    owner: ctx.owner, actionId: "test-forget", origin: "forget", kind: "text", mode: "exact",
    text: { digests: [await coreDigest(matching, key)] },
  });
}

async function insertMatchingRow(ctx, key) {
  const row = {
    ...await query(ctx, matching, key), kind: "fact", origin: "explicit", text: matching,
    source, confidence: 1, embedding: null,
  };
  const { uow, memories } = ctx.adapter;
  await uow.run(ctx.owner, {}, (tx) => memories.insert(tx, ctx.scope(null), row, [], 1));
}

async function matchingRowHidden(ctx) {
  const { uow, memories, keys } = ctx.adapter;
  const key = await keys.userKey(ctx.owner);
  await seed(ctx, key);
  await insertMatchingRow(ctx, key);
  const page = await uow.run(ctx.owner, { readOnly: true }, (tx) =>
    memories.exportPage(tx, ctx.scope(null), { cursor: null, limit: 10 }));
  assert.deepEqual(page.items, []);
}

async function matchingQueryBlocked(ctx, includeUnrelated = false) {
  const { uow, memories, keys } = ctx.adapter;
  const key = await keys.userKey(ctx.owner);
  const queries = [await query(ctx, matching, key)];
  if (includeUnrelated) queries.push(await query(ctx, unrelated, key));
  await seed(ctx, key);
  const policy = await uow.run(ctx.owner, { readOnly: true }, (tx) =>
    memories.readWritePolicy(tx, ctx.scope(null), queries, source, "hash"));
  assert.deepEqual(policy.blockedPositions, [0]);
}

async function matchingFinishSuppressed(ctx) {
  const { uow, capture, keys } = ctx.adapter;
  const key = await keys.userKey(ctx.owner);
  await seed(ctx, key);
  const claim = await uow.run(ctx.owner, { pauseLock: true }, (tx) => capture.claim(tx, {
    scope: ctx.scope(null), client: "test-client", sessionId: "test-session", eventId: "test-event",
    payloadDigest: "a".repeat(64),
  }, [{ id: "test-message", role: "user", content: matching, occurredAtMs: null }], { leaseMs: 60_000 }));
  assert.equal(claim.status, "claimed");
  const { token } = await uow.run(ctx.owner, { pauseLock: true }, (tx) => capture.beginDispatch(tx, claim.token));
  const item = {
    ...await query(ctx, matching, key), content: matching, kind: "fact", confidence: 1, embedding: null, receipts: [],
  };
  const result = await uow.run(ctx.owner, { pauseLock: true }, (tx) => capture.finish(tx, token, [item]));
  assert.equal(result.suppressedCount, 1);
}

async function rotationChangesKey(ctx) {
  const before = await ctx.adapter.keys.userKey(ctx.owner);
  await insertMatchingRow(ctx, before);
  await ctx.harness.setFingerprintSecret("test-secret-rotation");
  const after = await ctx.adapter.keys.userKey(ctx.owner);
  assert.notEqual(after.id, before.id);
}

const omitStoredKeyedDigests = {
  "memory-store": [["return digests;", 'return digests.filter(({ alg }) => alg === "sha256");']],
};
const skipRedigest = ["addKeyedDigest(digests, await coreDigest(row.text, key));", ""];

const mutants = [
  ["rows omit keyed digests", "K-KD-1", matchingRowHidden, /Lexical must retain the unrelated row only/, omitStoredKeyedDigests],
  ["write queries ignore digests", "K-KD-2", matchingQueryBlocked, /Keyed write policy must block the matching query only/, {
    "fact-match": [["digests: query.digests ?? digestsFor(query)", "digests: digestsFor(query)"]],
  }],
  ["keyed explicit saves block the session", "K-KD-2", (ctx) => matchingQueryBlocked(ctx, true),
    /Keyed write policy must leave this session unblocked/, {
      "memory-store": [["blockedSession: policy.blocksSession(source.client, source.sessionId),",
        'blockedSession: (mode === "hash" && batch.some(({ digests }) => digests?.some(({ alg }) => alg === "hmac"))) || policy.blocksSession(source.client, source.sessionId),']],
    }],
  ["rotation skips row digests", "K-KD-4", rotationChangesKey, /Rotation must leave zero rows missing a keyed digest/, {
    "unit-of-work": [skipRedigest],
  }],
  ["rotation publishes the key before covering rows", "K-KD-4", rotationChangesKey,
    /A published rotated key must already cover every row/, {
      privacy: [[
        "await rotateRowDigests((owner) => userFingerprintKey(next, owner, labels));\n        secret = next;",
        "secret = next;\n        await rotateRowDigests((owner) => userFingerprintKey(next, owner, labels));",
      ]],
    }],
  ["ineligible queries are allowed", "K-KD-2", (ctx) => matchingQueryBlocked(ctx, true),
    /A query without a comparable keyed digest must fail closed/, {
      "fact-match": [['mode: mode === "hash" ? "explicitSave" : "capture" }) !== false',
        'mode: mode === "hash" ? "explicitSave" : "capture" }) === true']],
    }],
  ["finish ignores item digests", "K-KD-3", matchingFinishSuppressed, /Capture finish must suppress only the matching item/, {
    capture: [["textHash: row.textHash, digests: row.digests,", "textHash: row.textHash,"]],
  }],
];

for (const [name, id, run, failure, mutations] of mutants) {
  test(`${id} detects when ${name} after the naive case passes`, async () => {
    const testCase = KEYED_DIGEST_CASES.find((candidate) => candidate.id === id);
    assert.ok(testCase);
    const factory = await variantFactory(name, mutations);
    assert.equal(await runCase(factory, { id, title: "naive", needs: testCase.needs, run }), null);
    await assert.rejects(runCase(factory, testCase), failure);
  });
}

async function withKeyedDigests(rows, keys) {
  const copy = structuredClone(rows);
  for (const entries of copy.values()) {
    for (const { row } of entries.values()) {
      for (const key of keys) row.digests.push(await coreDigest(row.text, key));
    }
  }
  return copy;
}

test("keyed digest cases accept a store that computes keyed digests at read time", async (t) => {
  const factory = await variantFactory("lazy row digests", {
    ...omitStoredKeyedDigests,
    index: [["createUnitOfWork(nativeErrorMap, now, flags.placement)",
      "createUnitOfWork(nativeErrorMap, now, flags.placement, (owner) => ringKeys(owner))"]],
    "unit-of-work": [
      ["export function createUnitOfWork(nativeErrorMap, now = Date.now, includeTopics = false) {",
        `${withKeyedDigests}\nexport function createUnitOfWork(nativeErrorMap, now, includeTopics, readKeys) {`],
      ["const result = body(() => {", `const current = issuedRun.state;
      const state = !write && current.rows.size > 0
        ? { ...current, rows: await withKeyedDigests(current.rows, await readKeys(tx.owner)) }
        : current;
      const result = body(() => {`],
      ["return issuedRun.state;", "return state;"],
      skipRedigest,
      ["for (const entries of rows.values()) {", "for (const entries of (await withKeyedDigests(rows, keys)).values()) {"],
    ],
  }, async (harness) => {
    for (const { rows } of await harness.dump()) {
      for (const { row } of rows) assert.ok(row.digests.every(({ alg }) => alg === "sha256"));
    }
  });
  for (const testCase of KEYED_DIGEST_CASES) {
    await t.test(testCase.id, async () => {
      assert.equal(await runCase(factory, testCase), null);
    });
  }
});
