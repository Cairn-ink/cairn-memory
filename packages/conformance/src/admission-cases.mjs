import { check, equal, readDump, rejects, row } from "./support.mjs";

/** @import { CaptureKey, CaptureMessage, Tx } from "@cairn-ink/core/ports" */
/** @typedef {import("./index.d.mts").CaseContext} Context */

/** @type {readonly CaptureMessage[]} */
const messages = [
  { id: "first", role: "user", content: "The orchard opens in spring.", occurredAtMs: 20 },
  { id: "second", role: "assistant", content: "I will mark the calendar.", occurredAtMs: null },
];

/** @param {Context} ctx @returns {CaptureKey} */
function event(ctx) {
  return { scope: ctx.scope(null), client: "first-client", sessionId: "session", eventId: "event",
    payloadDigest: "a".repeat(64) };
}

/** @param {CaptureKey} key */
function selection({ scope, client, sessionId, eventId }) {
  return { scope: { ...scope }, client, sessionId, eventId };
}

/** @param {Context} ctx @param {CaptureKey} key @param {readonly CaptureMessage[]} [batch] */
function admit({ adapter: { uow, capture } }, key, batch = messages) {
  const enqueue = capture.admit?.bind(capture);
  check(enqueue, "Expected capture.admit");
  return uow.run(key.scope.owner, { pauseLock: true }, tx =>
    enqueue(tx, structuredClone(key), batch.map(message => ({ ...message }))));
}

/** @param {Context} ctx @param {CaptureKey} key */
function load({ adapter: { uow, capture } }, key) {
  const read = capture.load?.bind(capture);
  check(read, "Expected capture.load");
  return uow.run(key.scope.owner, { readOnly: true }, tx => read(tx, selection(key)));
}

/** @param {Context} ctx @param {CaptureKey} key */
function claimEvent({ adapter: { uow, capture } }, key) {
  return uow.run(key.scope.owner, { pauseLock: true }, tx =>
    capture.claim(tx, structuredClone(key), messages.map(message => ({ ...message })), { leaseMs: 60_000 }));
}

/** @param {Context} ctx @param {CaptureKey} key */
async function claim(ctx, key) {
  const claimed = await claimEvent(ctx, key);
  check(claimed.status === "claimed", "A new capture must be claimable");
  return claimed.token;
}

/** @param {Context} ctx @param {string} token */
async function finishMemory(ctx, token) {
  const { adapter: { capture, uow }, owner } = ctx;
  const memory = await row(ctx, "The orchard opens in spring.");
  const item = { content: memory.text, kind: memory.kind, confidence: memory.confidence, textHash: memory.textHash,
    embedding: memory.embedding && { model: memory.embedding.model, vector: new Float32Array(memory.embedding.vector) },
    receipts: [] };
  const dispatch = await uow.run(owner, { pauseLock: true }, tx => capture.beginDispatch(tx, token));
  const result = await uow.run(owner, { pauseLock: true }, tx => capture.finish(tx, dispatch.token, [item]));
  check(result.memories.length === 1, "The fixture must finish with a stored memory");
  return { token: dispatch.token, result: structuredClone(result) };
}

