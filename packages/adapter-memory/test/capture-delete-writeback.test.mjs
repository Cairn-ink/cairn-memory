import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { coreDigest } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";

const scope = { owner: "owner", namespace: null };
const target = { client: "client", sessionId: "target", eventId: "capture" };
const control = { ...target, sessionId: "control", eventId: "control-capture" };
const messages = [
  { id: "first", role: "user", content: "The footpath crosses a stone bridge.", occurredAtMs: 10 },
  { id: "second", role: "user", content: "The copper kettle is on the shelf.", occurredAtMs: 20 },
];
const controlMessage = { ...messages[0], content: "The oak table has four legs.", occurredAtMs: 30 };
const extracted = new Map([
  [messages[0].content, "The route passes over water."],
  [messages[1].content, "The shelf holds cookware."],
  [controlMessage.content, "The dining furniture has four supports."],
]);
const key = { ...target, scope, payloadDigest: "a".repeat(64) };

function fixture(capabilities = {}) {
  const storage = createMemoryAdapter({ capabilities: { rawArchive: true, ...capabilities } });
  const { raw, uow } = storage;
  const read = work => uow.run(scope.owner, { readOnly: true }, work);
  const write = work => uow.run(scope.owner, { pauseLock: true }, work);
  const page = () => read(tx => raw.listRaw(tx, { owner: scope.owner, namespaces: [scope.namespace] },
    { limit: 10, cursor: null }));
  const remove = () => write(tx => raw.deleteConversation(tx, scope, target));
  return { storage, read, write, page, remove };
}

function captureService(storage, { duringModel, duringEmbedding } = {}) {
  return createMemoryService({
    storage,
    model: {
      model: "test", contextWindow: 16_384, countTokens: () => 1,
      async call(_stage, { input }) {
        await duringModel?.();
        return { items: input.messages.map(({ index, content }) => ({
          kind: "fact", content: extracted.get(content), confidence: 0.9, sourceIndices: [index],
        })) };
      },
    },
    embedder: {
      model: "test", dimensions: 1,
      async embed(inputs) {
        await duringEmbedding?.();
        return inputs.map(() => Float32Array.of(1));
      },
    },
    gate: { async assertOpen() {} },
    clock: {
      nowMs: () => 100, monotonicMs: () => 100,
      async sha256Hex(text) { return createHash("sha256").update(text).digest("hex"); },
      async hmacHex(secret, text) { return createHmac("sha256", secret).update(text).digest("hex"); },
    },
    tokens: { countTokens: () => 1 },
    config: {},
  });
}

for (const phase of ["model", "embedding"]) {
  for (const prearchived of [true, false]) {
    test(`capture deletion during ${phase} with ${prearchived ? "prearchived" : "ledger-only"} messages`, async t => {
      const { storage, write, page, remove } = fixture();
      let deletion;
      async function deleteDuringCapture() {
        deletion ??= await remove();
      }
      const service = captureService(storage, {
        duringModel: phase === "model" ? deleteDuringCapture : undefined,
        duringEmbedding: phase === "embedding" ? deleteDuringCapture : undefined,
      });
      if (prearchived) {
        const earlier = { ...key, eventId: "earlier" };
        assert.deepEqual(await write(tx => storage.raw.archive(tx, earlier, messages)), { archived: 2 });
      }
      assert.deepEqual(await service.enqueueCapture(scope, { ...target, messages }), { status: "accepted" });
      const interrupted = await service.runCapture(scope, target);
      assert.deepEqual(deletion, { rawDeleted: prearchived ? 2 : 0 }, "Deletion must commit during the selected callback");

      const dump = await storage.harness.dump();
      const [{ rows, rawRows }] = dump;
      await t.test("saves no memory from the deleted conversation", () => {
        assert.equal(rows.length, 0, "Capture saved memories from deleted messages");
      });
      await t.test("lists no Raw rows from the deleted conversation", async () => {
        assert.equal((await page()).items.length, 0, "Capture returned deleted messages to listRaw");
      });
      await t.test("stores no Raw rows from the deleted conversation", () => {
        assert.equal(rawRows.length, 0, "Capture wrote deleted messages back into Raw");
      });
      await t.test("removes both source texts from the dump and ledger", () => {
        const serialized = JSON.stringify(dump);
        assert.deepEqual(messages.filter(({ content }) => serialized.includes(content)).map(({ id }) => id),
          [], "The dump still contains deleted source text");
      });
      if (phase === "embedding") {
        await t.test("suppresses capture at the final eligibility check", () => {
          assert.deepEqual(interrupted, { status: "failed", code: "suppressed" });
        });
      }

      assert.deepEqual(await service.enqueueCapture(scope, { ...control, messages: [controlMessage] }),
        { status: "accepted" });
      const result = await service.runCapture(scope, control);
      assert.equal(result.status, "done");
      assert.equal(result.result.memories.length, 1);
      const [stored] = await storage.harness.dump();
      assert.deepEqual(stored.rows.filter(({ row }) => row.source.sessionId === control.sessionId).map(({ row }) => row.text),
        [extracted.get(controlMessage.content)]);
      assert.deepEqual((await page()).items.filter(({ sessionId }) => sessionId === control.sessionId)
        .map(({ messageId, content }) => [messageId, content]), [[controlMessage.id, controlMessage.content]]);
    });
  }
}

