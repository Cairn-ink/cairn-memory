import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { assertAdapterCapabilities, FORGET_STEP_CAPABILITIES } from "@cairn-ink/core";
import { RATIONALE_CASES, runCase } from "@cairn-ink/conformance";

function factory(mutate = () => {}) {
  return {
    name: "memory rationale",
    async open({ capabilities }) {
      const adapter = createMemoryAdapter({ capabilities });
      mutate(adapter);
      return {
        adapter, sessionRefs: "plain", harness: adapter.harness, nativeErrorMap: adapter.nativeErrorMap,
        busyNativeCodes: [], embeddingDimensions: null, async close() {},
      };
    },
  };
}

test("rationale is off by default and registered with the forget capability", () => {
  const disabled = createMemoryAdapter();
  assert.equal(disabled.capabilities.rationaleEdges, false);
  assert.equal(disabled.rationale, undefined);
  assert.equal(disabled.harness.seedRationaleMessage, undefined);
  const enabled = createMemoryAdapter({ capabilities: { rationaleEdges: true } });
  assert.equal(enabled.capabilities.rationaleEdges, true);
  assert.doesNotThrow(() => assertAdapterCapabilities(enabled));
  assert.ok(FORGET_STEP_CAPABILITIES["dependents.invalidate"].includes("rationaleEdges"));
});

const preservesEdgeAfterWrite = (adapter) => {
  const { incident } = adapter.rationale;
  const cached = new Map();
  adapter.rationale.incident = async (tx, scope, id, page) => {
    const key = JSON.stringify([scope.owner, scope.namespace, id]);
    const rows = await incident(tx, scope, id, page);
    if (rows.length) cached.set(key, rows);
    return rows.length ? rows : cached.get(key) ?? rows;
  };
};

const mutations = {
  insert: ["a self-edge counts twice", adapter => {
    const { degree, incident } = adapter.rationale;
    adapter.rationale.degree = async (tx, scope, id) => (await degree(tx, scope, id)) +
      (await incident(tx, scope, id, { limit: 11 })).filter(({ from, to }) => from.id === to.id).length;
  }, /A self-edge counts once/],
  degree: ["degree undercounts and allows an overflow", adapter => {
    adapter.rationale.degree = async () => 0;
  }, /Degree overflow must fail/],
  stale: ["incoming rows disappear before validation", adapter => {
    adapter.rationale.incoming = async () => [];
  }, /Expected operation to reject/],
  hidden: ["a suppression fact is ignored by both the fence and evidence read", adapter => {
    adapter.harness.seedFact = async () => {};
  }, /Only the visible premise remains/],
  "receipt-private": ["raw missing or withheld text is returned as evidence", adapter => {
    const { sourceEvidence } = adapter.rationale;
    adapter.rationale.sourceEvidence = async (tx, scope, refs) => {
      try { return await sourceEvidence(tx, scope, refs); }
      catch (error) {
        if (error.code !== "revision_conflict") throw error;
        return refs.map(({ memoryId, revision }) => ({ memory: { id: memoryId, revision }, receipts: [
          { id: "0".repeat(64), role: "user", excerpt: "A message with a forgotten excerpt." },
        ] }));
      }
    };
  }, /Expected operation to reject/],
  "raw-deleted": ["evidence still returns a cached copy of deleted Raw", adapter => {
    const { sourceEvidence } = adapter.rationale;
    const cached = new Map();
    adapter.rationale.sourceEvidence = async (tx, scope, refs) => {
      try {
        const evidence = await sourceEvidence(tx, scope, refs);
        for (const source of evidence) cached.set(JSON.stringify([scope, source.memory.id, source.memory.revision]), source);
        return evidence;
      } catch (error) {
        if (error.code === "revision_conflict") {
          const previous = refs.map(({ memoryId, revision }) => cached.get(JSON.stringify([scope, memoryId, revision])));
          if (previous.every(Boolean)) return previous;
        }
        throw error;
      }
    };
  }, /Expected operation to reject/],
  scope: ["foreign incident reads expose another namespace's edge", adapter => {
    const { incident } = adapter.rationale;
    let cached;
    adapter.rationale.incident = async (tx, scope, id, page) => {
      const rows = await incident(tx, scope, id, page);
      if (rows.length) cached = rows;
      return rows.length ? rows : cached ?? rows;
    };
  }, /Foreign scope has no rows/],
  index: ["index advances per edge", adapter => {
    const { insert } = adapter.rationale;
    const { catalog } = adapter.placement;
    const witnessed = new WeakSet();
    let excess = 0;
    adapter.rationale.insert = async (tx, scope, edge) => {
      const result = await insert(tx, scope, edge);
      if (result.inserted) {
        if (witnessed.has(tx)) excess++;
        witnessed.add(tx);
      }
      return result;
    };
    adapter.placement.catalog = async (...args) => {
      const result = await catalog(...args);
      return { ...result, indexRevision: result.indexRevision + excess };
    };
  }, /One owner index revision for the batch/],
};

