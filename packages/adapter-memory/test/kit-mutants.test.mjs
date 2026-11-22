import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CASES, runCase } from "@cairn-ink/conformance";
import { CoreError } from "@cairn-ink/core";

function factory(wrap) {
  return {
    name: "memory mutant",
    async open({ capabilities }) {
      const adapter = createMemoryAdapter({ capabilities });
      return wrap({
        adapter,
        harness: adapter.harness,
        nativeErrorMap: adapter.nativeErrorMap,
        busyNativeCodes: [],
        embeddingDimensions: null,
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

function delaysPausedWriters(opened) {
  const { uow } = opened.adapter;
  return withPorts(opened, {
    uow: {
      async run(owner, options, fn) {
        if (options.pauseLock && !options.readOnly) {
          await new Promise((resolve) => setTimeout(resolve, 0));
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
  ["ignores the pause lock", "K-UOW-3", ignoresPauseLock, /Pause-lock writer entered while the reader held the pause lock/],
  ["takes the write lock first", "K-UOW-3", takesWriteLockFirst, /Concurrent runs exceeded 5 seconds/],
  ["delays paused writers and ignores the pause lock", "K-UOW-3", (opened) => delaysPausedWriters(ignoresPauseLock(opened)),
    /Pause-lock writer entered while the reader held the pause lock/],
  ["delays paused writers and takes the write lock first", "K-UOW-3", (opened) => delaysPausedWriters(takesWriteLockFirst(opened)),
    /Concurrent runs exceeded 5 seconds/],
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

function run(id, wrap) {
  const testCase = CASES.find((candidate) => candidate.id === id);
  assert.ok(testCase, `Unknown conformance case ${id}`);
  return runCase(factory(wrap), testCase);
}

for (const [description, id, wrap, failure] of regressions) {
  test(`${id} rejects an adapter that ${description}`, async () => {
    await assert.rejects(() => run(id, wrap), failure);
  });
}

test("K-MEM-4 accepts a coarse write clock", async () => {
  assert.equal(await run("K-MEM-4", coarseClock), null);
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
  })), /Adapter close exceeded 5 seconds/);
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
    assert.match(error.cause?.message ?? "", /Adapter close exceeded 5 seconds/);
    return true;
  });
});
