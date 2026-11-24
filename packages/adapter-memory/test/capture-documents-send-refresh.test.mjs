import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { documentCardSearchText } from "@cairn-ink/core/routing";
import { createMemoryService } from "@cairn-ink/core/service";

const scope = { owner: "owner", namespace: null };
const actor = { kind: "web", client: null, sessionId: null };
const day = Date.UTC(2025, 0, 1);
const event = sessionId => ({ client: "client", sessionId, eventId: sessionId });
const message = (id, content, occurredAtMs = day) => ({ id, role: "user", content, occurredAtMs });
const schedule = "The hatch opens at 8 each morning.";
const plan = message("plan", [
  "Remember this maintenance plan for the community workshop.",
  schedule,
  "Inspect the fittings after opening and record the results in the log.",
  "Clean the workbench after the inspection and leave the aisle clear.",
].join("\n"));
const correction = message("correction", "The hatch now opens at 10.", day + 86_400_000);
const unrelated = message("unrelated", "Water the seedlings every Tuesday.");
const planText = documentCardSearchText({ title: plan.content.split("\n")[0], body: plan.content });

function fixture({ rawArchive = false, model = null } = {}) {
  const storage = createMemoryAdapter({ capabilities: { rawArchive, documentCards: true } });
  const read = work => storage.uow.run(scope.owner, { readOnly: true }, work);
  const write = work => storage.uow.run(scope.owner, { pauseLock: true }, work);
  const embeddings = [];
  const diagnostics = [];
  let onGate;
  const service = createMemoryService({
    storage, model, config: { documentCards: { enabled: true, amendments: !!model } },
    embedder: { model: "fixture", dimensions: 1, async embed(texts) {
      embeddings.push([...texts]);
      return texts.map(() => Float32Array.of(1));
    } },
    tokens: { countTokens: () => 1 },
    clock: {
      nowMs: Date.now, monotonicMs: () => performance.now(),
      sha256Hex: text => createHash("sha256").update(text).digest("hex"),
      async hmacHex() { throw new Error("Unexpected HMAC"); },
    },
    gate: { async assertOpen(owner, phase) {
      assert.equal(owner, scope.owner);
      await onGate?.(phase);
    } },
    diagnostics: entry => diagnostics.push(entry),
  });
  async function enqueue(selection, messages) {
    assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages }), { status: "accepted" });
  }
  async function run(selection, race) {
    let committed = false;
    let remaining = race?.occurrence ?? 1;
    onGate = async phase => {
      if (phase !== race?.phase || --remaining !== 0) return;
      await race.commit();
      committed = true;
    };
    const result = await service.runCapture(scope, selection);
    onGate = undefined;
    if (race) assert.equal(committed, true, "The mutation must commit in the selected gate");
    assert.equal(result.status, "done");
    assert.equal((await service.captureStatus(scope, selection.eventId, { client: selection.client })).status, "done");
    return result.result;
  }
  return { storage, service, read, write, enqueue, run, embeddings, diagnostics };
}

for (const related of [true, false]) {
  test(`Raw deletion in the card pre-send gate ${related ? "withdraws the card payload" : "preserves an unrelated card payload"}`, async () => {
    const f = fixture({ rawArchive: true });
    const capture = event("plan");
    const deleted = related ? capture : event("unrelated");
    await f.enqueue(capture, [plan]);
    assert.equal((await f.write(tx => f.storage.raw.importArchive(tx, scope, deleted, [related ? plan : unrelated]))).archived, 1);
    await f.run(capture, { phase: "pre-send", async commit() {
      assert.deepEqual(await f.write(tx => f.storage.raw.deleteConversation(tx, scope, deleted)), { rawDeleted: 1 });
    } });
    assert.deepEqual(f.embeddings, related ? [] : [[planText]]);
  });
}

for (const forgotten of ["bound memory", "unrelated memory", "new value"]) {
  test(`Forgetting the ${forgotten} in the verify dispatch gate ${forgotten === "unrelated memory" ? "preserves" : "withdraws"} the verify payload`, async () => {
    let cardId;
    const verifyRequests = [];
    const newValue = "Open the hatch at 10 during workshop hours.";
    const model = {
      model: "fixture", contextWindow: 32768, countTokens: () => 1,
      async call(_stage, { input }) {
        return { items: input.messages.some(({ content }) => content === plan.content)
          ? [{ content: schedule, sourceIndices: [0], kind: "fact", confidence: 0.9 }]
          : [] };
      },
      async detectChanges() {
        return { changes: [{ card_id: cardId, quote: correction.content, new_value: newValue }] };
      },
      async verifyChange(request) {
        verifyRequests.push(request);
        return { applies: true, line: newValue };
      },
    };
    const f = fixture({ model });
    const seed = event("plan");
    await f.enqueue(seed, [plan]);
    const { memories: [{ id: boundMemory }] } = await f.run(seed);
    const [card] = await f.read(tx => f.storage.documentCards.list(tx, scope));
    cardId = card.id;
    assert.deepEqual(card.sourceMemories, [{ id: boundMemory, revision: 1 }]);
    let memoryToForget = boundMemory;
    if (forgotten !== "bound memory") {
      const saved = await f.service.save(scope, forgotten === "new value" ? newValue : unrelated.content, actor);
      assert.equal(saved.status, "saved");
      memoryToForget = saved.item.id;
    }
    const capture = event("correction");
    await f.enqueue(capture, [correction]);
    // Extraction and amendment detection each pass the dispatch gate before verification.
    await f.run(capture, { phase: "dispatch", occurrence: 3, async commit() {
      assert.equal((await f.service.forget(scope, memoryToForget, actor)).status, "forgotten");
    } });
    if (forgotten === "unrelated memory") {
      assert.equal(verifyRequests.length, 1);
      assert.ok(verifyRequests[0].input.includes(newValue));
    } else {
      assert.equal(verifyRequests.length, 0);
      assert.ok(f.diagnostics.some(({ reason }) => reason === "verify_skipped_ineligible"));
    }
  });
}
