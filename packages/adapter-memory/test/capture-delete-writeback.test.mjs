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
      await t.test(`finishes at the ${phase}-stage recheck with no memories`, () => {
        assert.equal(interrupted.status, "done");
        assert.equal(interrupted.result.memories.length, 0);
      });

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
  await t.test("assertEligible rejects a stored resend of deleted text with suppressed", async () => {
    // The resend's text looks unchanged, so only the delete tombstone can reject it.
    await admitAndClaim(f, resent, messages);
    await assert.rejects(write(tx => capture.assertEligible(tx, resent, [0])), { code: "suppressed" },
      "assertEligible accepted deleted text in a new event");
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

async function rawVisibility({ storage, read }, { client, sessionId }, batch) {
  const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
  return read(async tx => {
    const query = batch.map(({ content }) => content).join(" ");
    const { turns } = await storage.contextRead.raw.search(tx, readSet, query, { limit: 10, lexicalOnly: true });
    const withheld = await Promise.all(batch.map(({ id, content, role, occurredAtMs }) =>
      storage.suppressions.receiptWithheld(tx, scope, { client, sessionId, messageId: id, role,
        occurredAtMs, excerpt: content })));
    return { messageIds: turns.map(({ messageId }) => messageId).sort(), withheld };
  });
}

test("resending a deleted conversation keeps different text at the same message ID visible", async () => {
  const f = fixture({ contextRead: true, contextRawRead: true });
  const service = captureService(f.storage);
  assert.deepEqual(await service.enqueueCapture(scope, { ...target, messages }), { status: "accepted" });
  assert.deepEqual(await f.remove(), { rawDeleted: 0 });
  const resend = { ...target, eventId: resent.eventId };
  assert.deepEqual(await service.enqueueCapture(scope, { ...resend, messages }), { status: "accepted" });
  const replay = await service.runCapture(scope, resend);
  assert.equal(replay.status, "done");
  assert.equal(replay.result.memories.length, 0);

  const batch = [controlMessage];
  assert.deepEqual(await service.enqueueCapture(scope, { ...control, messages: batch }), { status: "accepted" });
  const result = await service.runCapture(scope, control);
  assert.equal(result.status, "done");
  assert.equal(result.result.memories.length, 1);
  assert.deepEqual((await f.page()).items.map(({ sessionId, content }) => [sessionId, content]),
    [[control.sessionId, controlMessage.content]]);
  assert.deepEqual(await rawVisibility(f, control, batch), { messageIds: [controlMessage.id], withheld: [false] });
});

test("explicitly importing ledger-only deleted messages is refused and their receipts stay withheld", async () => {
  const f = fixture({ contextRead: true, contextRawRead: true });
  const service = captureService(f.storage);
  assert.deepEqual(await service.enqueueCapture(scope, { ...target, messages }), { status: "accepted" });
  assert.deepEqual(await f.remove(), { rawDeleted: 0 });
  const { client, sessionId } = target;
  assert.deepEqual(await service.importRawMessages(scope, [{ client, sessionId, messages }]),
    { imported: 0, duplicate: 0, suppressed: 2, invalid: 0 });
  assert.deepEqual((await f.page()).items, []);
  assert.deepEqual(await rawVisibility(f, target, messages), { messageIds: [], withheld: [true, true] });
});

for (const prearchived of [false, true]) {
  test(`deleting a directly claimed conversation prevents writeback ${prearchived ? "with" : "without"} prearchived Raw`, async () => {
    const { storage: { capture, raw, harness }, read, write, remove, page } = fixture();
    const [message] = messages;
    const batch = [message];
    if (prearchived) assert.deepEqual(await write(tx => raw.archive(tx, key, batch)), { archived: 1 });
    const claim = await write(tx => capture.claim(tx, key, batch, { leaseMs: 60_000 }));
    assert.equal(claim.status, "claimed");
    assert.equal(await read(tx => capture.load(tx, key)), null);
    await write(tx => capture.beginDispatch(tx, claim.token));
    assert.deepEqual(await remove(), { rawDeleted: prearchived ? 1 : 0 });

    const content = extracted.get(message.content);
    const textHash = "sha256:" + createHash("sha256").update(content.toLowerCase()).digest("hex");
    const { client, sessionId } = key;
    const { id: messageId, role, occurredAtMs } = message;
    const item = { content, kind: "fact", confidence: 1, embedding: null, textHash,
      receipts: [{ client, sessionId, messageId, role, occurredAtMs }] };
    await assert.rejects(write(async tx => {
      await capture.assertEligible(tx, key, [0]);
      await capture.finish(tx, claim.token, [item]);
      await raw.archive(tx, key, batch);
    }), { code: "suppressed" });
    const [{ rows }] = await harness.dump();
    assert.deepEqual(rows, []);
    assert.deepEqual((await page()).items, []);
  });
}

async function textPurgeFact(message) {
  return {
    factId: "fact", incarnation: "test", epoch: 1n, createdAtMs: 1,
    fact: { ...scope, actionId: "purge", kind: "text", mode: "exact", origin: "forget",
      text: { digests: [await coreDigest(message.content)] } },
  };
}

test("deleting an already blank ledger slot stops writeback from the loaded text", async () => {
  const { storage, write, page } = fixture();
  const [message] = messages;
  const fact = await textPurgeFact(message);
  let purged, erased;
  const service = captureService(storage, { async duringModel() {
    purged = await write(tx => storage.raw.purgeWithheld(tx, scope, [fact]));
    erased = await write(tx => storage.raw.eraseSessions(tx, scope, [target]));
  } });
  assert.deepEqual(await service.enqueueCapture(scope, { ...target, messages: [message] }), { status: "accepted" });
  const result = await service.runCapture(scope, target);
  assert.deepEqual(purged, { rawDeleted: 0, ledgerBlanked: 1 });
  assert.deepEqual(erased, { rawDeleted: 0, ledgerBlanked: 0 });
  assert.equal(result.status, "done");
  assert.equal(result.result.memories.length, 0);
  const [{ rows }] = await storage.harness.dump();
  assert.deepEqual(rows, []);
  assert.deepEqual((await page()).items, []);
});

test("a ledger slot blanked by text purge alone stays eligible", async () => {
  const f = fixture();
  const { storage: { capture, raw }, read, write } = f;
  await admitAndClaim(f, key, messages);
  const stored = await textPurgeFact(messages[0]);
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

test("recording original text after deletion preserves a cross-namespace lineage fence", async () => {
  const { storage, write, remove } = fixture();
  const { raw, harness } = storage;
  assert.deepEqual(await write(tx => raw.archive(tx, key, messages)), { archived: 2 });
  assert.deepEqual(await remove(), { rawDeleted: 2 });
  await write(tx => raw.recordLineage(tx, key, messages));
  await write(tx => raw.fenceSession(tx, scope, target));

  const forkScope = { ...scope, namespace: "fork" };
  const service = captureService(storage);
  assert.deepEqual(await service.enqueueCapture(forkScope, { ...control, messages }), { status: "accepted" });
  const result = await service.runCapture(forkScope, control);
  assert.equal(result.status, "done");
  const [{ rows, rawRows }] = await harness.dump();
  assert.deepEqual({ memories: result.result.memories.length, rows: rows.length, rawRows: rawRows.length },
    { memories: 0, rows: 0, rawRows: 0 });
});

test("deletion prevents writeback after a direct claim ends", async t => {
  await t.test("a retryable abandonment blocks writeback on reclaim", async () => {
    const { storage: { capture, raw, harness }, write, remove } = fixture();
    const claim = await write(tx => capture.claim(tx, key, messages, { leaseMs: 60_000 }));
    assert.equal(claim.status, "claimed");
    await write(tx => capture.abandon(tx, claim.token, { code: "extraction_failed", retryable: true }));
    assert.deepEqual(await remove(), { rawDeleted: 0 });

    const retry = await write(tx => capture.claim(tx, key, messages, { leaseMs: 60_000 }));
    assert.equal(retry.status, "claimed");
    await write(tx => capture.beginDispatch(tx, retry.token));
    const [{ id: messageId, role, occurredAtMs, content: source }] = messages;
    const { client, sessionId } = key;
    const content = extracted.get(source);
    const item = { content, kind: "fact", confidence: 1, embedding: null,
      textHash: "sha256:" + createHash("sha256").update(content.toLowerCase()).digest("hex"),
      receipts: [{ client, sessionId, messageId, role, occurredAtMs }] };
    await assert.rejects(write(async tx => {
      await capture.assertEligible(tx, key, [0, 1]);
      await capture.finish(tx, retry.token, [item]);
      await raw.archive(tx, key, messages);
    }), { code: "suppressed" });
    const [{ rows, rawRows }] = await harness.dump();
    assert.deepEqual({ rows, rawRows }, { rows: [], rawRows: [] });
  });

  await t.test("an empty finish keeps a fresh event from restoring the messages", async () => {
    const { storage, write, remove } = fixture();
    const { capture, harness } = storage;
    const claim = await write(tx => capture.claim(tx, key, messages, { leaseMs: 60_000 }));
    assert.equal(claim.status, "claimed");
    const finished = await write(tx => capture.finish(tx, claim.token, []));
    assert.deepEqual(finished.memories, []);
    assert.deepEqual(await remove(), { rawDeleted: 0 });

    const service = captureService(storage);
    const fresh = { ...target, eventId: resent.eventId };
    assert.deepEqual(await service.enqueueCapture(scope, { ...fresh, messages }), { status: "accepted" });
    const result = await service.runCapture(scope, fresh);
    assert.equal(result.status, "done");
    const [{ rows, rawRows }] = await harness.dump();
    assert.deepEqual({ memories: result.result.memories.length, rows: rows.length, rawRows: rawRows.length },
      { memories: 0, rows: 0, rawRows: 0 });
  });
});
