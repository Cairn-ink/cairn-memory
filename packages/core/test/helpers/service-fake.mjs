import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compareSortKey, compareUtf8, CoreError, factBlocksIncoming, factHidesRow } from "@cairn-ink/core";

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
    items: items.map(publicRow),
    nextCursor: remaining.length > limit ? JSON.stringify([last.updatedAtUs.toString(), last.id]) : null,
  };
}

function cosineDistance(a, b) {
  if (!a || !b || a.length !== b.length) return undefined;
  const product = a.reduce((sum, value, i) => sum + value * b[i], 0);
  return 1 - product / (Math.hypot(...a) * Math.hypot(...b));
}

function factSlot(fact) {
  const { kind, namespace } = fact;
  if (kind === "rawSpan") return JSON.stringify([kind, namespace, fact.sessionKeyHash, fact.messageKey,
    fact.startUtf16, fact.endUtf16]);
  const digests = fact.text.digests.map(({ alg, value }) => alg + ":" + value).sort();
  return JSON.stringify([kind, namespace, fact.mode, fact.sourceMemory?.id, digests]);
}

function digestsWithHash({ digests = [], textHash }) {
  const value = textHash.slice(7);
  return digests.some(digest => digest.alg === "sha256" && digest.value === value) ? digests :
    [...digests, { alg: "sha256", value, pipeline: "core", redactionVersion: 3, keyId: null }];
}

function publicRow({ digests: _digests, ...row }) {
  return row;
}

