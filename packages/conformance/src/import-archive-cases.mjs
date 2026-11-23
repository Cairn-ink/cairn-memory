import { coreDigest, legacyExactMac, passageShingles } from "@cairn-ink/core";
import { coreFingerprintLabels } from "../../core/src/privacy/fingerprint.mjs";
import { caught, check, equal, readDump, rejects } from "./support.mjs";

/** @import { CaptureKey, CaptureMessage, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

const missingImport = "needs raw.importArchive";
const client = "test-client";
const sessionId = "test-session";

/** @param {string} id @param {string} content @param {number | null} [occurredAtMs] @returns {CaptureMessage} */
function message(id, content, occurredAtMs = 10) {
  return { id, role: "user", content, occurredAtMs };
}

/** @param {CaseContext} ctx */
function fixture(ctx) {
  const { raw, uow } = ctx.adapter;
  check(raw, "rawArchive requires the raw port");
  const scope = ctx.scope(null);
  const session = { client, sessionId };
  const { owner } = scope;
  /** @type {CaptureKey} */
  const key = { ...session, scope, eventId: "test-event", payloadDigest: "a".repeat(64) };
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const write = (fn) => uow.run(owner, { pauseLock: true }, fn);
  const importArchive = raw.importArchive?.bind(raw);
  return {
    raw, uow, scope, session, key, write, importArchive,
    put: importArchive && ((/** @type {CaptureMessage[]} */ messages, source = session) =>
      write((tx) => importArchive(tx, scope, source, messages))),
    page: () => uow.run(owner, { readOnly: true },
      (tx) => raw.listRaw(tx, { owner, namespaces: [scope.namespace] }, { limit: 20, cursor: null })),
  };
}

/** @param {CaseContext} ctx @param {string} actionId */
function factBase({ owner }, actionId) {
  return { owner, actionId, origin: /** @type {const} */ ("forget") };
}

/** @param {CaseContext} ctx @param {{client: string, sessionId: string}} session */
function sessionRef(ctx, session) {
  if (ctx.sessionRefs === "plain") return session;
  const hash = ctx.harness.hashSessionKey?.(session.client, session.sessionId);
  check(typeof hash === "string" && /^[a-f0-9]{64}$/u.test(hash), "Hashed sessions require harness.hashSessionKey");
  return { client: session.client, sessionKeyHash: hash };
}

