import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compareSortKey, compareUtf8, CoreError } from "@cairn-ink/core";

export const hostedScope = Object.freeze({ owner: "owner", namespace: null });

export function memory(id, { scope = hostedScope, kind = "fact", updatedAtUs = 1000n, text = "short" } = {}) {
  return {
    id, scope: { ...scope }, kind, origin: "explicit", text, textHash: "sha256:" + "a".repeat(64),
    confidence: 1, source: { kind: "mcp", client: null, sessionId: null }, revision: 1,
    createdAtMs: 0, updatedAtMs: Number(updatedAtUs / 1000n), updatedAtUs,
  };
}

function newestFirst(a, b) {
  return compareSortKey(b.updatedAtUs, a.updatedAtUs) || compareUtf8(b.id, a.id);
}

function readPage(rows, { cursor, limit }) {
  const key = cursor === null ? null : JSON.parse(cursor);
  const after = key && { updatedAtUs: BigInt(key[0]), id: key[1] };
  const remaining = rows.filter(row => !after || newestFirst(row, after) > 0).sort(newestFirst);
  const items = remaining.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: remaining.length > limit ? JSON.stringify([last.updatedAtUs.toString(), last.id]) : null,
  };
}

export function serviceFake({ rows = [], leakForgotten = false, writes = false, near = false, hasKey = true,
  recall = false, semantic = false } = {}) {
  let committedRows = [...rows];
  const calls = [];
  const mutations = [];
  const owners = new Map();
  const active = new Set();
  const hooks = {};
  let runId = 0;
  let nextId = 0;
  let nowMs = 100;
  function ownerState(owner) {
    if (!owners.has(owner)) {
      owners.set(owner, { forgotten: new Set(), revision: 0, pause: { paused: false, generation: 0 }, facts: [] });
    }
    return owners.get(owner);
  }

  function record(tx, owner, method, ...args) {
    assert.ok(active.has(tx));
    assert.equal(tx.owner, owner);
    calls.push([method, ...args]);
  }

  function stateToken(tx, { owner, namespaces }) {
    return JSON.stringify([owner, namespaces, tx.revision]);
  }

  function candidates(tx, { owner, namespaces }) {
    return tx.rows.filter(row => row.scope.owner === owner && namespaces.includes(row.scope.namespace) &&
      (leakForgotten || !tx.forgotten.has(row.id)));
  }

  const storage = {
    name: "recording",
    capabilities: {},
    uow: {
      async run(owner, options, run) {
        calls.push(["run", owner, { ...options }]);
        await hooks.beforeRun?.();
        if (options.pauseLock) calls.push(["lock", "pause"]);
        if (!options.readOnly) calls.push(["lock", "owner-write"]);
        const state = ownerState(owner);
        const tx = {
          owner, options, rows: committedRows, revision: state.revision, facts: state.facts, runId: ++runId,
          forgotten: new Set(state.forgotten), pause: state.pause,
        };
        active.add(tx);
        try {
          const result = await run(tx);
          if (!options.readOnly) {
            state.pause = tx.pause;
            state.facts = tx.facts;
            state.revision = tx.revision;
            committedRows = tx.rows;
          }
          return result;
        } finally {
          active.delete(tx);
        }
      },
    },
    pause: {
      async get(tx, owner) {
        record(tx, owner, "pause.get", owner);
        assert.ok(tx.options.pauseLock);
        return { ...tx.pause, enforced: true };
      },
      async set(tx, owner, paused) {
        record(tx, owner, "pause.set", owner, paused);
        assert.ok(tx.options.pauseLock);
        assert.ok(!tx.options.readOnly);
        tx.pause = {
          paused, generation: tx.pause.generation + Number(paused && (!tx.pause.paused || !hooks.keepRepeatedGeneration)),
        };
        return { ...tx.pause, enforced: true };
      },
    },
    snapshot: {
      async stateToken(tx, scope) {
        record(tx, scope.owner, "snapshot.stateToken", scope);
        assert.ok(tx.options.readOnly);
        return stateToken(tx, scope);
      },
      async assertUnchanged(tx, scope, token) {
        record(tx, scope.owner, "snapshot.assertUnchanged", scope, token);
        assert.ok(tx.options.readOnly);
        if (token !== stateToken(tx, scope)) throw new CoreError("cursor_stale");
      },
    },
    recent: {
      async recent(tx, scope, page) {
        record(tx, scope.owner, "recent.recent", scope, page);
        assert.ok(tx.options.readOnly);
        return readPage(candidates(tx, scope), page);
      },
    },
    memories: {
      async exportPage(tx, scope, page) {
        record(tx, scope.owner, "memories.exportPage", scope, page);
        assert.ok(tx.options.readOnly);
        const result = readPage(candidates(tx, { owner: scope.owner, namespaces: [scope.namespace] }), page);
        await hooks.afterExportPage?.(result);
        return result;
      },
    },
    fence: {
      async assertVisible(tx, scope, refs) {
        record(tx, scope.owner, "fence.assertVisible", scope, refs);
        assert.ok(tx.options.readOnly || (writes && tx.options.pauseLock));
        return refs.filter(ref => !tx.forgotten.has(ref.id) &&
          !(recall && ownerState(scope.owner).forgotten.has(ref.id)) && !hooks.hideAtFence?.(ref));
      },
    },
  };

  function unexpected() {
    assert.fail("unexpected dependency call");
  }

  const fake = {
    storage, calls, hooks,
    deps: {
      storage,
      model: { model: "model", contextWindow: 2048, call: unexpected, countTokens: unexpected },
      embedder: { model: "embedder", dimensions: 1, embed: unexpected },
      gate: { assertOpen: unexpected },
      clock: { nowMs: unexpected, monotonicMs: unexpected, sha256Hex: unexpected, hmacHex: unexpected },
      tokens: {
        countTokens(text) {
          assert.equal(active.size, 0, "count tokens outside the UoW");
          return hooks.countTokens?.(text) ?? 1;
        },
      },
      config: {},
    },
    forget({ scope: { owner }, id }) {
      const state = ownerState(owner);
      state.forgotten.add(id);
      state.revision++;
    },
    insert(row) {
      committedRows = [...committedRows, row];
      ownerState(row.scope.owner).revision++;
    },
    committed(owner) {
      return { rows: committedRows.filter(row => row.scope.owner === owner), facts: ownerState(owner).facts };
    },
    mutations,
  };

  let dispatchReady = false;
  if (writes || recall) {
    // The gate's marker expires after the first continuation gets a chance to start the send.
    fake.deps.gate.assertOpen = async (owner, phase) => {
      assert.equal(active.size, 0, "gate outside the UoW");
      calls.push(["gate", owner, phase]);
      hooks.gate?.(phase);
      if (phase === "dispatch") {
        dispatchReady = true;
        queueMicrotask(() => queueMicrotask(() => { dispatchReady = false; }));
      }
    };
  }

  if (recall) {
    const refOf = row => ({ type: "memory", id: row.id, namespace: row.scope.namespace });
    storage.lexical = {
      async lexical(tx, scope, query, depth, options) {
        record(tx, scope.owner, "lexical.lexical", scope, query, depth, options);
        assert.ok(tx.options.readOnly);
        const ranked = candidates(tx, scope).flatMap(row => {
          const score = hooks.lexicalScore?.(row, query);
          return score === undefined ? [] : [{ ref: refOf(row), score, updatedAtUs: row.updatedAtUs }];
        }).sort((a, b) => b.score - a.score || newestFirst({ ...a, id: a.ref.id }, { ...b, id: b.ref.id }));
        const rows = ranked.slice(0, depth);
        hooks.afterLexical?.(rows);
        return { rows, matched: ranked.length > 0 };
      },
    };
    storage.hydrate = {
      async hydrate(tx, scope, refs, intent) {
        record(tx, scope.owner, "hydrate.hydrate", scope, refs, intent);
        assert.ok(tx.options.readOnly);
        const rows = candidates(tx, scope);
        const result = refs.flatMap(ref => {
          const memory = rows.find(row => row.id === ref.id && row.scope.namespace === ref.namespace);
          return memory ? [{ ref, memory }] : [];
        }).reverse();
        return hooks.hydrate?.(result) ?? result;
      },
    };
    fake.deps.embedQuery = {
      async embedQuery(owner, query, options) {
        calls.push(["embedQuery", owner, query, options]);
        assert.equal(active.size, 0, "query embed outside the UoW");
        assert.ok(dispatchReady, "query embed starts in the dispatch continuation");
        await hooks.embedQuery?.();
        return { vector: Float32Array.of(1), model: "query-model" };
      },
    };
    if (semantic) {
      storage.capabilities.semanticRetrieval = true;
      storage.vector = {
        async vector(tx, scope, query, model, depth) {
          record(tx, scope.owner, "vector.vector", scope, query, model, depth);
          assert.ok(tx.options.readOnly);
          const ranked = candidates(tx, scope).flatMap(row => {
            const distance = hooks.vectorDistance?.(row);
            return distance === undefined ? [] : [{ ref: refOf(row), distance, updatedAtUs: row.updatedAtUs }];
          }).sort((a, b) => a.distance - b.distance || newestFirst({ ...a, id: a.ref.id }, { ...b, id: b.ref.id }));
          return { rows: ranked.slice(0, depth),
            coverage: hooks.coverage ?? { eligible: ranked.length, embedded: ranked.length, complete: true } };
        },
      };
    }
  }

  if (writes) {
    const encoding = new TextEncoder();
    fake.deps.embedder.embed = async texts => {
      calls.push(["embed", [...texts]]);
      assert.equal(active.size, 0, "embed outside the UoW");
      assert.ok(dispatchReady, "embed starts in the dispatch continuation");
      await hooks.embed?.();
      return [Float32Array.of(1)];
    };
    fake.deps.clock.nowMs = () => ++nowMs;
    fake.deps.clock.sha256Hex = async value => {
      assert.equal(active.size, 0, "hash outside the UoW");
      return createHash("sha256").update(value).digest("hex");
    };
    storage.capabilities.nearDuplicate = near;
    storage.keys = {
      async userKey(owner) {
        assert.equal(active.size, 0, "key lookup outside the UoW");
        calls.push(["keys.userKey", owner]);
        if (!hasKey) return null;
        if (hooks.userKey) return hooks.userKey(owner);
        const signingKey = await crypto.subtle.importKey("raw", encoding.encode("fixture key for " + owner),
          { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        return { id: "fixture-key", signingKey };
      },
    };

    function mutate(tx, owner, method, ...args) {
      record(tx, owner, method, ...args);
      assert.ok(!tx.options.readOnly);
      mutations.push({ method, run: tx.runId, args });
      tx.revision++;
    }

    function getRow(tx, scope, id) {
      return tx.rows.find(row => row.id === id && row.scope.owner === scope.owner &&
        row.scope.namespace === scope.namespace) ?? null;
    }

    function changedRow(tx, row, changes, timestamp) {
      tx.rows = tx.rows.map(candidate => candidate === row ? {
        ...row, ...changes, updatedAtMs: timestamp, updatedAtUs: BigInt(timestamp) * 1000n,
      } : candidate);
    }

    Object.assign(storage.memories, {
      async get(tx, scope, id) {
        record(tx, scope.owner, "memories.get", scope, id);
        return hooks.get ? hooks.get(tx, scope, id) : getRow(tx, scope, id);
      },
      async readWritePolicy(tx, scope, [query], source, mode, editId) {
        record(tx, scope.owner, "memories.readWritePolicy", scope, query, source, mode, editId);
        const matches = [];
        const hiddenIds = [];
        for (const row of tx.rows) {
          if (row.scope.owner !== scope.owner || row.scope.namespace !== scope.namespace || row.id === editId) continue;
          const exact = [query.textHash, query.legacyHash].includes(row.textHash);
          const distance = exact ? 0 : hooks.nearDistance?.(row);
          if (distance === undefined) continue;
          matches.push({ id: row.id, kind: "stored", match: exact ? "exact" : "near",
            revision: row.revision, writeTimeUs: row.updatedAtUs, distance });
          if (tx.forgotten.has(row.id)) hiddenIds.push(row.id);
        }
        matches.sort((a, b) => a.distance - b.distance);
        return { matches: [matches], hiddenIds, blockedSession: false, blockedPositions: [] };
      },
      async insert(tx, scope, content, receipts, timestamp) {
        mutate(tx, scope.owner, "memories.insert", content, receipts);
        const row = {
          ...content, id: "inserted-" + ++nextId, scope, revision: 1, createdAtMs: timestamp,
          updatedAtMs: timestamp, updatedAtUs: BigInt(timestamp) * 1000n,
        };
        tx.rows = [...tx.rows, row];
        return row;
      },
      async touchDuplicate(tx, scope, id, receipts, merge, timestamp) {
        mutate(tx, scope.owner, "memories.touchDuplicate", id, receipts, merge);
        const row = getRow(tx, scope, id);
        assert.ok(row);
        changedRow(tx, row, merge, timestamp);
        return { outcome: "touched", revision: row.revision };
      },
      async replaceContent(tx, scope, id, revision, next, receipts, timestamp) {
        mutate(tx, scope.owner, "memories.replaceContent", id, revision, next, receipts);
        const row = getRow(tx, scope, id);
        assert.equal(row?.revision, revision);
        await hooks.replaceContent?.();
        changedRow(tx, row, { ...next, revision: revision + 1 }, timestamp);
        return { outcome: "changed", revision: revision + 1 };
      },
    });
    storage.suppressions = {
      async snapshot(tx, scope, candidates) {
        record(tx, scope.owner, "suppressions.snapshot", scope, candidates);
        await hooks.snapshot?.();
        return { blockedSession: false, blockedMessages: [],
          passages: tx.facts.filter(({ fact }) => (fact.namespace ?? null) === scope.namespace) };
      },
      async writeFact(tx, fact, incarnation) {
        mutate(tx, fact.owner, "suppressions.writeFact", fact, incarnation);
        const stored = { fact, incarnation, factId: "fact-" + (tx.facts.length + 1),
          epoch: BigInt(tx.facts.length + 1), createdAtMs: nowMs };
        tx.facts = [...tx.facts, stored];
        return { ...stored, created: true };
      },
    };
    fake.seedFact = fact => {
      const state = ownerState(fact.owner);
      state.facts = [...state.facts, { fact, factId: "seed-fact", epoch: 1n, createdAtMs: nowMs, incarnation: "fixture" }];
    };
  }
  return fake;
}
