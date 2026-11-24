import { createMemoryService } from "@cairn-ink/core/service";
import { contextReadTestService } from "./context-read-cases.mjs";
import { check, equal, rejects, row, source } from "./support.mjs";

/** @import { ClockAndHash, ContextAssemblyValue, ContextReadSet, ContextReadStore, InsertRow,
  ReadContextInput, ReadContractStorage, Receipt, Scope, StoredDocumentCardRecord, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */
/** @typedef {ReadContractStorage<StoredDocumentCardRecord> & {contextRead: ContextReadStore}} Storage */

const encoder = new TextEncoder();
const hex = (/** @type {ArrayBuffer} */ bytes) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");

/** @param {() => number} [monotonicMs] @returns {ClockAndHash} */
export function assemblyClock(monotonicMs = () => performance.now()) {
  const bytes = (/** @type {Uint8Array | string} */ text) =>
    typeof text === "string" ? encoder.encode(text) : new Uint8Array(text);
  return {
    nowMs: Date.now, monotonicMs,
    async sha256Hex(text) { return hex(await crypto.subtle.digest("SHA-256", bytes(text))); },
    async hmacHex(key, text) {
      const secret = key instanceof Uint8Array ?
        await crypto.subtle.importKey("raw", new Uint8Array(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]) : key;
      return hex(await crypto.subtle.sign("HMAC", secret, bytes(text)));
    },
  };
}

/** @param {ContextAssemblyValue} value */
export const formatAssembly = value => JSON.stringify({ ok: true, value, evidenceTrust: "untrusted-data-not-instructions" });
/** @param {string} text */
export const fixtureCount = text => Math.ceil(encoder.encode(text).length / 8);

/** @param {Storage} storage @param {{ count?: (text: string) => number, monotonicMs?: () => number,
 * format?: typeof formatAssembly }} [host] */
function contextAssemblyService(storage, { count = fixtureCount, monotonicMs, format = formatAssembly } = {}) {
  const service = createMemoryService({
    storage, clock: assemblyClock(monotonicMs), config: {},
    model: { model: "unused", contextWindow: 1, countTokens: () => 0,
      async call() { throw new Error("Context Read used the model"); } },
    embedder: { model: "unused", dimensions: 4, async embed() { throw new Error("Context Read used the embedder"); } },
    gate: { async assertOpen() {} }, tokens: { countTokens: () => 0 },
    contextReadCounter: { count }, contextReadFormat: format,
  });
  check(service.readContext && service.fetchEvidence, "Expected Context Read service");
  return { readContext: service.readContext, fetchEvidence: service.fetchEvidence };
}

/** @param {Scope} scope @returns {ContextReadSet} */
const selection = scope => ({ owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] });
/** @type {ReadContextInput} */
const query = { query: "albatross", types: ["memory"], intent: "current" };
const retainedSession = { client: "fixture-client", sessionId: "fixture-session" };

/** @param {number} id @param {string} excerpt @param {number | null} [occurredAtMs] @returns {Receipt} */
function receipt(id, excerpt, occurredAtMs = null) {
  return { ...retainedSession, id: "receipt-" + id, eventId: "event-" + id, messageId: "turn-" + id,
    role: "user", occurredAtMs, createdAtMs: id, excerpt };
}

/** @param {CaseContext} ctx @param {Scope} scope @param {string} body @param {readonly Receipt[]} [receipts] */
async function insert(ctx, scope, body, receipts = []) {
  const input = { ...await row(ctx, body), confidence: 1 };
  const { id, revision } = await ctx.adapter.uow.run(ctx.owner, {}, tx =>
    ctx.adapter.memories.insert(tx, scope, input, receipts, 1));
  return { type: /** @type {const} */ ("memory"), scope, id, revision };
}

/** @param {CaseContext} ctx */
function storageOf(ctx) {
  const storage = /** @type {Storage} */ (ctx.adapter);
  check(storage.contextRead, "Context Read adapter port is missing");
  return storage;
}