export function serviceFake({ rows = [], leakForgotten = false, writes = false, near = false, hasKey = true, forgetting } = {}) {
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
      owners.set(owner, {
        forgotten: new Set(), revision: 0, pause: { paused: false, generation: 0 }, facts: [],
        effects: { fences: [], closures: [], purges: [], hiddenCards: [], logs: [], invalidatedConflicts: [], quantityDrops: [] },
      });
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

  function hidesRow(tx, row) {
    return tx.forgotten.has(row.id) || (forgetting && tx.facts.some(stored =>
      factHidesRow(stored, {
        type: "memory", scope: row.scope, memoryId: row.id, revision: row.revision,
        digests: digestsWithHash(row),
        embedding: row.embedding?.vector,
      }, {
        rowShingles: false,
        // Hosted src/memory/suppressions.ts:127–136 exempts later explicit saves from distance.
        vectorSuppression: storage.capabilities.vectorSuppression === true &&
          !(["mcp", "web"].includes(row.source.kind) && row.createdAtMs > stored.createdAtMs),
      }) !== false));
  }

  function candidates(tx, { owner, namespaces }) {
    return tx.rows.filter(row => row.scope.owner === owner && namespaces.includes(row.scope.namespace) &&
      (leakForgotten || !hidesRow(tx, row)));
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
          effects: Object.fromEntries(Object.entries(state.effects).map(([field, items]) => [field, [...items]])),
        };
        active.add(tx);
        try {
          const result = await run(tx);
          if (!options.readOnly) {
            if (forgetting) await hooks.fault?.("commit");
            state.pause = tx.pause;
            state.facts = tx.facts;
            state.revision = tx.revision;
            state.effects = tx.effects;
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
        return refs.filter(ref => !tx.forgotten.has(ref.id) && !hooks.hideAtFence?.(ref) &&
          (!forgetting || candidates(tx, scope).some(row => row.id === ref.id && row.scope.namespace === ref.namespace)));
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
      const { facts, effects, revision } = ownerState(owner);
      return { rows: committedRows.filter(row => row.scope.owner === owner), facts,
        ...(forgetting && { effects, revision }) };
    },
    mutations,
  };

  if (writes) {
    const encoding = new TextEncoder();
    // The gate's marker expires after the first continuation gets a chance to start the send.
    let dispatchReady = false;
    fake.deps.gate.assertOpen = async (owner, phase) => {
      assert.equal(active.size, 0, "gate outside the UoW");
      calls.push(["gate", owner, phase]);
      hooks.gate?.(phase);
      if (phase === "dispatch") {
        dispatchReady = true;
        queueMicrotask(() => queueMicrotask(() => { dispatchReady = false; }));
      }
    };
    fake.deps.embedder.embed = async texts => {
      calls.push(["embed", [...texts]]);
      assert.equal(active.size, 0, "embed outside the UoW");
      assert.ok(dispatchReady, "embed starts in the dispatch continuation");
      const vector = await hooks.embed?.(texts);
      return [vector ?? Float32Array.of(1)];
    };
    fake.deps.clock.nowMs = () => ++nowMs;
    fake.deps.clock.sha256Hex = async value => {
      if (!forgetting) assert.equal(active.size, 0, "OW1 hashes outside the UoW");
      await hooks.fault?.("clock.sha256Hex");
      return createHash("sha256").update(value).digest("hex");
    };
    storage.capabilities.nearDuplicate = near;
    storage.keys = {
      async userKey(owner) {
        assert.equal(active.size, 0, "key lookup outside the UoW");
        calls.push(["keys.userKey", owner]);
        await hooks.fault?.("keys.userKey");
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
        await hooks.fault?.("memories.get");
        if (hooks.get) return hooks.get(tx, scope, id);
        const row = getRow(tx, scope, id);
        return row === null ? null : publicRow(row);
      },
      async findDuplicates(tx, scope, [query], options) {
        record(tx, scope.owner, "memories.findDuplicates", scope, query, options);
        await hooks.fault?.("memories.findDuplicates");
        const matches = [];
        for (const row of candidates(tx, { owner: scope.owner, namespaces: [scope.namespace] })) {
          if (row.id === options.excludeId) continue;
          const exact = [query.textHash, query.legacyHash].includes(row.textHash);
          const distance = exact ? 0 : near && cosineDistance(query.embedding, row.embedding?.vector);
          if (!exact && (typeof distance !== "number" || !(distance <= options.nearDistance))) continue;
          matches.push({ id: row.id, kind: "stored", match: exact ? "exact" : "near",
            revision: row.revision, writeTimeUs: row.updatedAtUs, distance });
        }
        return [matches];
      },
      async erase(tx, scope, id) {
        mutate(tx, scope.owner, "memories.erase", id);
        const row = getRow(tx, scope, id);
        tx.rows = tx.rows.filter(candidate => candidate !== row);
        await hooks.fault?.("memories.erase");
        return Boolean(row);
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
          if (hidesRow(tx, row)) hiddenIds.push(row.id);
        }
        matches.sort((a, b) => a.distance - b.distance);
        const blocked = forgetting && tx.facts.some(stored => {
          const { fact } = stored;
          if (fact.kind !== "text" || !fact.text.digests.every(({ alg }) => alg === "hmac")) return false;
          const passages = [{ digests: digestsWithHash(query), shingles: null, keyId: null }];
          return factBlocksIncoming(stored, { scope, passages },
            { mode: mode === "hash" ? "explicitSave" : "capture", rowShingles: false }) !== false;
        });
        return { matches: [matches], hiddenIds, blockedSession: false, blockedPositions: blocked ? [0] : [] };
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
        await hooks.snapshot?.(candidates);
        return { blockedSession: false, blockedMessages: [],
          passages: tx.facts.filter(stored => {
            const { fact } = stored;
            return fact.kind === "text" && (fact.namespace ?? null) === scope.namespace &&
              (!forgetting || candidates.passages === undefined ||
                factBlocksIncoming(stored, { scope, passages: candidates.passages },
                  { mode: "capture", rowShingles: false }) !== false);
          }) };
      },
      async writeFact(tx, fact, incarnation) {
        const previous = tx.facts.find(stored => factSlot(stored.fact) === factSlot(fact));
        if (previous) {
          record(tx, fact.owner, "suppressions.writeFact", fact, incarnation);
          if (previous.incarnation !== incarnation) throw new CoreError("fact_conflict");
          return { ...previous, created: false };
        }
        mutate(tx, fact.owner, "suppressions.writeFact", fact, incarnation);
        const stored = { fact, incarnation, factId: "fact-" + (tx.facts.length + 1),
          epoch: BigInt(tx.facts.length + 1), createdAtMs: nowMs };
        tx.facts = [...tx.facts, stored];
        await hooks.fault?.(fact.kind === "rawSpan" ? "suppressions.writeSpan" : "suppressions.writeFact");
        return { ...stored, created: true };
      },
      async factsFor(tx, scope, { memoryId }) {
        record(tx, scope.owner, "suppressions.factsFor", scope, memoryId);
        return tx.facts.filter(({ fact }) => (fact.namespace ?? null) === scope.namespace &&
          fact.sourceMemory?.id === memoryId);
      },
    };
    fake.seedFact = (fact, incarnation = "fixture") => {
      const state = ownerState(fact.owner);
      state.facts = [...state.facts, { fact, factId: "seed-fact", epoch: 1n, createdAtMs: nowMs, incarnation }];
    };

    if (forgetting) {
      const { capabilities = {}, spans = [], receipts = [], closure = [] } = forgetting;
      Object.assign(storage.capabilities, capabilities);
      storage.hydrate = {
        async hydrate(tx, scope, refs) {
          record(tx, scope.owner, "hydrate.hydrate", scope, refs);
          await hooks.fault?.("hydrate.hydrate");
          return refs.map(ref => ({ ref, receipts }));
        },
      };
      storage.spanLineage = {
        async resolveSpans(tx, scope, id) {
          record(tx, scope.owner, "spanLineage.resolveSpans", scope, id);
          await hooks.fault?.("spanLineage.resolveSpans");
          return spans;
        },
      };
      storage.sessionLineage = {
        async provenClosure(tx, scope, roots) {
          record(tx, scope.owner, "sessionLineage.provenClosure", scope, roots);
          await hooks.fault?.("sessionLineage.provenClosure");
          return closure;
        },
      };
      async function effect(tx, owner, method, field, value, ...args) {
        mutate(tx, owner, method, ...args);
        tx.effects[field].push(value);
        await hooks.fault?.(method, ...args);
      }
      storage.raw = {
        async fenceSession(tx, scope, session) {
          await effect(tx, scope.owner, "raw.fenceSession", "fences", session, session);
        },
        async eraseSessions(tx, scope, proven) {
          assert.equal(proven, closure, "eraseSessions receives only the branded closure");
          await effect(tx, scope.owner, "raw.eraseSessions", "closures", proven, proven);
        },
        async purgeWithheld(tx, scope, facts) {
          assert.ok(facts.every(({ factId }) => tx.facts.some(stored => stored.factId === factId)));
          await effect(tx, scope.owner, "raw.purgeWithheld", "purges", facts, facts);
        },
      };
      storage.documentCards = {
        async hideWhere(tx, scope, selector, reason) {
          await effect(tx, scope.owner, "documentCards.hideWhere", "hiddenCards", selector, scope, selector, reason);
          return { hidden: 1 };
        },
      };
      storage.conflicts = {
        async invalidate(tx, scope, id) {
          await effect(tx, scope.owner, "conflicts.invalidate", "invalidatedConflicts", id, id);
        },
      };
      storage.quantityLedger = {
        async dropWhere(tx, scope, selector) {
          await effect(tx, scope.owner, "quantityLedger.dropWhere", "quantityDrops", selector, selector);
        },
      };
      storage.forgetLog = {
        async record(tx, owner, id, atMs) {
          if (tx.effects.logs.includes(id)) return;
          await effect(tx, owner, "forgetLog.record", "logs", id, id, atMs);
        },
      };
    }
  }
  return fake;
}
