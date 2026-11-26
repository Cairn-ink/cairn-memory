import { CoreError, coreDigest, factIncarnationBody } from "@cairn-ink/core";
import { check, equal, rejects, source } from "./support.mjs";

/** @import { CaptureMessage, HostWriteHooks, Scope, Tx } from "@cairn-ink/core/ports" */
/** @import { MemoryServiceDeps } from "@cairn-ink/core/service" */
/** @typedef {{
 *   put(tx: Tx, scope: Scope, key: string, value: unknown, indexed?: boolean): Promise<void>,
 *   get(tx: Tx, scope: Scope, key: string): Promise<unknown>,
 *   stageSave(tx: Tx, scope: Scope, key: string, value: unknown): Promise<void>,
 *   inspect(scope: Scope, key: string): Promise<unknown>,
 * }} HostTable */
/** @typedef {{
 *   deps: MemoryServiceDeps,
 *   createService: (deps: MemoryServiceDeps) => ReturnType<typeof import("@cairn-ink/core/service").createMemoryService>,
 *   scope: Scope,
 *   table: HostTable,
 *   snapshot(): Promise<{indexRevision: number, memoryCount: number, receiptCount: number, factCount: number, rawCount: number}>,
 * }} HostWriteFixture */
/** @typedef {{id: string, title: string, run(f: HostWriteFixture): Promise<void>}} HostWriteCase */

export const captureIdentity = { client: "fixture", sessionId: "capture", eventId: "capture-event" };
export const capturedText = "The meadow has a silver gate.";
/** @type {CaptureMessage[]} */
export const messages = [
  { id: "turn-a", role: "user", content: "Check the gate in the meadow every Thursday.", occurredAtMs: 1001 },
  { id: "turn-b", role: "user", content: "The storage box is blue.", occurredAtMs: 1002 },
];
export const requested = { key: "save-key", fingerprint: "fixture-fingerprint" };
/** @type {NonNullable<import("@cairn-ink/core/ports").SaveOptions["receipt"]>} */
export const receipt = { client: "fixture", sessionId: "explicit", eventId: "save-event", role: "user", occurredAtMs: 1234 };

const initialText = "A striped umbrella sits in the hall.";
const replacementText = "A violet lantern hangs near the door.";

/** @param {Partial<HostWriteHooks>} [overrides] @returns {HostWriteHooks} */
export function syntheticHooks(overrides = {}) {
  return {
    async beforeSave() { return { status: "proceed" }; },
    async beforeCorrect() { return { status: "proceed" }; },
    async onSave() {},
    async onCorrect() {},
    async onForget() {},
    async onCaptureFinish() {},
    ...overrides,
  };
}

/** @param {HostWriteFixture} f @param {Partial<HostWriteHooks>} [overrides] */
function service(f, overrides) {
  return f.createService({ ...f.deps, hostWriteHooks: syntheticHooks(overrides) });
}

/** @param {HostWriteFixture} f */
async function seed(f) {
  const api = f.createService(f.deps);
  const saved = await api.save(f.scope, initialText, source, "fact", { receipt });
  check(saved.status === "saved", "Expected a newly written predecessor");
  return saved.item;
}

/** @param {unknown} value */
function frozen(value) {
  if (value !== null && typeof value === "object") {
    check(Object.isFrozen(value), "Hook metadata must be frozen");
    for (const nested of Object.values(value)) frozen(nested);
  }
}

/** @param {ReturnType<typeof service>} api @param {Scope} scope */
async function admit(api, scope) {
  equal(await api.enqueueCapture(scope, { ...captureIdentity, messages }), { status: "accepted" }, "Capture admission");
}

