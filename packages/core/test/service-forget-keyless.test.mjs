import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { allDigests, CoreError, factIncarnationBody, normalizeForHash } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { textVariants } from "../src/privacy/fingerprint.mjs";
import { prepareCoreText } from "../src/privacy/text.mjs";
import { validateSuppressionFact } from "../src/suppression-fact.mjs";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

const source = { kind: "mcp", client: null, sessionId: null };
const wording = "The spare lens is stored in the cabinet.";
const sha = text => createHash("sha256").update(text).digest("hex");
const row = (id, text = wording) => ({ ...memory(id, { text }), textHash: "sha256:" + sha(normalizeForHash(text)) });

function setup(rows, forgetting = { capabilities: { fingerprintKey: true } }, hasKey = false) {
  const fake = serviceFake({ rows, writes: true, near: true, hasKey, forgetting });
  return { ...fake, service: createMemoryService(fake.deps) };
}

function assertExactFact({ fact, incarnation }, target) {
  validateSuppressionFact(fact);
  assert.equal(fact.kind, "text");
  assert.equal(fact.mode, "exact");
  assert.equal(fact.origin, "forget");
  assert.equal(incarnation, sha(factIncarnationBody(fact)));
  assert.equal(fact.actionId, `forget:${incarnation}`);
  assert.deepEqual(fact.sourceMemory, { id: target.id, createdAtMs: target.createdAtMs });
  assert.equal(fact.text.keyId, null);
  assert.equal(fact.text.shingles, undefined);
  assert.equal(fact.text.embedding, undefined);
  assert.ok(fact.text.digests.every(digest => digest.alg === "sha256" && digest.keyId === null));
}

test("a null key still erases the row, cascades through lineage and withholds exact replays", async () => {
  const root = { client: "fixture", sessionId: "root" };
  const fork = { ...root, sessionId: "fork" };
  const closure = [root, fork];
  const span = { ...scope, kind: "rawSpan", origin: "forget", actionId: "fixture-span",
    sessionKeyHash: "a".repeat(64), messageKey: "message-one", contentDigest: "b".repeat(64),
    startUtf16: 0, endUtf16: 8 };
  const target = { ...row("target"), source: { kind: "capture", ...root },
    embedding: { model: "fixture", vector: Float32Array.of(1, 0) } };
  const neighbour = { ...row("neighbour", "A different memory."), embedding: target.embedding };
  const { service, calls, committed, mutations } = setup([target, neighbour], {
    capabilities: { fingerprintKey: true, vectorSuppression: true, spanLineage: true, rawSpans: true,
      sessionLineage: true, rawArchive: true, conflictEdges: true, forgetLog: true },
    closure, spans: [span],
  });

  assert.deepEqual(await service.forget(scope, target.id, source), { status: "forgotten", removedSimilar: 0 });
  const { rows, facts, effects } = committed(scope.owner);
  assert.deepEqual(rows, [neighbour]);
  assertExactFact(facts[0], target);
  assert.deepEqual(facts[0].fact.text.digests, await allDigests(wording, null));
  assert.equal(facts.length, 2);
  assert.deepEqual(facts[1].fact, { ...span, actionId: facts[0].fact.actionId });
  assert.deepEqual(facts.map(({ epoch }) => epoch), [1n, 2n]);
  assert.deepEqual(effects.fences, closure);
  assert.deepEqual(effects.closures, [closure]);
  assert.deepEqual(effects.purges, [[facts[0]]]);
  assert.deepEqual(effects.invalidatedConflicts, [target.id]);
  assert.deepEqual(effects.logs, [target.id]);
  assert.deepEqual(calls.map(([method]) => method), [
    "keys.userKey", "run", "lock", "lock", "memories.get", "memories.findDuplicates",
    "spanLineage.resolveSpans", "sessionLineage.provenClosure", "suppressions.writeFact",
    "raw.fenceSession", "raw.fenceSession", "raw.eraseSessions", "raw.purgeWithheld", "suppressions.writeFact",
    "conflicts.invalidate", "memories.erase", "forgetLog.record",
  ]);
  assert.equal(calls.find(([method]) => method === "memories.findDuplicates")[2].embedding, undefined);
  assert.equal(new Set(mutations.map(({ run }) => run)).size, 1);
  assert.deepEqual(await service.save(scope, wording, source), { status: "suppressed" });
});

