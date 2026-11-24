import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { createMemoryService } from "@cairn-ink/core/service";

const scope = { owner: "test-owner", namespace: null };
const event = { client: "test-client", sessionId: "test-session", eventId: "test-event" };
const source = { kind: "mcp", client: null, sessionId: null };
const messages = [
  { id: "bridge", role: "user", content: "The path crosses a stone bridge.", occurredAtMs: 10 },
  { id: "copper", role: "user", content: "Copper conducts electricity.", occurredAtMs: 20 },
];

async function assertKeyedLateForget(createService) {
  const storage = createMemoryAdapter({ capabilities: { rawArchive: false, fingerprintKey: true, shingleSuppression: true } });
  const requests = [];
  const service = createService({
    storage,
    model: {
      model: "test", contextWindow: 16_384, countTokens: () => 1,
      async call(_stage, { input }) {
        requests.push(input.messages.map(({ content }) => content));
        return { items: input.messages.map(({ index, content }) =>
          ({ kind: "fact", content, confidence: 0.9, sourceIndices: [index] })) };
      },
    },
    embedder: {
      model: "test", dimensions: 1,
      async embed(inputs) { return inputs.map(() => Float32Array.of(1)); },
    },
    clock: {
      nowMs: () => 100, monotonicMs: () => 100,
      async sha256Hex(text) { return createHash("sha256").update(text).digest("hex"); },
      async hmacHex(key, text) { return createHmac("sha256", key).update(text).digest("hex"); },
    },
    gate: { async assertOpen() {} },
    tokens: { countTokens: () => 1 },
    config: {},
  });

  const saved = await service.save(scope, messages[0].content, source);
  assert.equal(saved.status, "saved");
  assert.deepEqual(await service.enqueueCapture(scope, { ...event, messages }), { status: "accepted" });
  const { claim } = storage.capture;
  const { run } = storage.uow;
  let claimTx;
  let forgotten = false;
  storage.capture.claim = async (tx, key, batch, options) => {
    const result = await claim(tx, key, batch, options);
    if (result.status === "claimed") {
      assert.deepEqual(batch, messages);
      claimTx = tx;
    }
    return result;
  };
  storage.uow.run = async (owner, options, work) => {
    let tx;
    const result = await run(owner, options, current => {
      tx = current;
      return work(current);
    });
    // Forget after the claim commits and before the first source check builds the request.
    if (tx === claimTx) {
      assert.equal((await service.forget(scope, saved.item.id, source)).status, "forgotten");
      const current = await run(owner, { readOnly: true }, tx => storage.capture.load(tx, { scope, ...event }));
      assert.deepEqual(current.messages, messages, "Forget must leave the stored outbox intact");
      forgotten = true;
    }
    return result;
  };

  const done = await service.runCapture(scope, event);
  assert.equal(forgotten, true, "The forget must commit after claim");
  assert.deepEqual(requests, [[messages[1].content]], "The extraction request must contain only the surviving source");
  assert.equal(done.status, "done");
  assert.equal(done.result.memories.length, 1);
  const [{ rows }] = await storage.harness.dump();
  assert.deepEqual(rows.filter(({ row }) => row.text !== null).map(({ row }) => row.text), [messages[1].content]);
}

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

test("the keyed pre-dispatch filter withholds a late-forgotten source from an intact outbox", () =>
  assertKeyedLateForget(createMemoryService));

test("the intact-outbox test detects a bypass of the keyed pre-dispatch filter", async () => {
  const createService = await createKeyedDispatchMutant();
  // Both sources reach extraction when the keyed screen is bypassed because the stored slots still match.
  await assert.rejects(assertKeyedLateForget(createService), {
    message: /^The extraction request must contain only the surviving source\b/,
    actual: [messages.map(({ content }) => content)],
  });
});
