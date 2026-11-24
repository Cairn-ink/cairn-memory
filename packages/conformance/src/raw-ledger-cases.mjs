import { coreDigest, factIncarnationBody } from "@cairn-ink/core";
import { check, equal } from "./support.mjs";

/** @import { TextFact } from "@cairn-ink/core" */
/** @import { CaptureKey, CaptureMessage, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

/** @type {CaptureMessage} */
const first = { id: "first", role: "user", content: "cedar drawer", occurredAtMs: 10 };
/** @type {CaptureMessage} */
const second = { id: "second", role: "assistant", content: "maple shelf", occurredAtMs: 20 };
const messages = [first, second];

/** @param {CaseContext} ctx */
function ledgerFixture(ctx) {
  const { capture, raw, uow } = ctx.adapter;
  if (!raw) return "needs raw";
  if (typeof capture?.admit !== "function") return "needs capture.admit";
  if (typeof capture.load !== "function") return "needs capture.load";
  const { admit, load } = capture;
  const scope = ctx.scope(null);
  /** @type {CaptureKey} */
  const key = { scope, client: "test-client", sessionId: "session", eventId: crypto.randomUUID(),
    payloadDigest: "a".repeat(64) };
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const write = (fn) => uow.run(ctx.owner, { pauseLock: true }, fn);
  /** @param {CaptureKey} [target] @param {CaptureMessage[]} [batch] */
  const reserve = async (target = key, batch = messages) => {
    equal(await write((tx) => admit.call(capture, tx, target, batch)), { status: "admitted" },
      "Fixture must admit the capture");
  };
  /** @param {CaptureKey} [target] */
  const read = (target = key) => {
    const { scope, client, sessionId, eventId } = target;
    return uow.run(ctx.owner, { readOnly: true }, (tx) => load.call(capture, tx, { scope, client, sessionId, eventId }));
  };
  return { key, raw, scope, write, reserve, read };
}

/** @type {readonly ConformanceCase[]} */
export const RAW_LEDGER_CASES = [
  {
    id: "K-RAW-LEDGER-1", title: "purge blanks a definite ledger match and retains its slot", needs: ["rawArchive"],
    async run(ctx) {
      const fixture = ledgerFixture(ctx);
      if (typeof fixture === "string") return fixture;
      const { raw, key, scope, write, reserve, read } = fixture;
      if (typeof raw.purgeWithheld !== "function") return "needs raw.purgeWithheld";
      await reserve();
      equal(await read(), { key, messages }, "Fixture must store both ledger slots");
      equal((await write((tx) => raw.archive(tx, key, messages))).archived, 2, "Fixture must archive both Raw rows");
      /** @type {TextFact} */
      const fact = { kind: "text", mode: "exact", origin: "forget", owner: ctx.owner, actionId: "purge",
        text: { digests: [await coreDigest(first.content)] } };
      const incarnation = (await ctx.hash(factIncarnationBody(fact))).slice(7);
      const { factId, epoch, createdAtMs } = await write((tx) => ctx.adapter.suppressions.writeFact(tx, fact, incarnation));
      const stored = { fact, factId, epoch, createdAtMs, incarnation };
      const purge = () => write((tx) => raw.purgeWithheld(tx, scope, [stored, stored]));
      equal(await purge(), { rawDeleted: 1, ledgerBlanked: 1 }, "Purge must count one Raw row and one ledger slot");
      const scrubbed = { key, messages: [{ ...first, content: "" }, second] };
      equal(await read(), scrubbed, "Purge must preserve both slot identities and the unmatched text");
      equal(await purge(), { rawDeleted: 0, ledgerBlanked: 0 }, "A repeated purge must report zero changes");
      equal(await read(), scrubbed, "A repeated purge must preserve the ledger");
      equal(await write((tx) => raw.deleteConversation(tx, scope, key)), { rawDeleted: 1 },
        "Only the unmatched Raw row must remain in storage");
    },
  },
  {
    id: "K-RAW-LEDGER-2", title: "closure erasure blanks every slot in the proven sessions",
    needs: ["rawArchive", "sessionLineage"],
    async run(ctx) {
      const fixture = ledgerFixture(ctx);
      if (typeof fixture === "string") return fixture;
      const { raw, key, scope, write, reserve, read } = fixture;
      const lineage = ctx.adapter.sessionLineage;
      check(typeof lineage?.provenClosure === "function", "Session lineage must provide provenClosure");
      check(typeof raw.recordLineage === "function", "Raw store must provide recordLineage");
      check(typeof raw.eraseSessions === "function", "Raw store must provide eraseSessions");
      const related = { ...key, sessionId: "related", eventId: crypto.randomUUID() };
      const unrelated = { ...key, sessionId: "unrelated", eventId: crypto.randomUUID() };
      const changed = { ...first, content: "birch cabinet" };
      /** @type {[CaptureKey, CaptureMessage[]][]} */
      const sessions = [[key, messages], [related, [first]], [unrelated, [changed]]];
      for (const [target, batch] of sessions) {
        await reserve(target, batch);
        await write((tx) => raw.recordLineage(tx, target, batch));
      }
      const erase = () => write(async (tx) => {
        const closure = await lineage.provenClosure(tx, scope, [{ client: key.client, sessionId: key.sessionId }]);
        check(closure.length === 2 && closure.every(({ client }) => client === key.client),
          "Fixture must prove two sessions for the same client");
        equal(closure.map(({ sessionId }) => sessionId).sort(), [related.sessionId, key.sessionId],
          "Fixture must prove the root and the linked session");
        return raw.eraseSessions(tx, scope, closure);
      });
      equal(await erase(), { rawDeleted: 0, ledgerBlanked: 3 }, "Closure erasure must count its three ledger slots");
      const blank = (/** @type {CaptureMessage} */ item) => ({ ...item, content: "" });
      equal(await read(), { key, messages: messages.map(blank) }, "Closure erasure must scrub the root ledger");
      equal(await read(related), { key: related, messages: [blank(first)] }, "Closure erasure must scrub the linked ledger");
      equal(await read(unrelated), { key: unrelated, messages: [changed] }, "Closure erasure must preserve the unrelated ledger");
      equal(await erase(), { rawDeleted: 0, ledgerBlanked: 0 }, "A repeated closure erasure must report zero changes");
    },
  },
];
