import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { ADMISSION_CASES, IMPORT_TIME_CASES, runCase } from "@cairn-ink/conformance";

function factory(mutate = () => ({}), createAdapter = createMemoryAdapter) {
  return {
    async open({ capabilities }) {
      const original = createAdapter({ capabilities, now: () => 0 });
      const adapter = { ...original, ...mutate(original) };
      return {
        adapter, harness: original.harness, nativeErrorMap: original.nativeErrorMap,
        sessionRefs: "plain", busyNativeCodes: [], embeddingDimensions: null,
        async close() {},
      };
    },
  };
}

async function captureMutantFactory(before, after) {
  const entry = new URL("../src/index.mjs", import.meta.url);
  const capture = new URL("./capture.mjs", entry);
  entry.searchParams.set("mutation", after);
  capture.search = entry.search;
  const original = await readFile(capture, "utf8");
  assert.equal(original.split(before).length, 2, "Expected one capture mutation site");
  const source = original.replace(before, () => after);
  const hooks = registerHooks({
    resolve(request, context, nextResolve) {
      return nextResolve(context.parentURL === entry.href && request === "./capture.mjs" ? capture.href : request, context);
    },
    load(url, context, nextLoad) {
      return url === capture.href ? { format: "module", source, shortCircuit: true } : nextLoad(url, context);
    },
  });
  try {
    return factory(undefined, (await import(entry.href)).createMemoryAdapter);
  } finally {
    hooks.deregister();
  }
}

function changeAdmit(change) {
  return ({ capture }) => ({ capture: {
    ...capture, admit: (...args) => change(capture, ...args),
  } });
}

function changeLoad(change) {
  return ({ capture }) => ({ capture: {
    ...capture, load: (...args) => change(capture, ...args),
  } });
}

function changeInsert(change) {
  return ({ memories }) => ({ memories: {
    ...memories, insert: (...args) => change(memories, ...args),
  } });
}

function statusWrites(write) {
  return (adapter) => ({ capture: {
    ...adapter.capture,
    async status(tx, scope, ...args) {
      const status = await adapter.capture.status(tx, scope, ...args);
      await adapter.uow.run(scope.owner, { pauseLock: true }, writeTx => write(adapter, writeTx, scope));
      return status;
    },
  } });
}

function failedBeforePending({ capture }) {
  let terminal;
  return { capture: {
    ...capture,
    async abandon(tx, token, failure) {
      await capture.abandon(tx, token, failure);
      if (!failure.retryable) terminal = failure.code;
    },
    async status(tx, scope, eventId, client) {
      const result = await capture.status(tx, scope, eventId, client);
      if (terminal && client === undefined && result.status === "pending") return { status: "failed", code: terminal };
      return result;
    },
  } };
}

function returnsSharedLoad({ capture }) {
  const reads = new WeakMap();
  return { capture: {
    ...capture,
    async load(tx, selection) {
      if (!reads.has(tx)) reads.set(tx, await capture.load(tx, selection));
      return reads.get(tx);
    },
  } };
}

function acceptsInvalidTime(accept) {
  return changeInsert((memories, tx, scope, row, receipts, nowMs) =>
    memories.insert(tx, scope, {
      ...row, createdAtMs: accept(row.createdAtMs, nowMs) ? undefined : row.createdAtMs,
    }, receipts, nowMs));
}

