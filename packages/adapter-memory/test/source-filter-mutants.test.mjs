import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { runCase, SOURCE_FILTER_CASES } from "@cairn-ink/conformance";
import { allDigests, CoreError, withholdsAnyPassage } from "@cairn-ink/core";

const adapterURL = new URL("../src/index.mjs", import.meta.url);
const hashSessionKey = (client, sessionId) =>
  createHash("sha256").update(JSON.stringify([client, sessionId])).digest("hex");

function factory(createAdapter, sessionRefs = "plain") {
  return {
    name: `memory source filter (${sessionRefs})`,
    async open({ capabilities }) {
      const hash = sessionRefs === "hashed" ? hashSessionKey : undefined;
      const adapter = createAdapter({ capabilities, sessionRefs, hashSessionKey: hash });
      return {
        adapter, sessionRefs, harness: { ...adapter.harness, hashSessionKey: hash },
        nativeErrorMap: adapter.nativeErrorMap, busyNativeCodes: [], embeddingDimensions: null,
        async close() {},
      };
    },
  };
}

async function mutantFactory(label, moduleName, edits, sessionRefs) {
  const entry = new URL(adapterURL);
  const specifier = `./${moduleName}.mjs`;
  const module = new URL(specifier, entry);
  const variant = JSON.stringify([label, sessionRefs]);
  entry.searchParams.set("variant", variant);
  module.searchParams.set("variant", variant);
  let source = readFileSync(module, "utf8");
  for (const [before, after] of edits) {
    assert.equal(source.split(before).length, 2, `Expected one mutation site for ${label}`);
    source = source.replace(before, () => after);
  }
  const hooks = registerHooks({
    resolve(request, context, nextResolve) {
      return nextResolve(context.parentURL === entry.href && request === specifier ? module.href : request, context);
    },
    load(url, context, nextLoad) {
      return url === module.href ? { format: "module", source, shortCircuit: true } : nextLoad(url, context);
    },
  });
  try {
    const { createMemoryAdapter: createVariant } = await import(entry.href);
    return factory(createVariant, sessionRefs);
  } finally {
    hooks.deregister();
  }
}

const client = "test-client";
const sessionId = "test-session";
const withheld = "Test passage with a matching fact.";
const messageAt = (occurredAtMs, content = "Test message") => ({ id: "test-message", role: "user", content, occurredAtMs });
const key = (ctx, session = sessionId) =>
  ({ scope: ctx.scope(null), client, sessionId: session, eventId: "test-event", payloadDigest: "a".repeat(64) });

function seed(ctx, fact) {
  return ctx.harness.seedFact(ctx.owner, { owner: ctx.owner, actionId: "test-fact", origin: "forget", ...fact });
}

const seedSession = (ctx) => seed(ctx, { kind: "session", session: { client, sessionId } });
const seedWindow = (ctx) =>
  seed(ctx, { kind: "window", client, window: { startMs: 10, endMs: 20 }, unknownTime: true });

async function seedText(ctx) {
  const fp = { digests: await allDigests(withheld, null), shingles: null, keyId: null };
  await seed(ctx, { kind: "text", mode: "exact", text: fp });
  return fp;
}

function eligible({ adapter: { capture, uow }, owner }, admission, message) {
  return uow.run(owner, { readOnly: true }, (tx) => capture.eligible(tx, admission, [message]));
}

// Each naive case exercises the port without the condition that exposes the mutation.
async function matchingSessionBlocked(ctx) {
  await seedSession(ctx);
  assert.deepEqual(await eligible(ctx, key(ctx), messageAt(10)), []);
}

async function otherSessionAdmitted(ctx) {
  await seedSession(ctx);
  assert.deepEqual(await eligible(ctx, key(ctx, "other-session"), messageAt(10)), [0]);
}

async function outsideWindowAdmitted(ctx) {
  await seedWindow(ctx);
  assert.deepEqual(await eligible(ctx, key(ctx), messageAt(20)), [0]);
}

async function knownTimeBlocked(ctx) {
  await seedWindow(ctx);
  assert.deepEqual(await eligible(ctx, key(ctx), messageAt(10)), []);
}

