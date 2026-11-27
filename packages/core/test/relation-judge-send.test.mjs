import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";

// Core's test job installs Core alone. Resolve the sibling adapter against this checkout.
const adapterImports = new Map([
  ["@cairn-ink/core", new URL("../src/index.mjs", import.meta.url).href],
  ["@cairn-ink/core/routing", new URL("../src/routing/index.mjs", import.meta.url).href],
]);
const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(adapterImports.get(specifier) ?? specifier, context);
  },
});
let createMemoryAdapter;
try {
  ({ createMemoryAdapter } = await import("../../adapter-memory/src/index.mjs"));
} finally {
  resolver.deregister();
}

const scope = { owner: "owner", namespace: null };
const source = { kind: "mcp", client: null, sessionId: null };
const previousText = "the earlier route follows the river";
const memoryText = "the current route follows the ridge";
const stale = { status: "skipped", reason: "stale" };
const paused = { status: "paused" };
const sha256Hex = text => createHash("sha256").update(text).digest("hex");

async function fixture({ fallback = false } = {}) {
  const adapter = createMemoryAdapter({ capabilities: { semanticRetrieval: true, supersession: true, conflictEdges: true } });
  const { hydrate, memories, uow } = adapter;
  const modelRequests = [];
  const embedRequests = [];
  const phases = [];
  const query = new Float32Array([1, 0]);
  const model = "test";
  let commit;
  const service = createMemoryService({
    storage: fallback ? { ...adapter, hydrate: {
      async hydrate(tx, selection, refs, intent) {
        return (await hydrate.hydrate(tx, selection, refs, intent)).map(item => ({
          ...item, memory: item.memory && { ...item.memory, embedding: undefined },
        }));
      },
    } } : adapter,
    clock: {
      nowMs: () => 1, monotonicMs: () => 0,
      async sha256Hex(text) { return sha256Hex(text); },
      async hmacHex() { assert.fail("unexpected HMAC in a keyless test"); },
    },
    gate: {
      async assertOpen(owner, phase) {
        assert.equal(owner, scope.owner);
        phases.push(phase);
        if (phase === (fallback ? "dispatch" : "pre-send") && commit) {
          const action = commit;
          commit = undefined;
          await action();
        }
      },
    },
    model: {
      model, contextWindow: 8192, countTokens: () => 1,
      async call(_stage, request) {
        modelRequests.push(request);
        return { transitions: [] };
      },
    },
    embedder: {
      model, dimensions: query.length,
      async embed(texts) {
        embedRequests.push([...texts]);
        return [query];
      },
    },
    tokens: { countTokens: () => 1 },
    config: {},
  });

  async function insert(text, vector) {
    const { id, revision } = await uow.run(scope.owner, {}, tx => memories.insert(tx, scope, {
      kind: "fact", origin: "explicit", text, textHash: `sha256:${sha256Hex(text)}`, confidence: 1, source,
      embedding: { model, vector },
    }, [], 1));
    return { id, revision };
  }
  const memory = await insert(memoryText, query);
  const previous = await insert(previousText, new Float32Array([0.8, 0.6]));
  return {
    service, memory, previous, modelRequests, embedRequests, phases,
    async judgeWhile(action) {
      commit = action;
      const result = await service.judgeRelations(scope, memory);
      assert.equal(commit, undefined, "host gate did not run the commit");
      return result;
    },
    async forget(target) {
      assert.equal((await service.forget(scope, target.id, source)).status, "forgotten");
    },
    suppress(target) {
      return adapter.harness.seedFact(scope.owner, {
        ...scope, kind: "identity", memoryId: target.id, origin: "forget", actionId: "test-suppression",
      });
    },
  };
}

for (const action of ["forget", "suppress"]) {
  test(`relation judge withholds a candidate after ${action} commits during pre-send`, async () => {
    const f = await fixture();
    const result = await f.judgeWhile(() => f[action](f.previous));
    const contents = f.modelRequests.flatMap(({ input }) => input.candidates.map(({ content }) => content));
    assert.equal(contents.includes(previousText), false, "the recorded model request contained the withheld candidate");
    assert.equal(f.modelRequests.length, 0);
    assert.deepEqual(result, stale);
    assert.deepEqual(f.phases, ["pre-send"]);
  });
}

for (const resume of [false, true]) {
  test(`relation judge withholds model input after ${resume ? "pause and resume" : "pause"} during pre-send`, async () => {
    const f = await fixture();
    const result = await f.judgeWhile(async () => {
      await f.service.setPause(scope.owner, true);
      if (resume) await f.service.setPause(scope.owner, false);
    });
    assert.equal(f.modelRequests.length, 0, "the paused generation sent a model request");
    assert.deepEqual(result, paused);
    assert.deepEqual(f.phases, ["pre-send"]);
  });
}

for (const [action, commit, expected] of [
  ["forget", f => f.forget(f.memory), stale],
  ["pause", f => f.service.setPause(scope.owner, true), paused],
]) {
  test(`relation judge withholds fallback embedding after ${action} during dispatch`, async () => {
    const f = await fixture({ fallback: true });
    const result = await f.judgeWhile(() => commit(f));
    assert.equal(f.embedRequests.length, 0, "the embedder received the input memory");
    assert.equal(f.modelRequests.length, 0);
    assert.deepEqual(result, expected);
    assert.deepEqual(f.phases, ["dispatch"]);
  });
}