/** @type {readonly import("./index.d.mts").ConformanceCase[]} */
export const ADMISSION_CASES = [
  {
    id: "K-ADM-1", title: "loads the first admission in its original scope and session", needs: [],
    async run(ctx) {
      const { adapter: { capture } } = ctx;
      if (!capture?.admit) return "needs capture.admit";
      if (!capture.load) return "needs capture.load";
      const key = event(ctx);
      equal(await load(ctx, key), null, "Missing admission must load as null");
      equal(await admit(ctx, key), { status: "admitted" }, "First admission must be accepted");
      equal(await load(ctx, key), { key, messages }, "Load must return the admitted key and ordered messages");
      const withheld = messages.map(message => ({ ...message, content: "" }));
      equal(await admit(ctx, key, withheld), { status: "duplicate" }, "Redelivery must preserve the first admission");
      equal(await load(ctx, key), { key, messages }, "Redelivery must preserve the first admitted messages");
      equal(await load(ctx, { ...key, sessionId: "other" }), null, "Load must respect the selected session");
      equal(await load(ctx, { ...key, scope: ctx.scope("other") }), null, "Load must respect the selected namespace");
    },
  },
  {
    id: "K-ADM-2", title: "replays a pending, leased, or finished admission", needs: [],
    async run(ctx) {
      const { adapter: { capture } } = ctx;
      if (!capture?.admit) return "needs capture.admit";
      const key = event(ctx);
      equal(await admit(ctx, key), { status: "admitted" }, "First admission must be accepted");
      equal(await admit(ctx, key), { status: "duplicate" }, "The first admission must not take a lease");
      const token = await claim(ctx, key);
      equal(await admit(ctx, key), { status: "processing" }, "Redelivery during a live lease must report processing");
      equal(await claimEvent(ctx, key), { status: "processing" }, "A live admission must not issue another lease");
      const { result } = await finishMemory(ctx, token);
      equal(await admit(ctx, key), { status: "rawReplay", result }, "Redelivery must return the stored finish result");
      equal(await claimEvent(ctx, key), { status: "rawReplay", result }, "A finished admission must replay on claim");
    },
  },
  {
    id: "K-ADM-3", title: "rejects a changed payload digest for an admitted event", needs: [],
    async run(ctx) {
      if (!ctx.adapter.capture?.admit) return "needs capture.admit";
      const key = event(ctx);
      await admit(ctx, key);
      const changed = [{ ...messages[0], content: "The orchard opens in summer." }, messages[1]];
      await rejects(() => admit(ctx, { ...key, payloadDigest: "b".repeat(64) }, changed), "event_payload_conflict");
      equal(await admit(ctx, key), { status: "duplicate" }, "Conflict must preserve the original admission");
    },
  },
  {
    id: "K-ADM-4", title: "deduplicates across namespaces but scopes identity to owner and client", needs: [],
    async run(ctx) {
      if (!ctx.adapter.capture?.admit) return "needs capture.admit";
      const key = event(ctx);
      const cross = { ...key, scope: ctx.scope("other") };
      equal(await admit(ctx, key), { status: "admitted" }, "First admission must be accepted");
      equal(await admit(ctx, cross), { status: "duplicate" }, "The namespace must not partition admission identity");
      await rejects(() => admit(ctx, { ...cross, payloadDigest: "b".repeat(64) }), "event_payload_conflict");
      equal(await admit(ctx, { ...cross, client: "other-client" }), { status: "admitted" },
        "Another client must have an independent event");
      equal(await admit(ctx, { ...key, scope: { ...key.scope, owner: ctx.otherOwner } }), { status: "admitted" },
        "Another owner must have an independent event");
    },
  },
  {
    id: "K-ADM-5", title: "requires a pause-locked write run for admission", needs: [],
    async run(ctx) {
      const { adapter: { uow, capture }, owner } = ctx;
      const enqueue = capture?.admit?.bind(capture);
      if (!enqueue) return "needs capture.admit";
      const key = event(ctx);
      const run = (/** @type {Tx} */ tx) => enqueue(tx, structuredClone(key), messages.map(message => ({ ...message })));
      await rejects(() => uow.run(owner, {}, run), "internal_error");
      await rejects(() => uow.run(owner, { readOnly: true, pauseLock: true }, run), "internal_error");
      equal(await admit(ctx, key), { status: "admitted" }, "Refused calls must not reserve admission identity");
    },
  },
  {
    id: "K-ADM-6", title: "reports per-client states and aggregates pending before failed before done", needs: [],
    async run(ctx) {
      const { adapter: { uow, capture }, owner } = ctx;
      if (!capture?.admit) return "needs capture.admit";
      const read = capture.status?.bind(capture);
      if (!read) return "needs capture.status";
      const done = event(ctx);
      const failed = { ...done, client: "failed-client" };
      const pending = { ...done, client: "pending-client" };
      /** @param {string} [client] */
      const status = (client, scope = done.scope, eventId = done.eventId) =>
        uow.run(owner, { readOnly: true }, tx => read(tx, { ...scope }, eventId, client));
      const finish = (/** @type {string} */ token) =>
        uow.run(owner, { pauseLock: true }, tx => capture.finish(tx, token, []));
      equal(await status(), { status: "unknown" }, "Unknown event");
      equal(await status(done.client), { status: "unknown" }, "Unknown event for a client");
      await admit(ctx, done);
      equal(await status(), { status: "pending" }, "Unleased admission is pending");
      const token = await claim(ctx, done);
      equal(await status(done.client), { status: "pending" }, "Leased admission is pending");
      await finish(token);
      equal(await status(), { status: "done" }, "Finished event");
      await admit(ctx, failed);
      const failedToken = await claim(ctx, failed);
      const failure = { code: "invalid_input", retryable: false, message: "Private error detail." };
      const codeOnly = { status: "failed", code: "invalid_input" };
      await uow.run(owner, { pauseLock: true }, tx => capture.abandon(tx, failedToken, failure));
      equal(await status(), codeOnly, "Failed must take precedence over done and expose only the code");
      equal(await status(failed.client), codeOnly, "A terminal failure must expose only its code");
      equal(await admit(ctx, failed), { status: "duplicate" }, "Terminal failure must preserve admission identity");
      equal(await status(done.client), { status: "done" }, "Another client's failure must not replace done");
      equal(await status(pending.client), { status: "unknown" }, "An absent client must be unknown");
      await admit(ctx, pending);
      const pendingToken = await claim(ctx, pending);
      await uow.run(owner, { pauseLock: true }, tx =>
        capture.abandon(tx, pendingToken, { code: "storage_error", retryable: true }));
      equal(await status(), { status: "pending" }, "Pending must take precedence over failed");
      equal(await status(pending.client), { status: "pending" }, "Retryable abandon must return to pending");
      equal(await status(failed.client), codeOnly, "Pending for another client must not replace failure");
      equal(await status(undefined, ctx.scope("other")), { status: "unknown" }, "Status must respect the selected namespace");
      equal(await status(undefined, done.scope, "other"), { status: "unknown" }, "Status must respect the selected event");
    },
  },
  {
    id: "K-ADM-7", title: "reads status without changing the dump or state token", needs: [],
    async run(ctx) {
      const { adapter: { uow, capture, snapshot }, owner, harness } = ctx;
      if (!capture?.admit) return "needs capture.admit";
      const read = capture.status?.bind(capture);
      if (!read) return "needs capture.status";
      const key = event(ctx);
      await admit(ctx, key);
      const observeToken = () => uow.run(owner, { readOnly: true },
        tx => snapshot.stateToken(tx, { owner, namespaces: [key.scope.namespace] }));
      const beforeDump = structuredClone(await readDump(harness));
      const beforeToken = await observeToken();
      await uow.run(owner, { readOnly: true }, async tx => {
        await read(tx, { ...key.scope }, key.eventId, key.client);
        await read(tx, { ...key.scope }, key.eventId);
        await read(tx, { ...key.scope }, "missing");
      });
      equal(await readDump(harness), beforeDump, "Status must leave the dump unchanged");
      equal(await observeToken(), beforeToken, "Status must leave the state token unchanged");
    },
  },
  {
    id: "K-ADM-8", title: "admits and finishes a fully withheld batch", needs: [],
    async run(ctx) {
      const { adapter: { uow, capture }, owner } = ctx;
      if (!capture?.admit) return "needs capture.admit";
      const read = capture.load?.bind(capture);
      if (!read) return "needs capture.load";
      const key = event(ctx);
      const withheld = messages.map(message => ({ ...message, content: "" }));
      equal(await admit(ctx, key, withheld), { status: "admitted" }, "An all-withheld batch must be admitted");
      const token = await uow.run(owner, { pauseLock: true }, async tx => {
        const admitted = await read(tx, selection(key));
        equal(admitted, { key, messages: withheld }, "Withheld positions must be preserved");
        check(admitted, "The all-withheld admission must load");
        const { key: admittedKey, messages: admittedMessages } = structuredClone(admitted);
        const claimed = await capture.claim(tx, admittedKey, admittedMessages, { leaseMs: 60_000 });
        check(claimed.status === "claimed", "The all-withheld admission must be claimable");
        return claimed.token;
      });
      const result = structuredClone(await uow.run(owner, { pauseLock: true }, tx => capture.finish(tx, token, [])));
      equal(result.memories, [], "An all-withheld finish must write no memories");
      equal(await admit(ctx, key, withheld), { status: "rawReplay", result }, "The empty finish must be replayable");
    },
  },
  {
    id: "K-ADM-9", title: "detaches the loaded key and each message from stored admission data", needs: [],
    async run(ctx) {
      const { adapter: { uow, capture }, owner } = ctx;
      if (!capture?.admit) return "needs capture.admit";
      const read = capture.load?.bind(capture);
      if (!read) return "needs capture.load";
      const key = event(ctx);
      await admit(ctx, key);
      await uow.run(owner, { readOnly: true }, async tx => {
        const loaded = await read(tx, selection(key));
        check(loaded, "Expected a stored admission");
        Reflect.set(loaded.key.scope, "namespace", "changed");
        Reflect.set(loaded.key, "sessionId", "changed");
        Reflect.set(loaded.messages[0], "content", "changed");
        Reflect.set(loaded.messages, "length", 1);
        const reread = await read(tx, selection(key));
        equal(reread, { key, messages }, "Load output must not mutate the admission");
        check(reread && reread.key !== loaded.key && reread.key.scope !== loaded.key.scope &&
          reread.messages !== loaded.messages && reread.messages.every((message, offset) => message !== loaded.messages[offset]),
        "Each load must return fresh copies");
      });
      equal(await load(ctx, key), { key, messages }, "The committed admission must preserve the stored values");
    },
  },
  {
    id: "K-ADM-10", title: "keeps one lease and one finish when a standalone claim precedes admission", needs: [],
    async run(ctx) {
      const { adapter: { capture, memories, uow }, owner } = ctx;
      if (!capture?.admit) return "needs capture.admit";
      const key = event(ctx);
      const token = await claim(ctx, key);
      const other = { ...key, scope: ctx.scope("other") };
      equal(await claimEvent(ctx, other), { status: "processing" },
        "A standalone claim must report processing in another namespace");
      const admission = await admit(ctx, key);
      equal(await claimEvent(ctx, key), { status: "processing" }, "Admission must not allow a second lease");
      equal(admission, { status: "processing" }, "Admission must see the existing standalone lease");

      const finished = await finishMemory(ctx, token);
      equal(await claimEvent(ctx, key), { status: "rawReplay", result: finished.result },
        "Claim must replay the standalone finish");
      await rejects(() => uow.run(owner, { pauseLock: true }, tx => capture.finish(tx, finished.token, [])), "stale_admission");
      const { items } = await uow.run(owner, { readOnly: true }, tx =>
        memories.exportPage(tx, ctx.scope(null), { cursor: null, limit: 10 }));
      equal(items.map(({ id }) => id), [finished.result.memories[0].id], "Only one memory must be stored");
    },
  },
  {
    id: "K-ADM-11", title: "replays a standalone finish on admission", needs: [],
    async run(ctx) {
      if (!ctx.adapter.capture?.admit) return "needs capture.admit";
      const key = event(ctx);
      const { result } = await finishMemory(ctx, await claim(ctx, key));
      equal(await admit(ctx, key), { status: "rawReplay", result }, "Admission must replay a standalone finish");
      await rejects(() => admit(ctx, { ...key, payloadDigest: "b".repeat(64) }), "event_payload_conflict");
    },
  },
  {
    id: "K-ADM-12", title: "deduplicates a terminally abandoned standalone claim", needs: [],
    async run(ctx) {
      const { adapter: { capture, uow }, owner } = ctx;
      if (!capture?.admit) return "needs capture.admit";
      const key = event(ctx);
      const token = await claim(ctx, key);
      await uow.run(owner, { pauseLock: true }, tx =>
        capture.abandon(tx, token, { code: "invalid_input", retryable: false }));
      equal(await admit(ctx, key), { status: "duplicate" }, "Admission must honor a terminal standalone abandon");
      equal(await claimEvent(ctx, { ...key, scope: ctx.scope("other") }), { status: "duplicate" },
        "A terminal standalone abandon must deduplicate claims across namespaces");
      await rejects(() => admit(ctx, { ...key, payloadDigest: "b".repeat(64) }), "event_payload_conflict");
    },
  },
  {
    id: "K-ADM-13", title: "rejects a different digest for a standalone claim", needs: [],
    async run(ctx) {
      if (!ctx.adapter.capture?.admit) return "needs capture.admit";
      const key = event(ctx);
      await claim(ctx, key);
      await rejects(() => admit(ctx, { ...key, payloadDigest: "b".repeat(64) }), "event_payload_conflict");
    },
  },
  {
    id: "K-ADM-14", title: "shares one lease and finish across namespaces", needs: [],
    async run(ctx) {
      const { adapter: { capture, memories, uow }, owner } = ctx;
      if (!capture?.admit) return "needs capture.admit";
      const key = event(ctx);
      const other = { ...key, scope: ctx.scope("other") };
      const token = await claim(ctx, key);
      const admission = await admit(ctx, other);
      equal(await claimEvent(ctx, other), { status: "processing" },
        "Cross-namespace admission must not allow a second lease");
      equal(admission, { status: "processing" }, "Cross-namespace admission must see the existing lease");

      const { result } = await finishMemory(ctx, token);
      equal(await admit(ctx, other), { status: "rawReplay", result }, "Cross-namespace admission must replay the finish");
      equal(await claimEvent(ctx, other), { status: "rawReplay", result }, "Cross-namespace claim must replay the finish");
      for (const input of [key, other, { ...key, scope: ctx.scope("third") }]) {
        const conflict = { ...input, payloadDigest: "b".repeat(64) };
        await rejects(() => claimEvent(ctx, conflict), "event_payload_conflict");
        await rejects(() => admit(ctx, conflict), "event_payload_conflict");
      }
      const otherSession = { ...other, sessionId: "other-session" };
      await rejects(() => claimEvent(ctx, otherSession), "event_payload_conflict");
      await rejects(() => admit(ctx, otherSession), "event_payload_conflict");

      const ids = await uow.run(owner, { readOnly: true }, async tx => {
        const original = await memories.exportPage(tx, ctx.scope(null), { cursor: null, limit: 10 });
        const alternate = await memories.exportPage(tx, ctx.scope("other"), { cursor: null, limit: 10 });
        return [...original.items, ...alternate.items].map(({ id }) => id);
      });
      equal(ids, [result.memories[0].id], "Cross-namespace redelivery must store exactly one memory");
    },
  },
];