async function assertWithoutFact(ctx) {
  const { adapter: { capture, uow }, owner } = ctx;
  const admission = key(ctx);
  const message = messageAt(10);
  await uow.run(owner, { pauseLock: true }, (tx) => capture.claim(tx, admission, [message], { leaseMs: 60_000 }));
  const positions = await eligible(ctx, admission, message);
  assert.deepEqual(positions, [0]);
  await uow.run(owner, {}, (tx) => capture.assertEligible(tx, admission, positions));
}

async function textAdmitted(ctx, text) {
  await seedText(ctx);
  assert.deepEqual(await eligible(ctx, key(ctx), messageAt(10, text)), [0]);
}

async function matchingTextWithheld(ctx) {
  const { adapter: { suppressions, uow }, owner } = ctx;
  const fp = await seedText(ctx);
  const snapshot = await uow.run(owner, { readOnly: true }, (tx) =>
    suppressions.snapshot(tx, ctx.scope(null), { client, sessionId, passages: [fp] }));
  assert.equal(withholdsAnyPassage([fp], snapshot.passages.map(({ fact }) => fact)), true);
}

function textFilteringAdapter(options) {
  const adapter = createMemoryAdapter(options);
  const { capture, suppressions } = adapter;
  return {
    ...adapter,
    capture: {
      ...capture,
      async eligible(tx, key, messages) {
        const positions = await capture.eligible(tx, key, messages);
        const kept = [];
        for (const position of positions) {
          const fp = { digests: await allDigests(messages[position].content, null), shingles: null, keyId: null };
          const { scope, client, sessionId } = key;
          const { passages } = await suppressions.snapshot(tx, scope, { client, sessionId, passages: [fp] });
          if (!withholdsAnyPassage([fp], passages.map(({ fact }) => fact))) kept.push(position);
        }
        return kept;
      },
    },
  };
}

const sessionMatch = "factBlocksIncoming(stored, { scope, passages: [], session: { client, sessionId } }, capture) !== false";
const windowFacts = 'const windows = scoped.filter((stored) => isKind(stored, "window"));';
const snapshotPassages = "passages: structuredClone(projected === undefined ? texts : matchingPassages(texts, projected)),";
const matcher = "const matcher = matchFacts(state.facts, scope);";
const mutants = [
  ["ineligible is admitted", "K-SRC-1", matchingSessionBlocked, /Ineligible session comparison must deny source positions/,
    "fact-match", [[sessionMatch, sessionMatch.replace("!== false", "=== true")]]],
  ["windows are ignored", "K-SRC-2", outsideWindowAdmitted, /Client window must block its half-open interval/,
    "fact-match", [[windowFacts, "const windows = [];"]]],
  ["unknown times are ignored", "K-SRC-2", knownTimeBlocked, /All-client window must block inside and unknown times/,
    "fact-match", [["of occurredAtMs.entries()) {", "of occurredAtMs.entries()) {\n        if (time === null) continue;"]]],
  ["session facts are ignored", "K-SRC-1", otherSessionAdmitted, /Matching session must have no eligible positions/,
    "fact-match", [["sessions.some((stored) =>", "[].some((stored) =>"]]],
  ["assert uses stale facts", "K-SRC-3", assertWithoutFact, /Expected operation to reject/,
    "capture", [
      ["  return {\n    async claim", "  const preflightFacts = new Map();\n  return {\n    async claim"],
      [`        ${matcher}\n        if`, `        preflightFacts.set(scope.owner, structuredClone(state.facts));\n        ${matcher}\n        if`],
      [`          ${matcher}\n          if`, "          const matcher = matchFacts(preflightFacts.get(scope.owner) ?? state.facts, scope);\n          if"],
    ]],
  ["text facts filter source positions", "K-SRC-4", (ctx) => textAdmitted(ctx, "Unrelated message."),
    /Text facts must leave source positions eligible/],
  ["snapshot omits matching text", "K-SRC-4", (ctx) => textAdmitted(ctx, withheld),
    /Core must withhold matching text from snapshot passages/, "fact-match", [[snapshotPassages, "passages: [],"]]],
  ["read-only assert is allowed", "K-SRC-5", assertWithoutFact, /Expected operation to reject/,
    "capture", [['return port.write(tx, scope, "conditional",', "return port.write(tx, scope, false,"]]],
  ["snapshot evidence withholds all text", "K-SRC-4", matchingTextWithheld, /The matching facts must leave unrelated text visible/,
    "fact-match", [[snapshotPassages,
      "passages: texts.map((stored) => ({ ...stored, fact: { ...stored.fact, text: { digests: [] } } })),"]]],
];

