import { assertReadContractCapabilities } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { bounded, caught, check, equal, gate, isCoreErrorShape, observe, receiptAttachAdvancesRevision, rejects, row, source } from "./support.mjs";

/** @import { ClockAndHash, ContextReadSet, ContextReadStore, FindCandidatesInput, InsertRow,
  ReadContractStorage, Receipt, Scope, StoredDocumentCardRecord, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */
/** @typedef {ReadContractStorage<StoredDocumentCardRecord> & {contextRead: ContextReadStore}} Storage */

const encoder = new TextEncoder();
const hex = (/** @type {ArrayBuffer} */ bytes) => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("");

/** @param {ReadContractStorage<StoredDocumentCardRecord>} storage @param {() => number} [nowMs] */
export function contextReadTestService(storage, nowMs = Date.now) {
  /** @type {ClockAndHash} */
  const clock = {
    nowMs, monotonicMs: () => performance.now(),
    async sha256Hex(value) {
      return hex(await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : new Uint8Array(value)));
    },
    async hmacHex(key, value) {
      const signingKey = key instanceof Uint8Array ?
        await crypto.subtle.importKey("raw", new Uint8Array(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]) : key;
      return hex(await crypto.subtle.sign("HMAC", signingKey, typeof value === "string" ? encoder.encode(value) : new Uint8Array(value)));
    },
  };
  const service = createMemoryService({
    storage, clock, config: {},
    model: { model: "unused", contextWindow: 1, countTokens: () => 0,
      async call() { throw new Error("Context Read used the model"); } },
    // Existing legacy writes require an embedding. Count neither this port nor
    // the hosted query embedder as a Context Read provider.
    embedder: { model: "fixture", dimensions: 4, async embed(texts) { return texts.map(() => new Float32Array([1, 0, 0, 0])); } },
    gate: { async assertOpen() {} },
    tokens: { countTokens: () => 0 },
  });
  check(service.findCandidates && service.fetchEvidence, "Context Read service entries are missing");
  return { ...service, findCandidates: service.findCandidates, fetchEvidence: service.fetchEvidence };
}

/** @param {Scope} scope @param {number} [access] @returns {ContextReadSet} */
function readSet(scope, access = 1) {
  return { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [access] };
}

const current = /** @type {const} */ ("current");
/** @type {FindCandidatesInput} */
const find = { query: "albatross", types: ["memory"], intent: current };

/** @param {CaseContext} ctx @returns {Storage} */
function contextStorage(ctx) {
  const adapter = /** @type {Storage} */ (ctx.adapter);
  check(adapter.contextRead, "Context Read adapter port is missing");
  return adapter;
}

/** @param {CaseContext} ctx @param {Scope} scope @param {string} text @param {readonly Receipt[]} [receipts] */
async function insert(ctx, scope, text, receipts = []) {
  const input = await row(ctx, text);
  const { id, revision } = await ctx.adapter.uow.run(ctx.owner, {}, tx =>
    ctx.adapter.memories.insert(tx, scope, input, receipts, 1));
  return { type: /** @type {const} */ ("memory"), scope, id, revision };
}

/** @param {number} number @returns {Receipt & {eventId: string, createdAtMs: number}} */
function receipt(number) {
  return { id: "receipt-" + String(number).padStart(2, "0"), client: "fixture-client", sessionId: "fixture-session",
    eventId: "event-" + number, messageId: "message-" + number, role: "user",
    occurredAtMs: null, createdAtMs: number, excerpt: "retained source " + number };
}

