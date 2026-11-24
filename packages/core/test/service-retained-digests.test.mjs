import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";
import { allDigests, CoreError, factBlocksIncoming, factHidesRow, normalizeForHash, prepareCoreText,
  redactHostedCurrent, redactV1 } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

const source = { kind: "mcp", client: null, sessionId: null };
const selection = { client: "client", sessionId: "session", eventId: "event" };
const previous = memory("target", { text: "The sample is in the cabinet." });
const forgotten = "The spare lens is boxed.";
const secret = randomBytes(16).toString("hex");
const unrelated = `  ＡＰＩ＿ＫＥＹ=${secret}   goes in the blue folder.  `;
const canonical = text => normalizeForHash(prepareCoreText(text));
const message = (id, content) => ({ id, role: "user", content, occurredAtMs: null });

async function fixture({ factAtFinish = false } = {}) {
  const fake = serviceFake({ writes: true, forgetting: {}, capture: true });
  const { storage, hooks, seedFact } = fake;
  const runtimeKey = randomBytes(32);
  const keyId = randomBytes(8).toString("hex");
  const sign = text => createHmac("sha256", runtimeKey).update(text).digest("hex");
  const retained = { alg: "hmac", keyId, label: "hosted-v1", mac: async text => sign(text) };
  const storedDigest = (text, pipeline = "hosted-v1", redactionVersion = 1) => ({
    alg: retained.alg, keyId, value: sign(normalizeForHash(text)), pipeline, redactionVersion,
  });
  const storedFact = { ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "forget",
    text: { digests: [storedDigest(forgotten)] } };
  const current = await storage.keys.userKey(scope.owner);
  const previousDigests = await allDigests(previous.text, current);
  fake.insert({ ...previous, textHash: "sha256:" + (await allDigests(previous.text))[0].value,
    digests: [...previousDigests, storedDigest(previous.text)] });
  if (!factAtFinish) seedFact(storedFact);

  // Exercise core's passage checks independently of source eligibility in the adapter.
  hooks.eligible = messages => messages.map((_, index) => index);
  const calls = [];
  let active = 0;
  const run = storage.uow.run;
  storage.uow.run = (owner, options, work) => run(owner, options, async tx => {
    active++;
    try {
      return await work(tx);
    } finally {
      active--;
    }
  });
  function provide(digesters) {
    storage.keys.retainedDigesters = async owner => {
      calls.push({ owner, active });
      return digesters.map(digester => ({ ...digester, async mac(text) {
        calls.push({ text, active, label: digester.label });
        return digester.mac(text);
      } }));
    };
  }
  function expectedDigest(text, pipeline = "hosted-v1", redactionVersion = 1) {
    return { ...storedDigest(text, pipeline, redactionVersion), label: retained.label };
  }
  return { ...fake, current, retained, storedFact, storedDigest, expectedDigest, provide, signerCalls: calls,
    service: createMemoryService(fake.deps) };
}

const operations = {
  save: async (f, text) => (await f.service.save(scope, text, source)).status,
  correct: async (f, text) => (await f.service.correct(scope, previous.id, previous.revision, text, source)).status,
  capture: async (f, text) => {
    assert.deepEqual(await f.service.enqueueCapture(scope, {
      ...selection, messages: [message("source", "The user described the inventory.")],
    }), { status: "accepted" });
    f.seedFact(f.storedFact);
    f.signerCalls.length = 0;
    f.hooks.model = () => ({ items: [{ kind: "fact", confidence: 0.9, content: text, sourceIndices: [0] }] });
    const result = await f.service.runCapture(scope, selection);
    assert.equal(result.status, "done");
    return result.result.memories.length ? "saved" : "suppressed";
  },
  import: async (f, text) => {
    const counts = await f.service.importMemories(scope, [{ kind: "fact", text }], source);
    assert.equal(counts.imported + counts.suppressed, 1);
    return counts.imported ? "saved" : "suppressed";
  },
};

function assertSignerCalls(f, text) {
  assert.deepEqual(f.signerCalls.filter(call => "owner" in call), [{ owner: scope.owner, active: 0 }]);
  const signed = f.signerCalls.filter(call => "text" in call);
  assert.equal(signed.filter(call => call.text === canonical(text) && call.label === f.retained.label).length, 1);
  assert.ok(signed.some(call => call.text === normalizeForHash(text) && call.label === f.retained.label));
  assert.ok(signed.every(call => call.active === 0));
}