for (const [label, id, run, failure, moduleName, edits] of mutants) {
  test(`${id} detects when ${label} after the naive case passes`, async () => {
    const full = SOURCE_FILTER_CASES.find((candidate) => candidate.id === id);
    assert.ok(full);
    const variant = moduleName ? await mutantFactory(label, moduleName, edits, "plain") : factory(textFilteringAdapter);
    assert.equal(await runCase(variant, { id, title: "naive", needs: [], run }), null);
    await assert.rejects(runCase(variant, full), failure);
  });
}

function transactionSuppressionAdapter(options, failWrite) {
  const adapter = createMemoryAdapter(options);
  const { capture, suppressions, uow } = adapter;
  const factWrites = new WeakSet();
  return {
    ...adapter,
    suppressions: {
      ...suppressions,
      async writeFact(tx, ...args) {
        if (failWrite) throw new CoreError("suppressed");
        const written = await suppressions.writeFact(tx, ...args);
        factWrites.add(tx);
        return written;
      },
    },
    capture: {
      ...capture,
      async assertEligible(tx, ...args) {
        if (!factWrites.has(tx)) await capture.assertEligible(tx, ...args);
      },
    },
    uow: {
      ...uow,
      run(owner, options, callback) {
        return uow.run(owner, options, async (tx) => {
          const result = await callback(tx);
          if (factWrites.has(tx)) throw new CoreError("suppressed");
          return result;
        });
      },
    },
  };
}

async function transactionOnlyRecheck(ctx) {
  const { adapter: { capture, suppressions, uow }, owner, harness } = ctx;
  const admission = key(ctx);
  const message = messageAt(10);
  await uow.run(owner, { pauseLock: true }, (tx) => capture.claim(tx, admission, [message], { leaseMs: 60_000 }));
  const positions = await eligible(ctx, admission, message);
  assert.deepEqual(positions, [0]);
  const before = await harness.dump();
  await assert.rejects(uow.run(owner, { pauseLock: true }, async (tx) => {
    await suppressions.writeFact(tx, { owner, actionId: "session", origin: "forget", kind: "session",
      session: { client, sessionId } }, "c".repeat(64));
    await capture.assertEligible(tx, admission, positions);
  }), (error) => error instanceof CoreError && error.code === "suppressed");
  assert.deepEqual(await harness.dump(), before);
  await uow.run(owner, {}, (tx) => capture.assertEligible(tx, admission, positions));
}

for (const [label, failWrite, failure] of [
  ["only the transaction rejects", false, /assertEligible must reject with suppressed/],
  ["writeFact rejects", true, /writeFact must resolve and create the fact/],
]) {
  test(`K-SRC-3 detects when ${label} after the naive case passes`, async () => {
    const id = "K-SRC-3";
    const full = SOURCE_FILTER_CASES.find((candidate) => candidate.id === id);
    const variant = factory((options) => transactionSuppressionAdapter(options, failWrite));
    assert.equal(await runCase(variant, { id, title: "naive", needs: [], run: transactionOnlyRecheck }), null);
    await assert.rejects(runCase(variant, full), failure);
  });
}

test("K-SRC-4 detects missing text facts on an always-keyed store", async () => {
  const id = "K-SRC-4";
  const full = SOURCE_FILTER_CASES.find((candidate) => candidate.id === id);
  const omitted = await mutantFactory("always-keyed snapshot omits text", "fact-match", [
    [snapshotPassages, "passages: [],"],
  ], "plain");
  const variant = { ...omitted, open: ({ capabilities }) =>
    omitted.open({ capabilities: { ...capabilities, fingerprintKey: true } }) };
  assert.equal(await runCase(variant, {
    id, title: "naive", needs: [], run: (ctx) => textAdmitted(ctx, withheld),
  }), null);
  await assert.rejects(runCase(variant, full), /Core must withhold matching text from snapshot passages/);
});

for (const profile of ["plain", "hashed"]) {
  test(`source filtering accepts reverse fact order under the ${profile} profile`, async () => {
    const reversed = await mutantFactory("reverse fact order", "fact-match", [
      ["(fact.namespace ?? null) === scope.namespace);", "(fact.namespace ?? null) === scope.namespace).reverse();"],
    ], profile);
    for (const testCase of SOURCE_FILTER_CASES) {
      assert.equal(await runCase(reversed, testCase), null, testCase.id);
    }
  });
}
