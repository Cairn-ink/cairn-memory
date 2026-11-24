import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CASES, runCase } from "@cairn-ink/conformance";
import { CoreError, compareSortKey, compareUtf8 } from "@cairn-ink/core";

function factory(wrap, { newId, embeddingDimensions = null } = {}) {
  return {
    name: "memory mutant",
    async open({ capabilities }) {
      const adapter = createMemoryAdapter({ capabilities, newId });
      return wrap({
        adapter,
        harness: adapter.harness,
        nativeErrorMap: adapter.nativeErrorMap,
        busyNativeCodes: [],
        embeddingDimensions,
        async close() {},
      });
    },
  };
}

function withPorts(opened, ports) {
  return { ...opened, adapter: { ...opened.adapter, ...ports } };
}

function ignoresPauseLock(opened) {
  const { uow } = opened.adapter;
  return withPorts(opened, {
    uow: { run: (owner, { pauseLock, ...options }, fn) => uow.run(owner, options, fn) },
  });
}

function takesWriteLockFirst(opened) {
  const { uow } = opened.adapter;
  const tails = new Map();
  async function withPause(owner, fn) {
    const previous = tails.get(owner);
    let release;
    const tail = new Promise((resolve) => { release = resolve; });
    tails.set(owner, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (tails.get(owner) === tail) tails.delete(owner);
    }
  }
  return withPorts(opened, {
    uow: {
      run(owner, { pauseLock, ...options }, fn) {
        if (!pauseLock) return uow.run(owner, options, fn);
        if (options.readOnly) return withPause(owner, () => uow.run(owner, options, fn));
        return uow.run(owner, options, (tx) => withPause(owner, () => fn(tx)));
      },
    },
  });
}

function delaysPausedWriters(opened, delayMs = 0) {
  const { uow } = opened.adapter;
  return withPorts(opened, {
    uow: {
      async run(owner, options, fn) {
        if (options.pauseLock && !options.readOnly) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        return uow.run(owner, options, fn);
      },
    },
  });
}

function dumpsMap(opened) {
  const { harness } = opened;
  return { ...opened, harness: { ...harness, async dump() { return new Map((await harness.dump()).entries()); } } };
}

function replaysInsertsAfterFailure(opened) {
  const { uow, memories } = opened.adapter;
  const inserts = new WeakMap();
  return withPorts(opened, {
    uow: {
      async run(owner, options, fn) {
        const pending = [];
        try {
          return await uow.run(owner, options, (tx) => {
            inserts.set(tx, pending);
            return fn(tx);
          });
        } catch (error) {
          if (pending.length > 0) {
            await uow.run(owner, options, async (tx) => {
              for (const args of pending) await memories.insert(tx, ...args);
            });
          }
          throw error;
        }
      },
    },
    memories: {
      ...memories,
      async insert(tx, ...args) {
        const result = await memories.insert(tx, ...args);
        inserts.get(tx).push(args);
        return result;
      },
    },
  });
}

function bypassesTxChecksForIssuedIds(opened) {
  const { uow, memories } = opened.adapter;
  const scopes = new Map();
  return withPorts(opened, {
    memories: {
      ...memories,
      async insert(tx, scope, ...args) {
        const result = await memories.insert(tx, scope, ...args);
        scopes.set(result.id, scope);
        return result;
      },
      async get(tx, scope, id) {
        if (!scopes.has(id)) throw new CoreError("internal_error");
        try {
          return await memories.get(tx, scope, id);
        } catch (error) {
          if (error.code !== "internal_error") throw error;
          const savedScope = scopes.get(id);
          return uow.run(savedScope.owner, { readOnly: true }, (live) => memories.get(live, savedScope, id));
        }
      },
    },
  });
}

function coarseClock(opened) {
  const { memories } = opened.adapter;
  return withPorts(opened, {
    memories: {
      ...memories,
      insert: (tx, scope, row, receipts) => memories.insert(tx, scope, row, receipts, 1),
      touchDuplicate: (tx, scope, id, receipts, merge) => memories.touchDuplicate(tx, scope, id, receipts, merge, 1),
    },
  });
}