/** @type {readonly ConformanceCase[]} */
export const IMPORT_ARCHIVE_CASES = [
  {
    id: "K-IMP-RAW-1", title: "counts mixed import outcomes and keeps the first row on replay", needs: ["rawArchive"],
    async run(ctx) {
      const { put, page, raw, write, scope, session } = fixture(ctx);
      if (!put) return missingImport;
      const first = message("first", "cedar garden");
      const next = message("second", "maple grove");
      const withheld = message("withheld", "suppressed orchard marker");
      equal(await put([first]), { archived: 1, existing: 0, withheld: 0 }, "Fixture must import one message");
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "text"), kind: "text", mode: "exact",
        text: { digests: [await coreDigest(withheld.content)] },
      });
      const batch = [{ ...first, content: "edited garden" }, withheld, next, next];
      equal(await put(batch), { archived: 1, existing: 2, withheld: 1 }, "Import must count each outcome");
      const committed = await readDump(ctx.harness);
      check(!JSON.stringify(committed).includes(withheld.content), "Import must never store withheld content");
      equal(await put(batch), { archived: 0, existing: 3, withheld: 1 }, "Re-import must count eligible IDs as existing");
      equal(await readDump(ctx.harness), committed, "Re-import must leave the committed state unchanged");
      equal((await page()).items.map(({ messageId, content }) => [messageId, content]).sort(),
        [[first.id, first.content], [next.id, next.content]], "Import must keep the first row on ID conflict");
      equal(await write((tx) => raw.deleteConversation(tx, scope, session)), { rawDeleted: 2 },
        "Only the two eligible rows may be physically stored");
    },
  },
  {
    id: "K-IMP-RAW-2", title: "refuses a session fact before storing messages", needs: ["rawArchive"],
    async run(ctx) {
      const { put, session } = fixture(ctx);
      if (!put) return missingImport;
      const item = message("first", "cedar garden");
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "session"), kind: "session", session: sessionRef(ctx, session),
      });
      const before = await readDump(ctx.harness);
      equal(await put([item]), { archived: 0, existing: 0, withheld: 1 }, "Session fact must refuse import");
      equal(await readDump(ctx.harness), before, "Session refusal must leave the committed state unchanged");
      equal(await put([item], { ...session, sessionId: "other-session" }),
        { archived: 1, existing: 0, withheld: 0 }, "The session fact must leave another session eligible");
    },
  },
  {
    id: "K-IMP-RAW-3", title: "applies owner and client windows to imports", needs: ["rawArchive", "rawWindowHide"],
    async run(ctx) {
      const { put, session, page } = fixture(ctx);
      if (!put) return missingImport;
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "owner-window"), kind: "window", client: null, window: { startMs: 10, endMs: 20 },
      });
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "client-window"), kind: "window", client, window: { startMs: 30, endMs: 40 },
        unknownTime: true,
      });
      const ownerStart = message("owner-start", "owner window start", 10);
      const ownerEnd = message("owner-end", "owner window end", 20);
      const clientStart = message("client-start", "client window start", 30);
      const clientEnd = message("client-end", "client window end", 40);
      const unknown = message("unknown", "missing event time", null);
      const batch = [ownerStart, ownerEnd, clientStart, clientEnd, unknown];
      equal(await put(batch), { archived: 2, existing: 0, withheld: 3 }, "Import must apply both half-open windows");
      const committed = JSON.stringify(await readDump(ctx.harness));
      for (const { id, content } of [ownerStart, clientStart, unknown]) {
        check(!committed.includes(JSON.stringify(id)) && !committed.includes(content),
          `Import must never store window refusal ${id}`);
      }
      equal(await put(batch, { ...session, client: "other-client" }),
        { archived: 4, existing: 0, withheld: 1 }, "Client window must apply only to its own client");
      const { items } = await page();
      equal(items.filter((item) => item.client === client).map(({ messageId }) => messageId).sort(),
        [clientEnd.id, ownerEnd.id], "Only the messages outside both windows may be stored for this client");
      const otherCommitted = JSON.stringify(await readDump(ctx.harness));
      check(!otherCommitted.includes(JSON.stringify(ownerStart.id)) && !otherCommitted.includes(ownerStart.content),
        "Import must never store owner-window refusals");
    },
  },
  {
    id: "K-IMP-RAW-3s", title: "refuses imports covered by raw spans", needs: ["rawArchive", "rawSpans"],
    async run(ctx) {
      const { put, session } = fixture(ctx);
      if (!put) return missingImport;
      const hashSessionKey = ctx.harness.hashSessionKey;
      if (ctx.sessionRefs === "plain" && !hashSessionKey) return "needs harness.hashSessionKey for raw spans";
      const sessionKeyHash = hashSessionKey?.(session.client, session.sessionId);
      check(typeof sessionKeyHash === "string" && /^[a-f0-9]{64}$/u.test(sessionKeyHash),
        "Raw spans require harness.hashSessionKey");
      const item = message("removed", "cedar garden");
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "span"), kind: "rawSpan", sessionKeyHash, messageKey: item.id, startUtf16: 6, endUtf16: 12,
        contentDigest: (await ctx.hash(item.content)).slice(7),
      });
      const before = await readDump(ctx.harness);
      equal(await put([{ ...item, content: "cedar" }]), { archived: 0, existing: 0, withheld: 1 },
        "Raw span identity must refuse even a shorter replay");
      equal(await readDump(ctx.harness), before, "Raw span refusal must leave the committed state unchanged");
      equal(await put([{ ...item, id: "other" }]), { archived: 1, existing: 0, withheld: 0 },
        "Raw span must leave a different message eligible");
    },
  },
  {
    id: "K-IMP-RAW-4", title: "fails closed when text evidence cannot be compared", needs: ["rawArchive"],
    async run(ctx) {
      const { put } = fixture(ctx);
      if (!put) return missingImport;
      const item = message("first", "cedar garden");
      const key = ctx.adapter.capabilities.fingerprintKey ? await ctx.adapter.keys.userKey(ctx.owner) : null;
      check(key || !ctx.adapter.capabilities.fingerprintKey, "fingerprintKey requires an owner key");
      const unrelated = await coreDigest("maple grove", key);
      // With a key, an exact miss still requires containment evidence in full mode.
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "incomparable"), kind: "text", mode: key ? "full" : "exact",
        text: key ? { digests: [unrelated], keyId: key.id } : {
          digests: [{ ...unrelated, alg: "hmac", keyId: "test-key" }],
        },
      });
      const before = await readDump(ctx.harness);
      equal(await put([item]), { archived: 0, existing: 0, withheld: 1 }, "Uncomparable text fact must refuse import");
      equal(await readDump(ctx.harness), before, "Uncomparable text fact must leave the committed state unchanged");
    },
  },
  {
    id: "K-IMP-RAW-4e", title: "refuses an exact core-domain keyed text match", needs: ["rawArchive", "fingerprintKey"],
    async run(ctx) {
      const { put } = fixture(ctx);
      if (!put) return missingImport;
      const key = await ctx.adapter.keys.userKey(ctx.owner);
      check(key, "fingerprintKey requires an owner key");
      const item = message("exact", "cedar garden");
      const digest = await coreDigest(item.content, key);
      const alias = await legacyExactMac(item.content, key, coreFingerprintLabels);
      check(alias !== digest.value, "Fixture must isolate the core-domain alias");
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "keyed-exact"), kind: "text", mode: "exact",
        text: { digests: [{ ...digest, value: alias }], keyId: key.id },
      });
      const before = await readDump(ctx.harness);
      const counts = await put([item]);
      const after = await readDump(ctx.harness);
      equal({ counts, dump: after }, { counts: { archived: 0, existing: 0, withheld: 1 }, dump: before },
        "The core-domain exact match must refuse import without storing the message");
    },
  },
  {
    id: "K-IMP-RAW-4k", title: "applies keyed text containment to imports",
    needs: ["rawArchive", "fingerprintKey", "shingleSuppression"],
    async run(ctx) {
      const { put } = fixture(ctx);
      if (!put) return missingImport;
      const key = await ctx.adapter.keys.userKey(ctx.owner);
      check(key, "fingerprintKey requires an owner key");
      const target = "the orchard has a cedar gate and a path lined with rosemary";
      const shingles = await passageShingles(target, key, Object.freeze({
        keyIdDomain: "test-key-id", shingleKeyPrefix: "test-shingle:", legacyExactPrefix: "test-exact:",
      }));
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "containment"), kind: "text", mode: "full",
        text: { digests: [await coreDigest(target, key)], shingles, keyId: key.id },
      });
      const contained = message("contained", `At the trailhead, ${target} next to the creek.`);
      const different = message("different", "Copper conducts electricity.");
      equal(await put([contained, different]), { archived: 1, existing: 0, withheld: 1 },
        "Text containment must refuse the matching import and allow unrelated text");
      check(!JSON.stringify(await readDump(ctx.harness)).includes(contained.content),
        "Import must never store text containment refusals");
    },
  },
  {
    id: "K-IMP-RAW-5", title: "refuses directly fenced sessions and every message of a proven fork", needs: ["rawArchive"],
    async run(ctx) {
      const { put, write, raw, key, scope, session } = fixture(ctx);
      if (!put) return missingImport;
      const anchor = message("anchor", "cedar marker");
      const turn = message("new-turn", "maple grove");
      await write(async (tx) => {
        await raw.recordLineage(tx, key, [anchor]);
        await raw.fenceSession(tx, scope, session);
      });
      const before = await readDump(ctx.harness);
      equal(await put([turn]), { archived: 0, existing: 0, withheld: 1 }, "A direct fence must refuse even a new ID");
      equal(await put([anchor, turn], { ...session, sessionId: "fork" }),
        { archived: 0, existing: 0, withheld: 2 }, "A proven fork must refuse the entire imported batch");
      equal(await readDump(ctx.harness), before, "Lineage refusals must leave the committed state unchanged");
      equal(await put([{ ...anchor, content: "different marker" }, turn], { ...session, sessionId: "edited" }),
        { archived: 2, existing: 0, withheld: 0 }, "A reused ID with edited content must leave the import eligible");
    },
  },
  {
    id: "K-IMP-RAW-6", title: "guards import writes, validates input and rolls back", needs: ["rawArchive"],
    async run(ctx) {
      const { put, importArchive, scope, session, uow, write, raw, key } = fixture(ctx);
      if (!importArchive || !put) return missingImport;
      const item = message("first", "cedar garden");
      const before = await readDump(ctx.harness);
      await rejects(() => uow.run(ctx.owner, { readOnly: true }, (tx) => importArchive(tx, scope, session, [item])),
        "internal_error");
      await rejects(() => uow.run(ctx.otherOwner, {}, (tx) => importArchive(tx, scope, session, [item])), "internal_error");
      await rejects(() => put([item], { ...session, client: "" }), "invalid_input");
      const invalidMessages = [{ ...item, occurredAtMs: 1.5 }];
      await rejects(() => put(invalidMessages), "invalid_input");
      await rejects(() => write((tx) => raw.archive(tx, key, invalidMessages)), "invalid_input");
      equal(await readDump(ctx.harness), before, "Rejected imports must leave the committed state unchanged");
      const abort = new Error("Abort import fixture");
      const error = await caught(() => write(async (tx) => {
        equal(await importArchive(tx, scope, session, [item]),
          { archived: 1, existing: 0, withheld: 0 }, "The rollback fixture must insert a message");
        throw abort;
      }));
      check(error === abort, "The import run must reject with the fixture error");
      equal(await readDump(ctx.harness), before, "Rolled-back imports must leave the committed state unchanged");
    },
  },
];
