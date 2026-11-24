import { CoreError } from "@cairn-ink/core";
import { captureKey, copyBatch, copyMessages } from "./capture.mjs";
import { importTextBlocked, purgeFacts, rawFactPolicy } from "./raw-facts.mjs";
import { allowsRawSession } from "./raw-lineage.mjs";
import { eraseRawSessions, purgeRawMessages } from "./raw-purge.mjs";
import { copySession, rawWriter, readRawRow } from "./raw-rows.mjs";
import { invalidInput, scopeKey } from "./storage-values.mjs";
import { advanceSuppressionEpoch, readFacts, readLegacyDenials } from "./suppressions.mjs";

/** @import { CaptureMessage, RawCapture, RawStore } from "@cairn-ink/core/ports" */
/** @import { IndexRevisions } from "./capture.mjs" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @typedef {ReturnType<typeof import("./raw-lineage.mjs").createRawLineage>} Lineage */

const write = { write: true };

/** @param {readonly CaptureMessage[]} messages */
function rawMessages(messages) {
  const copied = copyMessages(messages);
  if (copied.some(({ id }) => !id)) invalidInput();
  return copied;
}

/** @param {{withheld?: readonly number[]} | undefined} options @param {number} length */
function withheldPositions(options, length) {
  if (options === undefined) return new Set();
  if (options === null || typeof options !== "object") invalidInput();
  const prototype = Object.getPrototypeOf(options);
  const keys = Reflect.ownKeys(options);
  const slot = Object.getOwnPropertyDescriptor(options, "withheld");
  if ((prototype !== Object.prototype && prototype !== null) || keys.length !== (slot ? 1 : 0) ||
      (slot && (keys[0] !== "withheld" || !Object.hasOwn(slot, "value"))) ||
      ("withheld" in options) !== (slot !== undefined) ||
      !Object.is(slot?.value, Reflect.get(options, "withheld"))) invalidInput();
  if (!slot) return new Set();
  if (!Array.isArray(slot.value) || slot.value.length > length) invalidInput();
  const positions = copyBatch(/** @type {readonly number[]} */ (slot.value));
  const unique = new Set(positions);
  if (unique.size !== positions.length ||
      positions.some(position => !Number.isSafeInteger(position) || position < 0 || position >= length)) invalidInput();
  return unique;
}

/** @param {Port} port @param {SessionHasher} hashSession @param {Lineage} lineage @param {IndexRevisions} index */
export function createRawStore(port, hashSession, lineage, index) {
  let rawKeyConflict = 0;

  /** @type {RawStore & RawCapture} */
  const raw = {
    recordLineage(tx, input, messages) {
      return port(tx, input?.scope?.owner, write, db => {
        const key = captureKey(input, { owner: tx.owner, namespace: input.scope.namespace });
        lineage.record(db, key.scope, key, copyMessages(messages));
      });
    },

    archiveAllowed(tx, input) {
      return port(tx, input?.scope?.owner, {}, db => {
        const { scope, client, sessionId } = captureKey(input, { owner: tx.owner, namespace: input.scope.namespace });
        return allowsRawSession(db, scope, client, hashSession(scope, client, sessionId));
      });
    },

    archive(tx, input, messages) {
      return port(tx, input?.scope?.owner, write, db => {
        const key = captureKey(input, { owner: tx.owner, namespace: input.scope.namespace });
        const batch = rawMessages(messages);
        const { scope, client } = key;
        const facts = readFacts(db, scope);
        const policy = rawFactPolicy(scope, key, facts, hashSession);
        if (!batch.length || !allowsRawSession(db, scope, client, policy.sessionKeyHash, facts)) return { archived: 0 };
        const legacy = readLegacyDenials(db, scope);
        const insert = rawWriter(db, scope, key);
        let archived = 0;
        for (const item of batch) {
          if (policy.refusesSource(item, false) || importTextBlocked([], item.content, legacy)) continue;
          if (insert(item)) archived++;
          else if (readRawRow(db, scope, key, item.id)?.message.content !== item.content) rawKeyConflict++;
        }
        if (archived) index.advanceRaw(db, tx);
        return { archived };
      });
    },

    // Validate the whole batch before entering the write guard. Rejected input
    // has no effects and callers can correct it within the same transaction.
    async importArchive(tx, scope, input, messages, options) {
      const session = copySession(input);
      const batch = rawMessages(messages);
      const withheld = withheldPositions(options, batch.length);
      return port(tx, scope?.owner, write, db => {
        const selection = { owner: tx.owner, namespace: scope.namespace };
        const counts = { archived: 0, existing: 0, withheld: 0 };
        if (!batch.length) return counts;
        const facts = readFacts(db, selection);
        const policy = rawFactPolicy(selection, session, facts, hashSession);
        if (!allowsRawSession(db, selection, session.client, policy.sessionKeyHash, facts) ||
            lineage.fenced(db, selection, session, lineage.proofs(selection.owner, session.client, batch))) {
          return { ...counts, withheld: batch.length };
        }
        const legacy = readLegacyDenials(db, selection);
        const insert = rawWriter(db, selection, session);
        for (const [position, item] of batch.entries()) {
          if (withheld.has(position) || policy.refusesSource(item, true) || importTextBlocked(facts, item.content, legacy)) {
            counts.withheld++;
          } else if (insert(item)) {
            counts.archived++;
          } else {
            counts.existing++;
          }
        }
        if (counts.archived) index.advanceRaw(db, tx);
        return counts;
      });
    },

    fenceSession(tx, scope, input) {
      return port(tx, scope?.owner, write, db => {
        const selection = { owner: tx.owner, namespace: scope.namespace };
        const { client, sessionId } = copySession(input);
        const added = db.prepare(`INSERT INTO cairn_raw_fences (owner_id, namespace_key, session_hash)
          VALUES (?, ?, ?) ON CONFLICT DO NOTHING`).run(...scopeKey(selection), hashSession(selection, client, sessionId));
        if (added.changes) {
          advanceSuppressionEpoch(db, tx.owner);
          index.advanceRaw(db, tx);
        }
      });
    },

    eraseSessions(tx, scope, closure) {
      return port(tx, scope?.owner, write, db =>
        changed(db, tx, eraseRawSessions(db, { owner: tx.owner, namespace: scope.namespace }, copyBatch(closure).map(copySession))));
    },

    deleteConversation(tx, scope, input) {
      return port(tx, scope?.owner, write, db => {
        const selection = { owner: tx.owner, namespace: scope.namespace };
        const { rawDeleted } = changed(db, tx, eraseRawSessions(db, selection, [copySession(input)]));
        return { rawDeleted };
      });
    },

    purgeWithheld(tx, scope, supplied) {
      return port(tx, scope?.owner, write, db => {
        const selection = { owner: tx.owner, namespace: scope.namespace };
        return changed(db, tx, purgeRawMessages(db, selection, purgeFacts(selection, supplied), hashSession));
      });
    },
  };

  /** @param {Connection} db @param {import("@cairn-ink/core/ports").Tx} tx
   * @param {{rawDeleted: number, ledgerBlanked: number}} counts
   */
  function changed(db, tx, counts) {
    if (counts.rawDeleted || counts.ledgerBlanked) index.advanceRaw(db, tx);
    return counts;
  }

  return { raw, counters: () => ({ rawKeyConflict }) };
}
