import assert from "node:assert/strict";
import { test } from "node:test";
import * as kit from "@cairn-ink/conformance";
import { CoreError } from "@cairn-ink/core";
import { requireEmbedding } from "../../adapter-postgres/src/memory-metadata.mjs";
import { embeddingRequiredFactory, guardChecks } from "./fixtures/embedding-required.mjs";

function assertStorableValues(value) {
  if (typeof value === "string" && /[\u0000\uD800-\uDFFF]/u.test(value)) throw new CoreError("invalid_input");
  if (typeof value === "number" && !Number.isFinite(value)) throw new CoreError("invalid_input");
  if (value !== null && typeof value === "object") {
    for (const field of Object.values(value)) assertStorableValues(field);
  }
}

function withStorageGuards(adapter) {
  const { memories, capture, suppressions } = adapter;
  return {
    ...adapter,
    memories: {
      ...memories,
      async insert(tx, scope, row, ...rest) {
        requireEmbedding(row);
        return memories.insert(tx, scope, row, ...rest);
      },
      async replaceContent(tx, scope, id, revision, row, ...rest) {
        requireEmbedding(row);
        return memories.replaceContent(tx, scope, id, revision, row, ...rest);
      },
    },
    capture: {
      ...capture,
      async finish(tx, token, items) {
        for (const item of items) requireEmbedding(item);
        return capture.finish(tx, token, items);
      },
    },
    suppressions: {
      ...suppressions,
      async writeFact(tx, fact, ...rest) {
        assertStorableValues(fact);
        return suppressions.writeFact(tx, fact, ...rest);
      },
    },
  };
}

const suites = Object.entries(kit).filter(([, value]) => Array.isArray(value));
for (const vectors of [true, false]) {
  for (const [suite, cases] of suites) {
    const sessionRefs = suite === "PRIVACY_MATCH_CASES" ? "hashed" : "plain";
    const memory = embeddingRequiredFactory({ vectors, sessionRefs });
    const control = embeddingRequiredFactory({ vectors, sessionRefs, enforce: false, wrap: withStorageGuards });
    const wrapped = `wrapped guard, vectors ${vectors ? "on" : "off"}`;
    for (const [label, factory] of [[memory.name, memory], [wrapped, control]]) {
      for (const testCase of cases) {
        test(`${label} ${suite} ${testCase.id} ${testCase.title}`, async (t) => {
          const reason = await kit.runCase(factory, testCase);
          if (factory === control && ["K-FACT-3", "K-FACT-3r"].includes(testCase.id)) {
            assert.equal(reason, null, "The guarded fact slot case must pass");
          }
          if (reason !== null) {
            assert.match(reason, /\S/);
            t.skip(reason);
          }
        });
      }
    }
  }
}

for (const [port, check] of Object.entries(guardChecks)) {
  test(`${port} validates required embeddings before reading state`, async () => {
    const { adapter } = await embeddingRequiredFactory().open({ capabilities: {} });
    assert.equal(adapter.capabilities.embeddingRequiredOnInsert, true);
    await check(adapter);
  });
}

test("insufficient fixture dimensions return a reason and close the adapter", async () => {
  for (const [cases, id, embeddingDimensions, needed] of [
    [kit.CASES, "K-UOW-1", 2, 3],
    [kit.CAPTURE_CASES, "K-CLM-3", 3, 4],
  ]) {
    const factory = embeddingRequiredFactory({ embeddingDimensions });
    let closed = false;
    const tracked = {
      async open(options) {
        const opened = await factory.open(options);
        return { ...opened, async close() { await opened.close(); closed = true; } };
      },
    };
    const testCase = cases.find((candidate) => candidate.id === id);
    assert.equal(await kit.runCase(tracked, testCase),
      `embeddingRequiredOnInsert needs at least ${needed} dimensions for separated fixture vectors`);
    assert.equal(closed, true);
  }
});
