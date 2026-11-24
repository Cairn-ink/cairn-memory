import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CAPTURE_LATE_FORGET_CASES, runCase } from "@cairn-ink/conformance";
import { allDigests } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { rawFactory } from "./fixtures/raw.mjs";

const scope = { owner: "test-owner", namespace: null };
const selection = { client: "test-client", sessionId: "test-session", eventId: "test-event" };
const source = { kind: "mcp", client: null, sessionId: null };
const messages = [
  { id: "first", role: "user", content: "The path crosses a stone bridge.", occurredAtMs: 10 },
  { id: "second", role: "user", content: "Copper conducts electricity.", occurredAtMs: 20 },
];
// The outputs deliberately miss the forgotten text so candidate matching alone cannot withhold them.
const outputs = ["The route passes over water.", "The wire is conductive."];
const factBase = { owner: scope.owner, actionId: "test-forget", origin: "forget" };

function forgetAfterLoadedClaim(storage, forget) {
  const { claim } = storage.capture;
  const { run } = storage.uow;
  let claimTx;
  storage.capture.claim = async (tx, key, batch, options) => {
    const result = await claim(tx, key, batch, options);
    if (result.status === "claimed") {
      assert.equal(batch[0]?.content, messages[0].content, "The runner must already hold the source text");
      claimTx = tx;
    }
    return result;
  };
  storage.uow.run = async (owner, options, work) => {
    let tx;
    const result = await run(owner, options, (current) => {
      tx = current;
      return work(current);
    });
    // Forget takes the same pause lock, so commit it as soon as the claim transaction releases the lock.
    if (claimTx && tx === claimTx) await forget();
    return result;
  };
}

