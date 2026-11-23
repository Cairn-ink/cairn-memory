import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { CASES, CAPTURE_CASES, runCase } from "@cairn-ink/conformance";
import { embeddingRequiredFactory } from "./fixtures/embedding-required.mjs";

test("required embeddings preserve the vector depth check", async () => {
  const testCase = CASES.find(({ id }) => id === "K-RET-3");
  const mutant = embeddingRequiredFactory({
    wrap(adapter) {
      return {
        ...adapter,
        vector: {
          ...adapter.vector,
          async vector(...args) {
            const result = await adapter.vector.vector(...args);
            return args[4] === 2 ? { ...result, rows: result.rows.slice(0, 1) } : result;
          },
        },
      };
    },
  });
  await assert.rejects(runCase(mutant, testCase), /Vector depth did not return the first two candidates/);
  assert.equal(await runCase(embeddingRequiredFactory({ embeddingDimensions: 2 }), testCase), null);
});

const support = await import(new URL("./support.mjs", import.meta.resolve("@cairn-ink/conformance")).href);

for (const required of [false, true]) {
  test(`a dump failure rejects with required embeddings ${required ? "on" : "off"}`, async () => {
    // Use the old constructor when present to exercise the original misclassification.
    const Failure = support.FixtureEmbeddingUnavailable ?? class FixtureEmbeddingUnavailable extends Error {};
    const failure = new Failure("state snapshot failed");
    const testCase = CASES.find(({ id }) => id === "K-UOW-1");
    const base = embeddingRequiredFactory();
    const mutant = {
      async open(options) {
        const opened = await base.open(options);
        return {
          ...opened,
          adapter: {
            ...opened.adapter,
            capabilities: { ...opened.adapter.capabilities, embeddingRequiredOnInsert: required },
          },
          harness: { ...opened.harness, async dump() { throw failure; } },
        };
      },
    };
    await assert.rejects(runCase(mutant, testCase), (error) => error === failure);
    assert.equal(support.FixtureEmbeddingUnavailable, undefined);
  });
}

test("a fixture exhaustion from another opened case cannot hide a dump failure", async () => {
  const base = embeddingRequiredFactory();
  const testCase = CASES.find(({ id }) => id === "K-UOW-1");
  let exhaustion;
  const reason = await runCase(embeddingRequiredFactory({ embeddingDimensions: 2 }), {
    ...testCase,
    async run(ctx) {
      try {
        await testCase.run(ctx);
      } catch (error) {
        exhaustion = error;
        throw error;
      }
    },
  });
  assert.match(reason, /needs at least 3 dimensions/);
  const mutant = {
    async open(options) {
      const opened = await base.open(options);
      return { ...opened, harness: { ...opened.harness, async dump() { throw exhaustion; } } };
    },
  };
  await assert.rejects(runCase(mutant, testCase), (error) => error === exhaustion);
});

async function loadAdapterIgnoringEmbeddedExactMatches(priorOnly) {
  const entry = new URL(import.meta.resolve("@cairn-ink/adapter-memory"));
  const store = new URL("./memory-store.mjs", entry);
  const [entrySource, storeSource] = await Promise.all([readFile(entry, "utf8"), readFile(store, "utf8")]);
  const exact = 'if (exact) return { match: "exact", distance: distance ?? 0 };';
  assert.equal(storeSource.split(exact).length, 2, "Expected one exact classification for embedded pairs");
  const prior = "classify(query, batch[j], nearDistance)";
  const classifier = "function classify(query, candidate, nearDistance)";
  assert.ok(storeSource.includes(prior) && storeSource.includes(classifier));
  const mutant = priorOnly
    ? storeSource.replace(classifier, "function classify(query, candidate, nearDistance, ignoreExact = false)")
      .replace(prior, "classify(query, batch[j], nearDistance, true)")
      .replace(exact, exact.replace("if (exact)", "if (exact && !ignoreExact)"))
    : storeSource.replace(exact, "");
  const variant = priorOnly ? "?prior-mutant" : "?exact-mutant";
  entry.search = variant;
  store.search = variant;
  const sources = new Map([
    [entry.href, entrySource.replace('"./memory-store.mjs"', `"./memory-store.mjs${variant}"`)],
    [store.href, mutant],
  ]);
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (sources.has(url)) return { format: "module", shortCircuit: true, source: sources.get(url) };
      return nextLoad(url, context);
    },
  });
  try {
    return (await import(entry.href)).createMemoryAdapter;
  } finally {
    hooks.deregister();
  }
}

test("capture requires exact dedupe with required embeddings and near matching enabled", async () => {
  const testCase = CAPTURE_CASES.find(({ id }) => id === "K-CLM-3");
  for (const [priorOnly, expected] of [
    [true, /The in-batch copy must count as a duplicate/],
    [false, /The stored duplicate must count as a duplicate/],
  ]) {
    const createMutant = await loadAdapterIgnoringEmbeddedExactMatches(priorOnly);
    const mutant = embeddingRequiredFactory({
      wrap: ({ capabilities }) => createMutant({ capabilities, now: () => 0 }),
    });
    await assert.rejects(runCase(mutant, testCase), expected);
  }
  assert.equal(await runCase(embeddingRequiredFactory(), testCase), null);
});
