import { CoreError } from "@cairn-ink/core";
import { captureKey, copyBatch, copyMessages } from "./capture.mjs";
import { importTextBlocked, purgeFacts, rawFactPolicy } from "./raw-facts.mjs";
import { allowsRawSession } from "./raw-lineage.mjs";
import { eraseRawSessions, purgeRawMessages } from "./raw-purge.mjs";
import { copySession, rawWriter, readRawRow } from "./raw-rows.mjs";
import { receiptAddressDenial } from "./receipt-identity.mjs";
import { invalidInput, scopeKey } from "./storage-values.mjs";
import { advanceSuppressionEpoch, readFacts, readLegacyDenials } from "./suppressions.mjs";

/** @import { CaptureMessage, RawCapture, RawStore } from "@cairn-ink/core/ports" */
/** @import { IndexRevisions } from "./capture.mjs" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @import { MigratedRawPolicy } from "./migrate/raw-privacy.mjs" */
/** @import { MigratedCaptureControls } from "./migrate/capture-controls.mjs" */
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

/** @param {Port} port @param {SessionHasher} hashSession @param {Lineage} lineage @param {IndexRevisions} index
 * @param {MigratedRawPolicy} [migratedRaw]
 * @param {MigratedCaptureControls} [controls]
 * @param {ReturnType<typeof import("./placement-visibility.mjs").createTitleScrubber>} [scrubTitles]
 */