/** @type {readonly HostWriteCase[]} */
export const HOST_WRITE_HOOK_CASES = [
  {
    id: "HWH-SAVE-1",
    title: "locked admission, exact active receipt attribution, indexed effects and envelope replay",
    async run(f) {
      const { scope, table } = f;
      /** @type {string[]} */
      const calls = [];
      const api = service(f, {
        async beforeSave(tx, ctx) {
          calls.push("beforeSave");
          frozen(ctx);
          equal(ctx, { scope, source, request: requested }, "Save admission context");
          const envelope = await table.get(tx, ctx.scope, "envelope");
          if (envelope === undefined) return { status: "proceed" };
          const { value, indexRevision } = /** @type {{value: import("@cairn-ink/core/ports").SaveContext, indexRevision: number}} */ (envelope);
          return { status: "replay", result: { status: value.status, memory: value.memory, indexRevision } };
        },
        async onSave(tx, ctx) {
          calls.push("onSave");
          frozen(ctx);
          equal({ scope: ctx.scope, request: ctx.request, source: ctx.source, status: ctx.status },
            { scope, request: requested, source, status: "saved" }, "Save effect context");
          check(ctx.receipts.length === 1, "Expected one attached receipt");
          const { receiptId, ...link } = ctx.receipts[0];
          check(receiptId === null || typeof receiptId === "string", "Expected persisted receipt identity");
          equal(link, { client: receipt.client, sessionId: receipt.sessionId, messageId: receipt.eventId,
            occurredAtMs: receipt.occurredAtMs, role: receipt.role, outcome: "inserted" }, "Exact receipt metadata");
          await table.put(tx, ctx.scope, "effect", ctx.memory, true);
          equal(await table.get(tx, ctx.scope, "effect"), ctx.memory, "Hook reads its uncommitted effect");
          await table.stageSave(tx, ctx.scope, "envelope", ctx);
        },
      });
      const before = await f.snapshot();
      const save = () => api.save(scope, initialText, source, "fact", { receipt, hostRequest: requested });
      const first = await save();
      check(first.status === "saved" && first.indexRevision === before.indexRevision + 2, "Core and host indexed writes must both advance");
      const replay = await save();
      equal(replay, first, "Replay response equality");
      equal(calls, ["beforeSave", "beforeSave", "onSave", "beforeSave"], "Hook ordering and replay skip");
      equal(await table.inspect(scope, "effect"), { id: first.item.id, revision: first.item.revision }, "Host effect committed");
      const current = await f.snapshot();
      equal(current, { ...before, indexRevision: first.indexRevision, memoryCount: 1, receiptCount: 1 }, "Core write committed once");
      await f.createService(f.deps).forget(scope, first.item.id, source);
      equal(await save(), { status: "suppressed", indexRevision: first.indexRevision }, "Stale replay cannot deliver");
    },
  },
  {
    id: "HWH-SAVE-2",
    title: "explicit refusals, invalid decisions, and read-only admission",
    async run(f) {
      const { scope, table } = f;
      const start = await f.snapshot();
      for (const [keyed, final] of [[false, false], [false, true], [true, false], [true, true]]) {
        const request = keyed ? requested : null;
        let calls = 0;
        const save = service(f, {
          async beforeSave(_tx, ctx) {
            equal(ctx, { scope, source, request }, "Admission metadata without body");
            return { status: ++calls === (final ? 2 : 1) ? "refuse" : "proceed" };
          },
          async onSave() { throw new Error("Refusal reached onSave"); },
        }).save;
        equal(await save(scope, initialText, source, "fact", { receipt, ...(request && { hostRequest: request }) }),
          { status: "suppressed", indexRevision: start.indexRevision }, "Hosted refusal must suppress");
        equal(calls, final ? 2 : 1, "Both explicit admission calls");
      }
      for (const fail of ["throw", "decision", "write"]) {
        let calls = 0;
        const save = service(f, {
          async beforeSave(tx, ctx) {
            if (++calls === 1) return { status: "proceed" };
            if (fail === "throw") throw new CoreError("storage_busy");
            if (fail === "write") await table.put(tx, ctx.scope, "illegal", "beforeSave");
            return { status: "conflict" };
          },
        }).save;
        await rejects(() => save(scope, initialText, source, "fact", { receipt }), "host_write_hook_failed");
        equal(calls, 2, "Invalid final admission reached");
      }
      await rejects(() => service(f, {
        async beforeSave() { return { status: "conflict" }; },
      }).save(scope, initialText, source, "fact", { hostRequest: requested }), "event_payload_conflict");
      equal(await f.snapshot(), start, "Refusals and failures wrote no memory, receipt, fact, Raw, or index");
      equal(await table.inspect(scope, "illegal"), undefined, "Admission cannot mutate the host table");
      equal(await table.inspect(scope, "envelope"), undefined, "Refusals wrote no envelope");
    },
  },
  {
    id: "HWH-SAVE-3",
    title: "duplicate receipts retain exact active metadata and save effects roll back",
    async run(f) {
      const { scope, table } = f;
      const seeded = await seed(f);
      const start = await f.snapshot();
      const duplicate = (/** @type {Partial<HostWriteHooks>} */ hooks) =>
        service(f, hooks).save(scope, initialText, source, "fact", { receipt });
      let observed = false;
      const result = await duplicate({
        async onSave(tx, ctx) {
          observed = true;
          equal(ctx.status, "duplicate", "Duplicate invokes onSave");
          equal(ctx.memory, { id: seeded.id, revision: seeded.revision }, "Unchanged duplicate memory revision");
          equal(ctx.receipts.map(({ messageId, outcome }) => [messageId, outcome]),
            [[receipt.eventId, "existing"]], "Duplicate carries the original active receipt");
          await table.put(tx, ctx.scope, "duplicate", ctx.status);
        },
      });
      check(observed && result.status === "duplicate", "Duplicate effect was invoked");
      const beforeFailure = await f.snapshot();
      check(beforeFailure.memoryCount === start.memoryCount, "Duplicate retained one row");
      await rejects(() => service(f, {
        async onSave(tx, ctx) {
          await table.put(tx, ctx.scope, "rolled-back", ctx.memory, true);
          await table.stageSave(tx, ctx.scope, "rolled-back-envelope", ctx.memory);
          throw new Error("synthetic failure after insert");
        },
      }).save(scope, replacementText, source, "fact", { receipt, hostRequest: requested }), "host_write_hook_failed");
      equal(await f.snapshot(), beforeFailure, "Failed save rolls back core and index");
      equal(await table.inspect(scope, "rolled-back"), undefined, "Failed save rolls back host write");
      equal(await table.inspect(scope, "rolled-back-envelope"), undefined, "Failed save rolls back envelope");
    },
  },
  {
    id: "HWH-PRIVACY-1",
    title: "correction admission sees the predecessor before any mutation",
    async run(f) {
      const { scope, table } = f;
      const seeded = await seed(f);
      const start = await f.snapshot();
      const predecessor = { id: seeded.id, revision: seeded.revision, source, createdAtMs: seeded.createdAtMs };
      for (const action of ["refuse", "throw", "mutate", "invalid"]) {
        let called = false;
        const api = service(f, {
          async beforeCorrect(tx, ctx) {
            called = true;
            frozen(ctx);
            equal(ctx, { scope, predecessor }, "Correct admission context");
            if (action === "throw") throw new Error("synthetic throw");
            if (action === "mutate") await table.put(tx, ctx.scope, "illegal", "beforeCorrect");
            return action === "invalid" ? { status: "refuse", unexpected: true } : { status: "refuse" };
          },
          async onCorrect() { throw new Error("Refusal reached onCorrect"); },
        });
        const run = () => api.correct(scope, seeded.id, seeded.revision, replacementText, source);
        if (action === "refuse") equal(await run(), { status: "suppressed", indexRevision: start.indexRevision }, "Correct withheld");
        else await rejects(run, "host_write_hook_failed");
        check(called, "Expected correction admission before the write");
        equal(await f.snapshot(), start, "Original row, receipt, epoch and revision remain");
        const row = await f.deps.storage.uow.run(scope.owner, { readOnly: true },
          tx => f.deps.storage.memories.get(tx, scope, seeded.id));
        equal(row?.text, seeded.text, "Original body remains");
      }
      equal(await table.inspect(scope, "illegal"), undefined, "Correction admission cannot mutate the host table");
    },
  },
  {
    id: "HWH-PRIVACY-2",
    title: "forget and correct expose pre-mutation receipts and commit or roll back together",
    async run(f) {
      const { scope, table } = f;
      const seeded = await seed(f);
      const start = await f.snapshot();
      const predecessor = { id: seeded.id, revision: seeded.revision, source, createdAtMs: seeded.createdAtMs };
      for (const fail of [true, false]) {
        const api = service(f, {
          async onCorrect(tx, ctx) {
            frozen(ctx);
            equal(ctx.predecessor, predecessor, "Guarded correction predecessor");
            equal(ctx.priorReceipts.map(({ messageId }) => messageId), [receipt.eventId], "Prior receipt captured before replacement");
            equal(ctx.receipts?.map(({ messageId, outcome }) => [messageId, outcome]),
              [["correct-event", "inserted"]], "Replacement attachments are active");
            equal(ctx.replacement, { id: seeded.id, revision: seeded.revision + 1, source }, "Replacement binding");
            check(ctx.facts.length === 1 && ctx.facts[0].kind === "text" && ctx.facts[0].epoch > 0n, "Persisted predecessor fact");
            await table.put(tx, ctx.scope, "corrected", ctx.replacement, true);
            if (fail) throw new Error("synthetic throw after replacement");
          },
        });
        const run = () => api.correct(scope, seeded.id, seeded.revision, replacementText, source, {
          receipt: { ...receipt, eventId: "correct-event" },
        });
        if (fail) {
          await rejects(run, "host_write_hook_failed");
          equal(await f.snapshot(), start, "Failed correction rolled back core effects");
          equal(await table.inspect(scope, "corrected"), undefined, "Failed correction rolled back host effects");
        } else {
          const result = await run();
          check(result.status === "saved" && result.indexRevision === (await f.snapshot()).indexRevision, "Correction sampled after the hook");
        }
      }
      const corrected = await f.snapshot();
      for (const fail of [true, false]) {
        const api = service(f, {
          async onForget(tx, ctx) {
            frozen(ctx);
            equal(ctx.scope, scope, "Exact forget scope");
            equal(ctx.predecessor, { ...predecessor, revision: seeded.revision + 1 }, "Forget's guarded row");
            equal(ctx.priorReceipts.map(({ messageId }) => messageId), ["correct-event"], "Receipt snapshot predates erase");
            check(ctx.facts.length === 1 && ctx.facts[0].kind === "text", "Forget fact persisted before the hook");
            await table.put(tx, ctx.scope, "forgotten", ctx.predecessor, true);
            if (fail) throw new Error("synthetic throw after erase");
          },
        });
        equal((await api.forget(scope, seeded.id, source, { expectedRevision: seeded.revision })).status, "conflict", "Guard skips hook");
        const run = () => api.forget(scope, seeded.id, source, { expectedRevision: seeded.revision + 1 });
        if (fail) {
          await rejects(run, "host_write_hook_failed");
          equal(await f.snapshot(), corrected, "Failed forget rolls back fact, row and index");
          equal(await table.inspect(scope, "forgotten"), undefined, "Failed forget rolls back host write");
        } else {
          const result = await run();
          equal(result.status, "forgotten", "Forget committed");
          equal((await f.snapshot()).memoryCount, 0, "Forgotten row erased");
          equal((await f.snapshot()).receiptCount, 0, "Active receipts gone");
          check(await table.inspect(scope, "forgotten"), "Forget host effect committed");
          equal((await run()).status, "not_found", "Missing predecessor skips hook");
        }
      }
    },
  },
  {
    id: "HWH-CAPTURE-1",
    title: "capture finish exposes ordered attributable writes and positively verified Raw, then replays one result",
    async run(f) {
      const { scope, table } = f;
      let calls = 0;
      const api = service(f, {
        async onCaptureFinish(tx, ctx) {
          calls++;
          frozen(ctx);
          equal({ scope: ctx.scope, client: ctx.client, sessionId: ctx.sessionId, eventId: ctx.eventId },
            { scope, ...captureIdentity }, "Capture completion identity");
          equal(ctx.sources, messages.map(({ id, role, occurredAtMs }, position) => ({ position, messageId: id, role,
            occurredAtMs, client: captureIdentity.client, sessionId: captureIdentity.sessionId })), "Post-archive verified sources");
          check(ctx.writes.length >= 1, "Expected successful capture item");
          const [first] = ctx.writes;
          equal({ itemPosition: first.itemPosition, outcome: first.outcome, receipts: first.receipts.map(link => link.messageId) },
            { itemPosition: 0, outcome: "inserted", receipts: [messages[0].id] }, "Capture receipt attribution");
          await table.put(tx, ctx.scope, "capture", first.memory, true);
        },
      });
      await admit(api, scope);
      equal(calls, 0, "Admission does not invoke the finish hook");
      const result = await api.runCapture(scope, captureIdentity);
      check(result.status === "done" && result.result?.indexRevision === (await f.snapshot()).indexRevision, "Sample after hosted effects");
      equal(await api.runCapture(scope, captureIdentity), result, "Stored finish result is the returned result");
      equal(calls, 1, "Replay skips the finish hook");
      check(await table.inspect(scope, "capture"), "Hosted capture effect committed");
    },
  },
  {
    id: "HWH-CAPTURE-2",
    title: "capture rollback reverts complete ledger, Raw, memories, receipts, index and host write",
    async run(f) {
      const { scope, table } = f;
      const api = service(f, {
        async onCaptureFinish(tx, ctx) {
          await table.put(tx, ctx.scope, "capture", ctx.writes.length, true);
          throw new Error("synthetic rollback after finish");
        },
      });
      await admit(api, scope);
      const before = await f.snapshot();
      equal(await api.runCapture(scope, captureIdentity),
        { status: "failed", code: "host_write_hook_failed" }, "Capture maps hook failure");
      equal(await f.snapshot(), before, "All core capture effects rolled back");
      equal(await table.inspect(scope, "capture"), undefined, "Host capture effect rolled back");
      equal(await api.captureStatus(scope, captureIdentity.eventId, { client: captureIdentity.client }),
        { status: "failed", code: "host_write_hook_failed" }, "Original claim records the hook failure");
    },
  },
  {
    id: "HWH-CAPTURE-3",
    title: "finish positions survive suppression and duplicate bindings use the final revision",
    async run(f) {
      const { scope, deps } = f;
      const rejected = "A bronze badge belongs in the cabinet.";
      const blocked = /** @satisfies {import("@cairn-ink/core").TextFact} */ ({
        ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "finish-time-suppression",
        text: { digests: [await coreDigest(rejected)] },
      });
      const incarnation = await deps.clock.sha256Hex(factIncarnationBody(blocked));
      const { capture, suppressions } = deps.storage;
      const passing = { content: capturedText, kind: "fact", confidence: 0.8, sourceIndices: [0] };
      const replacement = { ...f, deps: { ...deps, storage: { ...deps.storage, capture: {
        ...capture,
        /** @type {typeof capture.finish} */
        async finish(tx, token, items) {
          // The synthetic adapter inserts the fence at its final policy boundary.
          await suppressions.writeFact(tx, blocked, incarnation);
          return capture.finish(tx, token, items);
        },
      } }, model: deps.model && { ...deps.model, async call() {
        return { items: [passing, { ...passing, content: rejected }, { ...passing, confidence: 0.99, sourceIndices: [1] }] };
      } } } };
      let called = false;
      const api = service(replacement, {
        async onCaptureFinish(_tx, { sources, writes }) {
          called = true;
          equal(sources.map(({ position }) => position), [1], "Suppression removes the shared citation from routing");
          equal(writes.map(({ itemPosition }) => itemPosition), [0, 2], "Exact un-compacted item positions");
          equal(writes[0].memory, writes[1].memory, "In-batch duplicate binds final stored revision and ID");
          equal(writes.map(({ receipts }) => receipts.map(({ messageId }) => messageId)),
            [[messages[0].id], [messages[1].id]], "Attributable receipts in input order");
        },
      });
      await admit(api, scope);
      const done = await api.runCapture(scope, captureIdentity);
      check(called && done.status === "done", "Expected committed finish");
      equal(done.result?.suppressedItems, [1], "Public suppression mapping");
      equal((await f.snapshot()).memoryCount, 1, "Duplicate resolved to stored ID");
    },
  },
  {
    id: "HWH-CAPTURE-4",
    title: "an archive attempt supplies no evidence of a visible Raw source",
    async run(f) {
      const { deps, scope } = f;
      const raw = deps.storage.raw;
      check(raw, "Expected Raw support");
      const api = service({ ...f, deps: { ...deps, storage: { ...deps.storage, raw: { ...raw,
        async archive() { return { archived: messages.length }; },
      } } } }, {
        async onCaptureFinish(tx, ctx) {
          equal(ctx.sources, [], "An archive count does not prove Raw visibility");
          equal(ctx.writes.length, 1, "Successful memory still has an attributable receipt");
          await f.table.put(tx, ctx.scope, "no-raw", ctx.writes[0].memory);
        },
      });
      const before = await f.snapshot();
      await admit(api, scope);
      const result = await api.runCapture(scope, captureIdentity);
      equal(result.status, "done", "Fresh result commits");
      check(await f.table.inspect(scope, "no-raw"), "Hook ran with the exact visible source set");
      equal((await f.snapshot()).rawCount, before.rawCount, "Fixture archived no Raw");
    },
  },
  {
    id: "HWH-PRIVACY-3",
    title: "retained receipt correction skips same-text and conflict and preserves guarded evidence",
    async run(f) {
      const { scope } = f;
      const seeded = await seed(f);
      const start = await f.snapshot();
      let calls = 0;
      const api = service(f, {
        async beforeCorrect() {
          calls++;
          return { status: "proceed" };
        },
        async onCorrect(tx, ctx) {
          calls++;
          equal(ctx.priorReceipts.map(({ messageId }) => messageId), [receipt.eventId], "Predecessor evidence");
          equal(ctx.receipts, null, "Null indicates retained receipts");
          await f.table.put(tx, ctx.scope, "retained", ctx.replacement.revision);
        },
      });
      equal((await api.correct(scope, seeded.id, seeded.revision + 1, replacementText, source)).status, "conflict",
        "A stale revision skips both correction hooks");
      equal((await api.correct(scope, seeded.id, seeded.revision, initialText, source)).status, "unchanged",
        "Same text skips both correction hooks");
      equal(calls, 0, "No hooks for early correction exits");
      equal(await f.snapshot(), start, "Early exits have no effects");
      const result = await api.correct(scope, seeded.id, seeded.revision, replacementText, source);
      check(result.status === "saved", "Correction succeeded");
      equal(calls, 2, "Admission then effect after a real correction");
      equal(await f.table.inspect(scope, "retained"), result.item.revision, "Correction effect committed");
      equal((await f.snapshot()).receiptCount, start.receiptCount, "Correction retained receipts");
    },
  },
  {
    id: "HWH-EXECUTOR-1",
    title: "live scope, async re-entry refusal, revoked handles and pending operation rollback",
    async run(f) {
      const { scope, table, deps } = f;
      const before = await f.snapshot();
      /** @type {Tx | undefined} */
      let issued;
      const plain = f.createService(deps);
      let resume = () => {};
      const deferred = new Promise(resolve => { resume = () => resolve(undefined); });
      /** @type {Promise<void> | undefined} */
      let continuation;
      const api = service(f, {
        async onSave(tx, ctx) {
          issued = tx;
          check(!tx.readOnly && tx.owner === scope.owner, "Hook uses a live write transaction");
          await rejects(() => table.get(tx, { ...scope, namespace: "foreign" }, "x"), "host_write_hook_failed");
          await rejects(() => plain.pauseState(scope.owner), "storage_transaction_active");
          await rejects(() => deps.storage.uow.run("other-owner", {}, async () => {}), "storage_transaction_active");
          continuation = deferred.then(() => rejects(() => plain.pauseState(scope.owner), "storage_transaction_active"));
          // The next two operations are queued before returning. The hook must await them.
          void table.put(tx, ctx.scope, "pending", true);
          void table.get(tx, ctx.scope, "pending");
        },
      });
      await rejects(() => api.save(scope, initialText, source), "host_write_hook_failed");
      resume();
      await continuation;
      check(issued, "Hook received transaction");
      const expired = issued;
      await rejects(() => table.get(expired, scope, "pending"), "host_write_hook_failed");
      equal(await table.inspect(scope, "pending"), undefined, "Queued host write rolled back");
      equal(await f.snapshot(), before, "Pending operation rolled back core state");
    },
  },
  {
    id: "HWH-EXECUTOR-2",
    title: "callback authorization fields are immutable and run bookkeeping is private",
    async run(f) {
      const { scope, table, deps } = f;
      const port = deps.storage.hostWriteHookPort;
      check(port, "Expected a host write hook port");
      const before = await f.snapshot();
      for (const field of /** @type {const} */ (["scope", "phase", "tx", "keyedSave"])) {
        /** @type {{run?: object}} */
        const observed = {};
        const api = service(f, {
          async onSave(tx, ctx) {
            const run = port.context.getStore();
            check(run, "Expected a live callback context");
            observed.run = run;
            await table.put(tx, ctx.scope, "effect", true);
            Object.assign(run, { [field]: run[field] });
          },
        });
        await rejects(() => api.save(scope, initialText, source), "host_write_hook_failed");
        check(observed.run && Object.isFrozen(observed.run), "The authorization record is frozen");
        check(!("active" in observed.run) && !("pending" in observed.run), "Run bookkeeping is private");
        check("scope" in observed.run && Object.isFrozen(observed.run.scope), "The authorized scope is frozen");
        equal(await table.inspect(scope, "effect"), undefined, "Host write rolled back");
        equal(await f.snapshot(), before, "Core write rolled back");
      }
    },
  },
];