/** @type {readonly ConformanceCase[]} */
export const CONTEXT_ASSEMBLY_CASES = [
  {
    id: "T-CONTEXT-ASSEMBLY-1",
    title: "meters the default dated block and deduplicates qualified receipt excerpts in rendered order",
    needs: ["contextRead"],
    async run(ctx) {
      const scope = ctx.scope("project\0assemble");
      const lateTime = Date.UTC(2025, 4, 5, 12, 2, 59), earlyTime = Date.UTC(2025, 4, 5, 12, 1, 12);
      const lateBody = "albatross albatross rests", earlyBody = "an albatross flies";
      const shared = "the island is windy";
      const late = await insert(ctx, scope, lateBody, [receipt(1, shared, lateTime), receipt(2, lateBody)]);
      const early = await insert(ctx, scope, earlyBody, [receipt(3, earlyBody, earlyTime), receipt(4, shared)]);
      const storage = storageOf(ctx);
      const { contextRead } = storage;
      const storedTime = Date.UTC(2025, 4, 5, 12, 4);
      const service = contextAssemblyService({ ...storage, contextRead: { ...contextRead,
        async evidence(...args) {
          const rows = await contextRead.evidence(...args);
          return rows.map(row => row?.type === "memory" && row.ref.id === late.id
            ? { ...row, receipts: row.receipts.map(receipt => receipt.id === "receipt-1"
              ? { ...receipt, sourceTimesMs: [storedTime, lateTime, storedTime + 10] } : receipt) } : row);
        },
      } });
      const result = await service.readContext(selection(scope), query);
      const [first, second] = result.assembly.items;
      check(first && second && "sources" in first && "sources" in second, "Expected two Memory bodies");
      equal(first.ref.id, early.id, "Dated order is independent of retrieval rank");
      equal(second.ref.id, late.id, "Second dated Memory");
      equal([first.rank, second.rank], [2, 1], "Original ranks survive date ordering");
      equal([first.date, second.date], ["2025-05-05T12:01Z", "2025-05-05T12:02Z"], "Stored event dates rounded to minutes");
      equal(first.sources, [
        { index: 0, date: "2025-05-05T12:01Z", role: "user", sameAsBody: true },
        { index: 1, role: "user", excerpt: shared },
      ], "First concrete source and body dedup");
      equal(second.sources, [
        { index: 0, dates: ["2025-05-05T12:02Z", "2025-05-05T12:04Z"], sameAs: { item: 0, source: 1 } },
        { index: 1, role: "user", sameAsBody: true },
      ], "Date ordering and duplicate pointer use the rendered positions");
      equal(Object.keys(first), ["ref", "rank", "date", "body", "sources"], "Wire property order and default omission");
      equal(Object.keys(first.ref), ["ns", "type", "id", "rev", "f"], "Compact ref property order");
      const diagnostics = result.diagnostics;
      equal(diagnostics.policy, { id: "rank-first-whole-v1" }, "Default policy");
      equal(diagnostics.representation, "representation-v2-dated", "Default representation");
      equal(diagnostics.budget, { maxTokens: 6000, maxItems: 24, used: fixtureCount(formatAssembly(result.assembly)) }, "Exact block count");
      equal(diagnostics.dedup, { sources: 1, body: 2 }, "Deduplication counters");
      equal(diagnostics.trace.counterCalls, 14, "Empty and final counts plus each unit and trial");
      check(result.snapshot, "Delivered Memory snapshot");
      equal((await service.fetchEvidence(selection(scope), { snapshot: result.snapshot })).items.map(({ ref }) => ref.id),
        [late.id, early.id], "Snapshot binds delivered Memory refs in packing order");
      const plain = await service.readContext(selection(scope), { ...query, representation: "representation-v2" });
      check(plain.assembly.items.every(item => !("date" in item) && "sources" in item &&
        item.sources.every(source => !("date" in source) && !("dates" in source))), "Undated representation omits provenance dates");
      equal(plain.assembly.items.flatMap(item => "sources" in item ? [item.ref.id] : []), [late.id, early.id], "Undated result preserves packing order");
    },
  },
  {
    id: "T-CONTEXT-ASSEMBLY-2",
    title: "keeps date-only evidence, enforces whole units, policies and the complete response byte guard",
    needs: ["contextRead"],
    async run(ctx) {
      const scope = ctx.scope("project\0budget");
      const date = Date.UTC(2025, 1, 3, 4, 5);
      const excerpt = "d".repeat(560);
      const short = "albatross albatross is here";
      const big = ("albatross " + "whole-body ".repeat(90)).trim();
      await insert(ctx, scope, short, [receipt(1, excerpt, date), receipt(2, short)]);
      await insert(ctx, scope, big);
      const storage = storageOf(ctx);
      const service = contextAssemblyService(storage);
      const limited = await service.readContext(selection(scope), { ...query, budget: { maxTokens: 70 } });
      equal(limited.assembly.items.length, 1, "The oversized body is omitted whole");
      const item = limited.assembly.items[0];
      check("sources" in item, "Expected the small body");
      equal(item.body, short, "The accepted body is whole");
      equal(item.sources, [{ index: 0, date: "2025-02-03T04:05Z", role: "user" },
        { index: 1, role: "user", sameAsBody: true }], "Date-only evidence survives a failed excerpt trial");
      equal(item.sourcesComplete, false, "An omitted excerpt makes sources incomplete");
      equal(limited.diagnostics.omitted, { items: 1, bodies: 1, sources: 1, unavailable: 0, oversized: 2 }, "Whole-unit omissions");
      equal(limited.diagnostics.stops, { budget: true, items: false, deadline: false }, "Budget stop");
      const firstSource = await service.readContext(selection(scope), { ...query, policy: { id: "rank-first-first-source-v1" },
        budget: { maxTokens: 70, maxItems: 1 } });
      check("sources" in firstSource.assembly.items[0], "Expected whole first-source body");
      equal(firstSource.assembly.items[0].sources, [{ index: 0, date: "2025-02-03T04:05Z", role: "user" }], "Second source is never tried");
      equal(firstSource.diagnostics.stops.items, true, "Body limit is reported even when sources are omitted");
      const coverage = await service.readContext(selection(scope), { ...query, policy: { id: "coverage-first-v1" } });
      equal(coverage.assembly.items.length, 2, "Coverage-first can include both whole bodies");
      equal(coverage.diagnostics.budget.used, fixtureCount(formatAssembly(coverage.assembly)), "Coverage-first exact final count");
      const competing = ctx.scope("project\0competing-units"), competingSet = selection(competing);
      await insert(ctx, competing, "albatross albatross primary", [receipt(3, "one source ".repeat(23).trim())]);
      await insert(ctx, competing, "albatross secondary recollection " + "with details ".repeat(10));
      const all = await service.readContext(competingSet, query);
      const onlyFirst = { ...all.assembly, items: all.assembly.items.slice(0, 1) };
      const bodiesOnly = { ...all.assembly, items: all.assembly.items.map(item => "sources" in item && item.sources.length
        ? { ...item, sources: [], sourcesComplete: /** @type {const} */ (false) } : item) };
      const maxTokens = Math.max(64, fixtureCount(formatAssembly(onlyFirst)), fixtureCount(formatAssembly(bodiesOnly)));
      check(maxTokens < all.diagnostics.budget.used, "Fixture must make the source and second body compete for space");
      const rankFirst = await service.readContext(competingSet, { ...query, budget: { maxTokens } });
      equal(rankFirst.assembly.items.length, 1, "Rank-first spends the remaining budget on the first source");
      const bodiesFirst = await service.readContext(competingSet, { ...query, budget: { maxTokens }, policy: { id: "coverage-first-v1" } });
      equal(bodiesFirst.assembly.items.length, 2, "Coverage-first reserves the same budget for a second whole body");
      equal(bodiesFirst.diagnostics.omitted.sources, 1, "Coverage-first accounts for the competing source it omitted");
      const byteGuard = contextAssemblyService(storage, { count: () => 1, format: value => formatAssembly(value) +
        (value.items.length ? " ".repeat(65_536) : "") });
      const byteLimited = await byteGuard.readContext(selection(scope), query);
      equal(byteLimited.assembly.items, [], "Byte-only guard rejects bodies that fit the token count");
      equal(byteLimited.diagnostics.trace.counterCalls, 6, "No minimal-probe counter call on byte rejection");
      await rejects(() => contextAssemblyService(storage, { count: () => 6001 }).readContext(selection(scope), query),
        "context_item_too_large");
      await rejects(() => contextAssemblyService(storage, { count: () => -1 }).readContext(selection(scope), query),
        "token_count_unavailable");
      await rejects(() => service.readContext(selection(scope), { ...query, budget: { maxTokens: 63 } }), "invalid_input");
      await rejects(() => service.readContext(selection(scope), { ...query, budget: { maxItems: 25 } }), "invalid_input");
    },
  },
  {
    id: "T-CONTEXT-ASSEMBLY-3",
    title: "keeps the last measured pack at the deadline and refuses any stale final revision",
    needs: ["contextRead"],
    async run(ctx) {
      const scope = ctx.scope("project\0assembly-fence");
      const body = "albatross albatross first", other = "an albatross second";
      const ref = await insert(ctx, scope, body);
      await insert(ctx, scope, other);
      const storage = storageOf(ctx);
      let now = 0;
      const deadlineService = contextAssemblyService(storage, { monotonicMs: () => now, count(text) {
        if (text === other) now = 10;
        return fixtureCount(text);
      } });
      const before = await deadlineService.readContext(selection(scope), { ...query, deadlineMs: 10 });
      equal(before.assembly.items.flatMap(item => "sources" in item ? [item.ref.id] : []), [ref.id], "Interrupting the second whole unit preserves the first");
      equal(before.diagnostics.stops.deadline, true, "Deadline stop");
      equal(before.diagnostics.trace.counterCalls, 5, "Required count follows interrupted unit count");
      equal(before.diagnostics.budget.used, fixtureCount(formatAssembly(before.assembly)), "Deadline block is counted exactly");

      const replacement = /** @type {InsertRow} */ (await row(ctx, "A revised albatross"));
      let counted = false, committed = false;
      /** @type {Tx[]} */
      const finalVisits = [];
      const { contextRead, fence, uow } = storage;
      const wrapped = {
        ...storage,
        /** @type {Storage["uow"]} */
        uow: { async run(owner, options, action) {
          check(options.readOnly, "Assembly requires read-only transactions");
          if (counted && !committed) {
            await uow.run(owner, {}, tx => storage.memories.replaceContent(tx, scope, ref.id, ref.revision, replacement, null, 2));
            committed = true;
          }
          return uow.run(owner, options, action);
        } },
        contextRead: { ...contextRead,
          /** @type {ContextReadStore["snapshotState"]} */
          async snapshotState(tx, ...args) {
            if (counted) finalVisits.push(tx);
            return contextRead.snapshotState(tx, ...args);
          },
        },
      };
      const stale = contextAssemblyService(wrapped, { count(text) { counted = true; return fixtureCount(text); } });
      await rejects(() => stale.readContext(selection(scope), query), "snapshot_stale");
      check(committed && finalVisits.length === 1, "An intervening revision is rejected by the final snapshot");

      counted = false;
      finalVisits.length = 0;
      const atomic = contextAssemblyService({ ...wrapped, contextRead: { ...wrapped.contextRead,
        async evidence(tx, ...args) { if (counted) finalVisits.push(tx); return contextRead.evidence(tx, ...args); },
      }, fence: { async assertVisible(tx, ...args) {
        if (counted) finalVisits.push(tx);
        return fence.assertVisible(tx, ...args);
      } } }, { count(text) { counted = true; return fixtureCount(text); } });
      await atomic.readContext(selection(scope), query);
      check(finalVisits.length === 3 && finalVisits.every(tx => tx === finalVisits[0]),
        "Namespace, evidence and visibility use the same final transaction");
    },
  },
  {
    id: "T-CONTEXT-ASSEMBLY-4",
    title: "excludes a fenced receipt from a visible Memory and returns empty assembly after forget",
    needs: ["contextRead", "rawArchive", "fingerprintKey"],
    async run(ctx) {
      const scope = ctx.scope("project\0receipt-fence");
      const storage = storageOf(ctx);
      const raw = storage.raw;
      const importArchive = raw?.importArchive?.bind(raw);
      check(raw && importArchive, "Expected the Raw archive");
      const fenced = "fenced fixture excerpt";
      const receiptDate = Date.UTC(2023, 5, 2);
      const body = "retained albatross Memory";
      const ref = await insert(ctx, scope, body, [receipt(1, fenced, receiptDate)]);
      await storage.uow.run(ctx.owner, { pauseLock: true }, tx =>
        importArchive(tx, scope, retainedSession, [{ id: "turn-1", role: "user", content: fenced, occurredAtMs: receiptDate }]));
      const service = contextAssemblyService(storage);
      const before = await service.readContext(selection(scope), query);
      check(formatAssembly(before.assembly).includes(fenced), "The retained source can be delivered before its fence");
      await storage.uow.run(ctx.owner, { pauseLock: true }, tx => raw.fenceSession(tx, scope, retainedSession));
      const after = await service.readContext(selection(scope), query);
      const item = after.assembly.items[0];
      check(item && "sources" in item && item.body === body, "Session fence allows the Memory body");
      check(!formatAssembly(after.assembly).includes(fenced) && !JSON.stringify(after).includes(fenced),
        "Fenced excerpt is absent everywhere");
      equal(item.sources, [], "Fenced receipt cannot supply dates either");
      equal(item.date, undefined, "Fenced timestamp does not date the body");
      equal(item.sourcesComplete, false, "Qualified evidence reports incomplete sources");

      const forgotten = await contextReadTestService(storage).forget(scope, ref.id, source);
      equal(forgotten.status, "forgotten", "Forget committed");
      const empty = await service.readContext(selection(scope), query);
      equal(empty.assembly.items, [], "No assembly after forget");
      equal(empty.snapshot, null, "Empty assembly has no snapshot");
      equal(empty.diagnostics.budget.used, fixtureCount(formatAssembly(empty.assembly)), "Exact empty block count");
    },
  },
  {
    id: "T-CONTEXT-ASSEMBLY-5",
    title: "uses exact authorized Raw spans and refuses Raw suppressed before final delivery",
    needs: ["contextRead", "contextRawRead", "rawArchive"],
    async run(ctx) {
      const storage = storageOf(ctx);
      const scope = ctx.scope("project\0assembly-raw"), readSet = selection(scope);
      const archive = storage.raw, raw = storage.contextRead.raw;
      const importArchive = archive?.importArchive?.bind(archive);
      check(archive && raw && importArchive, "Expected qualified Raw search and archive");
      const service = contextAssemblyService(storage);
      const empty = await service.readContext(readSet, { ...query, semantic: false });
      equal(empty.diagnostics.coverage.raw, "included", "Complete empty Raw coverage is preserved");
      const deadline = contextAssemblyService(storage, { monotonicMs: () => 0 });
      const short = await deadline.readContext(readSet, { ...query, deadlineMs: 50 });
      equal(short.diagnostics.coverage.raw, "partial", "The later-work reserve leaves no time to observe Raw inventory");
      const content = "😀".repeat(16) + " albatross " + "tail ".repeat(500);
      await storage.uow.run(ctx.owner, { pauseLock: true }, tx => importArchive(tx, scope, retainedSession,
        [{ id: "turn-1", role: "user", content, occurredAtMs: Date.UTC(2025, 1, 3, 4, 5) }]));
      const result = await service.readContext(readSet, { ...query, semantic: false });
      const [item] = result.assembly.items;
      check(item && "layer" in item && item.layer === "Raw", "Expected a Raw-only unit");
      equal(item.body, content.slice(item.start, item.end), "The selected excerpt is an exact authorized span");
      check(fixtureCount(item.body) <= 200 && item.body.includes("albatross") && new TextDecoder().decode(encoder.encode(item.body)) === item.body,
        "The exact span is relevant, Unicode-safe and capped");
      equal(result.diagnostics.budget.used, fixtureCount(formatAssembly(result.assembly)), "Whole Raw unit is metered in the block");
      equal(result.snapshot, null, "Raw turns stay outside the Memory/Card snapshot");

      let counted = false, fenced = false;
      const stale = contextAssemblyService({ ...storage,
        uow: { async run(owner, options, action) {
          if (!fenced && counted) {
            await storage.uow.run(owner, { pauseLock: true }, tx => archive.fenceSession(tx, scope, retainedSession));
            fenced = true;
          }
          return storage.uow.run(owner, options, action);
        } },
      }, { count(text) { counted = true; return fixtureCount(text); } });
      await rejects(() => stale.readContext(readSet, { ...query, semantic: false }), "snapshot_stale");
      check(fenced, "Suppression committed before final Raw witness check");
      const after = await service.readContext(readSet, query);
      equal(after.assembly.items, [], "Fenced Raw text never appears in a subsequent assembly");
      equal(after.diagnostics.coverage.raw, "included", "Complete scan found no eligible Raw turns");
      const many = Array.from({ length: 25 }, (_, i) => ({ id: "hit-" + i, role: /** @type {const} */ ("user"),
        content: "albatross match", occurredAtMs: null }));
      await storage.uow.run(ctx.owner, { pauseLock: true }, tx =>
        importArchive(tx, scope, { ...retainedSession, sessionId: "other-session" }, many));
      const bounded = await service.readContext(readSet, { ...query, semantic: false, budget: { maxItems: 1 } });
      equal(bounded.diagnostics.coverage.raw, "partial", "Only a bounded Raw prefix could be checked");
      equal(bounded.assembly.items.length, 1, "Raw results also respect the item ceiling");
      const disabled = await service.readContext(readSet, { ...query, raw: false });
      equal(disabled.diagnostics.coverage.raw, "unavailable", "Raw can be disabled per call");
    },
  },
];