async function assertPersisted(f, operation, text, decoy) {
  const current = await allDigests(prepareCoreText(text), f.current);
  const retained = [
    f.expectedDigest(text),
    f.expectedDigest(text, "hosted-v1", 2),
    f.expectedDigest(prepareCoreText(text), "core", 3),
    f.expectedDigest(redactV1(text.normalize("NFKC"))),
  ];
  const digests = [...current, ...retained, ...retained.slice(0, 3).map(digest => ({
    ...digest, label: decoy.label, value: f.storedFact.text.digests[0].value,
  }))];
  const row = f.committed(scope.owner).rows.find(row => row.text === prepareCoreText(text));
  assert.deepEqual(row?.digests, digests);
  if (operation === "capture") {
    const finish = f.mutations.find(({ method }) => method === "capture.finish");
    assert.deepEqual(finish?.args[1][0]?.digests, digests);
  } else {
    const [, , query] = f.calls.find(([method]) => method === "memories.readWritePolicy");
    assert.deepEqual(query.digests, digests);
  }
}

for (const [operation, write] of Object.entries(operations)) {
  test(`${operation} admits a retained-domain miss and stores the labelled digests`, async () => {
    const f = await fixture({ factAtFinish: operation === "capture" });
    const decoy = { ...f.retained, label: "other-label", async mac() { return f.storedFact.text.digests[0].value; } };
    const unavailable = { ...f.retained, label: "unavailable-label", async mac() { throw new Error("unavailable"); } };
    f.provide([f.retained, decoy, unavailable]);
    assert.equal(await write(f, unrelated), "saved");
    assertSignerCalls(f, unrelated);
    await assertPersisted(f, operation, unrelated, decoy);
  });

  for (const [scenario, adapt] of [
    ["matching", f => [f.retained]],
    ["absent", () => undefined],
    ["wrong label", f => [{ ...f.retained, label: "other-label" }]],
    ["throwing", f => [{ ...f.retained, async mac() { throw new Error("private signer details"); } }]],
    ["non-string", f => [{ ...f.retained, async mac() { return [await f.retained.mac(canonical(unrelated))]; } }]],
  ]) {
    test(`${operation} withholds a candidate with a ${scenario} retained signer`, async () => {
      const f = await fixture({ factAtFinish: operation === "capture" });
      const digesters = adapt(f);
      if (digesters) f.provide(digesters);
      const text = scenario === "matching" ? forgotten : unrelated;
      assert.equal(await write(f, text), "suppressed");
      assert.deepEqual(f.committed(scope.owner).rows.map(row => row.id), [previous.id]);
    });
  }
}

test("capture admission scrubs the matching message and keeps the comparable miss", async () => {
  const f = await fixture();
  f.provide([f.retained]);
  assert.deepEqual(await f.service.enqueueCapture(scope, { ...selection, messages: [
    message("blocked", forgotten), message("allowed", unrelated),
  ] }), { status: "accepted" });
  assertSignerCalls(f, unrelated);
  const admitted = f.mutations.find(({ method }) => method === "capture.admit");
  assert.deepEqual(admitted?.args[1].map(({ content }) => content), ["", "  API_KEY=[REDACTED]   goes in the blue folder.  "]);
});