async function captureRace({ keyed = false, timing, kind = "text", mutate = adapter => adapter,
  afterClaim = false, createService = createMemoryService }) {
  const storage = mutate(createMemoryAdapter({ capabilities: {
    rawArchive: true, rawWindowHide: true, fingerprintKey: keyed, shingleSuppression: keyed,
  } }));
  const modelRequests = [];
  const lineageWrites = [];
  const finalChecks = [];
  let embeddingInputs;
  let commitDuringEmbedding;
  const { recordLineage } = storage.raw;
  storage.raw.recordLineage = (tx, key, batch) => {
    lineageWrites.push(batch.map(({ id }) => id));
    return recordLineage(tx, key, batch);
  };
  const { assertEligible } = storage.capture;
  storage.capture.assertEligible = async (tx, key, positions) => {
    try {
      await assertEligible(tx, key, positions);
      if (embeddingInputs) finalChecks.push({ positions, outcome: "eligible" });
    } catch (error) {
      if (embeddingInputs) finalChecks.push({ positions, outcome: error.code });
      throw error;
    }
  };
  const service = createService({
    storage,
    model: {
      model: "test", contextWindow: 16_384, countTokens: () => 1,
      async call(_stage, request) {
        modelRequests.push(request);
        return { items: request.input.messages.map(({ index, content }) => ({
          kind: "fact", content: outputs[messages.findIndex(message => message.content === content)],
          confidence: 0.9, sourceIndices: [index],
        })) };
      },
    },
    embedder: {
      model: "test", dimensions: 1,
      async embed(inputs) {
        if (commitDuringEmbedding) {
          embeddingInputs = [...inputs];
          await commitDuringEmbedding();
        }
        return inputs.map(() => Float32Array.of(1));
      },
    },
    gate: { async assertOpen() {} },
    clock: {
      nowMs: () => 100, monotonicMs: () => 100,
      async sha256Hex(text) { return createHash("sha256").update(text).digest("hex"); },
      async hmacHex(key, text) { return createHmac("sha256", key).update(text).digest("hex"); },
    },
    tokens: { countTokens: () => 1 },
    config: {},
  });

  let commitForget;
  if (kind === "window") {
    commitForget = () => storage.harness.seedFact(scope.owner, {
      ...factBase, kind, client: selection.client, window: { startMs: 10, endMs: 20 },
    });
  } else if (timing && keyed) {
    const saved = await service.save(scope, messages[0].content, source);
    assert.equal(saved.status, "saved");
    commitForget = async () => {
      assert.equal((await service.forget(scope, saved.item.id, source)).status, "forgotten");
    };
  } else if (timing) {
    const digests = await allDigests(messages[0].content, null);
    commitForget = () => storage.harness.seedFact(scope.owner, { ...factBase, kind, mode: "exact", text: { digests } });
  }

  const dump = async () => (await storage.harness.dump()).find(({ owner }) => owner === scope.owner);
  assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages }), { status: "accepted" });
  const admitted = await dump();
  const ids = messages.map(({ id }) => id);
  const anchored = admitted.rawAnchors.flatMap(anchor => anchor.messages);
  assert.deepEqual(anchored.map(({ id }) => id), ids);
  for (const { digests } of anchored) {
    assert.equal(digests.length, 1);
    assert.match(digests[0], /^[a-f0-9]{64}$/u);
  }
  assert.deepEqual(admitted.rawRows, []);
  if (afterClaim) forgetAfterLoadedClaim(storage, commitForget);
  else if (timing === "before dispatch") await commitForget();
  if (timing === "during embedding") commitDuringEmbedding = commitForget;

  const completed = await service.runCapture(scope, selection);
  const modelMessages = timing === "before dispatch" ? messages.slice(1) : messages;
  assert.deepEqual(modelRequests.map(({ input }) => input.messages.map(({ content }) => content)),
    [modelMessages.map(({ content }) => content)], "Unexpected source text reached the model");
  if (timing === "before dispatch") assert.ok(!JSON.stringify(modelRequests).includes(messages[0].content));
  if (timing === "during embedding") {
    assert.deepEqual(embeddingInputs, outputs.map(text => text.toLowerCase()), "Both outputs must reach the embedder before the forget");
    assert.deepEqual(finalChecks, [{ positions: [0, 1], outcome: kind === "window" ? "suppressed" : "eligible" }],
      "The final eligibility check must see the committed source policy");
  }

  const stored = await dump();
  assert.equal(stored.facts.length, timing ? 1 : 0);
  const allowed = kind === "window" ? [] : timing ? [1] : [0, 1];
  if (kind === "window") {
    assert.deepEqual(completed, { status: "failed", code: "suppressed" });
  } else {
    assert.equal(completed.status, "done");
  }
  assert.deepEqual(stored.rows.map(({ row, receipts }) => [row.text, receipts.map(({ messageId }) => messageId)]).sort(),
    allowed.map(index => [outputs[index], [ids[index]]]).sort(), "Only surviving receipts and their memories may be stored");
  assert.deepEqual(stored.rawRows.map(({ messageId, content }) => [messageId, content]).sort(),
    allowed.map(index => [ids[index], messages[index].content]), "Only surviving raw rows may be stored");
  if (completed.status === "done") assert.equal(completed.result.memories.length, allowed.length);
  // Admission already writes opaque proofs for both sources. The runner must add none.
  assert.deepEqual(lineageWrites, [ids]);
  assert.deepEqual(stored.rawAnchors, admitted.rawAnchors);
}

for (const testCase of CAPTURE_LATE_FORGET_CASES) {
  for (const sessionRefs of ["plain", "hashed"]) {
    test(`${testCase.id} on memory with ${sessionRefs} session references`, async () => {
      assert.equal(await runCase(rawFactory({ sessionRefs }), testCase), null);
    });
  }
}

for (const keyed of [false, true]) {
  for (const timing of [undefined, "before dispatch", "during embedding"]) {
    test(`${keyed ? "Keyed" : "No-key"} capture ${timing ? `with a text forget ${timing}` : "without a forget"}`,
      () => captureRace({ keyed, timing }));
  }
}

