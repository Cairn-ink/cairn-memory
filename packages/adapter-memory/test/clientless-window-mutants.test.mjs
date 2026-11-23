import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { PRIVACY_MATCH_CASES, runCase } from "@cairn-ink/conformance";

function memoryFactory(create) {
  return {
    name: "memory snapshot",
    async open({ capabilities }) {
      const adapter = create({ capabilities });
      return {
        adapter, sessionRefs: "plain", harness: adapter.harness, nativeErrorMap: adapter.nativeErrorMap,
        busyNativeCodes: [], embeddingDimensions: null, async close() {},
      };
    },
  };
}

async function loadMutant(id, replacements) {
  const entry = new URL("../src/index.mjs", import.meta.url);
  const privacy = new URL("./privacy.mjs", entry);
  const matcher = new URL("./fact-match.mjs", entry);
  let source = readFileSync(matcher, "utf8");
  entry.searchParams.set("variant", id);
  privacy.searchParams.set("variant", id);
  matcher.searchParams.set("variant", id);
  for (const [before, after] of replacements) {
    assert.equal(source.split(before).length, 2, `Expected one mutation site for ${id}`);
    source = source.replace(before, () => after);
  }

  const hooks = registerHooks({
    resolve(request, context, nextResolve) {
      if (context.parentURL === entry.href && request === "./privacy.mjs") {
        return nextResolve(privacy.href, context);
      }
      // The entry point imports the matcher and the privacy port imports the candidate copier.
      if ((context.parentURL === entry.href || context.parentURL === privacy.href) && request === "./fact-match.mjs") {
        return nextResolve(matcher.href, context);
      }
      return nextResolve(request, context);
    },
    load(url, context, nextLoad) {
      if (url === matcher.href) return { format: "module", source, shortCircuit: true };
      return nextLoad(url, context);
    },
  });
  try {
    const { createMemoryAdapter: createMutant } = await import(entry.href);
    return memoryFactory(createMutant);
  } finally {
    hooks.deregister();
  }
}

const windowMatch = "factBlocksIncoming(stored,\n          { scope, passages: [], session, occurredAtMs: time }, capture)";
const mutants = [
  ["K-SNAP-F3", "bypasses windows without a client", /Owner-wide window must use half-open bounds without a client/, [
    ["const occurredAtMs = candidates.occurredAtMs;",
      "const occurredAtMs = client == null ? undefined : candidates.occurredAtMs;"],
    ["blockedMessages: occurredAtMs ?", "blockedMessages: client != null && occurredAtMs ?"],
  ]],
  ["K-SNAP-F5", "admits an ineligible client-specific match", /Client-specific window must block all times without a client/, [
    [`${windowMatch} !== false`, `${windowMatch} === true`],
  ]],
  ["K-SNAP-F4", "ignores unknown time", /Owner-wide window must block unknown time when enabled/, [
    ["of occurredAtMs.entries()) {", "of occurredAtMs.entries()) {\n        if (time === null) continue;"],
  ]],
];

for (const [id, label, failure, replacements] of mutants) {
  test(`${id} detects a snapshot that ${label}`, async () => {
    const testCase = PRIVACY_MATCH_CASES.find((candidate) => candidate.id === id);
    assert.ok(testCase);
    assert.equal(await runCase(memoryFactory(createMemoryAdapter), testCase), null);
    const mutant = await loadMutant(id, replacements);
    await assert.rejects(runCase(mutant, testCase), failure);
  });
}

test("clientless snapshots read the time field once and validate indexed data", async () => {
  const { harness, suppressions, uow } = createMemoryAdapter();
  const owner = "test-owner";
  const scope = { owner, namespace: null };
  await harness.seedFact(owner, {
    owner, actionId: "window", kind: "window", origin: "forget", client: null, window: { startMs: 10, endMs: 20 },
  });
  await uow.run(owner, { readOnly: true }, async (tx) => {
    for (const source of [{}, { client: null }]) {
      const times = Object.defineProperty([9, 10, 20], "entries", { value: function* () {} });
      let reads = 0;
      const result = await suppressions.snapshot(tx, scope, {
        ...source,
        get occurredAtMs() { reads++; return times; },
      });
      assert.deepEqual(result.blockedMessages, [1]);
      assert.equal(reads, 1);

      const accessor = Object.defineProperty([], "0", { get() { reads++; return 10; } });
      await assert.rejects(suppressions.snapshot(tx, scope, { ...source, occurredAtMs: accessor }), { code: "invalid_input" });
      assert.equal(reads, 1);
    }
  });
});
