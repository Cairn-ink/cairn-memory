import { readCardGeneration } from "./document-card-rows.mjs";
import { RAW_INSPECT_EPOCH_KEY } from "./schema/inspect.mjs";
import { ownerKey, scopeKey } from "./storage-values.mjs";

/** @import { CallOptions, ContextReadSet, Scope } from "@cairn-ink/core/ports" */
/** @import { Connection } from "./storage-values.mjs" */

const inspectEpoch = "SELECT epoch FROM cairn_inspect_epochs WHERE owner_id = ? AND namespace_key = ?";
// Inspect namespace keys are JSON. These keys track changes a card scan may
// safely resume across, separately from the epochs used by other readers.
const CARD_NEUTRAL_MEMORY = "card-neutral-memory:";
export const CARD_NEUTRAL_WRITES = "card-neutral-writes";

/** @param {Connection} db @param {Scope} scope */
export function noteCardNeutralMemoryChange(db, scope) {
  const [owner, namespace] = scopeKey(scope);
  advanceCardNeutralEpoch(db, owner, CARD_NEUTRAL_MEMORY + namespace);
}

/** @param {Connection} db @param {string} owner @param {string} key */
export function advanceCardNeutralEpoch(db, owner, key) {
  db.prepare(`INSERT INTO cairn_inspect_epochs VALUES (?, ?, 2)
    ON CONFLICT (owner_id, namespace_key) DO UPDATE SET epoch = epoch + 1`).run(owner, key);
}

/** @param {Connection} db @param {ContextReadSet} readSet */
export function cardNeutralChanges(db, { owner, namespaces }) {
  const epoch = db.prepare(inspectEpoch);
  const count = (/** @type {string} */ key) => Number(epoch.get(owner, key)?.epoch ?? 1) - 1;
  return { writes: count(CARD_NEUTRAL_WRITES),
    memories: namespaces.map(namespace => count(CARD_NEUTRAL_MEMORY + scopeKey({ owner, namespace })[1])) };
}

/** @param {Connection} db @param {ContextReadSet} readSet */
export function namespaceEpochs(db, { owner, namespaces }) {
  const epoch = db.prepare(inspectEpoch);
  return namespaces.map(namespace => Number(epoch.get(...scopeKey({ owner, namespace }))?.epoch ?? 1));
}

/** @param {Connection} db @param {ContextReadSet} readSet */
export function namespaceCardGenerations(db, { owner, namespaces }) {
  return namespaces.map(namespace => readCardGeneration(db, { owner, namespace }));
}

/** @param {Connection} db @param {ContextReadSet} readSet */
export function contextEpochs(db, readSet) {
  const { owner } = readSet;
  const raw = Number(db.prepare(inspectEpoch).get(ownerKey(owner), RAW_INSPECT_EPOCH_KEY)?.epoch ?? 0);
  const suppression = String(db.prepare("SELECT epoch FROM cairn_suppression_epochs WHERE owner_id = ?")
    .get(owner)?.epoch ?? "0");
  return { canonical: namespaceEpochs(db, readSet), suppression, raw };
}

/** @param {CallOptions} options @param {() => number} monotonicMs */
export function contextDeadline({ signal, deadlineAtMs = Infinity }, monotonicMs) {
  return () => Boolean(signal?.aborted) || monotonicMs() >= deadlineAtMs;
}
