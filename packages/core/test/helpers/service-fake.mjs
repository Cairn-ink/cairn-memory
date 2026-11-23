import assert from "node:assert/strict";
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

export function serviceFake({ rows = [], leakForgotten = false } = {}) {
  const calls = [];
  const owners = new Map();
  const active = new Set();
  const hooks = {};
  function ownerState(owner) {
    if (!owners.has(owner)) {
      owners.set(owner, { forgotten: new Set(), revision: 0, pause: { paused: false, generation: 0 } });
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
    return rows.filter(row => row.scope.owner === owner && namespaces.includes(row.scope.namespace) &&
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
        const tx = { owner, options, revision: state.revision, forgotten: new Set(state.forgotten), pause: state.pause };
        active.add(tx);
        try {
          const result = await run(tx);
          if (!options.readOnly) state.pause = tx.pause;
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
        return readPage(candidates(tx, { owner: scope.owner, namespaces: [scope.namespace] }), page);
      },
    },
    fence: {
      async assertVisible(tx, scope, refs) {
        record(tx, scope.owner, "fence.assertVisible", scope, refs);
        assert.ok(tx.options.readOnly);
        return refs.filter(ref => !tx.forgotten.has(ref.id) && !hooks.hideAtFence?.(ref));
      },
    },
  };

  function unexpected() {
    assert.fail("unexpected dependency call");
  }

  return {
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
  };
}