export function createRawStore(port, hashSession, lineage, index, migratedRaw, controls, scrubTitles) {
  let rawKeyConflict = 0;

  /** @type {RawStore & RawCapture} */
  const raw = {
    recordLineage(tx, input, messages) {
      return port(tx, input?.scope?.owner, write, db => {
        const key = captureKey(input, { owner: tx.owner, namespace: input.scope.namespace });
        controls?.assertCapture(key);
        const batch = copyMessages(messages);
        migratedRaw?.recordRange(db, key.scope, key, batch);
        lineage.record(db, key.scope, key, batch);
      });
    },

    archiveAllowed(tx, input) {
      return port(tx, input?.scope?.owner, {}, db => {
        const key = captureKey(input, { owner: tx.owner, namespace: input.scope.namespace });
        const { scope, client, sessionId } = key;
        return !controls?.rawDisposition(key) &&
          allowsRawSession(db, scope, client, hashSession(scope, client, sessionId)) &&
          !migratedRaw?.blocksEvent(db, key) &&
          !migratedRaw?.blocks(db, scope, { client, sessionId }, []);
      });
    },

    archive(tx, input, messages) {
      return port(tx, input?.scope?.owner, write, db => {
        const key = captureKey(input, { owner: tx.owner, namespace: input.scope.namespace });
        const batch = rawMessages(messages);
        const reason = controls?.rawDisposition(key);
        if (reason) return { archived: 0, reason };
        const { scope, client } = key;
        const facts = readFacts(db, scope);
        const policy = rawFactPolicy(scope, key, facts, hashSession);
        if (!batch.length || migratedRaw?.blocksEvent(db, key) ||
            !allowsRawSession(db, scope, client, policy.sessionKeyHash, facts)) return { archived: 0 };
        if (migratedRaw?.blocks(db, scope, key, batch)) {
          migratedRaw.fenceArrival(db, scope, key, batch);
          return { archived: 0 };
        }
        const legacy = readLegacyDenials(db, scope);
        const session = migratedRaw?.storageSession(db, scope, key) ?? key;
        const insert = rawWriter(db, scope, session);
        let archived = 0;
        for (const item of batch) {
          if (hasSourceTombstone(legacy, key, item.id, policy.sessionKeyHash) ||
              policy.refusesSource(item, false) || importTextBlocked([], item.content, legacy) ||
              migratedRaw?.blocksSpan(db, scope, key, item.id) ||
              migratedRaw?.reservesMessage(db, scope, key, item.id)) continue;
          if (insert(item)) archived++;
          else if (readRawRow(db, scope, session, item.id)?.message.content !== item.content) rawKeyConflict++;
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
        if (!allowsRawSession(db, selection, session.client, policy.sessionKeyHash, facts)) {
          return { ...counts, withheld: batch.length };
        }
        if (migratedRaw?.blocks(db, selection, session, batch)) {
          migratedRaw.fenceArrival(db, selection, session, batch);
          return { ...counts, withheld: batch.length };
        }
        if (lineage.fenced(db, selection, session, lineage.proofs(selection.owner, session.client, batch))) {
          return { ...counts, withheld: batch.length };
        }
        const legacy = readLegacyDenials(db, selection);
        const insert = rawWriter(db, selection, migratedRaw?.storageSession(db, selection, session) ?? session);
        for (const [position, item] of batch.entries()) {
          if (withheld.has(position) || hasSourceTombstone(legacy, session, item.id, policy.sessionKeyHash) ||
              policy.refusesSource(item, true) || importTextBlocked(facts, item.content, legacy) ||
              migratedRaw?.blocksSpan(db, selection, session, item.id) ||
              migratedRaw?.reservesMessage(db, selection, session, item.id)) {
            counts.withheld++;
          } else if (insert(item)) {
            counts.archived++;
          } else {
            counts.existing++;
          }
        }
        migratedRaw?.recordRange(db, selection, session, batch);
        if (counts.archived) index.advanceRaw(db, tx);
        return counts;
      });
    },

    fenceSession(tx, scope, input) {
      return port(tx, scope?.owner, write, db => {
        const selection = { owner: tx.owner, namespace: scope.namespace };
        if (addFence(db, selection, copySession(input))) {
          scrubTitles?.(db, selection);
          index.advanceRaw(db, tx);
        }
      });
    },

    eraseSessions(tx, scope, closure) {
      return port(tx, scope?.owner, write, db => {
        const selection = { owner: tx.owner, namespace: scope.namespace };
        return changed(db, tx, selection, eraseRawSessions(db, selection, eraseAddresses(selection, copyBatch(closure).map(copySession))));
      });
    },

    deleteConversation(tx, scope, input) {
      return port(tx, scope?.owner, write, db => {
        const selection = { owner: tx.owner, namespace: scope.namespace };
        const session = copySession(input);
        // Keep late turns with previously unseen message IDs from restoring the session.
        const fenced = addFence(db, selection, session);
        const { rawDeleted } = changed(db, tx, selection, eraseRawSessions(db, selection, eraseAddresses(selection, [session])), fenced);
        return { rawDeleted };
      });
    },

    purgeWithheld(tx, scope, supplied) {
      return port(tx, scope?.owner, write, db => {
        const selection = { owner: tx.owner, namespace: scope.namespace };
        return changed(db, tx, selection, purgeRawMessages(db, selection, purgeFacts(selection, supplied), hashSession));
      });
    },
  };

  /** @param {ReadonlySet<string>} legacy @param {import("./raw-rows.mjs").Session} session
   * @param {string} messageId @param {string} sessionHash */
  function hasSourceTombstone(legacy, { client, sessionId }, messageId, sessionHash) {
    if (!legacy.size) return false;
    // A migrated alias can still own a tombstone after its last Raw row is gone.
    return legacy.has(receiptAddressDenial({ client, sessionId, messageId })) ||
      (migratedRaw !== undefined && legacy.has(receiptAddressDenial({ client, sessionId: "legacy-raw:" + sessionHash, messageId })));
  }

  /** @param {Connection} db @param {import("@cairn-ink/core/ports").Scope} scope
   * @param {import("./raw-rows.mjs").Session} session */
  function addFence(db, scope, session) {
    const hashes = migratedRaw?.fenceHashes(scope, session) ?? [hashSession(scope, session.client, session.sessionId)];
    const insert = db.prepare(`INSERT INTO cairn_raw_fences (owner_id, namespace_key, session_hash)
      VALUES (?, ?, ?) ON CONFLICT DO NOTHING`);
    const keys = scopeKey(scope);
    let added = false;
    for (const hash of hashes) if (insert.run(...keys, hash).changes) added = true;
    if (added) advanceSuppressionEpoch(db, scope.owner);
    return added;
  }

  /** @param {import("@cairn-ink/core/ports").Scope} scope
   * @param {import("./raw-rows.mjs").Session[]} sessions */
  function eraseAddresses(scope, sessions) {
    if (!migratedRaw) return sessions;
    return sessions.flatMap(session => {
      const { client, sessionId } = session;
      const hash = hashSession(scope, client, sessionId);
      // Converted archives may retain the original legacy session address.
      return [...new Set([sessionId, "legacy-raw:" + hash, "s1:" + hash])]
        .map(sessionId => ({ client, sessionId }));
    });
  }

  /** @param {Connection} db @param {import("@cairn-ink/core/ports").Tx} tx
   * @param {import("@cairn-ink/core/ports").Scope} selection
   * @param {{rawDeleted: number, ledgerBlanked: number}} counts
   * @param {boolean} [fenced]
   */
  function changed(db, tx, selection, counts, fenced = false) {
    if (fenced || counts.rawDeleted || counts.ledgerBlanked) {
      scrubTitles?.(db, selection);
      index.advanceRaw(db, tx);
    }
    return counts;
  }

  return { raw, counters: () => ({ rawKeyConflict }) };
}
