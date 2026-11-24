import { RAW_INSPECT_EPOCH_KEY } from "./schema/inspect.mjs";
import { ownerKey, scopeKey } from "./storage-values.mjs";

/** @import { CallOptions, ContextReadSet } from "@cairn-ink/core/ports" */
/** @import { Connection } from "./storage-values.mjs" */

const inspectEpoch = "SELECT epoch FROM cairn_inspect_epochs WHERE owner_id = ? AND namespace_key = ?";

/** @param {Connection} db @param {ContextReadSet} readSet */
export function namespaceEpochs(db, { owner, namespaces }) {
  const epoch = db.prepare(inspectEpoch);
  return namespaces.map(namespace => Number(epoch.get(...scopeKey({ owner, namespace }))?.epoch ?? 1));
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