function dropsConfidenceOnlyMerge(opened) {
  const { memories } = opened.adapter;
  const missedRevisions = new Map();
  return withPorts(opened, {
    memories: {
      ...memories,
      async touchDuplicate(tx, scope, id, receipts, merge, nowMs) {
        const row = await memories.get(tx, scope, id);
        let missed = missedRevisions.get(id) ?? 0;
        const dropsChange = row && merge.kind === undefined && merge.origin === undefined &&
          merge.confidence !== row.confidence;
        if (dropsChange) {
          missedRevisions.set(id, ++missed);
          merge = { ...merge, confidence: row.confidence };
        }
        const result = await memories.touchDuplicate(tx, scope, id, receipts, merge, nowMs);
        return { outcome: dropsChange ? "changed" : result.outcome, revision: result.revision + missed };
      },
    },
  });
}

function bumpsRevisionForReceipt(opened) {
  const { memories } = opened.adapter;
  return withPorts(opened, {
    memories: {
      ...memories,
      async touchDuplicate(tx, scope, id, receipts, merge, nowMs) {
        const result = await memories.touchDuplicate(tx, scope, id, receipts, merge, nowMs);
        if (receipts.length > 0 && result.outcome === "touched") {
          return { outcome: "changed", revision: result.revision + 1 };
        }
        return result;
      },
    },
  });
}

function blocksUnrelatedSources(opened) {
  const { memories } = opened.adapter;
  return withPorts(opened, {
    memories: {
      ...memories,
      async readWritePolicy(tx, scope, batch, source, ...args) {
        const result = await memories.readWritePolicy(tx, scope, batch, source, ...args);
        return { ...result, blockedSession: source.client !== null && source.sessionId !== null };
      },
    },
  });
}

function hidesOnlyExactIds(opened) {
  const { memories } = opened.adapter;
  return withPorts(opened, {
    memories: {
      ...memories,
      async readWritePolicy(...args) {
        const result = await memories.readWritePolicy(...args);
        const exactIds = new Set(result.matches.flat()
          .filter((match) => match.kind === "stored" && match.match === "exact").map(({ id }) => id));
        return { ...result, hiddenIds: result.hiddenIds.filter((id) => exactIds.has(id)) };
      },
    },
  });
}

function acceptsEmptyCursor(opened) {
  const { memories } = opened.adapter;
  return withPorts(opened, {
    memories: {
      ...memories,
      exportPage: (tx, scope, page) => memories.exportPage(tx, scope, { ...page, cursor: page.cursor || null }),
    },
  });
}

function changesExportedText(opened) {
  const { memories } = opened.adapter;
  let calls = 0;
  return withPorts(opened, {
    memories: {
      ...memories,
      async exportPage(...args) {
        const page = await memories.exportPage(...args);
        if (++calls !== 2) return page;
        const [first, ...rest] = page.items;
        return { ...page, items: [{ ...first, text: `${first.text} changed` }, ...rest] };
      },
    },
  });
}

function issuesFreshCursors(opened) {
  const { memories } = opened.adapter;
  let sequence = 0;
  return withPorts(opened, {
    memories: {
      ...memories,
      async exportPage(tx, scope, { cursor, limit }) {
        const page = await memories.exportPage(tx, scope, { cursor: cursor?.replace(/\.\d+$/, "") ?? null, limit });
        return { ...page, nextCursor: page.nextCursor === null ? null : `${page.nextCursor}.${++sequence}` };
      },
    },
  });
}

function returnsRowInstances(opened) {
  const { memories } = opened.adapter;
  class Row {
    constructor(fields) {
      Object.assign(this, fields);
    }
  }
  return withPorts(opened, {
    memories: {
      ...memories,
      async get(...args) {
        const row = await memories.get(...args);
        return row === null ? null : new Row(row);
      },
      async exportPage(...args) {
        const page = await memories.exportPage(...args);
        return { ...page, items: page.items.map((row) => new Row(row)) };
      },
    },
  });
}

function losesConcurrentOwnerWrite(opened) {
  const { uow, memories } = opened.adapter;
  let firstWriter;
  let overlappingInsert;
  return withPorts(opened, {
    uow: {
      async run(owner, options, fn) {
        const first = firstWriter === undefined && !options.readOnly;
        if (first) firstWriter = owner;
        const result = await uow.run(owner, options, fn);
        if (first && overlappingInsert) {
          const { scope, id } = overlappingInsert;
          await uow.run(scope.owner, {}, (tx) => memories.erase(tx, scope, id));
        }
        return result;
      },
    },
    memories: {
      ...memories,
      async insert(tx, scope, ...args) {
        const result = await memories.insert(tx, scope, ...args);
        if (scope.owner !== firstWriter) overlappingInsert = { scope, id: result.id };
        return result;
      },
    },
  });
}