async function admitAndClaim({ storage: { capture }, write }, selection, batch) {
  await write(async tx => {
    assert.deepEqual(await capture.admit(tx, selection, batch), { status: "admitted" });
    assert.equal((await capture.claim(tx, selection, batch, { leaseMs: 60_000 })).status, "claimed");
  });
}

const resent = { ...key, eventId: "resend", payloadDigest: "b".repeat(64) };

test("deleting a conversation withdraws its ledger messages from capture", async t => {
  const f = fixture();
  const { storage: { capture, suppressions }, read, write, remove } = f;
  await admitAndClaim(f, key, messages);
  const [{ id: messageId, role, occurredAtMs, content: excerpt }] = messages;
  const { client, sessionId } = key;
  const receipt = { client, sessionId, messageId, role, occurredAtMs, excerpt };
  const receiptWithheld = () => read(tx => suppressions.receiptWithheld(tx, scope, receipt));
  assert.equal(await receiptWithheld(), false);
  assert.deepEqual(await remove(), { rawDeleted: 0 });

  await t.test("blanks the stored ledger slots", async () => {
    const stored = await read(tx => capture.load(tx, key));
    assert.deepEqual(stored.messages, messages.map(message => ({ ...message, content: "" })),
      "The stored ledger must retain slot identities and blank their text");
  });
  await t.test("eligible excludes withdrawn slots with the original batch", async () => {
    assert.deepEqual(await read(tx => capture.eligible(tx, key, messages)), [],
      "eligible accepted a withdrawn position");
  });
  await t.test("eligible excludes withdrawn addresses before a resend is admitted", async () => {
    assert.deepEqual(await read(tx => capture.eligible(tx, resent, messages)), [],
      "eligible accepted deleted text in a new event");
  });
  await t.test("assertEligible rejects a withdrawn position with suppressed", async () => {
    await assert.rejects(write(tx => capture.assertEligible(tx, key, [0])), { code: "suppressed" },
      "assertEligible accepted a withdrawn position");
  });
  await t.test("withholds receipts for withdrawn ledger-only messages", async () => {
    assert.equal(await receiptWithheld(), true);
  });
  await t.test("the same message ID in another session stays eligible", async () => {
    const controlKey = { ...key, ...control };
    await admitAndClaim(f, controlKey, [controlMessage]);
    assert.deepEqual(await read(tx => capture.eligible(tx, controlKey, [controlMessage])), [0]);
    await write(tx => capture.assertEligible(tx, controlKey, [0]));
  });
});

test("deleting a Raw-only message withdraws its address from a new event", async t => {
  const f = fixture();
  const { storage: { capture, raw }, read, write, remove } = f;
  assert.deepEqual(await write(tx => raw.archive(tx, key, messages)), { archived: 2 });
  assert.deepEqual(await remove(), { rawDeleted: 2 });
  await admitAndClaim(f, resent, messages);
  await t.test("eligible excludes deleted addresses whose new slots contain text", async () => {
    assert.deepEqual(await read(tx => capture.eligible(tx, resent, messages)), [],
      "eligible accepted deleted Raw addresses");
  });
  await t.test("assertEligible rejects a nonblank slot at a deleted address", async () => {
    await assert.rejects(write(tx => capture.assertEligible(tx, resent, [0])), { code: "suppressed" },
      "assertEligible accepted a deleted Raw address");
  });
});

test("a ledger slot blanked by text purge alone stays eligible", async () => {
  const f = fixture();
  const { storage: { capture, raw }, read, write } = f;
  await admitAndClaim(f, key, messages);
  const stored = {
    factId: "fact", incarnation: "test", epoch: 1n, createdAtMs: 1,
    fact: { ...scope, actionId: "purge", kind: "text", mode: "exact", origin: "forget",
      text: { digests: [await coreDigest(messages[0].content)] } },
  };
  assert.deepEqual(await write(tx => raw.purgeWithheld(tx, scope, [stored])), { rawDeleted: 0, ledgerBlanked: 1 });
  const { messages: batch } = await read(tx => capture.load(tx, key));
  assert.deepEqual(batch, [{ ...messages[0], content: "" }, messages[1]]);
  assert.deepEqual(await read(tx => capture.eligible(tx, key, batch)), [0, 1]);
  await write(tx => capture.assertEligible(tx, key, [0, 1]));
});

test("a message whose captured memory was forgotten stays eligible", async () => {
  const f = fixture({ rawArchive: false, inspect: true });
  const { storage, read, write } = f;
  const { capture } = storage;
  const service = captureService(storage);
  const [message] = messages;
  const batch = [message];
  assert.deepEqual(await service.enqueueCapture(scope, { ...target, messages: batch }), { status: "accepted" });
  const result = await service.runCapture(scope, target);
  assert.equal(result.status, "done");
  const [{ rows: [{ receipts }] }] = await storage.harness.dump();
  assert.deepEqual(receipts.map(({ messageId }) => messageId), [message.id]);
  const receipt = { ...receipts[0], excerpt: message.content };
  const receiptWithheld = () => read(tx => storage.suppressions.receiptWithheld(tx, scope, receipt));
  assert.equal(await receiptWithheld(), false);
  const forgotten = await service.forget(scope, result.result.memories[0].id,
    { kind: "web", client: null, sessionId: null });
  assert.equal(forgotten.status, "forgotten");
  assert.equal(await receiptWithheld(), true);
  await admitAndClaim(f, resent, batch);
  assert.deepEqual(await read(tx => capture.eligible(tx, resent, batch)), [0]);
  await write(tx => capture.assertEligible(tx, resent, [0]));
});