test("the final locked check refuses a window committed during embedding", () =>
  captureRace({ timing: "during embedding", kind: "window" }));

function ignoreFactsCommittedAfterAdmission(adapter) {
  const { seedFact } = adapter.harness;
  const { assertEligible } = adapter.capture;
  let factCommitted = false;
  adapter.harness.seedFact = async (...args) => {
    await seedFact(...args);
    factCommitted = true;
  };
  // The mutant trusts the earlier check after the fixture commits its only fact.
  adapter.capture.assertEligible = async (...args) => {
    if (!factCommitted) await assertEligible(...args);
  };
  return adapter;
}

test("the kit and final locked capture check detect an adapter ignoring late source refusals", async () => {
  for (const testCase of CAPTURE_LATE_FORGET_CASES) {
    await assert.rejects(runCase(rawFactory({ create: options => ignoreFactsCommittedAfterAdmission(createMemoryAdapter(options)) }),
      testCase), /Expected operation to reject/);
  }
  await assert.rejects(captureRace({ timing: "during embedding", kind: "window", mutate: ignoreFactsCommittedAfterAdmission }),
    /The final eligibility check must see the committed source policy/);
});

function reuseAdmissionPassages(adapter) {
  const { snapshot } = adapter.suppressions;
  let initialPassages;
  adapter.suppressions.snapshot = async (tx, scope, candidates) => {
    const current = await snapshot(tx, scope, candidates);
    if (!candidates?.sessionId || candidates.passages !== undefined) return current;
    initialPassages ??= current.passages;
    return { ...current, passages: initialPassages };
  };
  return adapter;
}

test("the pre-dispatch test detects stale source passages", async () => {
  // The no-key route commits the fact directly. A keyed forget also blanks the stored source text, which would
  // keep it from the model even with stale passages and so hide this check.
  await assert.rejects(captureRace({ timing: "before dispatch", mutate: reuseAdmissionPassages }),
    /Unexpected source text reached the model/);
});

test("the keyed pre-dispatch check withholds a source forgotten after the outbox batch is loaded", () =>
  captureRace({ keyed: true, timing: "before dispatch", afterClaim: true }));

async function createKeyedDispatchMutant() {
  const entry = new URL(import.meta.resolve("@cairn-ink/core/service"));
  const capture = new URL("./capture.mjs", entry);
  const source = readFileSync(capture, "utf8");
  const before = "const allowed = await filterCaptureSources(sources, positions, passages, null, sourceEvidence, writeKey);";
  const after = "const allowed = writeKey ? positions : " +
    "await filterCaptureSources(sources, positions, passages, null, sourceEvidence, writeKey);";
  assert.equal(source.split(before).length, 2, "Expected one pre-dispatch filter to mutate");
  entry.searchParams.set("variant", "skip-keyed-dispatch-filter");
  capture.searchParams.set("variant", "skip-keyed-dispatch-filter");
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(context.parentURL === entry.href && specifier === "./capture.mjs" ? capture.href : specifier, context);
    },
    load(url, context, nextLoad) {
      return url === capture.href ? { format: "module", source: source.replace(before, after), shortCircuit: true }
        : nextLoad(url, context);
    },
  });
  try {
    return (await import(entry.href)).createMemoryService;
  } finally {
    hooks.deregister();
  }
}

test("the loaded outbox regression detects a bypass of the keyed pre-dispatch filter", async () => {
  const createService = await createKeyedDispatchMutant();
  await assert.rejects(captureRace({ keyed: true, timing: "before dispatch", afterClaim: true, createService }), {
    message: /^Unexpected source text reached the model\b/,
    actual: [messages.map(({ content }) => content)],
    expected: [[messages[1].content]],
  });
});

test("the final text check detects stale source passages", async () => {
  await assert.rejects(captureRace({ keyed: true, timing: "during embedding", mutate: reuseAdmissionPassages }),
    /Only surviving receipts and their memories may be stored/);
});
