import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  CoreError, coreDigest, engineLegacyDigest, factBlocksIncoming, factIncarnationBody, FORGET_STEPS,
  hostedV1Digest, normalizeForHash, redactHostedCurrent, redactV1, validateSuppressionFact,
} from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { textVariants } from "../src/privacy/fingerprint.mjs";
import { prepareCoreText } from "../src/privacy/text.mjs";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

const source = { kind: "mcp", client: null, sessionId: null };
const root = { client: "fixture", sessionId: "source" };
const fork = { ...root, sessionId: "fork" };
const wording = "The spare lens is in the cabinet.";
const sha = text => createHash("sha256").update(text).digest("hex");
const row = (text, id = "target") => ({
  ...memory(id, { text }),
  textHash: "sha256:" + sha(normalizeForHash(text)),
});
const span = { ...scope, kind: "rawSpan", origin: "forget", actionId: "fixture",
  sessionKeyHash: "a".repeat(64), messageKey: "source-message", contentDigest: "b".repeat(64),
  startUtf16: 0, endUtf16: 8 };
const sourceMessage = { ...root, messageId: span.messageKey };
const receipt = { ...sourceMessage, role: "user", occurredAtMs: 10,
  sessionKeyHash: span.sessionKeyHash, messageKey: span.messageKey };
const replayMessage = content => ({ id: "replay", role: "user", content, occurredAtMs: 20 });
const event = { client: root.client, sessionId: "replay-session", eventId: "replay-event" };

function setup(target, options = {}) {
  const fake = serviceFake({ rows: [target], writes: true, hasKey: false,
    forgetting: { capabilities: { fingerprintKey: true } }, ...options });
  return { ...fake, service: createMemoryService(fake.deps) };
}

// The shared fake's slot builder supports text and span facts. Identity facts
// use the same transaction, including the existing commit/rollback boundary.
function supportIdentityFacts({ storage, hooks }) {
  const write = storage.suppressions.writeFact.bind(storage.suppressions);
  storage.suppressions.writeFact = async (tx, fact, incarnation) => {
    if (fact.kind !== "identity" && !tx.facts.some(stored => stored.fact.kind === "identity")) {
      return write(tx, fact, incarnation);
    }
    validateSuppressionFact(fact);
    const prior = tx.facts.find(stored => stored.incarnation === incarnation);
    if (prior) return { ...prior, created: false };
    const epoch = BigInt(tx.facts.length + 1);
    const stored = { fact, incarnation, epoch, factId: "fact-" + epoch, createdAtMs: 100 };
    tx.facts = [...tx.facts, stored];
    tx.revision++;
    await hooks.fault?.(fact.kind === "rawSpan" ? "suppressions.writeSpan" : "suppressions.writeFact");
    return { ...stored, created: true };
  };
}

for (const [path, replay] of [
  ["save", async ({ service }, text) => {
    assert.deepEqual(await service.save(scope, text, source), { status: "suppressed" });
  }],
  ["capture admission", async ({ service, mutations }, text) => {
    const message = replayMessage(text);
    assert.deepEqual(await service.enqueueCapture(scope, { ...event, messages: [message] }), { status: "accepted" });
    assert.deepEqual(mutations.find(({ method }) => method === "capture.admit").args[1], [{ ...message, content: "" }]);
  }],
  ["capture finish", async ({ service, hooks, mutations }, text, forget) => {
    // Install the fact during embedding so the finish check must withhold it.
    assert.deepEqual(await service.enqueueCapture(scope, { ...event, messages: [replayMessage(wording)] }),
      { status: "accepted" });
    hooks.model = () => ({ items: [{ content: text, kind: "fact", confidence: 0.9, sourceIndices: [0] }] });
    hooks.embed = forget;
    assert.equal((await service.runCapture(scope, event)).status, "done");
    assert.deepEqual(mutations.find(({ method }) => method === "capture.finish").args[1], []);
  }],
  ["memory import", async ({ service }, text) => {
    assert.deepEqual(await service.importMemories(scope, [{ text, kind: "fact" }], source),
      { imported: 0, duplicate: 0, suppressed: 1, invalid: 0 });
  }],
  ["Raw import", async ({ service, archived }, text) => {
    const { client, sessionId } = event;
    assert.deepEqual(await service.importRawMessages(scope, [{ client, sessionId, messages: [replayMessage(text)] }]),
      { imported: 0, duplicate: 0, suppressed: 1, invalid: 0 });
    assert.deepEqual(archived(scope.owner), []);
  }],
]) {
  test(`K1 withholds the prepared fullwidth Bearer replay at ${path}`, async () => {
    const token = ["sk", "-", "q".repeat(9), "ｑ", "q".repeat(10)].join("");
    const original = `Note Bearer ${token} for staging.`;
    const text = "Note Bearer [REDACTED] for staging.";
    assert.equal(prepareCoreText(original), text);
    const target = row(original);
    const fake = setup(target, { capture: true, rawArchive: true, compliantCapturePrefilter: true });
    fake.hooks.eligible = messages => messages.map((_, index) => index);
    const forget = async () => {
      assert.deepEqual(await fake.service.forget(scope, target.id, source), { status: "forgotten", removedSimilar: 0 });
    };
    if (path !== "capture finish") await forget();
    await replay(fake, text, forget);
    const { facts: [{ fact }] } = fake.committed(scope.owner);
    assert.equal(fact.kind, "text");
    assert.ok(fact.text.digests.some(({ value }) => value === sha(normalizeForHash(text))));
    assertNoSecretDigests(fact, original, [token]);
  });
}

