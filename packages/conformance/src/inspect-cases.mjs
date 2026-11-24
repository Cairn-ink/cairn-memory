import { assertAdapterCapabilities, compareUtf8, receiptExcerpt } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { check, equal, gate, rejects, row, source } from "./support.mjs";

/** @import { ClockAndHash, InspectItemInput, InspectListInput, Receipt, Scope, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

const encoder = new TextEncoder();
const algorithm = { name: "HMAC", hash: "SHA-256" };

/** @param {ArrayBuffer} digest */
const hex = digest => Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");

/** @type {ClockAndHash} */
const clock = {
  nowMs: () => 10,
  monotonicMs: () => 0,
  async sha256Hex(value) {
    return hex(await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : new Uint8Array(value)));
  },
  async hmacHex(key, value) {
    const signingKey = key instanceof Uint8Array
      ? await crypto.subtle.importKey("raw", new Uint8Array(key), algorithm, false, ["sign"]) : key;
    return hex(await crypto.subtle.sign("HMAC", signingKey, typeof value === "string" ? encoder.encode(value) : new Uint8Array(value)));
  },
};

/** @param {CaseContext["adapter"]} storage */
const keyless = storage => createMemoryService({ profile: "keyless-local", storage, clock }).inspect;

/** @param {string} messageId @param {string} [excerpt] @returns {Receipt} */
const receipt = (messageId, excerpt) => ({ client: "inspect-client", sessionId: "inspect-session",
  messageId, role: "user", occurredAtMs: 1, ...(excerpt !== undefined && { excerpt }) });

/** @param {CaseContext} ctx @param {Scope} scope @param {string} text @param {number} ms @param {Receipt[]} [receipts] */
async function insert(ctx, scope, text, ms, receipts = []) {
  const content = await row(ctx, text);
  return ctx.adapter.uow.run(scope.owner, {}, tx => ctx.adapter.memories.insert(tx, scope, content, receipts, ms));
}

/** @param {CaseContext["adapter"]} storage @param {Scope} scope @param {string} id */
async function detail(storage, scope, id) {
  const item = await keyless(storage)(scope, { memoryId: id });
  check(item.mode === "item", "Item discriminator");
  return item;
}

/** @param {string} value */
const b64 = value => btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");

/** Sign a syntactically valid continuation that references a receipt position that no longer exists.
 * @param {CaseContext["adapter"]} adapter @param {Scope} scope @param {string} original
 */
async function lostAnchor({ uow, inspect }, scope, original) {
  check(inspect, "Inspect capability requires its port");
  return uow.run(scope.owner, { readOnly: true }, async tx => {
    const { cursorKey } = await inspect.identity(tx);
    const [body] = original.split(".");
    const payload = JSON.parse(atob(body.replaceAll("-", "+").replaceAll("_", "/")));
    payload.a = { row: Number.MAX_SAFE_INTEGER };
    const encoded = b64(String.fromCharCode(...encoder.encode(JSON.stringify(payload))));
    const signature = await clock.hmacHex(cursorKey, encoded);
    return encoded + "." + b64(String.fromCharCode(...Array.from(signature.match(/../g) ?? [], byte => Number.parseInt(byte, 16))));
  });
}

