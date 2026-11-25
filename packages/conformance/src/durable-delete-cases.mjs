import { check, equal, readDump } from "./support.mjs";

/** @import { CaptureKey, CaptureMessage, Tx } from "@cairn-ink/core/ports" */
/** @import { ConformanceCase } from "./index.d.mts" */

/** @param {string} content @param {number} occurredAtMs @returns {CaptureMessage} */
function message(content, occurredAtMs) {
  return { id: crypto.randomUUID(), role: "user", content, occurredAtMs };
}

/** @type {readonly ConformanceCase[]} */
export const DURABLE_DELETE_CASES = [
  {
    id: "K-RAW-DEL-1", title: "conversation deletion refuses later turns with new IDs",
    needs: ["rawArchive"],
    async run({ adapter: { raw, capture, suppressions, uow }, owner, scope, harness }) {
      check(raw, "rawArchive requires the raw ports");
      const target = scope(null);
      const client = "test-client";
      const deleted = { client, sessionId: crypto.randomUUID() };
      const control = { client, sessionId: crypto.randomUUID() };
      /** @param {typeof deleted} session @returns {CaptureKey} */
      const key = session => ({ ...session, scope: target, eventId: crypto.randomUUID(), payloadDigest: "a".repeat(64) });
      /** @template T @param {(tx: Tx) => Promise<T>} work */
      const write = work => uow.run(owner, { pauseLock: true }, work);
      /** @param {typeof deleted} session @param {CaptureMessage} item */
      const archive = (session, item) => write(tx => raw.archive(tx, key(session), [item]));
      const remove = () => write(tx => raw.deleteConversation(tx, target, deleted));

      equal((await archive(deleted, message("The latch is brass.", 1))).archived, 1,
        "The conversation to delete must contain an archived message");
      equal((await archive(control, message("The shelf is oak.", 2))).archived, 1,
        "The control conversation must contain an archived message");
      equal((await remove()).rawDeleted, 1, "Deleting the conversation must remove its archived message");

      const before = await readDump(harness);
      // Probe both an old timestamp (re-sent history) and one well after the delete (a genuinely later turn),
      // so a time cutoff at the delete cannot pass for durable refusal.
      const afterDelete = Date.now() + 86_400_000;
      const resent = message("The latch was polished.", 3);
      const late = message("The latch was polished again.", afterDelete);
      equal((await archive(deleted, resent)).archived, 0, "Raw archive must refuse a new message in the deleted conversation");
      equal((await archive(deleted, late)).archived, 0,
        "Raw archive must refuse a new message timestamped after the deletion");
      equal(await readDump(harness), before, "A refused archive must leave the dump unchanged");

      const importArchive = raw.importArchive?.bind(raw);
      if (importArchive) {
        const counts = await write(tx => importArchive(tx, target, deleted, [message("The latch was replaced.", afterDelete + 1)]));
        equal(counts, { archived: 0, existing: 0, withheld: 1 },
          `Raw import must refuse a new message in the deleted conversation (got ${JSON.stringify(counts)})`);
        equal(await readDump(harness), before, "A refused import must leave the dump unchanged");
      }

      const receiptWithheld = suppressions.receiptWithheld?.bind(suppressions);
      if (receiptWithheld) {
        const { id, role, occurredAtMs, content } = late;
        const receipt = { ...deleted, messageId: id, role, occurredAtMs, excerpt: content };
        equal(await write(tx => receiptWithheld(tx, target, receipt)), true,
          "A receipt for a new message in the deleted conversation must be withheld");
      }

      if (capture?.eligible) {
        equal(await uow.run(owner, { readOnly: true },
          tx => capture.eligible(tx, key(deleted), [message("The latch was checked.", 5),
            message("The latch was checked again.", afterDelete + 2)])), [],
          "A new capture in the deleted conversation must have no eligible positions");
      }

      equal((await archive(control, message("The shelf was sanded.", afterDelete + 3))).archived, 1,
        "Raw archive must still accept a new message in another conversation for the same client");
      equal((await remove()).rawDeleted, 0, "Deleting the conversation again must remove zero messages");
    },
  },
];