for (const testCase of RATIONALE_CASES) {
  test(testCase.id + " " + testCase.title, async () => {
    assert.equal(await runCase(factory(), testCase), null);
  });
  const suffix = testCase.id.slice("T-RAT-".length);
  const [name, mutate, message] = mutations[suffix] ??
    ["incident rows survive the " + suffix + " write", preservesEdgeAfterWrite, /Invalidating write must delete stored incident rows/];
  test(testCase.id + " catches " + name, async () => {
    await assert.rejects(runCase(factory(mutate), testCase), message);
  });
}

test("T-RAT-insert catches a store claiming it reinserted an existing tuple", async () => {
  const insertCase = RATIONALE_CASES.find(({ id }) => id === "T-RAT-insert");
  const mutant = factory(adapter => {
    const { insert } = adapter.rationale;
    adapter.rationale.insert = async (...args) => {
      await insert(...args);
      return { inserted: true };
    };
  });
  await assert.rejects(runCase(mutant, insertCase), /Repeated tuple inserts nothing/);
});

test("T-RAT-degree catches an adapter committing earlier writes when core throws", async () => {
  const degreeCase = RATIONALE_CASES.find(({ id }) => id === "T-RAT-degree");
  const mutant = factory(adapter => {
    const { run } = adapter.uow;
    adapter.uow.run = async (owner, options, fn) => {
      let failure;
      const result = await run(owner, options, async tx => {
        try { return await fn(tx); }
        catch (error) { failure = error; }
      });
      if (failure) throw failure;
      return result;
    };
  });
  await assert.rejects(runCase(mutant, degreeCase), /Initial edges survive/);
});

test("evidence uses raw source text, cuts at a code point, and refuses more than 100 receipts", async () => {
  const adapter = createMemoryAdapter({ capabilities: { rationaleEdges: true } });
  const scope = { owner: "fixture-owner", namespace: null };
  const { rationale, uow, harness, memories } = adapter;
  const source = { client: "fixture", sessionId: "fixture", messageId: "source", role: "assistant", occurredAtMs: null };
  const raw = "x".repeat(799) + "🪨more";
  await harness.seedRationaleMessage(scope, source, raw);
  const { id, revision } = await uow.run(scope.owner, {}, tx => memories.insert(tx, scope, {
    text: "Stored interpretation", textHash: "sha256:" + "a".repeat(64), kind: "fact", origin: "inferred",
    confidence: 0.5, embedding: null, source: { kind: "capture", client: source.client, sessionId: source.sessionId },
  }, [source], 1));
  const refs = [{ memoryId: id, revision }];
  const read = () => uow.run(scope.owner, { readOnly: true }, tx => rationale.sourceEvidence(tx, scope, refs));
  const [{ receipts }] = await read();
  const receiptId = createHash("sha256").update(JSON.stringify([source.client, source.sessionId, source.messageId])).digest("hex");
  assert.deepEqual(receipts, [{ id: receiptId, role: "assistant", excerpt: "x".repeat(799) }]);
  assert.deepEqual(await uow.run(scope.owner, { readOnly: true }, tx => adapter.rationaleSourceText(tx, scope, refs)), [raw]);
  const overflow = Array.from({ length: 100 }, (_, i) => ({ ...source, messageId: "source-" + i }));
  await uow.run(scope.owner, {}, tx => memories.touchDuplicate(tx, scope, id, overflow, { confidence: 0.5 }, 2));
  await assert.rejects(read(), { code: "context_item_too_large" });
});