function assertNoSecretDigests(fact, original, secretValues) {
  const prepared = prepareCoreText(original);
  const spellings = textVariants(original, prepared).flatMap(([text]) =>
    [text, prepareCoreText(text), redactV1(text), redactV1(text.normalize("NFKC"))]);
  const secrets = secretValues.map(normalizeForHash);
  const unsafe = new Set(spellings.map(normalizeForHash)
    .filter(text => secrets.some(secret => text.includes(secret))).map(sha));
  assert.ok(unsafe.size > 0);
  assert.equal(fact.text?.digests.some(({ value }) => unsafe.has(value)) ?? false, false,
    "the stored fact has a SHA-256 digest of a spelling that contains the masked value");
}

function repeatedPassword() {
  const value = ["spring", "River", 2045].join("");
  return { value, text: `The database password is ${value}. Config: password=${value}` };
}

test("K2 uses identity and lineage when a masked value survives every spelling", async () => {
  const { value, text } = repeatedPassword();
  const target = { ...row(text), source: { kind: "capture", ...root } };
  const fake = setup(target, { forgetting: { capabilities: { spanLineage: true, rawArchive: true,
    rawSpans: true, sessionLineage: true, forgetLog: true }, spans: [span], closure: [root, fork] } });
  supportIdentityFacts(fake);
  const forget = () => fake.service.forget(scope, target.id, source);
  assert.deepEqual(await forget(), { status: "forgotten", removedSimilar: 0 });
  const { rows, facts: [identity, lineage], effects } = fake.committed(scope.owner);
  assert.deepEqual(rows, []);
  assertNoSecretDigests(identity.fact, text, [value]);
  assert.deepEqual(identity.fact, { ...scope, kind: "identity", origin: "forget", memoryId: target.id,
    actionId: `forget:${identity.incarnation}` });
  assert.equal(identity.incarnation, sha(factIncarnationBody(identity.fact)));
  assert.deepEqual(lineage.fact, { ...span, actionId: identity.fact.actionId });
  assert.deepEqual([identity.epoch, lineage.epoch], [1n, 2n]);
  assert.deepEqual(effects.fences, [root, fork]);
  assert.deepEqual(effects.closures, [[root, fork]]);
  assert.deepEqual(effects.purges, []);
  assert.deepEqual(effects.logs, [target.id]);
  fake.insert(target);
  assert.deepEqual(await forget(), { status: "forgotten", removedSimilar: 0 });
  assert.deepEqual(fake.committed(scope.owner).facts, [identity, lineage]);
});

for (const [label, assignment, length] of [
  ["parenthesised assignment", value => `(password=${value})`],
  ["trailing semicolon", value => `password=${value};`],
  ["quoted value", value => `password="${value}"`],
  ["bracketed value", value => `password=[${value}]`],
  ["trailing comma", value => `password=${value},`],
  ["surrounding periods", value => `password=.${value}.`],
  ["four-character run inside a longer value", value => `password=${"z".repeat(8)}!${value}~${"b".repeat(8)}`, 4],
]) {
  test(`K2b excludes a surviving password run with ${label}`, async () => {
    const password = repeatedPassword().value;
    const value = password.slice(0, length);
    const original = `The database password is ${value}. Config: ${assignment(value)}`;
    const target = { ...row(original), source: { kind: "capture", ...root } };
    const fake = setup(target, { forgetting: { capabilities: { spanLineage: true, rawSpans: true }, spans: [span] } });
    supportIdentityFacts(fake);
    assert.equal((await fake.service.forget(scope, target.id, source)).status, "forgotten");
    const { rows, facts } = fake.committed(scope.owner);
    assert.deepEqual(rows, []);
    for (const { fact } of facts) assertNoSecretDigests(fact, original, [value]);
    assert.deepEqual(facts.map(({ fact }) => fact.kind), ["identity", "rawSpan"]);
    const [identity, lineage] = facts.map(({ fact }) => fact);
    assert.equal(identity.memoryId, target.id);
    assert.deepEqual(lineage, { ...span, actionId: identity.actionId });
  });
}

