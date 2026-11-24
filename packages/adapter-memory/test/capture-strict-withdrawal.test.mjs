import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
// Use the same Core module instance as the shared scenarios so it recognizes the strict port error.
import { CoreError } from "../../core/src/index.mjs";
import { createMemoryService } from "../../core/src/service/index.mjs";
import { assertDeletedBeforeItemEmbedding } from "../../core/test/helpers/capture-item-withdrawal.mjs";
import { assertDeletedCapture, deletionTimings } from "../../core/test/helpers/service-capture-withdrawal.mjs";
import { hostedScope as scope, serviceFake } from "../../core/test/helpers/service-fake.mjs";

function strictAdapter(t, documentCards = false) {
  const storage = createMemoryAdapter({ capabilities: { rawArchive: true, documentCards } });
  const { claim, assertEligible } = storage.capture;
  let claimedContents;
  const staleAssertions = [];
  storage.capture.claim = async (tx, key, messages, options) => {
    const result = await claim(tx, key, messages, options);
    if (result.status === "claimed") claimedContents = messages.map(({ content }) => content);
    return result;
  };
  storage.capture.assertEligible = async (tx, key, positions) => {
    if (positions.length) {
      const { scope, client, sessionId, eventId } = key;
      const current = await storage.capture.load(tx, { scope, client, sessionId, eventId });
      const stale = positions.filter(position => {
        const content = current?.messages[position]?.content;
        return !content || content !== claimedContents?.[position];
      });
      if (stale.length) {
        staleAssertions.push(...stale);
        throw new CoreError("suppressed");
      }
    }
    return assertEligible(tx, key, positions);
  };
  // The send refresh translates suppressed into ingest_inputs_changed. Check what Core actually asserted.
  t.after(() => assert.deepEqual(staleAssertions, [], "Core asserted withdrawn positions"));
  return storage;
}

async function storedRows(storage) {
  const [{ rows, rawRows }] = await storage.harness.dump();
  return { memories: rows, raw: rawRows };
}

for (const [timing, boundary] of Object.entries(deletionTimings)) {
  test(`strict capture withdraws deleted text ${boundary}`, async t => {
    const storage = strictAdapter(t);
    await assertDeletedCapture(storage, timing, () => storedRows(storage));
  });
}

test("strict capture withholds item embeddings after deletion during extraction", async t => {
  const storage = strictAdapter(t);
  await assertDeletedBeforeItemEmbedding(storage);
  assert.deepEqual(await storedRows(storage), { memories: [], raw: [] });
});

const event = { client: "client", sessionId: "plan-session", eventId: "plan-event" };
const plan = { id: "plan", role: "user", occurredAtMs: Date.UTC(2025, 0, 1), content: "Remember this maintenance plan. " +
  "The hatch opens at 8 each morning. ".repeat(7).trimEnd() };
const sha256Hex = async text => createHash("sha256").update(text).digest("hex");

test("strict capture sizes and sends only unchanged sources after an edit before dispatch", async t => {
  const storage = strictAdapter(t);
  const { deps } = serviceFake({ writes: true, capture: true, hasKey: false });
  const { claim, load } = storage.capture;
  let edited = false;
  storage.capture.claim = async (...args) => {
    const result = await claim(...args);
    if (result.status === "claimed") edited = true;
    return result;
  };
  // Model an outbox edit in the read port, shared by Core and the strict assertion.
  storage.capture.load = async (...args) => {
    const current = await load(...args);
    if (edited && current) current.messages[0].content = "The revised plan starts tomorrow.";
    return current;
  };
  const unchanged = { ...plan, id: "orchids", content: "Water the orchids on Mondays." };
  const requests = [];
  const tokenInputs = [];
  const service = createMemoryService({
    ...deps, storage, clock: { ...deps.clock, sha256Hex },
    model: { ...deps.model,
      countTokens(text) { tokenInputs.push(text); return 1; },
      async call(_stage, { input }) {
        requests.push(input.messages.map(({ content }) => content));
        return { items: [] };
      },
    },
  });
  assert.deepEqual(await service.enqueueCapture(scope, { ...event, messages: [plan, unchanged] }), { status: "accepted" });

  assert.equal((await service.runCapture(scope, event)).status, "done");
  assert.deepEqual(requests, [[unchanged.content]]);
  assert.ok(tokenInputs.length > 0 && tokenInputs.every(text => !text.includes(plan.content)));
  const { memories, raw } = await storedRows(storage);
  assert.deepEqual(memories, []);
  assert.deepEqual(raw.map(({ content }) => content), [unchanged.content]);
});

for (const timing of ["after claim", "before card screening", "during card embedding"]) {
  test(`strict card-only capture withdraws a conversation deleted ${timing}`, async t => {
    const storage = strictAdapter(t, true);
    const { deps } = serviceFake({ writes: true, capture: true, hasKey: false });
    const { load, claim, eligible } = storage.capture;
    const { run } = storage.uow;
    const read = work => run(scope.owner, { readOnly: true }, work);
    const write = work => run(scope.owner, { pauseLock: true }, work);
    let deleteAfterTx;
    let deleted = false;
    let claimed = false;
    let eligibilityReads = 0;
    const prearchived = timing === "during card embedding";
    async function deleteConversation() {
      assert.deepEqual(await write(tx => storage.raw.deleteConversation(tx, scope, event)), { rawDeleted: prearchived ? 1 : 0 });
      assert.equal((await read(tx => load(tx, { scope, ...event }))).messages[0].content, "");
      deleted = true;
    }
    storage.capture.claim = async (tx, ...args) => {
      const result = await claim(tx, ...args);
      if (result.status === "claimed") {
        claimed = true;
        if (timing === "after claim") deleteAfterTx = tx;
      }
      return result;
    };
    storage.capture.eligible = async (tx, ...args) => {
      const result = await eligible(tx, ...args);
      // Claim reads eligibility first. The next read selects the sources for card embedding.
      if (claimed && ++eligibilityReads === 2 && timing === "before card screening") deleteAfterTx = tx;
      return result;
    };
    storage.uow.run = async (owner, options, work) => {
      let tx;
      const result = await run(owner, options, current => {
        tx = current;
        return work(current);
      });
      if (tx === deleteAfterTx) await deleteConversation();
      return result;
    };
    const embedded = [];
    const service = createMemoryService({
      ...deps, storage, model: null, config: { documentCards: { enabled: true } },
      clock: { ...deps.clock, sha256Hex },
      embedder: { ...deps.embedder, async embed(texts) {
        embedded.push(...texts);
        return texts.map(() => Float32Array.of(1));
      } },
      gate: { async assertOpen(owner, phase) {
        assert.equal(owner, scope.owner);
        if (prearchived && phase === "pre-send" && !deleted) await deleteConversation();
      } },
    });

    assert.deepEqual(await service.enqueueCapture(scope, { ...event, messages: [plan] }), { status: "accepted" });
    if (prearchived) await write(async tx => {
      const { key, messages } = await load(tx, { scope, ...event });
      assert.deepEqual(await storage.raw.archive(tx, key, messages), { archived: 1 });
    });

    const done = await service.runCapture(scope, event);
    assert.equal(deleted, true, "The deletion must commit at the requested boundary");
    if (!prearchived) assert.deepEqual(embedded, [], "Deleted source produced a card embedding request");
    assert.equal(done.status, "done");
    assert.deepEqual(done.result.memories, []);
    assert.deepEqual(await read(tx => storage.documentCards.list(tx, scope)), []);
    assert.deepEqual(await storedRows(storage), { memories: [], raw: [] });
  });
}
