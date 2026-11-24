import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";
import { allDigests, CoreError, factBlocksIncoming, normalizeForHash, prepareCoreText } from "@cairn-ink/core";
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
  const storedDigest = text => ({ alg: retained.alg, keyId, value: sign(canonical(text)),
    pipeline: "hosted-v1", redactionVersion: 1 });
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
  function expectedDigest(text) {
    return { alg: retained.alg, keyId, label: retained.label, value: sign(canonical(text)),
      pipeline: "core", redactionVersion: 3 };
  }
  return { ...fake, current, retained, storedFact, expectedDigest, provide, signerCalls: calls,
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
  assert.ok(signed.every(call => call.active === 0 && !call.text.includes(secret)));
}

async function assertPersisted(f, operation, text, extra = []) {
  const current = await allDigests(prepareCoreText(text), f.current);
  const digests = [...current, f.expectedDigest(text), ...extra];
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
    await assertPersisted(f, operation, unrelated, [{
      ...f.expectedDigest(unrelated), label: decoy.label, value: f.storedFact.text.digests[0].value,
    }]);
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
  for (const otherDomain of [{ label: "other-label" }, { keyId: "other-key" }, { alg: "other-algorithm" }]) {
    assert.equal(compare([{ ...digest, ...otherDomain }]), "ineligible");
  }
});

test("a retained-signer lookup failure surfaces only a CoreError", async () => {
  const f = await fixture();
  f.storage.keys.retainedDigesters = async () => { throw new Error("private lookup details"); };
  await assert.rejects(() => f.service.save(scope, unrelated, source),
    error => error instanceof CoreError && error.message === error.code && !error.cause);
});