const mutants = [
  ["K-ADM-1", "admit reverses the input in place before saving", changeAdmit((capture, tx, key, messages) => {
    messages.reverse();
    return capture.admit(tx, key, messages);
  }), /Load must return the admitted key and ordered messages/],
  ["K-ADM-1", "load reverses message order", changeLoad(async (capture, tx, selection) => {
    const loaded = await capture.load(tx, selection);
    if (loaded) loaded.messages.reverse();
    return loaded;
  }), /Load must return the admitted key and ordered messages/],
  ["K-ADM-2", "admit drops the stored finish result", changeAdmit(async (capture, ...args) => {
    const result = await capture.admit(...args);
    return result.status === "rawReplay" ? { status: "duplicate" } : result;
  }), /Redelivery must return the stored finish result/],
  ["K-ADM-3", "admit ignores the payload digest", changeAdmit((capture, tx, key, messages) =>
    capture.admit(tx, { ...key, payloadDigest: "a".repeat(64) }, messages)), /Expected operation to reject/],
  ["K-ADM-4", "admit deduplicates per namespace", changeAdmit((capture, tx, key, messages) =>
    capture.admit(tx, { ...key, eventId: JSON.stringify([key.scope.namespace, key.eventId]) }, messages)),
  /The namespace must not partition admission identity/],
  ["K-ADM-5", "admit accepts unlocked writes", ({ uow }) => ({ uow: {
    run: (owner, options, work) => uow.run(owner, { ...options, pauseLock: true }, work),
  } }), /Expected operation to reject/],
  ["K-ADM-6", "status prioritizes terminal failures over pending work", failedBeforePending,
    /Pending must take precedence over failed/],
  ["K-ADM-6", "status exposes failure details", ({ capture }) => ({ capture: {
    ...capture,
    async status(...args) {
      const result = await capture.status(...args);
      return result.status === "failed" ? { ...result, message: "Private error detail." } : result;
    },
  } }), /Failed must take precedence over done and expose only the code/],
  ["K-ADM-7", "status writes owner state", statusWrites(({ pause }, tx, scope) => pause.set(tx, scope.owner, true)),
    /Status must leave the dump unchanged/],
  ["K-ADM-7", "status advances the index revision", statusWrites(({ memories }, tx, scope) => memories.erase(tx, scope, "absent")),
    /Status must leave the state token unchanged/],
  ["K-ADM-8", "admit drops all-withheld batches", changeAdmit((capture, tx, key, messages) =>
    messages.every(({ content }) => content === "") ? { status: "duplicate" } : capture.admit(tx, key, messages)),
  /An all-withheld batch must be admitted/],
  ["K-ADM-9", "load reuses a mutable result within a run", returnsSharedLoad,
    /Load output must not mutate the admission/],
  ["K-IMP-T1", "insert ignores the supplied creation time", acceptsInvalidTime(() => true), /Creation time for past/],
  ["K-IMP-T1", "insert also uses creation time for the update", changeInsert((memories, tx, scope, row, receipts, nowMs) =>
    memories.insert(tx, scope, row, receipts, row.createdAtMs ?? nowMs)), /Update time for past/],
  ["K-IMP-T2", "insert accepts future creation times", acceptsInvalidTime((created, now) => created > now),
    /Expected operation to reject/],
  ["K-IMP-T2", "insert accepts fractional creation times", acceptsInvalidTime(created => Number.isFinite(created) && !Number.isInteger(created)),
    /Expected operation to reject/],
  ["K-IMP-T2", "insert accepts unsafe integer creation times", acceptsInvalidTime(created => Number.isInteger(created) && !Number.isSafeInteger(created)),
    /Expected operation to reject/],
  ["K-IMP-T3", "lexical retrieval ignores the creation window", ({ lexical }) => ({ lexical: {
    ...lexical, lexical: (tx, scope, ...args) => lexical.lexical(tx, { ...scope, window: undefined }, ...args),
  } }), /Lexical window must include imports by stored creation time/],
  ["K-IMP-T3", "recent orders results by creation time", ({ recent }) => ({ recent: {
    ...recent,
    async recent(...args) {
      const page = await recent.recent(...args);
      return { ...page, items: [...page.items].sort((a, b) => b.createdAtMs - a.createdAtMs) };
    },
  } }), /Recent window must use creation time with update time ordering/],
];

for (const [id, defect, mutate, failure] of mutants) {
  test(`${id} detects when ${defect}`, async () => {
    const testCase = [...ADMISSION_CASES, ...IMPORT_TIME_CASES].find(candidate => candidate.id === id);
    assert.ok(testCase);
    await assert.rejects(runCase(factory(mutate), testCase), failure);
  });
}

for (const [id, failure] of [
  ["K-ADM-10", /Admission must not allow a second lease/],
  ["K-ADM-11", /Admission must replay a standalone finish/],
  ["K-ADM-12", /Admission must honor a terminal standalone abandon/],
  ["K-ADM-13", /Expected operation to reject/],
  ["K-ADM-14", /A live lease must take precedence over a finish/],
]) {
  test(`${id} detects when admit ignores standalone claims`, async () => {
    const mutant = await captureMutantFactory(
      "if (row.key.client !== copy.client",
      "if (!row.messages || row.key.client !== copy.client",
    );
    const testCase = ADMISSION_CASES.find(candidate => candidate.id === id);
    assert.ok(testCase);
    await assert.rejects(runCase(mutant, testCase), failure);
  });
}
