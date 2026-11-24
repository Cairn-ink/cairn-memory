import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { NEAR_DUPLICATE_DISTANCE } from "@cairn-ink/core";
import { CASES, CAPTURE_CASES, runCase } from "@cairn-ink/conformance";
import { embeddingRequiredFactory, guardChecks } from "./fixtures/embedding-required.mjs";

const kitEntry = import.meta.resolve("@cairn-ink/conformance");
const { row } = await import(new URL("./support.mjs", kitEntry).href);
const factory = embeddingRequiredFactory();

async function loadMutant(moduleName, before, after) {
  const url = new URL(moduleName, kitEntry);
  const source = await readFile(url, "utf8");
  assert.equal(source.split(before).length, 2, "The installed kit must have exactly one mutation site");
  url.search = "mutant";
  const hooks = registerHooks({
    load(moduleUrl, context, nextLoad) {
      if (moduleUrl === url.href) return { format: "module", shortCircuit: true, source: source.replace(before, after) };
      return nextLoad(moduleUrl, context);
    },
  });
  try {
    return await import(url.href);
  } finally {
    hooks.deregister();
  }
}

function nearCase(rowFor, checkMatches) {
  return {
    id: "fixture-near",
    title: "keeps unrelated fixtures out of near matches",
    needs: ["nearDuplicate"],
    async run(ctx) {
      const { uow, memories } = ctx.adapter;
      const scope = ctx.scope(null);
      const first = await rowFor(ctx, "first fixture");
      const other = await rowFor(ctx, "different fixture");
      await uow.run(ctx.owner, {}, async (tx) => {
        await memories.insert(tx, scope, first, [], 1);
        await memories.insert(tx, scope, other, [], 1);
        if (checkMatches) {
          const [matches] = await memories.findDuplicates(tx, scope, [
            { textHash: other.textHash, embedding: other.embedding.vector },
          ], { nearDistance: NEAR_DUPLICATE_DISTANCE });
          assert.deepEqual(matches.map(({ match }) => match), ["exact"], "An unrelated fixture appeared as a near duplicate");
        }
      });
    },
  };
}

test("the near-duplicate checks kill the shared fixture vector mutant", async () => {
  const mutant = await loadMutant("./support.mjs", "vector[axis] = index % 2 === 0 ? 1 : -1;", "vector[2] = 1;");
  assert.equal(await runCase(factory, nearCase(mutant.row, false)), null);
  assert.equal(await runCase(factory, nearCase(row, true)), null);
  await assert.rejects(runCase(factory, nearCase(mutant.row, true)), /unrelated fixture appeared as a near duplicate/);

  const { captureCases } = await loadMutant("./capture-cases.mjs", '"./support.mjs"', '"./support.mjs?mutant"');
  const testCase = captureCases.find(({ id }) => id === "K-CLM-3");
  await assert.rejects(runCase(factory, testCase), /stored duplicate must count as a duplicate/);
});

test("the unembedded case kills the missing skip guard mutant", async () => {
  const { memoryCases } = await loadMutant("./memory-cases.mjs",
    '      if (capabilities.embeddingRequiredOnInsert) return "requires an unembedded row for exact and near-skip checks";\n',
    "");
  const naive = {
    id: "fixture-hash",
    title: "finds a fixture by hash",
    needs: [],
    async run(ctx) {
      const content = await row(ctx, "unembedded");
      const scope = ctx.scope(null);
      const { uow, memories } = ctx.adapter;
      await uow.run(ctx.owner, {}, async (tx) => {
        await memories.insert(tx, scope, content, [], 1);
        const [matches] = await memories.findDuplicates(tx, scope, [{ textHash: content.textHash }],
          { nearDistance: NEAR_DUPLICATE_DISTANCE });
        assert.deepEqual(matches.map(({ match }) => match), ["exact"]);
      });
    },
  };
  assert.equal(await runCase(factory, naive), null);
  assert.equal(await runCase(factory, CASES.find(({ id }) => id === "K-MEM-10")),
    "requires an unembedded row for exact and near-skip checks");
  await assert.rejects(runCase(factory, memoryCases.find(({ id }) => id === "K-MEM-10")), /Unembedded near skip count differs/);
});

test("the driver guard checks kill the adapter that advertises the flag and accepts null", async () => {
  const mutant = embeddingRequiredFactory({ enforce: false });
  const testCase = CAPTURE_CASES.find(({ id }) => id === "K-CLM-3");
  assert.equal(await runCase(mutant, testCase), null);
  const { adapter } = await mutant.open({ capabilities: {} });
  assert.equal(adapter.capabilities.embeddingRequiredOnInsert, true);
  await assert.rejects(guardChecks.insert(adapter), /Insert must reject a null embedding/);
  await assert.rejects(guardChecks.replaceContent(adapter), /Content replacement must reject a null embedding/);
  await assert.rejects(guardChecks.finish(adapter), /Finish must reject a batch containing a null embedding/);
});