test("capture admission and save honour retained facts with a transaction-selected key", async () => {
  const admission = await fixture();
  admission.provide([admission.retained]);
  const signingKey = await crypto.subtle.importKey("raw", randomBytes(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const published = { id: randomBytes(8).toString("hex"), signingKey };
  const currentOnly = "Count the yellow binders before lunch.";
  const [currentDigest] = await allDigests(currentOnly, published);
  admission.seedFact({ ...admission.storedFact, actionId: "current-forget", text: { digests: [currentDigest] } });
  admission.storage.keys.userKey = async () => { throw new Error("admission must select the key in the write transaction"); };
  let admissionSelections = 0;
  admission.storage.keys.userKeyForWrite = async tx => {
    assert.equal(tx.owner, scope.owner);
    assert.equal(tx.options.pauseLock, true);
    admissionSelections++;
    return published;
  };
  const miss = "A blue envelope";
  assert.deepEqual(await admittedContent(admission, forgotten, currentOnly, miss), ["", "", miss]);
  assert.equal(admissionSelections, 1);
  assertSignerCalls(admission, miss);

  const save = await fixture();
  save.provide([save.retained]);
  let selected = published;
  let saveSelections = 0;
  save.storage.keys.userKeyForWrite = async tx => {
    assert.equal(tx.owner, scope.owner);
    assert.equal(tx.options.pauseLock, true);
    saveSelections++;
    return selected;
  };
  await assert.rejects(() => operations.save(save, miss), { code: "fingerprint_key_mismatch" });
  assert.deepEqual(save.committed(scope.owner).rows.map(row => row.id), [previous.id]);
  selected = save.current;
  assert.equal(await operations.save(save, forgotten), "suppressed");
  save.signerCalls.length = 0;
  assert.equal(await operations.save(save, miss), "saved");
  assert.equal(saveSelections, 3);
  assertSignerCalls(save, miss);
});

test("memory import resolves retained signers once across batches", async () => {
  const f = await fixture();
  f.provide([f.retained]);
  const rows = Array.from({ length: 101 }, (_, index) => ({ kind: "fact", text: `Inventory item ${index}` }));
  assert.deepEqual(await f.service.importMemories(scope, rows, source),
    { imported: rows.length, duplicate: 0, suppressed: 0, invalid: 0 });
  assert.deepEqual(f.signerCalls.filter(call => "owner" in call), [{ owner: scope.owner, active: 0 }]);
  assert.equal(f.signerCalls.filter(call => "text" in call).length, rows.length);
  assert.ok(f.signerCalls.every(call => call.active === 0));
});

test("labelled stored facts distinguish retained domains with the same key", async () => {
  const f = await fixture();
  const digest = f.expectedDigest(forgotten);
  const stored = { fact: { ...f.storedFact, text: { digests: [digest] } } };
  const compare = digests => factBlocksIncoming(stored, { scope, passages: [{ digests }] }, { mode: "capture" });
  assert.equal(compare([digest]), true);
  assert.equal(compare([f.expectedDigest(unrelated)]), false);
  for (const otherDomain of [
    { label: "other-label" }, { keyId: "other-key" }, { alg: "other-algorithm" },
    { pipeline: "core" }, { redactionVersion: 2 },
  ]) {
    assert.equal(compare([{ ...digest, ...otherDomain }]), "ineligible");
  }
  const historical = { fact: { ...f.storedFact, text: { digests: [f.storedDigest(forgotten)] } } };
  assert.equal(factBlocksIncoming(historical, { scope, passages: [{ digests: [{ ...digest, redactionVersion: 2 }] }] },
    { mode: "capture" }), "ineligible");
});

async function admittedContent(f, ...texts) {
  const messages = texts.map((text, index) => message("source-" + index, text));
  assert.deepEqual(await f.service.enqueueCapture(scope, { ...selection, messages }), { status: "accepted" });
  return f.mutations.find(({ method }) => method === "capture.admit")?.args[1].map(({ content }) => content);
}

const writesAndAdmission = {
  ...operations,
  admission: async (f, text) => (await admittedContent(f, text))[0] ? "saved" : "suppressed",
};

for (const [operation, write] of Object.entries(writesAndAdmission)) {
  test(`${operation} compares the retained MAC of the frozen V1 spelling directly`, async () => {
    const f = await fixture({ factAtFinish: true });
    const replay = `Saved example {"access_token":"prefix Bearer ${randomBytes(12).toString("hex")} suffix"}`;
    const v1 = redactV1(replay);
    const hosted = redactHostedCurrent(replay);
    assert.notEqual(normalizeForHash(v1), canonical(replay));
    f.storedFact.text.digests = [f.storedDigest(v1)];
    if (operation !== "capture") f.seedFact(f.storedFact);
    f.provide([f.retained]);

    assert.equal(await write(f, replay), "suppressed");
    const signed = f.signerCalls.filter(call => "text" in call);
    const spellings = new Set([replay, v1, hosted, prepareCoreText(replay)].map(normalizeForHash));
    assert.deepEqual(signed.map(call => call.text).sort(), [...spellings].sort());
    assertSignerCalls(f, replay);
  });
}

test("admission checks hosted-current facts and fails closed without a retained signer", async () => {
  for (const provide of [true, false]) {
    const f = await fixture({ factAtFinish: true });
    const replay = `Saved example {"access_token":"${randomBytes(12).toString("hex")}"}`;
    f.storedFact.text.digests = [f.storedDigest(redactHostedCurrent(replay), "hosted-v1", 2)];
    f.seedFact(f.storedFact);
    if (provide) f.provide([f.retained]);
    assert.deepEqual(await admittedContent(f, replay, "A blue envelope"), ["", provide ? "A blue envelope" : ""]);
  }
});

for (const [operation, write] of Object.entries(writesAndAdmission)) {
  test(`${operation} admits a retained exact miss against a full fact without shingles`, async () => {
    for (const [text, expected] of [["A blue envelope", "saved"], ["The red lens is boxed", "suppressed"]]) {
      const f = await fixture({ factAtFinish: true });
      f.storedFact.mode = "full";
      f.storedFact.text.digests = [f.storedDigest("the red lens is boxed")];
      if (operation !== "capture") f.seedFact(f.storedFact);
      f.provide([f.retained]);
      assert.equal(await write(f, text), expected);
    }
  });
}

test("rotated Core shingles filter admission and imports under the retained key", async () => {
  const f = serviceFake({ writes: true, forgetting: {}, capture: true });
  const signingKey = await crypto.subtle.importKey("raw", randomBytes(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const original = { id: randomBytes(8).toString("hex"), signingKey };
  const rotated = await f.storage.keys.userKey(scope.owner);
  f.storage.keys.userKey = async () => original;
  f.storage.capabilities.fingerprintKey = true;
  f.hooks.eligible = messages => messages.map((_, index) => index);
  const service = createMemoryService(f.deps);
  const [exact] = await allDigests(forgotten);
  f.insert({ ...memory("forgotten", { text: forgotten }), textHash: "sha256:" + exact.value });
  assert.equal((await service.forget(scope, "forgotten", source)).status, "forgotten");
  assert.ok(f.committed(scope.owner).facts.some(({ fact }) =>
    fact.kind === "text" && fact.mode === "full" && fact.text.shingles?.length > 0 && fact.text.keyId === original.id));
  f.storage.keys.userKey = async () => rotated;
  f.storage.keys.retainedDigesters = async () => [{
    alg: "hmac", label: "core", keyId: original.id,
    async mac(text) {
      const bytes = await crypto.subtle.sign("HMAC", signingKey, new TextEncoder().encode(text));
      return Buffer.from(bytes).toString("hex");
    },
  }];
  const disjoint = "A blue envelope";
  const contained = `Inventory note: ${forgotten} Count items before lunch.`;
  assert.deepEqual(await admittedContent({ ...f, service }, disjoint, forgotten, contained), [disjoint, "", ""]);
  assert.deepEqual(await service.importMemories(scope, [disjoint, forgotten, contained].map(text => ({ kind: "fact", text })), source),
    { imported: 1, duplicate: 0, suppressed: 2, invalid: 0 });
});

test("an unlabelled MAC miss stays comparable when a second historical domain is unavailable", async () => {
  const f = await fixture();
  const { label: _label, ...core } = f.expectedDigest(forgotten, "core", 3);
  const hosted = { ...f.storedDigest("The other spelling"), keyId: randomBytes(8).toString("hex") };
  const stored = { fact: { ...f.storedFact, text: { digests: [core, hosted] } } };
  const digests = [{ ...core, value: f.storedDigest(unrelated).value }];
  assert.equal(factHidesRow(stored, { scope, memoryId: "row", digests }), false);
  assert.equal(factBlocksIncoming(stored, { scope, passages: [{ digests }] }, { mode: "capture" }), false);
});

test("a retained-signer lookup failure surfaces only a CoreError", async () => {
  const f = await fixture();
  f.storage.keys.retainedDigesters = async () => { throw new Error("private lookup details"); };
  await assert.rejects(() => f.service.save(scope, unrelated, source),
    error => error instanceof CoreError && error.message === error.code && !error.cause);
});