/** @type {readonly ConformanceCase[]} */
export const CONTEXT_READ_CASES = [
  {
    id: "T-CONTEXT-READ-1",
    title: "ranks a canonical horizon, binds continuations and degrades keylessly",
    needs: ["contextRead"],
    needsOff: ["cards"],
    async run(ctx) {
      const storage = contextStorage(ctx);
      let now = 10_000;
      let lexicalCalls = 0;
      let maintenanceCalls = 0;
      const { contextRead } = storage;
      const service = contextReadTestService({ ...storage, contextRead: {
        ...contextRead,
        async lexical(...args) { lexicalCalls++; return contextRead.lexical(...args); },
        ...(contextRead.prepareLexical && { async prepareLexical(...args) {
          maintenanceCalls++;
          return contextRead.prepareLexical?.(...args) ?? {};
        } }),
      } }, () => now);
      const scope = ctx.scope("project\0find");
      const selection = readSet(scope);
      const empty = await service.findCandidates(selection, find);
      equal(empty.items, [], "Empty search");
      equal(empty.coverage.byType.memory?.eligible, 0, "Empty eligible Memory coverage");

      const before = [lexicalCalls, maintenanceCalls];
      const error = await caught(() => service.findCandidates(selection, { ...find, semantic: true }));
      check(isCoreErrorShape(error) && error.code === "invalid_input" && !("retryable" in error && error.retryable),
        "Semantic search should give a non-retryable invalid_input");
      const diagnostics = /** @type {import("@cairn-ink/core/ports").ContextReadError} */ (error).diagnostics;
      equal(diagnostics?.channels.semantic, { state: "absent", causes: ["absent"] }, "Reason for keyless refusal");
      equal([lexicalCalls, maintenanceCalls], before, "No lexical search or maintenance on preflight refusal");

      const disabled = await service.findCandidates(selection, { ...find, types: ["card"] });
      equal(disabled.items, [], "Cards-off is a successful empty search");
      equal(disabled.coverage.byType.card?.eligible, 0, "Cards-off preserves the Card coverage row");
      await rejects(() => service.findCandidates(selection, { ...find, cursor: "malformed" }), "invalid_cursor");

      const refs = await Promise.all(Array.from({ length: 26 }, (_, i) => insert(ctx, scope, `albatross synthetic-${i}`)));
      const first = await service.findCandidates(selection, { ...find, limit: 1 });
      const cursor = first.nextCursor;
      check(cursor, "Expected a continuation");
      const initialCalls = [lexicalCalls, maintenanceCalls];
      const second = await service.findCandidates(selection, { ...find, limit: 24, cursor });
      equal([lexicalCalls, maintenanceCalls], initialCalls, "Continuation cannot replay ranking or maintenance");
      const all = [...first.items, ...second.items];
      // UUID fixtures sort identically in UTF-8 and JavaScript. Memory can also
      // use explicit non-ASCII IDs to exercise the ordering in its own tests.
      const ids = refs.map(ref => ref.id).sort();
      equal(all.map(item => item.ref.id), ids.slice(0, 24), "UTF-8 tie order and horizon");
      equal(all.map(item => item.rank), Array.from({ length: 24 }, (_, i) => i + 1), "Global ranks");
      check(all.every(item => item.channels.lexical.rank === item.rank && item.fusionScore === null &&
        item.channels.semantic === null), "Keyless channel ranks");
      equal(first.coverage.omitted.lexical, 2, "Omitted matches beyond the horizon");
      equal(second.nextCursor, null, "No continuation outside the horizon");

      const defaultPage = await service.findCandidates(selection, find);
      equal(defaultPage.items.length, 12, "Default page length");
      await rejects(() => service.findCandidates(selection, { ...find, query: "synthetic", cursor }), "invalid_cursor");
      await rejects(() => service.findCandidates(readSet(scope, 2), { ...find, cursor }), "cursor_stale");
      await insert(ctx, ctx.scope("personal\0"), "An unrelated namespace change");
      await service.findCandidates(selection, { ...find, cursor });
      const restarted = contextReadTestService(storage, () => now);
      await restarted.findCandidates(selection, { ...find, limit: 1 });
      await rejects(() => restarted.findCandidates(selection, { ...find, cursor }), "cursor_stale");
      now += 300_000;
      await rejects(() => service.findCandidates(selection, { ...find, cursor }), "cursor_stale");

      const fresh = await service.findCandidates(selection, { ...find, limit: 1 });
      check(fresh.nextCursor, "Expected a new ranking");
      const erased = await service.forget(scope, fresh.items[0].ref.id, source);
      equal(erased.status, "forgotten", "Forget applied");
      await rejects(() => service.findCandidates(selection, { ...find, cursor: fresh.nextCursor ?? "" }), "cursor_stale");
      const remaining = await service.findCandidates(selection, { ...find, limit: 24 });
      check(!remaining.items.some(item => item.ref.id === fresh.items[0].ref.id), "Forgotten Memory ranked");
      equal(remaining.coverage.byType.memory?.eligible, 25, "Post-forget coverage");
    },
  },
  {
    id: "T-CONTEXT-READ-2",
    title: "delivers ordered exact refs, bounds receipts and rejects stale snapshots",
    needs: ["contextRead"],
    async run(ctx) {
      const storage = contextStorage(ctx);
      let lookups = 0;
      let reads = 0;
      const service = contextReadTestService({ ...storage, uow: {
        run(owner, options, action) { reads++; return storage.uow.run(owner, options, action); },
      }, contextRead: {
        ...storage.contextRead,
        async evidence(...args) { lookups++; return storage.contextRead.evidence(...args); },
      } });
      const scope = ctx.scope("project\0evidence");
      const selection = readSet(scope);
      const first = await insert(ctx, scope, "First albatross", Array.from({ length: 17 }, (_, i) => receipt(17 - i)));
      const second = await insert(ctx, scope, "Second albatross");
      const fetched = await service.fetchEvidence(selection, { refs: [second, first], intent: current });
      equal(fetched.items.map(item => item.ref), [second, first], "Exact input order");
      equal(reads, 1, "Fetch enters one transaction");
      const item = fetched.items[1];
      check(item.type === "memory", "Expected Memory evidence");
      equal(item.provenance.sources.map(binding => binding.receiptId), Array.from({ length: 16 }, (_, i) => receipt(i + 1).id),
        "Date and ID order with 16 receipt sources");
      equal(item.provenance.coverage, { status: "budget_exhausted", included: 16, omitted: null }, "Bounded receipt coverage");
      const payload = JSON.parse(atob(fetched.snapshot.split(".")[0].replaceAll("-", "+").replaceAll("_", "/")));
      const prefix = payload.fences[1].slice(0, 8);
      equal((await service.fetchEvidence(selection, { snapshot: fetched.snapshot })).items, fetched.items, "Snapshot replay");
      await service.fetchEvidence(selection, { refs: [first], intent: current, fences: [prefix] });
      await rejects(() => service.fetchEvidence(selection, { refs: [first], intent: current,
        fences: [(prefix[0] === "A" ? "B" : "A") + prefix.slice(1)] }), "snapshot_stale");
      const beforeForeign = [reads, lookups];
      await rejects(() => service.fetchEvidence(selection, { refs: [first, { ...second, scope: { ...scope, owner: ctx.otherOwner } }],
        intent: current }), "authority_required");
      equal([reads, lookups], beforeForeign, "Foreign authority refused before storage");
      await rejects(() => service.fetchEvidence(selection, { snapshot: "wrong" }), "snapshot_stale");
      await rejects(() => service.fetchEvidence(readSet(ctx.scope("project\0wrong")), { snapshot: fetched.snapshot }), "snapshot_stale");
      await rejects(() => service.fetchEvidence(readSet(scope, 9), { snapshot: fetched.snapshot }), "snapshot_stale");
      await rejects(() => service.fetchEvidence(selection, { refs: [first], intent: current, responseByteLimit: 1 }), "context_item_too_large");

      const replacement = await row(ctx, "Corrected albatross");
      await storage.uow.run(ctx.owner, {}, tx => storage.memories.replaceContent(tx, scope, first.id, first.revision, replacement, null, 2));
      await rejects(() => service.fetchEvidence(selection, { snapshot: fetched.snapshot }), "snapshot_stale");
      await rejects(() => service.fetchEvidence(selection, { refs: [first], intent: current }), "revision_conflict");

      const missing = { ...second, id: "not-a-retained-id" };
      await rejects(() => service.fetchEvidence(selection, { refs: [second, missing], intent: current }), "evidence_unavailable");
      const previous = await service.fetchEvidence(selection, { refs: [second], intent: current });
      const touched = await storage.uow.run(ctx.owner, {}, tx => storage.memories.touchDuplicate(tx, scope, second.id, [receipt(1)],
        { confidence: 0.4, kind: "fact", origin: "explicit" }, 3));
      await rejects(() => service.fetchEvidence(selection, { snapshot: previous.snapshot }), "snapshot_stale");
      if (receiptAttachAdvancesRevision(ctx)) {
        equal(touched.revision, second.revision + 1, "A newly attached receipt should advance the revision once");
        await rejects(() => service.fetchEvidence(selection, { refs: [second], intent: current }), "revision_conflict");
        const updatedSecond = { ...second, revision: touched.revision };
        const after = await service.fetchEvidence(selection, { refs: [updatedSecond], intent: current });
        check(after.items[0].type === "memory" && after.items[0].provenance.sources.length === 1, "Receipt-only change visible");
        return;
      }
      equal(touched.revision, second.revision, "Receipt attachment preserves the revision with the flag off");
      const after = await service.fetchEvidence(selection, { refs: [second], intent: current });
      check(after.items[0].type === "memory" && after.items[0].provenance.sources.length === 1, "Receipt-only change visible");
    },
  },
  {
    id: "T-CONTEXT-READ-3",
    title: "pins final visibility and evidence to one read snapshot across a committed write",
    needs: ["contextRead"],
    async run(ctx) {
      const storage = contextStorage(ctx);
      const scope = ctx.scope("project\0barrier");
      const selection = readSet(scope);
      const ref = await insert(ctx, scope, "Before barrier");
      const entered = /** @type {ReturnType<typeof gate<Tx>>} */ (gate());
      const resume = /** @type {ReturnType<typeof gate<void>>} */ (gate());
      const visits = /** @type {Tx[]} */ ([]);
      let readRuns = 0;
      const service = contextReadTestService({ ...storage,
        uow: { run(owner, options, action) {
          check(options.readOnly, "Fetch did not request a read-only snapshot");
          readRuns++;
          return storage.uow.run(owner, options, action);
        } },
        contextRead: { ...storage.contextRead,
          async identity(tx) { visits.push(tx); return storage.contextRead.identity(tx); },
          async snapshotState(tx, ...args) { visits.push(tx); return storage.contextRead.snapshotState(tx, ...args); },
          async evidence(tx, ...args) {
            visits.push(tx);
            const rows = await storage.contextRead.evidence(tx, ...args);
            entered.release(tx);
            await resume.promise;
            return rows;
          },
        },
        fence: { async assertVisible(tx, ...args) { visits.push(tx); return storage.fence.assertVisible(tx, ...args); } },
      });
      const pending = observe(service.fetchEvidence(selection, { refs: [ref], intent: current }));
      try {
        /** @type {Tx | undefined} */
        let tx;
        await bounded(async () => {
          tx = await Promise.race([entered.promise, pending.then(() => { throw new Error("Fetch skipped evidence"); })]);
        }, "Fetch did not reach the evidence barrier", ctx.timeoutMs ?? 5000);
        const replacement = /** @type {InsertRow} */ (await row(ctx, "After barrier"));
        await bounded(() => storage.uow.run(ctx.owner, {}, async writer => {
          await storage.memories.replaceContent(writer, scope, ref.id, ref.revision, replacement, null, 2);
          await storage.memories.erase(writer, scope, ref.id);
        }), "Concurrent erase did not commit", ctx.timeoutMs ?? 5000);
        resume.release();
        const result = await pending;
        const item = result.items[0];
        check(item.type === "memory" && item.text === "Before barrier", "Fetch mixed snapshots or lost the retained body");
        equal(readRuns, 1, "Single fetch transaction despite the committed write");
        check(visits.length === 4 && visits.every(visited => visited === tx),
          "Identity, state, qualified revision/receipts and final fence must receive the same Tx");
        await rejects(() => contextReadTestService(storage).fetchEvidence(selection, { snapshot: result.snapshot }), "snapshot_stale");
      } finally {
        resume.release();
      }
    },
  },
  {
    id: "T-CONTEXT-READ-4",
    title: "registers the port in both directions and rejects borrowed or ended transactions",
    needs: ["contextRead"],
    async run(ctx) {
      const storage = contextStorage(ctx);
      const scope = ctx.scope("project\0tx");
      const selection = readSet(scope);
      const { contextRead, ...missing } = storage;
      try {
        assertReadContractCapabilities(missing);
        throw new Error("Missing capability port accepted");
      } catch (error) {
        check(isCoreErrorShape(error) && error.code === "capability_unavailable", "Missing port registration");
      }
      try {
        assertReadContractCapabilities({ ...storage, capabilities: { ...storage.capabilities, contextRead: false } });
        throw new Error("Unflagged capability port accepted");
      } catch (error) {
        check(isCoreErrorShape(error) && error.code === "capability_unavailable", "Unflagged port registration");
      }
      const ended = await storage.uow.run(ctx.owner, { readOnly: true }, async tx => tx);
      await rejects(() => contextRead.identity(ended), "internal_error");
      await rejects(() => contextRead.observeIndex(ended, selection, find), "internal_error");
      await rejects(() => storage.uow.run(ctx.otherOwner, { readOnly: true }, tx => contextRead.snapshotState(tx, selection, ["memory"])),
        "internal_error");
    },
  },
  {
    id: "T-CONTEXT-READ-5",
    title: "fetch withholds the only receipt of a visible Memory after a source fence",
    needs: ["contextRead", "rawArchive"],
    async run(ctx) {
      const adapter = contextStorage(ctx);
      const raw = ctx.adapter.raw;
      check(raw, "Raw archive port required");
      const { raw: rawSearch, ...memoryReads } = adapter.contextRead;
      const unreachable = () => { throw new Error("Fetch must not search Raw"); };
      const services = [
        contextReadTestService({ ...adapter, capabilities: { ...adapter.capabilities, contextRawRead: false },
          contextRead: memoryReads }),
        contextReadTestService({ ...adapter, capabilities: { ...adapter.capabilities, contextRawRead: true },
          contextRead: { ...memoryReads, raw: rawSearch ?? { search: unreachable, revalidate: unreachable } } }),
      ];
      const scope = ctx.scope("project\0fenced-evidence");
      const selection = readSet(scope);
      const retained = receipt(1);
      const { client, messageId, role, occurredAtMs, excerpt } = retained;
      const root = { client, sessionId: "original-source-session" };
      await adapter.uow.run(ctx.owner, { pauseLock: true }, async tx => {
        const batch = [{ id: messageId, role, occurredAtMs, content: excerpt ?? "" }];
        for (const [index, { sessionId }] of [root, retained].entries()) {
          const key = { scope, client, sessionId, eventId: "archive-event-" + index, payloadDigest: "a".repeat(64) };
          await raw.recordLineage(tx, key, batch);
          equal((await raw.archive(tx, key, batch)).archived, 1, "Archive both the original turn and its fork");
        }
      });
      const ref = await insert(ctx, scope, "A visible Memory with one receipt", [retained]);
      const before = await Promise.all(services.map(service => service.fetchEvidence(selection, { refs: [ref], intent: current })));
      await adapter.uow.run(ctx.owner, { pauseLock: true }, tx => raw.fenceSession(tx, scope, root));
      for (const [index, service] of services.entries()) {
        const initial = before[index].items[0];
        check(initial.type === "memory" && initial.provenance.sources.length === 1, "Fixture has one retained receipt");
        const after = await service.fetchEvidence(selection, { refs: [ref], intent: current });
        const item = after.items[0];
        check(item.type === "memory" && item.text === initial.text, "A fenced receipt leaves the Memory visible");
        equal(item.provenance.sources, [], "Withhold receipt ID and content identity");
        equal(item.provenance.receiptMetadata, [], "Withhold receipt metadata");
        equal(item.provenance.coverage, { status: "budget_exhausted", included: 0, omitted: 1 }, "Count the withheld receipt");
        check(!excerpt || !JSON.stringify(item).includes(excerpt), "Fenced excerpt is absent from delivery");
        await rejects(() => service.fetchEvidence(selection, { snapshot: before[index].snapshot }), "snapshot_stale");
      }
    },
  },
];
