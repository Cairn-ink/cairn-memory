import { createMemoryService } from "@cairn-ink/core/service";
import { check, DEFAULT_EMBEDDING_DIMENSIONS, equal, readDump } from "./support.mjs";

/** @import { CaptureKey, CaptureMessage, Receipt, Scope } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

const encoder = new TextEncoder();

/** Lends the adapter to core, adding a fixture name only when the adapter has none. Core reads each port when it
 * needs it, on the adapter itself, so ports behind prototype getters work and properties outside the storage
 * contract are never read. An existing name is passed through unchanged, as proxy invariants require for frozen adapters.
 * @param {CaseContext["adapter"]} adapter @returns {CaseContext["adapter"] & { name: string }}
 */
function storageOf(adapter) {
  return /** @type {CaseContext["adapter"] & { name: string }} */ (new Proxy(adapter, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      return key === "name" && typeof value !== "string" ? "receipt-fixture" : value;
    },
    has: (target, key) => key === "name" || Reflect.has(target, key),
  }));
}

/** Equivalent dumps compare equal whatever order their object keys were inserted in.
 * @param {unknown} value @returns {unknown}
 */
function sortedKeys(value) {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value && typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value);
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, sortedKeys(record[key])]));
  }
  return value;
}

/** @param {CaseContext["harness"]} harness */
async function dumpText(harness) {
  return JSON.stringify(sortedKeys(await readDump(harness)));
}

/** @param {CaseContext} ctx */
function saveService(ctx) {
  const unused = () => { throw new Error("Unexpected provider call during save"); };
  const dimensions = ctx.embeddingDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
  return createMemoryService({
    storage: storageOf(ctx.adapter),
    model: { model: "fixture-only", contextWindow: 1, call: unused, countTokens: unused },
    embedder: ctx.adapter.capabilities.embeddingRequiredOnInsert ? {
      model: "fixture-only", dimensions,
      async embed(texts) {
        const vector = new Float32Array(dimensions);
        vector[0] = 1;
        return texts.map(() => vector.slice());
      },
    } : null,
    gate: { async assertOpen() {} },
    clock: {
      nowMs: () => 3, monotonicMs: () => 0, hmacHex: unused,
      async sha256Hex(input) {
        const digest = await crypto.subtle.digest("SHA-256",
          typeof input === "string" ? encoder.encode(input) : new Uint8Array(input));
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      },
    },
    tokens: { countTokens: unused },
    config: {},
  });
}

/** @param {Scope} scope @param {string} content @param {number} occurredAtMs */
function conversation(scope, content, occurredAtMs) {
  /** @type {CaptureKey} */
  const key = {
    scope, client: "fixture-client", sessionId: crypto.randomUUID(),
    eventId: crypto.randomUUID(), payloadDigest: "a".repeat(64),
  };
  /** @satisfies {CaptureMessage} */
  const message = { id: crypto.randomUUID(), role: "user", content, occurredAtMs };
  /** @satisfies {Receipt} */
  const receipt = { client: key.client, sessionId: key.sessionId, messageId: message.id, role: message.role, occurredAtMs };
  return { key, message, receipt, session: { client: key.client, sessionId: key.sessionId } };
}

/**
 * @param {CaseContext} ctx @param {Scope} scope @param {ReturnType<typeof saveService>} service
 * @param {ReturnType<typeof conversation>["receipt"]} receipt @param {string} text @param {string} label
 */
async function expectSuppressedSave({ adapter: { memories, uow }, harness }, scope, service, receipt, text, label) {
  const index = () => uow.run(scope.owner, { readOnly: true }, async tx => memories.indexRevision?.(tx));
  const revision = memories.indexRevision ? await index() : undefined;
  const before = await dumpText(harness);
  const message = `Core save must suppress a ${label} receipt`;
  const result = await service.save(scope, text,
    { kind: "mcp", client: receipt.client, sessionId: null }, "fact", { receipt }).catch(cause => {
    throw new Error(`${message} (save rejected)`, { cause });
  });
  equal(result.status, "suppressed", message);
  equal(await dumpText(harness), before, `A suppressed ${label} receipt save must leave the dump unchanged`);
  if (memories.indexRevision) equal(await index(), revision, `A suppressed ${label} receipt save must leave the index revision unchanged`);
}

/** @type {readonly ConformanceCase[]} */
export const RECEIPT_WITHHELD_CASES = [
  {
    id: "K-RCPT-W1", title: "withholds receipts from deleted and fenced conversations",
    needs: ["rawArchive"],
    async run(ctx) {
      const { raw, suppressions, uow } = ctx.adapter;
      const { receiptWithheld } = suppressions;
      check(typeof receiptWithheld === "function", "An adapter with rawArchive must implement suppressions.receiptWithheld");
      check(raw, "rawArchive requires the raw ports");
      const scope = ctx.scope(null);
      // Core checks the receipt inside its pause-locked write transaction, so the probes use the same kind.
      /** @param {Receipt} receipt @param {string} excerpt */
      const withheld = (receipt, excerpt) => uow.run(scope.owner, { pauseLock: true },
        tx => receiptWithheld.call(suppressions, tx, scope, { ...receipt, excerpt }));
      /** @param {ReturnType<typeof conversation>} fixture */
      const archive = async ({ key, message }) => {
        const result = await uow.run(scope.owner, { pauseLock: true }, tx => raw.archive(tx, key, [message]));
        equal(result.archived, 1, "The receipt source message must be archived");
      };

      const deleted = conversation(scope, "The copper kettle sits on the shelf.", 1);
      await archive(deleted);
      equal(await withheld(deleted.receipt, deleted.message.content), false,
        "A receipt from a visible archived message must not be withheld");
      const removal = await uow.run(scope.owner, { pauseLock: true },
        tx => raw.deleteConversation(tx, scope, deleted.session));
      equal(removal.rawDeleted, 1, "Deleting the conversation must remove its archived message");
      equal(await withheld(deleted.receipt, deleted.message.content), true, "A receipt from a deleted conversation must be withheld");
      // The excerpt is the saved text, so a reworded save still cites the deleted message.
      const reworded = "A copper kettle rests on a shelf.";
      equal(await withheld(deleted.receipt, reworded), true, "A reworded receipt from a deleted conversation must be withheld");

      const fenced = conversation(scope, "The linen curtains are blue.", 2);
      await archive(fenced);
      await uow.run(scope.owner, { pauseLock: true }, tx => raw.fenceSession(tx, scope, fenced.session));
      equal(await withheld(fenced.receipt, fenced.message.content), true, "A receipt from a fenced conversation must be withheld");
      // A fence covers the whole conversation, including messages that were never archived.
      const unarchived = { ...fenced.receipt, messageId: crypto.randomUUID() };
      const unarchivedText = "The linen curtains were washed.";
      equal(await withheld(unarchived, unarchivedText), true,
        "A receipt for an unarchived message in a fenced conversation must be withheld");

      const service = saveService(ctx);
      await expectSuppressedSave(ctx, scope, service, deleted.receipt, deleted.message.content, "deleted");
      await expectSuppressedSave(ctx, scope, service, deleted.receipt, reworded, "reworded deleted");
      await expectSuppressedSave(ctx, scope, service, fenced.receipt, fenced.message.content, "fenced");
      await expectSuppressedSave(ctx, scope, service, unarchived, unarchivedText, "fenced unarchived");
    },
  },
];