test("addendum 15 records the scope of keyless text purge and span suppression", async () => {
  const doc = await readFile(new URL("../docs/PHASE0.md", import.meta.url), "utf8");
  const addendum = doc.match(/^15\. \*\*Keyless forget\.\*\*[\s\S]*?(?=^### )/mu)?.[0] ?? "";
  assert.match(addendum, /physically purges Raw messages.*exact text fact/u);
  assert.match(addendum, /merely contain the forgotten text.*weaker protection/u);
  assert.match(addendum, /span facts.*withholds.*from reads/u);
  assert.match(addendum, /Physical deletion.*depends on the adapter/u);
  assert.match(addendum, /proven-closure erasure apply as usual/u);
  assert.match(addendum, /maximal runs.*masked value.*four characters/u);
  assert.match(addendum, /any collected run/u);
});

test("the span lineage port documents how forget handles missing Raw rows and other doubt", async () => {
  const types = await readFile(new URL("../src/ports/privacy.d.ts", import.meta.url), "utf8");
  const port = types.match(/export interface SpanLineageStore \{[^}]+/u)?.[0] ?? "";
  assert.match(port, /Returns \[\] when the memory's source Raw rows no longer exist/u);
  assert.match(port, /forget still erases the memory/u);
  assert.match(port, /Throws raw_lineage_unavailable on any other doubt/u);
});

function matches(stored, digest) {
  return factBlocksIncoming(stored, { scope, passages: [{ digests: [digest] }] }, { mode: "capture" });
}

test("K3 keeps the three candidate domains and the row's historical SHA alias for plain text", async () => {
  const archived = "The spare lens is in the wooden cabinet.";
  const hosted = await hostedV1Digest(archived);
  const target = { ...row(wording), textHash: "sha256:" + hosted.value };
  const { service, committed } = setup(target);
  assert.equal((await service.forget(scope, target.id, source)).status, "forgotten");
  const [stored] = committed(scope.owner).facts;
  for (const candidate of [await coreDigest(wording), hosted, await engineLegacyDigest(wording)]) {
    assert.equal(matches(stored, candidate), true, candidate.pipeline);
  }
  assert.deepEqual(new Set(stored.fact.text.digests.map(({ value }) => value)),
    new Set([(await coreDigest(wording)).value, hosted.value]));
});

test("K3 retains a safe historical hosted spelling when core's spelling still holds a secret", async () => {
  const token = ["sk", "-", "v".repeat(20)].join("");
  const original = `Fixture Ｘ${token} for staging.`;
  const hosted = redactHostedCurrent(original);
  assert.ok(prepareCoreText(original).includes(token));
  assert.ok(!hosted.includes(token));
  const target = row(original);
  const fake = setup(target);
  supportIdentityFacts(fake);
  const { service, committed } = fake;
  assert.equal((await service.forget(scope, target.id, source)).status, "forgotten");
  const [stored] = committed(scope.owner).facts;
  assert.equal(stored.fact.kind, "text");
  assertNoSecretDigests(stored.fact, original, [token]);
  assert.deepEqual(stored.fact.text.digests.map(({ value }) => value), [sha(normalizeForHash(hosted))]);
  assert.equal(matches(stored, await hostedV1Digest(hosted)), true);
});

const faultPoints = {
  resolve: ["memories.get", "memories.findDuplicates"],
  "lineage.resolve": ["spanLineage.resolveSpans", "hydrate.hydrate", "sessionLineage.provenClosure"],
  "suppression.write": ["clock.sha256Hex", "suppressions.writeFact"],
  "session.fence": ["raw.fenceSession"],
  "raw.purge": ["raw.eraseSessions", "raw.purgeWithheld"],
  "receipts.suppress": ["suppressions.writeSpan"],
  "dependents.invalidate": ["documentCards.hideWhere", "conflicts.invalidate", "quantityLedger.dropWhere"],
  // edits.unlink is a no-op. The next boundary is entry to the combined erase port.
  "edits.unlink": ["before erase"],
  tombstone: ["memories.erase"],
  "receipts.delete": ["after erase"],
  "epoch.advance": ["commit"],
};

test("K4 injects a fault at every named keyless forget step or its transaction boundary", async t => {
  assert.deepEqual(Object.keys(faultPoints), FORGET_STEPS);
  for (const [step, methods] of Object.entries(faultPoints)) {
    for (const method of methods) {
      await t.test(`${step} / ${method}`, async () => {
        const target = { ...row(wording), source: { kind: "capture", ...root } };
        const { service, storage, hooks, committed } = setup(target, {
          forgetting: { capabilities: { fingerprintKey: true, spanLineage: true, rawSpans: true,
            rawArchive: true, sessionLineage: true, documentCards: true, conflictEdges: true,
            quantityLedger: true, forgetLog: true }, spans: [span], receipts: [receipt], closure: [root, fork] },
        });
        const before = structuredClone(committed(scope.owner));
        let injected = 0;
        const inject = () => { injected++; throw new CoreError("storage_error"); };
        const erase = storage.memories.erase.bind(storage.memories);
        storage.memories.erase = async (...args) => {
          if (method === "before erase") inject();
          const erased = await erase(...args);
          if (method === "after erase") inject();
          return erased;
        };
        hooks.fault = point => { if (point === method) inject(); };
        await assert.rejects(service.forget(scope, target.id, source), { name: CoreError.name, code: "storage_error" });
        assert.equal(injected, 1);
        assert.deepEqual(committed(scope.owner), before);
      });
    }
  }
});

test("K4 a late fault rolls back the identity-only branch and its staged lineage", async () => {
  const target = { ...row(repeatedPassword().text), source: { kind: "capture", ...root } };
  const fake = setup(target, { forgetting: { capabilities: { rawArchive: true, spanLineage: true, rawSpans: true,
    sessionLineage: true, forgetLog: true }, spans: [span], closure: [root, fork] } });
  supportIdentityFacts(fake);
  const { service, storage, hooks, committed } = fake;
  const before = structuredClone(committed(scope.owner));
  const write = storage.suppressions.writeFact.bind(storage.suppressions);
  const staged = [];
  storage.suppressions.writeFact = async (tx, fact, incarnation) => {
    const written = await write(tx, fact, incarnation);
    staged.push(fact.kind);
    return written;
  };
  hooks.fault = method => { if (method === "forgetLog.record") throw new CoreError("storage_error"); };
  await assert.rejects(service.forget(scope, target.id, source), { name: CoreError.name, code: "storage_error" });
  assert.deepEqual(committed(scope.owner), before);
  assert.deepEqual(staged, ["identity", "rawSpan"]);
});

for (const [hasKey, projection] of [[false, "missing"], [true, "missing"], [false, "no receipts"], [true, "no receipts"]]) {
  test(`K5 erases with ${hasKey ? "a key" : "no key"} and ${projection} projection after Raw is gone`, async () => {
    const target = { ...row(wording), source: { kind: "capture", ...root } };
    const { service, storage, calls, committed } = setup(target, { hasKey,
      forgetting: { capabilities: { fingerprintKey: true, spanLineage: true, rawArchive: true,
        documentCards: true }, spans: [] } });
    storage.hydrate.hydrate = async (_tx, _scope, refs) =>
      projection === "missing" ? [] : refs.map(ref => ({ ref }));
    assert.deepEqual(await service.forget(scope, target.id, source), { status: "forgotten", removedSimilar: 0 });
    assert.ok(calls.some(([method]) => method === "spanLineage.resolveSpans"));
    const { rows, facts, effects } = committed(scope.owner);
    assert.deepEqual(rows, []);
    assert.deepEqual(facts.map(({ fact }) => [fact.kind, fact.mode]), [["text", hasKey ? "full" : "exact"]]);
    assert.deepEqual(effects.fences, [root]);
    assert.deepEqual(effects.purges, [facts]);
    assert.deepEqual(effects.hiddenCards, [{ sourceMemoryId: target.id }, { session: root }]);
  });
}

test("keyless removedSimilar counts exact duplicates without requesting unavailable containment", async () => {
  const target = { ...row(wording), embedding: { model: "fixture", vector: Float32Array.of(1, 0) } };
  const { service, storage, committed } = setup(target, { rows: [target, row(wording, "exact")],
    forgetting: { capabilities: { fingerprintKey: false, vectorSuppression: true, nearDuplicate: true } } });
  const find = storage.memories.findDuplicates.bind(storage.memories);
  storage.memories.findDuplicates = (tx, scope, queries, options) => {
    if (queries.some(query => Object.hasOwn(query, "embedding"))) throw new CoreError("ineligible");
    return find(tx, scope, queries, options);
  };
  assert.deepEqual(await service.forget(scope, target.id, source), { status: "forgotten", removedSimilar: 1 });
  assert.deepEqual(committed(scope.owner).rows.map(({ id }) => id), ["exact"]);
});
