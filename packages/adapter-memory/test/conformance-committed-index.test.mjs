import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { COMMITTED_INDEX_CASES, runCase } from "@cairn-ink/conformance";
import { CAPABILITIES, OPTIONAL_PORTS } from "@cairn-ink/core";

const optional = new Set(Object.values(OPTIONAL_PORTS));
const standard = Object.fromEntries(CAPABILITIES
  .filter(flag => !optional.has(flag) && flag !== "embeddingRequiredOnInsert").map(flag => [flag, true]));
const hashSessionKey = (client, sessionId) => createHash("sha256").update(JSON.stringify([client, sessionId])).digest("hex");

function factory({ flags = {}, honorRequests = false, sessionRefs = "plain", wrap = adapter => adapter,
  create = createMemoryAdapter } = {}) {
  return {
    name: "memory",
    async open({ capabilities }) {
      const adapter = create({
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

test("K-IDX-COMMIT-1 rejects a stale first forecast", async () => {
  const wrap = adapter => {
    const { memories } = adapter;
    const reads = new WeakSet();
    return { ...adapter, memories: { ...memories, committedIndexRevision(tx) {
      if (reads.has(tx)) return memories.committedIndexRevision(tx);
      reads.add(tx);
      return memories.indexRevision(tx);
    } } };
  };
  await assert.rejects(runCase(factory({ wrap }), COMMITTED_INDEX_CASES[0]), {
    message: /^Memory insert: next start \(\d+\) must equal committed revision \(\d+\); run start was \d+$/u,
  });
});

function staleForecastAfter(port, method) {
  return adapter => {
    const { memories } = adapter;
    const written = new WeakSet();
    const writes = adapter[port];
    const mutated = { ...adapter, [port]: { ...writes, async [method](tx, ...args) {
      const result = await writes[method](tx, ...args);
      written.add(tx);
      return result;
    } } };
    return { ...mutated, memories: { ...mutated.memories,
      committedIndexRevision: tx => written.has(tx) ? memories.indexRevision(tx) : memories.committedIndexRevision(tx),
    } };
  };
}

for (const [port, method, scenario] of [
  ["memories", "replaceContent", "Memory correction"],
  ["memories", "touchDuplicate", "Memory duplicate merge"],
  ["memories", "erase", "Memory erase"],
  ["raw", "fenceSession", "Raw fence"],
  ["raw", "archive", "Raw archive"],
  ["raw", "deleteConversation", "Raw delete"],
  ["documentCards", "hide", "Card hide"],
]) {
  test(`K-IDX-COMMIT-2 rejects a stale forecast after ${scenario}`, async () => {
    const wrap = staleForecastAfter(port, method);
    await assert.rejects(runCase(factory({ honorRequests: true, wrap }), COMMITTED_INDEX_CASES[1]), {
      message: new RegExp(`^${scenario}: next start \\(\\d+\\) must equal committed revision \\(\\d+\\); run start was \\d+$`, "u"),
    });
  });
}

async function createMutant(name, module, before, after) {
  const entry = new URL("../src/index.mjs", import.meta.url);
  const target = new URL(module, entry);
  const original = await readFile(target, "utf8");
  assert.equal(original.split(before).length, 2, "Expected one mutation site");
  const source = original.replace(before, () => after);
  entry.searchParams.set("variant", name);
  target.search = entry.search;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(context.parentURL === entry.href && specifier === module ? target.href : specifier, context);
    },
    load(url, context, nextLoad) {
      return url === target.href ? { format: "module", shortCircuit: true, source } : nextLoad(url, context);
    },
  });
  try {
    return (await import(entry.href)).createMemoryAdapter;
  } finally {
    hooks.deregister();
  }
}

for (const [label, testCase, module, before, after, message] of [
  ["a card hide without a revision change", COMMITTED_INDEX_CASES[1], "./document-cards.mjs",
    "if (changed) recordCardWrite(run, namespace);", "if (changed) run.stateWritten = true;",
    /^Card hide: committed revision must differ from start \(\d+\)$/u],
  ["mixed writes without a revision change", COMMITTED_INDEX_CASES[2], "./unit-of-work.mjs",
    "export function indexRevisionAfterRun(run) {", `export function indexRevisionAfterRun(run) {
  if (run.indexDirty && run.state.indexRevision !== run.startIndexRevision) return run.startIndexRevision;`,
    /^Mixed writes: committed revision must differ from start \(\d+\)$/u],
  ["committing a different revision from the forecast", COMMITTED_INDEX_CASES[0], "./unit-of-work.mjs",
    "state.indexRevision = revision;", "state.indexRevision = revision + 1;",
    /^Memory insert: next start \(\d+\) must equal committed revision \(\d+\); run start was \d+$/u],
  ["keeping the inserted memory after rollback", COMMITTED_INDEX_CASES[3], "./unit-of-work.mjs",
    "const result = await fn(tx);", "const result = await fn(tx).catch(error => { current.committed = state; throw error; });",
    /^Rollback: the inserted memory must be absent after abort$/u],
]) {
  test(`${testCase.id} rejects ${label}`, async () => {
    const create = await createMutant(label, module, before, after);
    await assert.rejects(runCase(factory({ honorRequests: true, create }), testCase), { message });
  });
}
