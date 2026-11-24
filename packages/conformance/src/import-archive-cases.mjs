import { coreDigest, legacyExactMac, passageShingles, PRIVACY_REDACTION_VERSIONS } from "@cairn-ink/core";
import { coreFingerprintLabels } from "../../core/src/privacy/fingerprint.mjs";
import { caught, check, equal, readDump, rejects } from "./support.mjs";

/** @import { CaptureKey, CaptureMessage, Tx } from "@cairn-ink/core/ports" */
/** @import { TextFact } from "@cairn-ink/core" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

const missingImport = "needs raw.importArchive";
const client = "test-client";
const sessionId = "test-session";

/** @param {string} id @param {string} content @param {number | null} [occurredAtMs] @returns {CaptureMessage} */
function message(id, content, occurredAtMs = 10) {
  return { id, role: "user", content, occurredAtMs };
}

/** @param {CaseContext} ctx @param {string | null} [namespace] */
function fixture(ctx, namespace = null) {
  const { raw, uow } = ctx.adapter;
  check(raw, "rawArchive requires the raw port");
  const scope = ctx.scope(namespace);
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

/** @param {CaseContext} ctx @param {string | null} namespace @param {Pick<TextFact, "mode" | "text">} fact
 * @param {string} matchingContent @param {readonly string[]} withheldIds
 */
async function checkTextImport(ctx, namespace, fact, matchingContent, withheldIds) {
  const { put, scope } = fixture(ctx, namespace);
  check(put, "Text matching requires raw.importArchive");
  await ctx.harness.seedFact(ctx.owner, {
    ...factBase(ctx, "text-import"), ...scope, kind: "text", ...fact,
  });
  const matching = message("matching", matchingContent);
  const unrelated = message("unrelated", "Copper conducts electricity.");
  for (const item of [matching, unrelated]) {
    const before = await readDump(ctx.harness);
    const withheld = withheldIds.includes(item.id);
    equal(await put([item]), { archived: Number(!withheld), existing: 0, withheld: Number(withheld) },
      `Import must match capture admission for the ${item.id} message`);
    if (withheld) {
      equal(await readDump(ctx.harness), before, "Text refusal must leave the committed state unchanged");
    }
  }
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
    id: "K-IMP-RAW-4", title: "matches canonical text digests and fails closed on unavailable evidence", needs: ["rawArchive"],
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
      await checkTextImport(ctx, "canonical", {
        mode: "exact", text: { digests: [await coreDigest(item.content)] },
      }, item.content, ["matching"]);
    },
  },
  {
    id: "K-IMP-RAW-4e", title: "matches capture admission for core and adapter text MAC domains", needs: ["rawArchive", "fingerprintKey"],
    async run(ctx) {
      const { put } = fixture(ctx);
      if (!put) return missingImport;
      const key = await ctx.adapter.keys.userKey(ctx.owner);
      check(key, "fingerprintKey requires an owner key");
      const content = "cedar garden";
      const digest = await coreDigest(content, key);
      const coreMac = await legacyExactMac(content, key, coreFingerprintLabels);
      const adapterMac = await legacyExactMac(content, key, Object.freeze({
        ...coreFingerprintLabels, legacyExactPrefix: "test-exact:",
      }));
      check(coreMac !== digest.value && adapterMac !== digest.value && adapterMac !== coreMac,
        "Fixture must isolate the two MAC domains");
      await checkTextImport(ctx, null, {
        mode: "exact", text: { digests: [{ ...digest, value: coreMac }], keyId: key.id },
      }, content, ["matching"]);
      const legacy = /** @satisfies {TextFact["text"]["digests"][number]} */ ({
        ...digest, value: adapterMac, pipeline: "engine-legacy", redactionVersion: PRIVACY_REDACTION_VERSIONS.v1,
      });
      await checkTextImport(ctx, "adapter-mac", {
        mode: "exact", text: { digests: [legacy], keyId: key.id },
      }, content, ["matching", "unrelated"]);
      // Capture can compare the SHA-256 alias, which misses both messages.
      await checkTextImport(ctx, "adapter-mac-with-alias", {
        mode: "exact", text: { digests: [legacy, await coreDigest("A different passage.")], keyId: key.id },
      }, content, []);
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
      const shingles = await passageShingles(target, key, coreFingerprintLabels);
      await checkTextImport(ctx, null, {
        mode: "full", text: { digests: [await coreDigest(target, key)], shingles, keyId: key.id },
      }, `At the trailhead, ${target} next to the creek.`, ["matching"]);
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
  {
    id: "K-IMP-RAW-7", title: "a withheld anchor fences the entire imported fork", needs: ["rawArchive"],
    async run(ctx) {
      const { put, importArchive, raw, key, scope, session, page, write } = fixture(ctx);
      if (!importArchive || !put) return missingImport;
      const anchor = message("anchor", "cedar marker");
      const turn = message("turn", "maple grove");
      equal(await put([anchor, turn]), { archived: 2, existing: 0, withheld: 0 }, "Fixture must import both source rows");
      await write(async (tx) => {
        await raw.recordLineage(tx, key, [anchor]);
        await raw.fenceSession(tx, scope, session);
        await raw.deleteConversation(tx, scope, session);
      });
      const fork = { ...session, sessionId: "fork" };
      const batch = [turn, anchor];
      const before = await readDump(ctx.harness);
      equal(await write((tx) => importArchive(tx, scope, fork, batch, { withheld: [1] })),
        { archived: 0, existing: 0, withheld: batch.length }, "A withheld anchor must fence the whole fork");
      equal((await page()).items, [], "A fenced fork must not re-archive either deleted row");
      equal(await readDump(ctx.harness), before, "Importing a proven fork must leave no new rows or proofs");
    },
  },
  {
    id: "K-IMP-RAW-8", title: "withheld positions stay out of raw lists, search and storage", needs: ["rawArchive"],
    async run(ctx) {
      const { importArchive, raw, scope, session, page, uow, write } = fixture(ctx);
      if (!importArchive) return missingImport;
      const first = message("first", "cedar");
      const blocked = message("excluded", "quartz");
      const last = message("last", "maple");
      const visible = [first, last];
      equal(await write((tx) => importArchive(tx, scope, session, [first, blocked, last], { withheld: [1] })),
        { archived: 2, existing: 0, withheld: 1 }, "Import must archive only the positions outside the withheld list");
      equal((await page()).items.map(({ messageId, content }) => [messageId, content]).sort(),
        visible.map(({ id, content }) => [id, content]), "Raw list must contain only the eligible rows");
      const committed = JSON.stringify(await readDump(ctx.harness));
      check(!committed.includes(JSON.stringify(blocked.id)) && !committed.includes(blocked.content),
        "Committed state must exclude the withheld row");
      for (const { id, content } of visible) {
        check(committed.includes(JSON.stringify(id)) && committed.includes(content), "Committed state must include each eligible row");
      }
      const selection = { owner: ctx.owner, namespaces: [scope.namespace] };
      await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
        equal((await raw.raw(tx, selection, blocked.content, "search", { limit: 20 })).segments, [],
          "Raw search must exclude the withheld row");
        for (const { id, content } of visible) {
          const result = await raw.raw(tx, selection, content, "search", { limit: 20 });
          equal(result.segments.map(({ messageId }) => messageId), [id], "Raw search must return each eligible row");
        }
      });
    },
  },
  {
    id: "K-IMP-RAW-9", title: "counts each position once across overlapping import refusals and existing IDs",
    needs: ["rawArchive", "rawWindowHide"],
    async run(ctx) {
      const { put, importArchive, scope, session, page, write } = fixture(ctx);
      if (!importArchive || !put) return missingImport;
      const existing = message("existing", "cedar", 20);
      equal(await put([existing]), { archived: 1, existing: 0, withheld: 0 }, "Fixture must store the existing row");
      const forgotten = "quartz";
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "window"), kind: "window", client, window: { startMs: 10, endMs: 20 },
      });
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "text"), kind: "text", mode: "exact", text: { digests: [await coreDigest(forgotten)] },
      });
      const fresh = message("fresh", "maple", 20);
      const batch = [
        fresh,
        message(existing.id, forgotten, 10),
        existing,
        message("window-only", "willow", 15),
        message("text-only", forgotten, 20),
        message(existing.id, "ash", 20),
        message(fresh.id, "birch", 20),
      ];
      equal(await write((tx) => importArchive(tx, scope, session, batch, { withheld: [5, 1, 6] })),
        { archived: 1, existing: 1, withheld: 5 }, "Every import position must contribute exactly one outcome");
      equal((await page()).items.map(({ messageId, content }) => [messageId, content]).sort(),
        [existing, fresh].map(({ id, content }) => [id, content]), "Only eligible positions may determine stored rows");
    },
  },
  {
    id: "K-IMP-RAW-10", title: "validates withheld positions before writes and accepts omitted options", needs: ["rawArchive"],
    async run(ctx) {
      const { put, importArchive, scope, session, write } = fixture(ctx);
      if (!importArchive || !put) return missingImport;
      const batch = [message("first", "cedar"), message("second", "maple")];
      const before = await readDump(ctx.harness);
      await write(async (tx) => {
        for (const withheld of [[0, 0], [2], [-1], [0.5], [Number.MAX_SAFE_INTEGER + 1], ["0"], new Array(1), null, undefined]) {
          const invalid = /** @type {{withheld: number[]}} */ (/** @type {unknown} */ ({ withheld }));
          await rejects(() => importArchive(tx, scope, session, batch, invalid), "invalid_input");
        }
        await rejects(() => importArchive(tx, scope, session, [], { withheld: [0] }), "invalid_input");
      });
      equal(await readDump(ctx.harness), before, "Invalid options must leave committed state unchanged");
      equal(await put(batch), { archived: 2, existing: 0, withheld: 0 }, "Omitting options must archive eligible rows");
      equal(await put(batch), { archived: 0, existing: 2, withheld: 0 }, "Omitting options must still count existing IDs");
      equal(await write((tx) => importArchive(tx, scope, session, batch, {})),
        { archived: 0, existing: 2, withheld: 0 }, "An empty options object must behave like omitted options");
    },
  },
];
