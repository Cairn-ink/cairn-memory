import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createMemoryService } from "@cairn-ink/core/service";

export const scope = { owner: "owner", namespace: null };
const selection = { client: "client", sessionId: "session", eventId: "event" };
const lookup = { scope, ...selection };
const sources = [
  { id: "lantern", role: "user", content: "Store the lantern under the stairs.", occurredAtMs: 10 },
  { id: "orchids", role: "user", content: "Water the orchids on Mondays.", occurredAtMs: 20 },
];
const contents = sources.map(({ content }) => content);

export const deletionTimings = {
  "after-generation": "after the send-generation check",
  "before-generation": "before the send-generation check",
  "during-dispatch": "while the dispatch gate awaits",
};

async function runCaptureWithChange(storage, timing, change) {
  const run = storage.uow.run.bind(storage.uow);
  const write = work => run(scope.owner, { pauseLock: true }, work);
  const read = work => run(scope.owner, { readOnly: true }, work);
  const providerRequests = [];
  let afterGeneration = false;
  let changed = false;
  async function commitChange() {
    assert.equal(changed, false);
    await change({ read, write });
    changed = true;
  }
  const service = createMemoryService({
    storage: { ...storage, uow: { async run(...args) {
      const result = await run(...args);
      if (afterGeneration) {
        afterGeneration = false;
        assert.deepEqual(args.slice(0, 2), [scope.owner, { pauseLock: true }]);
        await commitChange();
      }
      return result;
    } } },
    model: { model: "test", contextWindow: 16_384, countTokens: () => 1,
      async call(stage, { input }) {
        assert.equal(stage, "extract");
        providerRequests.push(input.messages.map(({ content }) => content));
        return { items: [
          ...input.messages.map(({ content, index }) =>
            ({ content, kind: "instruction", confidence: 0.9, sourceIndices: [index] })),
          { content: "Record both household tasks.", kind: "instruction", confidence: 0.9, sourceIndices: [0, 1] },
        ] };
      } },
    embedder: { model: "test", dimensions: 1, async embed(inputs) {
      return inputs.map(() => Float32Array.of(1));
    } },
    gate: { async assertOpen(owner, phase) {
      assert.equal(owner, scope.owner);
      if (phase === "pre-send") {
        if (timing === "before-generation") await commitChange();
        if (timing === "after-generation") afterGeneration = true;
      }
      if (phase === "dispatch" && timing === "during-dispatch" && !changed) await commitChange();
    } },
    clock: { nowMs: () => 1_000, monotonicMs: () => 1_000,
      async sha256Hex(input) { return createHash("sha256").update(input).digest("hex"); },
      hmacHex: () => assert.fail("Capture uses the owner fingerprint key"),
    },
    tokens: { countTokens: () => 1 },
    config: {},
  });
  assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages: sources }), { status: "accepted" });
  await write(async tx => {
    const admitted = await storage.capture.load(tx, lookup);
    assert.deepEqual(admitted.messages, sources);
    assert.deepEqual(await storage.raw.archive(tx, admitted.key, admitted.messages), { archived: 2 });
  });

  const result = await service.runCapture(scope, selection);
  assert.equal(changed, true, "The change must commit at the requested boundary");
  return { result, providerRequests, status: await service.captureStatus(scope, selection.eventId) };
}

export async function assertDeletedCapture(storage, timing, readStored) {
  const { result, providerRequests, status } = await runCaptureWithChange(storage, timing, async ({ read, write }) => {
    assert.deepEqual(await write(tx => storage.raw.deleteConversation(tx, scope, selection)), { rawDeleted: 2 });
    const current = await read(tx => storage.capture.load(tx, lookup));
    assert.deepEqual(current.messages.map(({ content }) => content), ["", ""]);
  });

  const late = timing === "during-dispatch";
  assert.deepEqual(providerRequests, late ? [contents] : [], "Requests reaching the extraction provider");
  const stored = await readStored();
  assert.deepEqual(stored.raw, [], "Deleted Raw rows were re-inserted");
  assert.deepEqual(stored.memories, [], "Deleted sources produced stored memories");
  if (late) {
    assert.equal(result.status, "done");
    assert.deepEqual(result.result.memories, []);
    assert.deepEqual(status, { status: "done" });
  } else {
    assert.deepEqual(result, { status: "failed", code: "ingest_inputs_changed" });
    assert.deepEqual(status, { status: "pending" });
  }
}

export async function assertChangedCapture(storage, timing, change, readStored) {
  const { result, providerRequests, status } = await runCaptureWithChange(storage, timing, change);
  if (timing === "during-dispatch") {
    assert.deepEqual(providerRequests, [contents]);
    assert.equal(result.status, "done");
    assert.equal(result.result.memories.length, 1);
    assert.deepEqual(await readStored(), { memories: [contents[1]], raw: [contents[1]] });
  } else {
    assert.deepEqual(providerRequests, []);
    assert.deepEqual(result, { status: "failed", code: "ingest_inputs_changed" });
    assert.deepEqual(status, { status: "pending" });
    assert.deepEqual(await readStored(), { memories: [], raw: [] });
  }
}
