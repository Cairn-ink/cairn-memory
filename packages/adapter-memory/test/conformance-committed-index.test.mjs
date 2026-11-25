import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { COMMITTED_INDEX_CASES, runCase } from "@cairn-ink/conformance";
import { CAPABILITIES, OPTIONAL_PORTS } from "@cairn-ink/core";

const optional = new Set(Object.values(OPTIONAL_PORTS));
const standard = Object.fromEntries(CAPABILITIES
  .filter(flag => !optional.has(flag) && flag !== "embeddingRequiredOnInsert").map(flag => [flag, true]));
const hashSessionKey = (client, sessionId) => createHash("sha256").update(JSON.stringify([client, sessionId])).digest("hex");

function factory({ flags = {}, honorRequests = false, sessionRefs = "plain", wrap = adapter => adapter } = {}) {
  return {
    name: "memory",
    async open({ capabilities }) {
      const adapter = createMemoryAdapter({
        capabilities: { ...flags, ...(honorRequests && capabilities) }, sessionRefs, hashSessionKey,
      });
      return {
        adapter: wrap(adapter), sessionRefs, embeddingDimensions: null,
        harness: adapter.harness, nativeErrorMap: adapter.nativeErrorMap, busyNativeCodes: [],
        async close() {},
      };
    },
  };
}

for (const [profile, options] of [
  ["standard", { flags: { ...standard, semanticRetrieval: true } }],
  ["no flags", {}],
  ["plain session references, optional ports", { honorRequests: true }],
  ["hashed session references, optional ports", { honorRequests: true, sessionRefs: "hashed" }],
]) {
  for (const testCase of COMMITTED_INDEX_CASES) {
    test(`memory (${profile}) ${testCase.id} ${testCase.title}`, async () => {
      assert.equal(await runCase(factory(options), testCase), null);
    });
  }
}

function withCommittedRevision(revision) {
  return adapter => ({ ...adapter, memories: { ...adapter.memories,
    committedIndexRevision: async tx => revision(await adapter.memories.indexRevision(tx)),
  } });
}

function leakRolledBackRevision(adapter) {
  const { uow, memories } = adapter;
  let aborted;
  const leaked = new WeakMap();
  return {
    ...adapter,
    uow: {
      ...uow,
      run(owner, options, work) {
        return uow.run(owner, options, async tx => {
          if (aborted?.owner === owner) {
            leaked.set(tx, aborted.revision);
            aborted = undefined;
          }
          try {
            return await work(tx);
          } catch (error) {
            if (!tx.readOnly) aborted = { owner, revision: await memories.committedIndexRevision(tx) };
            throw error;
          }
        });
      },
    },
    memories: { ...memories, indexRevision: tx => leaked.get(tx) ?? memories.indexRevision(tx) },
  };
}

for (const [label, id, wrap, message] of [
  ["the start revision", "K-IDX-COMMIT-1", withCommittedRevision(start => start),
    /^Memory insert: next start \(\d+\) must equal committed revision \(\d+\); run start was \d+$/u],
  ["start plus one unconditionally", "K-IDX-COMMIT-1", withCommittedRevision(start => start + 1),
    /^No writes: committed revision before writes \(\d+\) must equal start \(\d+\)$/u],
  ["a rolled-back revision in the next run", "K-IDX-COMMIT-4", leakRolledBackRevision,
    /^Rollback: next start \(\d+\) must equal pre-run start \(\d+\); aborted revision was \d+$/u],
]) {
  test(`${id} rejects ${label}`, async () => {
    const testCase = COMMITTED_INDEX_CASES.find(candidate => candidate.id === id);
    assert.ok(testCase);
    await assert.rejects(runCase(factory({ wrap }), testCase), { message });
  });
}
