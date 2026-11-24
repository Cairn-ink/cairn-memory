import { CoreError } from "@cairn-ink/core";
import { RAW_INSPECT_EPOCH_KEY } from "./schema/inspect.mjs";
import { ownerKey, scopeKey } from "./storage-values.mjs";

/** @import { CallOptions, ContextReadSet } from "@cairn-ink/core/ports" */
/** @import { Connection } from "./storage-values.mjs" */

/** @param {Connection} db @param {ContextReadSet} readSet */
export function contextEpochs(db, { owner, namespaces }) {
  const epoch = db.prepare("SELECT epoch FROM cairn_inspect_epochs WHERE owner_id = ? AND namespace_key = ?");
  const raw = Number(epoch.get(ownerKey(owner), RAW_INSPECT_EPOCH_KEY)?.epoch ?? 0);
  const canonical = namespaces.map(namespace => Number(epoch.get(...scopeKey({ owner, namespace }))?.epoch ?? 1));
  const suppression = String(db.prepare("SELECT epoch FROM cairn_suppression_epochs WHERE owner_id = ?")
    .get(owner)?.epoch ?? "0");
  return { canonical, suppression, raw };
}

/** @param {ReturnType<typeof contextEpochs>} epochs */
export function evidenceEpochs({ canonical, raw }) {
  return canonical.map(epoch => {
    const combined = epoch + raw;
    if (!Number.isSafeInteger(combined)) throw new CoreError("storage_error");
    return combined;
  });
}

/** @param {CallOptions} options @param {() => number} monotonicMs */
export function contextDeadline({ signal, deadlineAtMs = Infinity }, monotonicMs) {
  return () => Boolean(signal?.aborted) || monotonicMs() >= deadlineAtMs;
}
