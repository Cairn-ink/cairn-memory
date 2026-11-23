import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compareSortKey, compareUtf8, CoreError, factBlocksIncoming, factHidesRow, withholdsAnyPassage } from "@cairn-ink/core";
import { fingerprintMemoryPassages } from "../../src/privacy/fingerprint.mjs";
import { requiresLegacyMacDomain } from "../../src/privacy/withholds.mjs";

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

export function serviceFake({ rows = [], leakForgotten = false, writes = false, near = false, hasKey = true, forgetting,
  recall = false, semantic = false, capture = false, rawArchive = false, sessionLineage = false } = {}) {
  let committedRows = [...rows];
  const calls = [];
  const mutations = [];
  const owners = new Map();
  const active = new Set();
  const hooks = {};
  let runId = 0;
  let nextId = 0;
  let nowMs = 100;
  let dispatchReady = false;
  function ownerState(owner) {
    if (!owners.has(owner)) {
      owners.set(owner, {
        forgotten: new Set(), revision: 0, pause: { paused: false, generation: 0 }, facts: [],
        effects: { fences: [], closures: [], purges: [], hiddenCards: [], logs: [], invalidatedConflicts: [], quantityDrops: [] },
        admissions: new Map(), archived: [],
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
    return tx.forgotten.has(row.id) || (forgetting && tx.facts.some(stored => stored.fact.kind !== "window" &&
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
        await hooks.beforeRun?.(owner, options);
        if (options.pauseLock) calls.push(["lock", "pause"]);
        if (!options.readOnly) calls.push(["lock", "owner-write"]);
        const state = ownerState(owner);
        // Writes replace committedRows, so an open run retains its original rows and suppressions.
        const tx = {
          owner, options, rows: committedRows, revision: state.revision, facts: state.facts, runId: ++runId,
          forgotten: new Set(state.forgotten), pause: state.pause, admissions: state.admissions, archived: state.archived,
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
            state.admissions = tx.admissions;
            state.archived = tx.archived;
            state.effects = tx.effects;
            committedRows = tx.rows;
            hooks.afterCommit?.(tx);
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
        const result = readPage(candidates(tx, scope), page);
        await hooks.afterRecentPage?.(result);
        return result;
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
    hydrate: {
      async hydrate(tx, scope, refs, intent) {
        record(tx, scope.owner, "hydrate.hydrate", scope, refs, intent);
        assert.ok(tx.options.readOnly);
        const rows = candidates(tx, scope);
        const result = refs.flatMap(ref => {
          const memory = rows.find(row => row.id === ref.id && row.scope.namespace === ref.namespace);
          return memory ? [{ ref, memory: tx.ranked ? memory : publicRow(memory) }] : [];
        }).reverse();
        // Recall hooks act on the ranking snapshot. Delivery reads its own rows.
        if (intent === "recall" && !tx.ranked) return result;
        return hooks.hydrate?.(result) ?? result;
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
    commitForget(row) {
      fake.forget(row);
      const { id, scope: { owner, namespace } } = row;
      committedRows = committedRows.filter(candidate => candidate.id !== id ||
        candidate.scope.owner !== owner || candidate.scope.namespace !== namespace);
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

  async function fixtureUserKey(owner) {
    if (!hasKey) return null;
    if (hooks.userKey) return hooks.userKey(owner);
    const signingKey = await crypto.subtle.importKey("raw", new TextEncoder().encode("fixture key for " + owner),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return { id: "fixture-key", signingKey };
  }

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
    fake.deps.clock.sha256Hex = async value => {
      assert.equal(active.size, 0, "hash outside the UoW");
      return createHash("sha256").update(value).digest("hex");
    };
    const refOf = row => ({ type: "memory", id: row.id, namespace: row.scope.namespace });
    storage.lexical = {
      async lexical(tx, scope, query, depth, options) {
        record(tx, scope.owner, "lexical.lexical", scope, query, depth, options);
        assert.ok(tx.options.readOnly);
        tx.ranked = true;
        const ranked = candidates(tx, scope).flatMap(row => {
          const score = hooks.lexicalScore?.(row, query);
          return score === undefined ? [] : [{ ref: refOf(row), score, updatedAtUs: row.updatedAtUs }];
        }).sort((a, b) => b.score - a.score || newestFirst({ ...a, id: a.ref.id }, { ...b, id: b.ref.id }));
        const rows = ranked.slice(0, depth);
        hooks.afterLexical?.(rows);
        return { rows, matched: ranked.length > 0 };
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
    fake.deps.embedder.embed = async (texts, options) => {
      calls.push(["embed", [...texts]]);
      assert.equal(active.size, 0, "embed outside the UoW");
      assert.ok(dispatchReady, "embed starts in the dispatch continuation");
      if (hooks.embedBatch) return hooks.embedBatch(texts);
      const result = await hooks.embed?.(texts, options);
      if (capture && Array.isArray(result)) return result;
      return texts.map(() => result ?? Float32Array.of(1));
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
        if (active.size > 0) {
          const [tx] = active;
          assert.ok(capture && active.size === 1 && tx.owner === owner && tx.options.pauseLock && !tx.options.readOnly,
            "capture may recheck the key under the owner pause lock");
        }
        calls.push(["keys.userKey", owner]);
        await hooks.fault?.("keys.userKey");
        return fixtureUserKey(owner);
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
      async readWritePolicy(tx, scope, queries, source, mode, editId) {
        record(tx, scope.owner, "memories.readWritePolicy", scope,
          queries.length === 1 ? queries[0] : queries, source, mode, editId);
        const hiddenIds = new Set();
        const blockedPositions = [];
        const matches = queries.map((query, index) => {
          const matches = [];
          for (const row of tx.rows) {
            if (row.scope.owner !== scope.owner || row.scope.namespace !== scope.namespace || row.id === editId) continue;
            const exact = [query.textHash, query.legacyHash].includes(row.textHash);
            const distance = exact ? 0 : hooks.nearDistance?.(row);
            if (distance === undefined) continue;
            matches.push({ id: row.id, kind: "stored", match: exact ? "exact" : "near",
              revision: row.revision, writeTimeUs: row.updatedAtUs, distance });
            if (hidesRow(tx, row)) hiddenIds.add(row.id);
          }
          const blocked = forgetting && tx.facts.some(stored => {
            const { fact } = stored;
            if (fact.kind !== "text" || !fact.text.digests.every(({ alg }) => alg === "hmac")) return false;
            const passages = [{ digests: digestsWithHash(query), shingles: null, keyId: null }];
            return factBlocksIncoming(stored, { scope, passages },
              { mode: mode === "hash" ? "explicitSave" : "capture", rowShingles: false }) !== false;
          });
          if (blocked) blockedPositions.push(index);
          return matches.sort((a, b) => a.distance - b.distance);
        });
        return { matches, hiddenIds: [...hiddenIds], blockedSession: false, blockedPositions };
      },
      async insert(tx, scope, content, receipts, timestamp) {
        const createdAtMs = content.createdAtMs === undefined ? timestamp : content.createdAtMs;
        if (!Number.isSafeInteger(createdAtMs) || createdAtMs > timestamp) throw new CoreError("invalid_input");
        mutate(tx, scope.owner, "memories.insert", content, receipts);
        const row = {
          ...content, id: "inserted-" + ++nextId, scope, revision: 1, createdAtMs,
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
        const { client, sessionId, occurredAtMs } = candidates;
        const facts = tx.facts.filter(({ fact }) => (fact.namespace ?? null) === scope.namespace);
        const blockedSession = facts.some(({ fact }) => fact.kind === "session" &&
          fact.session.client === candidates.client && fact.session.sessionId === candidates.sessionId);
        const windows = facts.filter(({ fact }) => fact.kind === "window");
        // The port contract: owner-wide windows apply even when the source has no client or session.
        // Ruling B, time-bounded: a clientless source is checked against every window. Inside a
        // client-specific window the core matcher returns "ineligible" (blocked); outside it, no match.
        const applicable = windows;
        const blockedMessages = (occurredAtMs ?? []).flatMap((time, index) =>
          applicable.some(stored => factBlocksIncoming(stored, {
            scope, passages: [], ...(client == null ? {} : { session: { client, sessionId: sessionId ?? "" } }),
            occurredAtMs: time,
          }, { mode: "capture" }) !== false) ? [index] : []);
        return { blockedSession, blockedMessages,
          passages: facts.filter(stored => {
            const { fact } = stored;
            return fact.kind === "text" &&
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
      // Keyed capture fixtures need the same fingerprint key in the facade and the source filter.
      if (capture && hasKey && fact.kind === "text" && fact.text.digests.some(({ alg }) => alg === "hmac")) {
        storage.capabilities.fingerprintKey = true;
      }
    };

    if (forgetting) {
      const { capabilities = {}, spans = [], receipts = [], closure = [] } = forgetting;
      Object.assign(storage.capabilities, capabilities);
      const readHydrate = storage.hydrate.hydrate;
      storage.hydrate = {
        async hydrate(tx, scope, refs, intent) {
          if (tx.options.readOnly) return readHydrate(tx, scope, refs, intent);
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
  if (capture) {
    const admissionId = ({ client, eventId }) => JSON.stringify([client, eventId]);
    let nextToken = 0;

    function claimWrite(tx, method, ...args) {
      record(tx, tx.owner, method, ...args);
      assert.ok(tx.options.pauseLock && !tx.options.readOnly);
      mutations.push({ method, run: tx.runId, args });
    }

    function updateAdmission(tx, id, row) {
      tx.admissions = new Map(tx.admissions).set(id, row);
    }

    function liveClaim(tx, token) {
      const entry = [...tx.admissions].find(([, row]) => row.token === token && row.expiresAt > nowMs);
      if (!entry) throw new CoreError("stale_admission");
      return entry;
    }

    async function eligiblePositions(tx, key, messages) {
      const override = hooks.eligible?.(messages);
      if (override != null) return override;

      const { scope, client } = key;
      const facts = tx.facts.map(({ fact }) => fact).filter(fact => (fact.namespace ?? null) === scope.namespace);
      const windows = facts.filter(fact => fact.kind === "window" && (fact.client === null || fact.client === client));
      const positions = messages.flatMap(({ occurredAtMs }, index) => windows.some(({ window, unknownTime }) =>
        occurredAtMs === null ? unknownTime === true : occurredAtMs >= window.startMs && occurredAtMs < window.endMs)
        ? [] : [index]);
      const textFacts = facts.filter(fact => fact.kind === "text");
      if (!textFacts.length || !positions.length) return positions;
      if (textFacts.some(requiresLegacyMacDomain)) return [];

      const fingerprintKey = storage.capabilities.fingerprintKey ? await fixtureUserKey(scope.owner) : null;
      const allowed = await Promise.all(positions.map(async position => {
        const { content } = messages[position];
        if (content && withholdsAnyPassage(await fingerprintMemoryPassages(content, content, fingerprintKey), textFacts)) {
          return null;
        }
        return position;
      }));
      return allowed.filter(position => position !== null);
    }

    fake.deps.model.contextWindow = 8192;
    fake.deps.model.countTokens = () => {
      assert.equal(active.size, 0, "model token count outside the UoW");
      return 1;
    };
    fake.deps.model.call = async (stage, request, options) => {
      calls.push(["model.call", stage, request]);
      assert.equal(active.size, 0, "model call outside the UoW");
      assert.ok(dispatchReady, "model call starts in the dispatch continuation");
      return await hooks.model?.(stage, request, options) ?? { items: [] };
    };
    fake.deps.clock.monotonicMs = () => hooks.monotonicMs?.() ?? performance.now();

    storage.capture = {
      async admit(tx, key, messages) {
        record(tx, key.scope.owner, "capture.admit", key, messages);
        assert.ok(tx.options.pauseLock && !tx.options.readOnly);
        const id = admissionId(key);
        const row = tx.admissions.get(id);
        if (row) {
          if (row.key.payloadDigest !== key.payloadDigest) throw new CoreError("event_payload_conflict");
          if (row.processing) return { status: "processing" };
          if (row.result) return { status: "rawReplay", result: row.result };
          return { status: "duplicate" };
        }
        mutations.push({ method: "capture.admit", run: tx.runId, args: [key, messages] });
        tx.admissions = new Map(tx.admissions).set(id, {
          key: { ...key, scope: { ...key.scope } }, messages: messages.map(message => ({ ...message })), status: "pending",
        });
        return { status: "admitted" };
      },
      async load(tx, selection) {
        record(tx, selection.scope.owner, "capture.load", selection);
        const row = tx.admissions.get(admissionId(selection));
        if (!row || row.key.scope.namespace !== selection.scope.namespace || row.key.sessionId !== selection.sessionId) return null;
        const { key, messages } = row;
        return structuredClone({ key, messages });
      },
      async status(tx, scope, eventId, client) {
        record(tx, scope.owner, "capture.status", scope, eventId, client);
        assert.ok(tx.options.readOnly);
        const rows = [...tx.admissions.values()].filter(({ key }) => key.scope.namespace === scope.namespace &&
          key.eventId === eventId && (client === undefined || key.client === client));
        if (rows.some(row => row.status === "pending")) return { status: "pending" };
        const failed = rows.find(row => row.status === "failed");
        if (failed) return failed.code === undefined ? { status: "failed" } : { status: "failed", code: failed.code };
        return { status: rows.length ? "done" : "unknown" };
      },
      async claim(tx, key, messages, { leaseMs }) {
        record(tx, key.scope.owner, "capture.claim", key, messages, { leaseMs });
        assert.ok(tx.options.pauseLock && !tx.options.readOnly);
        const id = admissionId(key);
        const row = tx.admissions.get(id);
        assert.ok(row && row.key.scope.namespace === key.scope.namespace);
        if (row.key.payloadDigest !== key.payloadDigest || row.key.sessionId !== key.sessionId) {
          throw new CoreError("event_payload_conflict");
        }
        if (row.result) return { status: "rawReplay", result: structuredClone(row.result) };
        if (row.status === "failed") return { status: "duplicate" };
        if (row.processing || (row.token && row.expiresAt > nowMs)) return { status: "processing" };
        const token = "lease-" + ++nextToken;
        updateAdmission(tx, id, { ...row, token, expiresAt: nowMs + leaseMs, dispatched: false });
        mutations.push({ method: "capture.claim", run: tx.runId, args: [key, token] });
        return { status: "claimed", token };
      },
      async beginDispatch(tx, token) {
        claimWrite(tx, "capture.beginDispatch", token);
        const [id, row] = liveClaim(tx, token);
        assert.equal(row.dispatched, false);
        const next = "dispatch-" + ++nextToken;
        updateAdmission(tx, id, { ...row, token: next, dispatched: true });
        return { token: next };
      },
      async eligible(tx, key, messages) {
        record(tx, key.scope.owner, "capture.eligible", key, messages);
        assert.ok(tx.options.pauseLock && !tx.options.readOnly);
        return eligiblePositions(tx, key, messages);
      },
      async assertEligible(tx, key, positions) {
        record(tx, key.scope.owner, "capture.assertEligible", key, positions);
        assert.ok(tx.options.pauseLock && !tx.options.readOnly);
        const row = tx.admissions.get(admissionId(key));
        if (!row?.token || row.key.scope.namespace !== key.scope.namespace || row.key.payloadDigest !== key.payloadDigest) {
          throw new CoreError("stale_admission");
        }
        liveClaim(tx, row.token);
        await hooks.assertEligible?.();
        const allowed = await eligiblePositions(tx, key, row.messages);
        if (positions.some(position => !allowed.includes(position))) throw new CoreError("suppressed");
      },
      async finish(tx, token, items) {
        claimWrite(tx, "capture.finish", token, items);
        const [id, row] = liveClaim(tx, token);
        assert.ok(!items.length || row.dispatched);
        await hooks.finish?.();
        const memories = items.map(item => {
          const memoryId = "captured-" + ++nextId;
          tx.rows = [...tx.rows, {
            ...memory(memoryId, { scope: row.key.scope, kind: item.kind, text: item.content }),
            origin: "inferred", confidence: item.confidence, textHash: item.textHash, embedding: item.embedding,
          }];
          return { id: memoryId, revision: 1, outcome: "inserted" };
        });
        if (items.length) tx.revision++;
        const result = { indexRevision: tx.revision, memories, suppressedCount: 0, duplicateCount: 0, counters: {} };
        updateAdmission(tx, id, { ...row, status: "done", token: undefined, result: structuredClone(result) });
        return result;
      },
      async abandon(tx, token, failure) {
        claimWrite(tx, "capture.abandon", token, failure);
        const [id, row] = liveClaim(tx, token);
        updateAdmission(tx, id, { ...row, status: failure.retryable ? "pending" : "failed",
          token: undefined, code: failure.code });
      },
    };
    fake.setCaptureResult = (selection, result) => {
      const rows = ownerState(selection.scope.owner).admissions;
      const id = admissionId(selection);
      assert.ok(rows.has(id));
      rows.set(id, { ...rows.get(id), ...result });
    };
    if (rawArchive) {
      storage.capabilities.rawArchive = true;
      fake.archived = owner => ownerState(owner).archived;
      storage.raw = {
        ...storage.raw,
        async recordLineage(tx, key, messages) {
          record(tx, key.scope.owner, "raw.recordLineage", key, messages);
          assert.ok(tx.options.pauseLock && !tx.options.readOnly);
          assert.ok(tx.admissions.has(admissionId(key)));
          mutations.push({ method: "raw.recordLineage", run: tx.runId, args: [key, messages] });
          await hooks.recordLineage?.();
        },
        async archiveAllowed(tx, key) {
          record(tx, key.scope.owner, "raw.archiveAllowed", key);
          assert.ok(tx.options.pauseLock && !tx.options.readOnly);
          return hooks.archiveAllowed?.() ?? true;
        },
        async archive(tx, key, messages) {
          assert.equal(key.scope.owner, tx.owner);
          claimWrite(tx, "raw.archive", key, messages);
          await hooks.archive?.();
          tx.archived = [...tx.archived, ...messages];
          return { archived: messages.length };
        },
      };
    }
    if (sessionLineage) {
      storage.capabilities.sessionLineage = true;
      storage.sessionLineage = {
        ...storage.sessionLineage,
        async isFenced(tx, scope, session) {
          record(tx, scope.owner, "sessionLineage.isFenced", scope, session);
          assert.ok(tx.options.pauseLock && !tx.options.readOnly);
          return hooks.isFenced?.(session) ?? { fenced: false, proof: "proven" };
        },
      };
    }
  }
  return fake;
}
