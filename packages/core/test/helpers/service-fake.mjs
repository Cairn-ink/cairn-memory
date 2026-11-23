import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compareSortKey, compareUtf8, CoreError, withholdsAnyPassage } from "@cairn-ink/core";
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
    items,
    nextCursor: remaining.length > limit ? JSON.stringify([last.updatedAtUs.toString(), last.id]) : null,
  };
}

export function serviceFake({ rows = [], leakForgotten = false, writes = false, near = false, hasKey = true,
  capture = false, rawArchive = false, sessionLineage = false } = {}) {
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
      owners.set(owner, { forgotten: new Set(), revision: 0, pause: { paused: false, generation: 0 }, facts: [],
        admissions: new Map(), archived: [] });
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
        await hooks.beforeRun?.(owner, options);
        if (options.pauseLock) calls.push(["lock", "pause"]);
        if (!options.readOnly) calls.push(["lock", "owner-write"]);
        const state = ownerState(owner);
        const tx = {
          owner, options, rows: committedRows, revision: state.revision, facts: state.facts, runId: ++runId,
          forgotten: new Set(state.forgotten), pause: state.pause, admissions: state.admissions, archived: state.archived,
        };
        active.add(tx);
        try {
          const result = await run(tx);
          if (!options.readOnly) {
            state.pause = tx.pause;
            state.facts = tx.facts;
            state.revision = tx.revision;
            state.admissions = tx.admissions;
            state.archived = tx.archived;
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
        return refs.filter(ref => !tx.forgotten.has(ref.id) && !hooks.hideAtFence?.(ref));
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

  async function fixtureUserKey(owner) {
    if (!hasKey) return null;
    if (hooks.userKey) return hooks.userKey(owner);
    const signingKey = await crypto.subtle.importKey("raw", new TextEncoder().encode("fixture key for " + owner),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return { id: "fixture-key", signingKey };
  }

  if (writes) {
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
    fake.deps.embedder.embed = async (texts, options) => {
      calls.push(["embed", [...texts]]);
      assert.equal(active.size, 0, "embed outside the UoW");
      assert.ok(dispatchReady, "embed starts in the dispatch continuation");
      return await hooks.embed?.(texts, options) ?? texts.map(() => Float32Array.of(1));
    };
    fake.deps.clock.nowMs = () => ++nowMs;
    fake.deps.clock.sha256Hex = async value => {
      assert.equal(active.size, 0, "hash outside the UoW");
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
        const facts = tx.facts.filter(({ fact }) => (fact.namespace ?? null) === scope.namespace);
        const blockedSession = facts.some(({ fact }) => fact.kind === "session" &&
          fact.session.client === candidates.client && fact.session.sessionId === candidates.sessionId);
        return { blockedSession, blockedMessages: [], passages: facts.filter(({ fact }) => fact.kind === "text") };
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
      // Keyed capture fixtures need the same fingerprint key in the facade and the source filter.
      if (capture && hasKey && fact.kind === "text" && fact.text.digests.some(({ alg }) => alg === "hmac")) {
        storage.capabilities.fingerprintKey = true;
      }
    };
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