/** @type {readonly ConformanceCase[]} */
export const INSPECT_CASES = [
  {
    id: "K-INSPECT-1", title: "inspect empty, list, state filters and exact continuation order", needs: ["inspect"],
    requests: { supersession: true },
    async run(ctx) {
      const { adapter, harness, owner, otherOwner } = ctx;
      const scope = ctx.scope("project\0inspect");
      const inspect = keyless(adapter);
      equal(await inspect(scope, {}), { mode: "list", memories: [], nextCursor: null, exhausted: true }, "Empty list shape");

      const a = await insert(ctx, scope, "First visible memory", 5);
      const b = await insert(ctx, scope, "Second visible memory", 5);
      const c = await insert(ctx, scope, "Retained historical body", 4);
      const hidden = await insert(ctx, scope, "Suppressed memory ahead of first page", 6);
      const eachScope = [ctx.scope("personal\0"), { owner: otherOwner, namespace: scope.namespace }];
      for (const foreign of eachScope) await insert(ctx, foreign, "Foreign scope body", 7);
      await harness.seedFact(owner, { ...scope, kind: "identity", memoryId: hidden.id, actionId: "hide-inspect", origin: "forget" });

      if (adapter.supersession) {
        await adapter.uow.run(owner, {}, tx => adapter.supersession?.markHistorical(tx, scope, c.id, 4) ?? Promise.resolve());
      } else {
        check(harness.markInspectHistorical, "Historical inspect fixture");
        await harness.markInspectHistorical(scope, c.id);
      }
      const order = [a.id, b.id].sort(compareUtf8).concat(c.id);
      let cursor;
      for (const [index, id] of order.entries()) {
        const page = await inspect(scope, { limit: 1, ...(cursor && { cursor }) });
        check(page.mode === "list", "List discriminator");
        equal(page.memories.map(row => row.id), [id], "List order must use visible rows, exact time and UTF-8 ID");
        check(!Object.hasOwn(page.memories[0], "text") && !Object.hasOwn(page.memories[0], "updatedAtUs"), "List returns metadata only");
        equal(page.exhausted, index === order.length - 1, "Only the last visible row exhausts the list");
        cursor = page.nextCursor;
      }
      equal(cursor, null, "Exhausted list cursor");
      for (const [state, ids] of /** @type {const} */ ([["active", order.slice(0, 2)], ["historical", [c.id]]])) {
        const page = await inspect(scope, { states: [state] });
        check(page.mode === "list", "State-filtered list");
        equal(page.memories.map(row => row.id), ids, "State filter");
        check(page.memories.every(row => row.state === state), "State metadata");
      }
      equal((await detail(adapter, scope, c.id)).memory.text, "Retained historical body", "Historical evidence retains its stored body");
      await rejects(() => inspect(scope, { memoryId: hidden.id }), "memory_not_found");
    },
  },
  {
    id: "K-INSPECT-2", title: "inspect item, receipt paging, qualification and procedural anchors", needs: ["inspect"],
    async run(ctx) {
      const { adapter, harness, owner } = ctx;
      const scope = ctx.scope(null);
      const excerpt = receiptExcerpt("  Ｓource\t " + "password=" + "f".repeat(20) + "  " + "x".repeat(900));
      const attached = receipt("first", excerpt);
      const input = [attached, receipt("no-stored-excerpt"), receipt("second", "Second source"),
        { ...receipt("withheld-source", "Source with a denied event time"), occurredAtMs: 9 }];
      const saved = await insert(ctx, scope, "Stored inspected body", 2, input);
      await harness.seedFact(owner, { ...scope, kind: "window", client: null,
        window: { startMs: 8, endMs: 10 }, actionId: "withhold-inspect-source", origin: "forget" });
      const first = await detail(adapter, scope, saved.id);
      equal(first.memory.filing, { status: "unfiled" }, "Filing shape");
      equal(first.memory.receiptCount, 2, "Missing and source-withheld excerpts are excluded from counts");
      equal(first.receipts.length, 2, "Missing and source-withheld excerpts are skipped");
      equal([first.placements, first.conflicts], [[], []], "Absent capabilities yield empty arrays");
      check(!Object.hasOwn(first, "qualification"), "Qualification is omitted by default");
      equal(first.memory.text, "Stored inspected body", "Inspect returns the stored text");
      const stored = first.receipts.find(row => row.eventId === attached.messageId);
      check(stored && stored.id !== stored.eventId && /^[a-f0-9-]{36}$/u.test(stored.id), "Receipt has an allocated UUID");
      check(stored.excerpt === excerpt && excerpt.includes("[REDACTED]") && excerpt.length === 800, "Retained excerpt redaction and bound");
      equal(stored.occurredAtMs, 1, "Source event time");
      equal(stored.createdAtMs, 2, "Receipt creation time");

      await adapter.uow.run(owner, {}, tx => adapter.memories.touchDuplicate(tx, scope, saved.id,
        [{ ...attached, id: "incoming-fake-id" }, receipt("last", "Later source")], { confidence: 0.4 }, 3));
      const retained = await detail(adapter, scope, saved.id);
      equal(retained.receipts.find(row => row.eventId === attached.messageId)?.id, stored.id, "Duplicate attachment reuses the receipt ID");
      equal(retained.receipts.map(row => row.id).slice(0, 2), first.receipts.map(row => row.id).sort(compareUtf8), "Tied receipt IDs sort in UTF-8 order");
      equal(retained.receipts.at(-1)?.eventId, "last", "Receipt creation time precedes ID in ordering");

      const digest = await clock.sha256Hex(stored.excerpt);
      const procedural = { tagRevision: 1, procedural: true, origin: /** @type {const} */ ("explicit"),
        anchors: [{ receiptId: stored.id, digest, start: 0, end: 6 }] };
      const qualification = { version: 1, anchors: [{ receiptId: stored.id, receiptDigest: digest, start: 0, end: 6,
        text: stored.excerpt.slice(0, 6) }] };
      check(harness.seedInspectEvidence, "Inspect evidence fixtures");
      await harness.seedInspectEvidence(scope, saved.id, { procedural, qualification });
      const inspect = keyless(adapter);
      let receiptCursor;
      for (const [index, receipt] of retained.receipts.entries()) {
        const includeQualification = index % 2 === 0;
        const page = await inspect(scope, { memoryId: saved.id, receiptLimit: 1,
          ...(receiptCursor && { receiptCursor }), includeQualification });
        check(page.mode === "item", "Item discriminator");
        equal(page.receipts, [receipt], "Receipt page skips withheld rows and retains order");
        equal(page.procedural, procedural, "Procedural anchors are returned even when off-page");
        if (includeQualification) equal(page.qualification, qualification, "Requested stored qualification");
        else check(!Object.hasOwn(page, "qualification"), "Explicit false omits qualification");
        receiptCursor = page.nextReceiptCursor;
        equal(page.exhausted, index === retained.receipts.length - 1, "Receipt lookahead controls exhaustion");
      }
      equal(receiptCursor, null, "Receipt continuation terminates");

      await harness.seedInspectEvidence(scope, saved.id, { procedural: { ...procedural,
        anchors: [{ ...procedural.anchors[0], receiptId: "withheld" }] }, qualification: { ...qualification,
        anchors: [{ ...qualification.anchors[0], receiptId: "withheld" }] } });
      const withheld = await inspect(scope, { memoryId: saved.id, includeQualification: true });
      check(withheld.mode === "item" && withheld.qualification === null && !Object.hasOwn(withheld, "procedural"),
        "Unsafe anchors withhold both qualification and procedural evidence");
    },
  },
  {
    id: "K-INSPECT-3", title: "inspect invalid combination, invalid cursor and stale continuations", needs: ["inspect"],
    async run(ctx) {
      const { adapter } = ctx;
      const scope = ctx.scope("personal\0");
      const a = await insert(ctx, scope, "Memory with two inspect receipts", 2, [receipt("a", "Source A"), receipt("b", "Source B")]);
      const b = await insert(ctx, scope, "Another visible memory", 1);
      const inspect = keyless(adapter);
      const list = await inspect(scope, { limit: 1, states: ["historical", "active"] });
      const item = await inspect(scope, { memoryId: a.id, receiptLimit: 1 });
      check(list.mode === "list" && list.nextCursor && item.mode === "item" && item.nextReceiptCursor, "Both pages have continuations");
      const { nextCursor } = list;
      const { nextReceiptCursor } = item;
      for (const value of [{ memoryId: a.id, limit: 1 }, { includeQualification: false }, { receiptLimit: 1 }]) {
        await rejects(() => inspect(scope, /** @type {InspectItemInput | InspectListInput} */ (/** @type {unknown} */ (value))), "invalid_input");
      }
      const other = ctx.scope("project\0different");
      await rejects(() => inspect(scope, { cursor: "synthetic-invalid-cursor" }), "invalid_cursor");
      await rejects(() => inspect(scope, { cursor: nextCursor, limit: 2 }), "invalid_cursor");
      await rejects(() => inspect(scope, { cursor: nextCursor, limit: 1, states: ["active"] }), "invalid_cursor");
      await rejects(() => inspect(other, { cursor: nextCursor, limit: 1 }), "invalid_cursor");
      await rejects(() => inspect(scope, { memoryId: a.id, receiptCursor: nextCursor, receiptLimit: 1 }), "invalid_cursor");
      await rejects(() => inspect(scope, { memoryId: b.id, receiptCursor: nextReceiptCursor, receiptLimit: 1 }), "invalid_cursor");

      const missing = await lostAnchor(adapter, scope, nextReceiptCursor);
      await rejects(() => inspect(scope, { memoryId: a.id, receiptCursor: missing, receiptLimit: 1 }), "cursor_stale");
      await insert(ctx, other, "An unrelated namespace write", 3);
      const resumed = await inspect(scope, { cursor: nextCursor, limit: 1 });
      check(resumed.mode === "list" && resumed.memories[0]?.id === b.id, "An unrelated namespace leaves the continuation valid");
      await insert(ctx, scope, "New write in the inspected namespace", 4);
      await rejects(() => inspect(scope, { cursor: nextCursor, limit: 1 }), "cursor_stale");
      await rejects(() => inspect(scope, { memoryId: a.id, receiptCursor: nextReceiptCursor, receiptLimit: 1 }), "cursor_stale");
    },
  },
  {
    id: "K-INSPECT-4", title: "inspect keeps a single read snapshot across a correction", needs: ["inspect"],
    async run(ctx) {
      const { adapter, owner } = ctx;
      const scope = ctx.scope("project\0snapshot");
      const old = await insert(ctx, scope, "Original stored body", 5, [receipt("source", "Original source")]);
      const inspect = adapter.inspect;
      check(inspect, "Inspect port is registered");
      await rejects(() => adapter.uow.run(owner, { readOnly: true }, tx =>
        inspect.list(tx, { ...scope, owner: ctx.otherOwner }, { states: ["active"], limit: 1 })), "internal_error");

      /** @type {Tx | undefined} */
      let finished;
      await adapter.uow.run(owner, { readOnly: true }, async tx => { finished = tx; });
      await rejects(() => inspect.identity(/** @type {Tx} */ (finished)), "internal_error");
      const entered = gate();
      const corrected = gate();
      let reads = 0;
      /** @type {Tx | undefined} */
      let snapshotTx;
      const service = keyless({
        ...adapter,
        uow: { run(owner, options, fn) {
          reads++;
          equal(options, { readOnly: true }, "Inspect uses a read-only run");
          return adapter.uow.run(owner, options, tx => {
            snapshotTx = tx;
            return fn(tx);
          });
        } },
        inspect: {
          ...inspect,
          async item(tx, scope, id, page) {
            check(tx === snapshotTx, "Inspect port receives the same transaction");
            entered.release(undefined);
            await corrected.promise;
            return inspect.item(tx, scope, id, page);
          },
        },
      });
      const pending = service(scope, { memoryId: old.id });
      await entered.promise;
      try {
        const newRow = await row(ctx, "Corrected stored body");
        await adapter.uow.run(owner, {}, tx => adapter.memories.replaceContent(tx, scope, old.id, old.revision,
          newRow, [receipt("corrected-source", "Corrected source")], 6));
      } finally {
        corrected.release(undefined);
      }
      const previous = await pending;
      check(previous.mode === "item" && previous.memory.revision === old.revision && previous.memory.text === "Original stored body",
        "An in-flight inspect retains the original body and revision");
      equal(previous.receipts.map(receipt => receipt.eventId), ["source"], "Receipt page shares the body snapshot");
      equal(reads, 1, "Inspect makes one UnitOfWork call");
      const latest = await detail(adapter, scope, old.id);
      equal([latest.memory.revision, latest.memory.text, latest.receipts[0].eventId],
        [old.revision + 1, "Corrected stored body", "corrected-source"], "The next inspect reflects the correction");
    },
  },
  {
    id: "K-INSPECT-5", title: "inspect forgotten returns memory_not_found after forget", needs: ["inspect"],
    async run(ctx) {
      const { adapter } = ctx;
      const scope = ctx.scope(null);
      const saved = await insert(ctx, scope, "A memory to forget", 2);
      const unavailable = () => { throw new Error("Unexpected model call"); };
      const service = createMemoryService({ storage: { name: "inspect-conformance", ...adapter }, clock, config: {},
        model: { model: "unused", contextWindow: 1, call: unavailable, countTokens: unavailable },
        embedder: { model: "unused", dimensions: 1, embed: unavailable },
        gate: { assertOpen: unavailable }, tokens: { countTokens: unavailable },
      });
      equal((await service.forget(scope, saved.id, source)).status, "forgotten", "Forget commits");
      await rejects(() => service.inspect(scope, { memoryId: saved.id }), "memory_not_found");
      equal(await service.inspect(scope, {}), { mode: "list", memories: [], nextCursor: null, exhausted: true }, "Forgotten rows leave the list");
    },
  },
  {
    id: "K-INSPECT-6", title: "inspect registration requires flag and port agreement", needs: ["inspect"],
    async run({ adapter }) {
      const { inspect: _port, ...missing } = adapter;
      assertAdapterCapabilities(adapter);
      await rejects(async () => assertAdapterCapabilities(missing), "capability_unavailable");
      await rejects(async () => assertAdapterCapabilities({ ...adapter, capabilities: { ...adapter.capabilities, inspect: false } }),
        "capability_unavailable");
    },
  },
  {
    id: "K-INSPECT-7", title: "inspect withholds a fenced receipt and invalidates earlier receipt cursors",
    needs: ["inspect", "rawArchive"],
    requests: { supersession: true },
    async run(ctx) {
      const { adapter, harness, owner } = ctx;
      const raw = adapter.raw;
      check(raw && harness.seedInspectEvidence, "Fenced receipt fixtures");
      const scope = ctx.scope("personal\0");
      const retained = receipt("fenced-turn", "An excerpt from the fenced conversation");
      const safe = { ...receipt("safe-turn", "Independent receipt"), sessionId: "safe-session" };
      /** @param {Receipt} sourceReceipt */
      async function archive({ client, sessionId, messageId, role, occurredAtMs, excerpt }) {
        await adapter.uow.run(owner, { pauseLock: true }, tx => raw?.archive(tx,
          { scope, client, sessionId, eventId: "archive-" + messageId, payloadDigest: "a".repeat(64) },
          [{ id: messageId, role, occurredAtMs, content: excerpt ?? "" }]) ?? Promise.resolve());
      }
      await archive(retained);
      await archive(safe);
      const memory = await insert(ctx, scope, "Visible body with one receipt", 1, [retained]);
      const paged = await insert(ctx, scope, "Visible body with paged receipts", 2, [safe]);
      await adapter.uow.run(owner, {}, tx => adapter.memories.touchDuplicate(tx, scope, paged.id, [retained], { confidence: 0.4 }, 3));
      const before = await detail(adapter, scope, memory.id);
      equal(before.memory.receiptCount, 1, "Fixture starts with one visible receipt");
      const stored = before.receipts[0];
      const digest = await clock.sha256Hex(stored.excerpt);
      const anchors = [{ receiptId: stored.id, digest, start: 0, end: 2 }];
      await harness.seedInspectEvidence(scope, memory.id, {
        qualification: { anchors },
        procedural: { tagRevision: 1, procedural: true, origin: "explicit", anchors },
      });
      const inspect = keyless(adapter);
      const preFence = await inspect(scope, { memoryId: memory.id, includeQualification: true });
      check(preFence.mode === "item" && preFence.qualification && preFence.procedural, "Both anchors are initially visible");

      const previous = await insert(ctx, scope, "Historical body for a supersession link", 0);
      const supersession = adapter.supersession;
      if (supersession) {
        await adapter.uow.run(owner, {}, async tx => {
          await supersession.record(tx, scope, { previous: { id: previous.id, revision: previous.revision },
            replacement: { id: memory.id, revision: memory.revision } }, [stored.id], 4);
          await supersession.markHistorical(tx, scope, previous.id, 4);
        });
        equal((await detail(adapter, scope, previous.id)).supersession?.receiptIds, [stored.id], "Supersession starts with evidence");
      }
      const page = await inspect(scope, { memoryId: paged.id, receiptLimit: 1 });
      check(page.mode === "item" && page.nextReceiptCursor, "Expected pre-fence continuation");
      const store = adapter.inspect;
      check(store, "Inspect store required");
      const { nextAnchor } = await adapter.uow.run(owner, { readOnly: true }, tx =>
        store.item(tx, scope, paged.id, { limit: 1, includeQualification: false }));
      check(nextAnchor, "Expected a stored receipt anchor");

      await adapter.uow.run(owner, { pauseLock: true }, tx => raw.fenceSession(tx, scope, retained));
      await rejects(() => inspect(scope, { memoryId: paged.id, receiptLimit: 1, receiptCursor: page.nextReceiptCursor ?? "" }), "cursor_stale");
      const continuation = await adapter.uow.run(owner, { readOnly: true }, tx =>
        store.item(tx, scope, paged.id, { limit: 1, includeQualification: false, after: nextAnchor }));
      equal(continuation.item?.receipts, [], "The continuation independently applies read safety");
      const item = await inspect(scope, { memoryId: memory.id, includeQualification: true });
      check(item.mode === "item", "Memory stays visible after its source fence");
      equal([item.receipts, item.memory.receiptCount, item.qualification, item.procedural], [[], 0, null, null],
        "Fenced source withheld from the page, count and stored anchors");
      const list = await inspect(scope, {});
      check(list.mode === "list", "List discriminator");
      equal(list.memories.find(r => r.id === memory.id)?.receiptCount, 0, "List excludes fenced receipts from counts");
      const filtered = await detail(adapter, scope, paged.id);
      equal(filtered.receipts.map(r => r.excerpt), [safe.excerpt], "Fresh paging still filters a fenced source");
      if (supersession) {
        const historical = (await detail(adapter, scope, previous.id)).supersession;
        equal([historical?.receiptIds, historical?.evidenceAvailable], [[], false], "Supersession withholds fenced evidence");
      }

      // Deletion alone must also stale cursors and withhold the archived source.
      const second = { ...safe, messageId: "second-safe-turn", sessionId: "second-safe-session" };
      await archive(second);
      await adapter.uow.run(owner, {}, tx => adapter.memories.touchDuplicate(tx, scope, paged.id, [second], { confidence: 0.4 }, 5));
      const preDelete = await inspect(scope, { memoryId: paged.id, receiptLimit: 1 });
      check(preDelete.mode === "item" && preDelete.nextReceiptCursor, "Expected pre-delete continuation");
      await adapter.uow.run(owner, { pauseLock: true }, tx => raw.deleteConversation(tx, scope, second));
      await rejects(() => inspect(scope, { memoryId: paged.id, receiptLimit: 1, receiptCursor: preDelete.nextReceiptCursor ?? "" }), "cursor_stale");
      equal((await detail(adapter, scope, paged.id)).receipts.map(r => r.messageId), [safe.messageId], "Deleted archive source is withheld");
      await archive(second);
      equal((await detail(adapter, scope, paged.id)).receipts.map(r => r.messageId), [safe.messageId], "A replay cannot restore deleted receipt evidence");
    },
  },
];