test("keyless forget persists only redacted digests for a legacy row holding a secret", async () => {
  const token = ["sk", "-", "a".repeat(20)].join("");
  const oauth = "b".repeat(20);
  // The API key is detectable before NFKC, and quoted OAuth needs the current redactor.
  const original = `Fixture Ｘ${token} and "id_token": "${oauth}".`;
  const redacted = 'Fixture X[REDACTED] and "id_token": "[REDACTED]".';
  const target = row("target", original);
  const { service, committed } = setup([target]);

  assert.deepEqual(await service.forget(scope, target.id, source), { status: "forgotten", removedSimilar: 0 });
  const { rows, facts: [stored] } = committed(scope.owner);
  assert.deepEqual(rows, []);
  assertExactFact(stored, target);
  const spellings = textVariants(original, prepareCoreText(original)).map(([text]) => text);
  const unsafe = new Set();
  for (const spelling of spellings.filter(text => text.includes(token) || text.includes(oauth))) {
    unsafe.add(sha(normalizeForHash(spelling)));
  }
  assert.ok(unsafe.has(target.textHash.slice(7)));
  for (const { value } of stored.fact.text.digests) assert.equal(unsafe.has(value), false);
  assert.deepEqual(stored.fact.text.digests, await allDigests(redacted, null));
  assert.deepEqual(await service.save(scope, redacted, source), { status: "suppressed" });
});

test("forget runs without a fingerprint provider", async () => {
  const target = row("target");
  const { deps, storage, committed } = setup([target]);
  delete storage.keys;
  const service = createMemoryService(deps);
  assert.deepEqual(await service.forget(scope, target.id, source), { status: "forgotten", removedSimilar: 0 });
  assertExactFact(committed(scope.owner).facts[0], target);
});

test("disabled fingerprint capability bypasses a configured provider and retains exact counts", async () => {
  const target = row("target");
  const { service, calls, committed } = setup([target, row("exact")], {
    capabilities: { fingerprintKey: false },
  }, true);
  assert.deepEqual(await service.forget(scope, target.id, source), { status: "forgotten", removedSimilar: 1 });
  assert.equal(calls.some(([method]) => method === "keys.userKey"), false);
  assertExactFact(committed(scope.owner).facts[0], target);
});

test("a null transaction-scoped key falls back without consulting the external lookup", async () => {
  const target = row("target");
  const { service, storage, hooks, committed } = setup([target], undefined, true);
  let lookups = 0;
  storage.keys.userKeyForWrite = async tx => {
    assert.equal(tx.owner, scope.owner);
    assert.equal(tx.options.pauseLock, true);
    lookups++;
    return null;
  };
  hooks.fault = method => {
    if (method === "keys.userKey") assert.fail("unexpected external lookup");
  };
  assert.deepEqual(await service.forget(scope, target.id, source), { status: "forgotten", removedSimilar: 0 });
  assert.equal(lookups, 1);
  assertExactFact(committed(scope.owner).facts[0], target);
});

for (const transactionScoped of [false, true]) {
  test(`a throwing ${transactionScoped ? "transaction-scoped" : "external"} lookup still errors for an existing row`, async () => {
    const target = row("target");
    const { service, storage, hooks, committed, mutations } = setup([target]);
    const fail = () => { throw new Error("fixture key lookup failure"); };
    if (transactionScoped) storage.keys.userKeyForWrite = fail;
    else hooks.fault = method => { if (method === "keys.userKey") fail(); };
    const before = committed(scope.owner);
    await assert.rejects(service.forget(scope, target.id, source), { name: CoreError.name, code: "internal_error" });
    assert.deepEqual(await service.forget(scope, "missing", source), { status: "not_found" });
    assert.deepEqual(committed(scope.owner), before);
    assert.deepEqual(mutations, []);
  });
}
