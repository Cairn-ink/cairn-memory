import { CoreError } from "@cairn-ink/core";
import { invalidateRationale, sourceMessageKey } from "./rationale.mjs";
import { copyReceipts, writeNamespace } from "./validation.mjs";

/** @typedef {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>} Unit */
/** @typedef {import("@cairn-ink/conformance/factory").TestHarness} TestHarness */

/** Test fixtures for source messages and otherwise unsupported memory writes.
 * @param {Unit["port"]} port @param {Unit["runSeed"]} runSeed
 * @returns {Required<Pick<TestHarness, "seedRationaleMessage" | "changeRationaleMemory">>}
 */
export function createRationaleHarness(port, runSeed) {
  return {
    async seedRationaleMessage(scope, receipt, text) {
      const namespace = writeNamespace(scope);
      const [source] = copyReceipts([receipt]);
      const key = sourceMessageKey(source);
      if (text !== null && (typeof text !== "string" || !text.length ||
          !/** @type {string & {isWellFormed(): boolean}} */ (text).isWellFormed())) {
        throw new CoreError("invalid_input");
      }
      await runSeed(scope.owner, tx => port(tx, scope, true, state => {
        let messages = state.rationaleMessages.get(namespace);
        if (!messages) state.rationaleMessages.set(namespace, messages = new Map());
        if (text === null) messages.delete(key);
        else messages.set(key, { text, role: source.role, occurredAtMs: source.occurredAtMs });
        for (const [id, { receipts }] of state.rows.get(namespace) ?? []) {
          if (receipts.some(receipt => sourceMessageKey(receipt) === key)) invalidateRationale(state, namespace, id);
        }
      }));
    },

    async changeRationaleMemory(scope, id, change) {
      const namespace = writeNamespace(scope);
      await runSeed(scope.owner, tx => port(tx, scope, true, state => {
        const entries = state.rows.get(namespace);
        const entry = entries?.get(id);
        if (!entry || !entries) throw new CoreError("memory_not_found");
        switch (change) {
          case "revision": entry.row.revision++; break;
          case "content": entry.row.text += " (updated)"; break;
          case "currentness": entry.row.historical = true; break;
          case "receipt-remove": entry.receipts.pop(); break;
          case "namespace": {
            const destination = namespace === null ? "moved" : null;
            let target = state.rows.get(destination);
            if (!target) state.rows.set(destination, target = new Map());
            if (target.has(id)) throw new CoreError("memory_conflict");
            entries.delete(id);
            entry.row.scope.namespace = destination;
            target.set(id, entry);
            break;
          }
          default: throw new CoreError("invalid_input");
        }
        invalidateRationale(state, namespace, id);
      }));
    },
  };
}