const regressions = [
  ["ignores the pause lock", "K-UOW-3r", ignoresPauseLock, /Pause-lock writer entered while the reader held the pause lock/],
  ["takes the write lock first", "K-UOW-3r", takesWriteLockFirst, /Concurrent runs exceeded 5100 ms/],
  ["delays paused writers and ignores the pause lock", "K-UOW-3r", (opened) => delaysPausedWriters(ignoresPauseLock(opened)),
    /Pause-lock writer entered while the reader held the pause lock/],
  ["delays paused writers and takes the write lock first", "K-UOW-3r", (opened) => delaysPausedWriters(takesWriteLockFirst(opened)),
    /Concurrent runs exceeded 5100 ms/],
  ["returns a Map dump", "K-UOW-1", dumpsMap, /dump\(\) must return JSON-safe data.*Map/],
  ["commits inserts after a callback fails", "K-UOW-1", replaysInsertsAfterFailure, /Callback failure did not roll back/],
  ["bypasses transaction checks for issued ids", "K-UOW-7", bypassesTxChecksForIssuedIds, /Expected operation to reject/],
  ["drops a confidence-only merge", "K-MEM-4", dropsConfidenceOnlyMerge, /Confidence-only merge was not applied verbatim/],
  ["reports a revision bump for receipts alone", "K-MEM-4", bumpsRevisionForReceipt, /Receipts alone should leave the revision unchanged/],
  ["blocks unrelated sources", "K-MEM-13", blocksUnrelatedSources, /A different session of the same client was blocked/],
  ["omits ids of hidden near-only matches", "K-MEM-13", hidesOnlyExactIds, /A hidden near-only match should report its id/],
  ["accepts an empty cursor", "K-MEM-12", acceptsEmptyCursor, /Expected operation to reject/],
  ["loses another owner's committed write", "K-UOW-2", losesConcurrentOwnerWrite, /Another owner's committed row was lost/],
];

function run(id, wrap, options) {
  const testCase = CASES.find((candidate) => candidate.id === id);
  assert.ok(testCase, `Unknown conformance case ${id}`);
  return runCase(factory(wrap, options), testCase);
}

for (const [description, id, wrap, failure] of regressions) {
  test(`${id} rejects an adapter that ${description}`, async () => {
    await assert.rejects(() => run(id, wrap), failure);
  });
}

test("K-MEM-4 accepts a coarse write clock", async () => {
  assert.equal(await run("K-MEM-4", coarseClock), null);
});

test("K-MEM-12 rejects changed exported text on re-read", async () => {
  await assert.rejects(() => run("K-MEM-12", changesExportedText), /First page cursor reached different items on re-read/);
});

test("K-UOW-3 and K-UOW-3r allow settle waits on top of the concurrency bound", { timeout: 2000 }, async (t) => {
  const delayMs = 175;
  const settleMs = 4800;
  const timeoutMs = 4900;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const wrap = (opened) => delaysPausedWriters({ ...opened, settleMs, timeoutMs }, delayMs);
  // The reader phase overlaps the writer delay with settling. The writer phase
  // waits for the held writer and then the other owner before settling.
  for (const [id, steps] of [
    ["K-UOW-3r", [delayMs, settleMs - delayMs]],
    ["K-UOW-3", [delayMs, delayMs, settleMs]],
  ]) {
    const result = run(id, wrap);
    result.catch(() => {});
    for (const step of steps) {
      await setImmediate();
      t.mock.timers.tick(step);
    }
    assert.equal(await result, null);
  }
});

test("K-MEM-12 accepts fresh cursors for the same position", async () => {
  assert.equal(await run("K-MEM-12", issuesFreshCursors), null);
});

test("K-MEM-4 and K-MEM-12 accept row instances", async () => {
  assert.equal(await run("K-MEM-4", returnsRowInstances), null);
  assert.equal(await run("K-MEM-12", returnsRowInstances), null);
});

test("runCase rejects when the adapter never closes", async () => {
  await assert.rejects(() => run("K-ERR-1", (opened) => ({
    ...opened,
    close: () => new Promise(() => {}),
  })), /Adapter close exceeded 5000 ms/);
});

test("runCase preserves the case error when the adapter never closes", async () => {
  const failure = new Error("case failed");
  const testCase = {
    id: "close-failure",
    title: "throws a case error",
    needs: [],
    async run() { throw failure; },
  };
  await assert.rejects(() => runCase(factory((opened) => ({
    ...opened,
    close: () => new Promise(() => {}),
  })), testCase), (error) => {
    assert.strictEqual(error instanceof AggregateError ? error.errors[0] : error, failure);
    assert.match(error.cause?.message ?? "", /Adapter close exceeded 5000 ms/);
    return true;
  });
});

function lexicalOutsideReadSet(opened) {
  const { lexical } = opened.adapter;
  return withPorts(opened, {
    lexical: {
      lexical: (tx, scope, ...args) => lexical.lexical(tx, { ...scope, namespaces: [...scope.namespaces, "outside"] }, ...args),
    },
  });
}

function newestFirst(a, b) {
  return compareSortKey(b.updatedAtUs, a.updatedAtUs) || compareUtf8(b.id, a.id);
}

function namespaceDescending(a, b) {
  return a === b ? 0 : a === null ? 1 : b === null ? -1 : compareUtf8(b, a);
}

function lexicalNewestTies(opened) {
  const { lexical } = opened.adapter;
  return withPorts(opened, {
    lexical: {
      async lexical(tx, scope, query, depth, options) {
        const result = await lexical.lexical(tx, scope, query, Number.MAX_SAFE_INTEGER, options);
        const rows = result.rows.sort((a, b) => b.score - a.score ||
          newestFirst({ ...a, id: a.ref.id }, { ...b, id: b.ref.id }));
        return { ...result, rows: rows.slice(0, depth) };
      },
    },
  });
}

function lexicalAlwaysMatches(opened) {
  const { lexical } = opened.adapter;
  return withPorts(opened, {
    lexical: { async lexical(...args) { return { ...await lexical.lexical(...args), matched: true }; } },
  });
}

function lexicalWithScore(opened, score, onlyDepth) {
  const { lexical } = opened.adapter;
  return withPorts(opened, {
    lexical: {
      async lexical(tx, scope, query, depth, options) {
        const result = await lexical.lexical(tx, scope, query, depth, options);
        if (onlyDepth !== undefined && depth !== onlyDepth) return result;
        return { ...result, rows: result.rows.map((row) => ({ ...row, score })) };
      },
    },
  });
}

function vectorWithCappedDistances(opened, distance) {
  const { vector } = opened.adapter;
  return withPorts(opened, {
    vector: {
      async vector(tx, scope, query, model, depth) {
        const result = await vector.vector(tx, scope, query, model, depth);
        if (depth !== 2) return result;
        return { ...result, rows: result.rows.map((row) => ({ ...row, distance })) };
      },
    },
  });
}

function vectorWithIdenticalRoundoff(opened) {
  const { memories, vector } = opened.adapter;
  return withPorts(opened, {
    vector: {
      async vector(tx, scope, query, model, depth) {
        const result = await vector.vector(tx, scope, query, model, depth);
        if (depth !== 2) return result;
        // Query with the nearest row's own embedding for the capped search.
        const { id, namespace } = result.rows[0].ref;
        const { embedding } = await memories.get(tx, { owner: scope.owner, namespace }, id);
        const identical = await vector.vector(tx, scope, embedding.vector, model, depth);
        const [nearest, ...rest] = identical.rows;
        assert.equal(nearest.distance, 0);
        return { ...identical, rows: [{ ...nearest, distance: -1.1920929e-7 }, ...rest] };
      },
    },
  });
}

function vectorSearchesAllOwnerNamespaces(opened) {
  const { memories, vector } = opened.adapter;
  const namespacesByOwner = new Map();
  return withPorts(opened, {
    memories: {
      ...memories,
      async insert(tx, scope, ...args) {
        const result = await memories.insert(tx, scope, ...args);
        if (!namespacesByOwner.has(scope.owner)) namespacesByOwner.set(scope.owner, new Set());
        namespacesByOwner.get(scope.owner).add(scope.namespace);
        return result;
      },
    },
    vector: {
      vector: (tx, scope, ...args) => vector.vector(tx, {
        ...scope, namespaces: [...namespacesByOwner.get(scope.owner)],
      }, ...args),
    },
  });
}

function vectorIgnoresLength(opened) {
  const { vector } = opened.adapter;
  const dimensions = opened.embeddingDimensions ?? 4;
  return withPorts(opened, {
    vector: {
      vector(tx, scope, query, ...args) {
        const resized = new Float32Array(dimensions);
        resized.set(query.subarray(0, dimensions));
        return vector.vector(tx, scope, resized, ...args);
      },
    },
  });
}

function storesNativeWidthOnly(opened) {
  const { memories } = opened.adapter;
  return withPorts(opened, {
    memories: {
      ...memories,
      async insert(tx, scope, content, ...args) {
        if (content.embedding && content.embedding.vector.length !== opened.embeddingDimensions) {
          throw new CoreError("invalid_input");
        }
        return memories.insert(tx, scope, content, ...args);
      },
    },
  });
}

function vectorAlwaysComplete(opened) {
  const { vector } = opened.adapter;
  return withPorts(opened, {
    vector: {
      async vector(...args) {
        const result = await vector.vector(...args);
        return { ...result, coverage: { ...result.coverage, complete: true } };
      },
    },
  });
}

function vectorIgnoresModel(opened) {
  const { vector } = opened.adapter;
  return withPorts(opened, {
    vector: {
      async vector(tx, scope, query, model, depth) {
        const { rows, coverage: { eligible, embedded } } = await vector.vector(tx, scope, query, model, depth);
        const other = await vector.vector(tx, scope, query, "other", depth);
        const combined = [...rows, ...other.rows].sort((a, b) => a.distance - b.distance ||
          compareSortKey(b.updatedAtUs, a.updatedAtUs) || compareUtf8(b.ref.id, a.ref.id));
        const total = embedded + other.coverage.embedded;
        return { rows: combined.slice(0, depth), coverage: { eligible, embedded: total, complete: total === eligible } };
      },
    },
  });
}

function recentUsesRunLocalCursors(opened) {
  const { recent } = opened.adapter;
  const issuedBy = new Map();
  return withPorts(opened, {
    recent: {
      async recent(tx, scope, page) {
        if (page.cursor !== null && issuedBy.get(page.cursor) !== tx) throw new CoreError("invalid_cursor");
        const result = await recent.recent(tx, scope, page);
        if (result.nextCursor !== null) issuedBy.set(result.nextCursor, tx);
        return result;
      },
    },
  });
}

function recentKeepsLatestCursor(opened) {
  const { recent } = opened.adapter;
  const latestByOwner = new Map();
  let sequence = 0;
  return withPorts(opened, {
    recent: {
      async recent(tx, scope, { cursor, limit }) {
        const latest = latestByOwner.get(scope.owner);
        if (cursor !== null && cursor !== latest?.issued) throw new CoreError("invalid_cursor");
        const result = await recent.recent(tx, scope, { cursor: cursor === null ? null : latest.cursor, limit });
        if (result.nextCursor === null) return result;
        const issued = String(++sequence);
        latestByOwner.set(scope.owner, { issued, cursor: result.nextCursor });
        return { ...result, nextCursor: issued };
      },
    },
  });
}

function recentNamespaceDescending(opened) {
  const { recent } = opened.adapter;
  const positions = new Map();
  const order = (a, b) => newestFirst(a, b) || namespaceDescending(a.scope.namespace, b.scope.namespace);
  return withPorts(opened, {
    recent: {
      async recent(tx, scope, { cursor, limit }) {
        if (limit < 1 || (cursor !== null && !positions.has(cursor))) {
          return recent.recent(tx, scope, { cursor, limit });
        }
        const { items } = await recent.recent(tx, scope, { cursor: null, limit: Number.MAX_SAFE_INTEGER });
        const remaining = (cursor === null ? items : items.filter((row) => order(row, positions.get(cursor)) > 0)).sort(order);
        const page = remaining.slice(0, limit);
        const nextCursor = remaining.length > limit ? String(positions.size) : null;
        if (nextCursor !== null) positions.set(nextCursor, page.at(-1));
        return { items: page, nextCursor };
      },
    },
  });
}

function recentTimeOnlyCursor(opened) {
  const { recent } = opened.adapter;
  const cursorTimes = new Map();
  return withPorts(opened, {
    recent: {
      async recent(tx, scope, { cursor, limit }) {
        if (limit < 1 || (cursor !== null && !cursorTimes.has(cursor))) {
          return recent.recent(tx, scope, { cursor, limit });
        }
        const { items } = await recent.recent(tx, scope, { cursor: null, limit: Number.MAX_SAFE_INTEGER });
        const after = cursor === null ? items : items.filter(({ updatedAtUs }) => updatedAtUs < cursorTimes.get(cursor));
        const page = after.slice(0, limit);
        const nextCursor = after.length > limit ? String(cursorTimes.size) : null;
        if (nextCursor !== null) cursorTimes.set(nextCursor, page.at(-1).updatedAtUs);
        return { items: page, nextCursor };
      },
    },
  });
}

function recentLeaksHiddenRow(opened) {
  const { recent, memories } = opened.adapter;
  const { harness } = opened;
  let hidden;
  return {
    ...withPorts(opened, {
      recent: {
        async recent(tx, scope, page) {
          const result = await recent.recent(tx, scope, page);
          if (page.cursor !== null || !hidden || result.items.length === 0) return result;
          const row = await memories.get(tx, hidden.scope, hidden.id);
          return { ...result, items: [row, ...result.items.slice(1)] };
        },
      },
    }),
    harness: {
      ...harness,
      async seedFact(owner, fact) {
        if (fact.kind === "identity") hidden = { scope: { owner, namespace: fact.namespace }, id: fact.memoryId };
        return harness.seedFact(owner, fact);
      },
    },
  };
}

function snapshotReturnsInitialToken(opened) {
  const { snapshot } = opened.adapter;
  let initialToken;
  return withPorts(opened, {
    snapshot: {
      ...snapshot,
      async stateToken(tx, scope) {
        initialToken ??= await snapshot.stateToken(tx, scope);
        return initialToken;
      },
    },
  });
}

function snapshotIgnoresRevision(opened) {
  const { snapshot } = opened.adapter;
  const tokens = new Map();
  return withPorts(opened, {
    snapshot: {
      async stateToken(tx, scope) {
        const live = await snapshot.stateToken(tx, scope);
        const key = JSON.stringify([scope.owner, [...scope.namespaces].sort(), scope.clients?.slice().sort()]);
        if (!tokens.has(key)) tokens.set(key, live);
        return tokens.get(key);
      },
      async assertUnchanged(tx, scope, token) {
        if (tokens.has(JSON.stringify([scope.owner, [...scope.namespaces].sort(), scope.clients?.slice().sort()])) &&
            token === await this.stateToken(tx, scope)) return;
        return snapshot.assertUnchanged(tx, scope, token);
      },
    },
  });
}

function snapshotIgnoresReadSet(opened) {
  const { snapshot } = opened.adapter;
  const ownerOnly = ({ owner }) => ({ owner, namespaces: [null] });
  return withPorts(opened, {
    snapshot: {
      stateToken: (tx, scope) => snapshot.stateToken(tx, ownerOnly(scope)),
      assertUnchanged: (tx, scope, token) => snapshot.assertUnchanged(tx, ownerOnly(scope), token),
    },
  });
}

function recordsHiddenRef(opened, wrap) {
  const { harness } = opened;
  let hidden;
  const wrapped = wrap(() => hidden);
  return {
    ...wrapped,
    harness: {
      ...harness,
      async seedFact(owner, fact) {
        if (fact.kind === "identity") hidden = { type: "memory", namespace: fact.namespace, id: fact.memoryId };
        return harness.seedFact(owner, fact);
      },
    },
  };
}

function hydrateThrowsOnHidden(opened) {
  const { hydrate } = opened.adapter;
  return recordsHiddenRef(opened, (hidden) => withPorts(opened, {
    hydrate: {
      async hydrate(tx, scope, refs, intent) {
        if (refs.some((ref) => ref.id === hidden()?.id)) throw new CoreError("memory_not_found");
        return hydrate.hydrate(tx, scope, refs, intent);
      },
    },
  }));
}

function hydrateSortsByNamespace(opened) {
  const { hydrate } = opened.adapter;
  return withPorts(opened, {
    hydrate: {
      async hydrate(...args) {
        return (await hydrate.hydrate(...args)).sort((a, b) => namespaceDescending(a.ref.namespace, b.ref.namespace));
      },
    },
  });
}

function hydrateReorders(opened) {
  const { hydrate } = opened.adapter;
  return withPorts(opened, {
    hydrate: { async hydrate(...args) { return (await hydrate.hydrate(...args)).reverse(); } },
  });
}

function hydrateOmitsExportReceipts(opened) {
  const { hydrate } = opened.adapter;
  return withPorts(opened, {
    hydrate: {
      async hydrate(tx, scope, refs, intent) {
        const items = await hydrate.hydrate(tx, scope, refs, intent);
        return intent === "export" ? items.map(({ receipts, ...item }) => item) : items;
      },
    },
  });
}

function fenceSortsByNamespace(opened) {
  const { fence } = opened.adapter;
  return withPorts(opened, {
    fence: {
      async assertVisible(...args) {
        return (await fence.assertVisible(...args)).sort((a, b) => namespaceDescending(a.namespace, b.namespace));
      },
    },
  });
}

function fenceLeaksHiddenRef(opened) {
  const { fence } = opened.adapter;
  return recordsHiddenRef(opened, (hidden) => withPorts(opened, {
    fence: {
      async assertVisible(tx, scope, refs) {
        const visible = await fence.assertVisible(tx, scope, refs);
        return refs.filter(({ id, namespace }) => id === hidden()?.id ||
          visible.some((ref) => ref.id === id && ref.namespace === namespace));
      },
    },
  }));
}

function keepsVectorWhenOff(opened) {
  if (opened.adapter.capabilities.semanticRetrieval) return opened;
  const { vector } = createMemoryAdapter({ capabilities: { semanticRetrieval: true } });
  return withPorts(opened, { vector });
}

const retrievalRegressions = [
  ["widens the lexical read set", "K-RET-1", lexicalOutsideReadSet, /Lexical returned the wrong refs/],
  ["returns infinite lexical scores", "K-RET-1", (opened) => lexicalWithScore(opened, Infinity),
    /Lexical score must be finite/],
  ["returns a NaN lexical score at depth one", "K-RET-1", (opened) => lexicalWithScore(opened, NaN, 1),
    /Lexical score must be finite/],
  ["reports matched for an empty lexical result", "K-RET-2", lexicalAlwaysMatches, /empty lexical result reported a match/],
  ["returns NaN distances for capped vector results", "K-RET-3", (opened) => vectorWithCappedDistances(opened, NaN),
    /Vector distance must be finite and between 0 and 2/],
  ["returns a distance of 2.5 for capped vector results", "K-RET-3", (opened) => vectorWithCappedDistances(opened, 2.5),
    /Vector distance must be finite and between 0 and 2/],
  ["searches all namespaces of the owner for vectors", "K-RET-3", vectorSearchesAllOwnerNamespaces, /Complete vector coverage/],
  ["ignores the query width in vector search", "K-RET-3", vectorIgnoresLength, /Mismatched vector query coverage/],
  ["reports complete vector coverage with missing embeddings", "K-RET-3", vectorAlwaysComplete,
    /Incomplete vector coverage was reported complete/],
  ["ignores the query model in vector search", "K-RET-3", vectorIgnoresModel, /Vector eligible and embedded counts/],
  ["pages recent rows without an ID tie-break", "K-RET-9", recentTimeOnlyCursor, /Missing recent second-page continuation/],
  ["rejects recent cursors from another run", "K-RET-9", recentUsesRunLocalCursors, { code: "invalid_cursor" }],
  ["keeps only the latest recent cursor per owner", "K-RET-9", recentKeepsLatestCursor, { code: "invalid_cursor" }],
  ["includes a hidden recent row", "K-RET-9", recentLeaksHiddenRow, /Recent pages did not contain exactly the visible rows in order/],
  ["ignores the owner revision in state tokens", "K-SNAP-1", snapshotIgnoresRevision, /Expected operation to reject/],
  ["always issues the initial state token", "K-SNAP-1", snapshotReturnsInitialToken, { code: "cursor_stale" }],
  ["ignores the read set in state tokens", "K-SNAP-1", snapshotIgnoresReadSet, /Expected operation to reject/],
  ["throws when asked to hydrate a hidden ref", "K-HYD-1", hydrateThrowsOnHidden, { code: "memory_not_found" }],
  ["reorders hydrated refs", "K-HYD-1", hydrateReorders, /Hydrate refs did not preserve the visible input order/],
  ["sorts hydrated refs by namespace descending", "K-HYD-1", hydrateSortsByNamespace, /Hydrate refs did not preserve the visible input order/],
  ["omits receipts from export hydration", "K-HYD-1", hydrateOmitsExportReceipts, /Hydrate receipts were missing or changed/],
  ["lets hidden refs pass the fence", "K-FEN-1", fenceLeaksHiddenRef, /Fence did not return exactly the visible refs in input order/],
  ["sorts fenced refs by namespace descending", "K-FEN-1", fenceSortsByNamespace, /Fence did not return exactly the visible refs in input order/],
  ["keeps the vector port when asked to disable it", "K-CAP-2", keepsVectorWhenOff, { code: "capability_unavailable" }],
];

for (const [description, id, wrap, failure] of retrievalRegressions) {
  test(`${id} rejects an adapter that ${description}`, async () => {
    await assert.rejects(() => run(id, wrap), failure);
  });
}

test("K-RET-1 accepts lexical ties ordered by descending time and ID", async () => {
  const ids = ["z", "a"];
  let index = 0;
  assert.equal(await run("K-RET-1", lexicalNewestTies, { newId: () => ids[index++] ?? `id-${index}` }), null);
});

test("K-RET-3 accepts a store that writes only native-width vectors", async () => {
  assert.equal(await run("K-RET-3", storesNativeWidthOnly, { embeddingDimensions: 6 }), null);
});

test("K-RET-3 accepts float32 roundoff for identical vectors", async () => {
  assert.equal(await run("K-RET-3", vectorWithIdenticalRoundoff), null);
});

test("K-RET-9 accepts namespace-descending order for equal recent keys", async () => {
  const ids = ["oldest", "same", "same", "other", "newest"];
  let index = 0;
  assert.equal(await run("K-RET-9", recentNamespaceDescending, { newId: () => ids[index++] ?? `id-${index}` }), null);
});

test("K-CAP-2 accepts an undefined vector port when asked off", async () => {
  assert.equal(await run("K-CAP-2", (opened) => opened.adapter.capabilities.semanticRetrieval ?
    opened : withPorts(opened, { vector: undefined })), null);
});

test("K-CAP-2 accepts a factory that only offers semantic retrieval off", async () => {
  assert.equal(await run("K-CAP-2", (opened) => withPorts(opened, {
    capabilities: { ...opened.adapter.capabilities, semanticRetrieval: false }, vector: undefined,
  })), null);
});

test("K-CAP-2 skips when the factory keeps semantic retrieval enabled", async () => {
  const alwaysOn = factory((opened) => opened);
  assert.equal(await runCase({ ...alwaysOn, open: () => alwaysOn.open({ capabilities: { semanticRetrieval: true } }) },
    CASES.find(({ id }) => id === "K-CAP-2")), "needs semanticRetrieval off");
});

function returnsRetrievalInstances(opened) {
  const { adapter: { lexical, vector, hydrate, recent, fence } } = opened;
  class Result {
    constructor(fields) {
      Object.assign(this, fields);
    }
  }
  const withRef = (row) => new Result({ ...row, ref: new Result(row.ref) });
  return withPorts(returnsRowInstances(opened), {
    lexical: {
      async lexical(...args) {
        const { rows, matched } = await lexical.lexical(...args);
        return new Result({ rows: rows.map(withRef), matched });
      },
    },
    ...(vector && {
      vector: {
        async vector(...args) {
          const { rows, coverage } = await vector.vector(...args);
          return new Result({ rows: rows.map(withRef), coverage: new Result(coverage) });
        },
      },
    }),
    hydrate: {
      async hydrate(...args) {
        return (await hydrate.hydrate(...args)).map((item) => withRef({
          ...item, memory: new Result(item.memory), receipts: item.receipts.map((r) => new Result(r)),
          sourceDates: new Result(item.sourceDates),
        }));
      },
    },
    recent: {
      async recent(...args) {
        const { items, nextCursor } = await recent.recent(...args);
        return new Result({ items: items.map((item) => new Result(item)), nextCursor });
      },
    },
    fence: { async assertVisible(...args) { return (await fence.assertVisible(...args)).map((ref) => new Result(ref)); } },
  });
}

test("retrieval cases accept class instances", async () => {
  for (const id of ["K-RET-1", "K-RET-2", "K-RET-3", "K-RET-9", "K-HYD-1", "K-MEM-4r", "K-FEN-1"]) {
    assert.equal(await run(id, returnsRetrievalInstances), null);
  }
});

test("K-RET-9 accepts fresh recent cursors for the same position", async () => {
  let sequence = 0;
  assert.equal(await run("K-RET-9", (opened) => {
    const { recent } = opened.adapter;
    return withPorts(opened, {
      recent: {
        async recent(tx, scope, { cursor, limit }) {
          const page = await recent.recent(tx, scope, { cursor: cursor?.replace(/\.\d+$/, "") ?? null, limit });
          return { ...page, nextCursor: page.nextCursor === null ? null : `${page.nextCursor}.${++sequence}` };
        },
      },
    });
  }), null);
});

test("retrieval cases accept a coarse write clock", async () => {
  for (const id of ["K-RET-1", "K-RET-3", "K-RET-9", "K-SNAP-1", "K-HYD-1", "K-MEM-4r"]) {
    assert.equal(await run(id, coarseClock), null);
  }
});
