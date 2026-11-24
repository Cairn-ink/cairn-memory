import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { captureSendFake, captureSendTrace, providerCalls } from "./helpers/service-capture-send-refresh.mjs";
import { selection } from "./helpers/service-capture-trace.mjs";
import { hostedScope as scope } from "./helpers/service-fake.mjs";

const source = { kind: "mcp", client: null, sessionId: null };
const withheld = { id: "lantern", role: "user", content: "Store the lantern under the stairs.", occurredAtMs: 100 };
const remaining = { id: "orchids", role: "user", content: "Water the orchids on Mondays.", occurredAtMs: 200 };

async function setup(saveSource = false) {
  const fake = captureSendFake({ forgetting: {} });
  fake.storage.capabilities.fingerprintKey = true;
  const service = createMemoryService(fake.deps);
  const saved = saveSource ? await service.save(scope, withheld.content, source) : null;
  if (saved) assert.equal(saved.status, "saved");
  assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages: [withheld, remaining] }),
    { status: "accepted" });
  fake.calls.length = 0;
  fake.mutations.length = 0;
  fake.hooks.model = (_, { input }) => ({ items: input.messages.map(({ content, index }) =>
    ({ content, kind: "instruction", confidence: 0.9, sourceIndices: [index] })) });
  return { ...fake, service, saved, run: () => service.runCapture(scope, selection) };
}

const extractionInputs = fake => fake.calls.filter(([method]) => method === "model.call")
  .map(([, , { input }]) => input.messages.map(({ content }) => content));

function afterSendGeneration(fake, work) {
  const { uow } = fake.storage;
  const run = uow.run;
  uow.run = async (...args) => {
    const start = fake.calls.length;
    const [method, , phase] = fake.calls.at(-1) ?? [];
    const result = await run(...args);
    if (method === "gate" && phase === "pre-send") {
      assert.deepEqual(fake.calls.slice(start).map(([method]) => method), ["run", "lock", "lock", "pause.get"]);
      assert.ok(fake.mutations.some(({ method }) => method === "capture.beginDispatch"));
      await work(args[0]);
    }
    return result;
  };
}

for (const change of ["text forget", "forget window"]) {
  test(`a ${change} committed after the send-generation check prevents the stale send and allows a retry`, async () => {
    const fake = await setup(change === "text forget");
    let committed = false;
    afterSendGeneration(fake, async owner => {
      if (committed) return;
      if (change === "text forget") {
        assert.equal((await fake.service.forget(scope, fake.saved.item.id, source)).status, "forgotten");
      } else {
        await fake.storage.uow.run(owner, { pauseLock: true }, tx => fake.storage.suppressions.writeFact(tx, {
          ...scope, kind: "window", origin: "forget", actionId: "forget-window",
          client: selection.client, window: { startMs: 90, endMs: 110 },
        }, "fixture"));
      }
      committed = true;
    });

    const attempt = await fake.run();
    assert.equal(committed, true);
    assert.deepEqual(extractionInputs(fake), []);
    assert.deepEqual(attempt, { status: "failed", code: "ingest_inputs_changed" });
    assert.deepEqual(fake.mutations.find(({ method }) => method === "capture.abandon").args,
      ["dispatch-2", { code: "ingest_inputs_changed", retryable: true }]);
    assert.deepEqual(await fake.service.captureStatus(scope, selection.eventId), { status: "pending" });

    const retry = await fake.run();
    assert.equal(retry.status, "done");
    assert.equal(retry.result.memories.length, 1);
    assert.deepEqual(extractionInputs(fake), [[remaining.content]]);
    assert.deepEqual(fake.archived(scope.owner), [remaining]);
  });
}

test("a forget committed while the dispatch gate is pending is enforced at finish", async () => {
  const fake = await setup(true);
  const derived = "Use the space beneath the staircase for storage.";
  // Let Core's finish-time passage screen decide whether the derived item can use this source.
  fake.hooks.eligible = batch => batch.map((_, position) => position);
  const model = fake.hooks.model;
  fake.hooks.model = (...args) => ({ items: model(...args).items.map(item =>
    item.content === withheld.content ? { ...item, content: derived } : item) });
  const assertOpen = fake.deps.gate.assertOpen;
  let committed = false;
  async function forgetWhilePending(owner, phase) {
    assert.equal((await fake.service.forget(scope, fake.saved.item.id, source)).status, "forgotten");
    committed = true;
    return assertOpen(owner, phase);
  }
  fake.deps.gate.assertOpen = (owner, phase) => phase === "dispatch" && !committed
    ? forgetWhilePending(owner, phase) : assertOpen(owner, phase);

  const result = await fake.run();
  assert.equal(committed, true);
  assert.deepEqual(extractionInputs(fake), [[withheld.content, remaining.content]]);
  assert.ok(fake.calls.some(([method, texts]) => method === "embed" && texts.includes(derived.toLowerCase())));
  assert.equal(result.status, "done");
  assert.equal(result.result.memories.length, 1);
  assert.deepEqual(fake.committed(scope.owner).rows.map(({ text }) => text), [remaining.content]);
  assert.deepEqual(fake.archived(scope.owner), [remaining]);
});

test("an unchanged capture sends the same provider trace as the base", async () => {
  const { calls } = await captureSendTrace(createMemoryService);
  const trace = providerCalls(calls);
  assert.deepEqual(trace.map(([method]) => method), ["model.countTokens", "model.call", "model.options", "embed"]);
  // Base trace verified by tools/testing/service-capture-send-refresh.qualification.mjs.
  assert.equal(createHash("sha256").update(JSON.stringify(trace)).digest("hex"),
    "d482afe0a14ffe18c5255c41d7c365082d99af1ad3517dac2d2a27e99fc9ac48");
});

test("a storage error in the final refresh passes through and prevents the send", async () => {
  const fake = await setup();
  afterSendGeneration(fake, () => {
    fake.hooks.snapshot = () => { throw new CoreError("storage_error"); };
  });

  assert.deepEqual(await fake.run(), { status: "failed", code: "storage_error" });
  assert.deepEqual(providerCalls(fake.calls), []);
  assert.deepEqual(fake.mutations.find(({ method }) => method === "capture.abandon").args,
    ["dispatch-2", { code: "storage_error", retryable: true }]);
  assert.deepEqual(await fake.service.captureStatus(scope, selection.eventId), { status: "pending" });
});
