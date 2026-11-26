import { hostCaptureEffects, nodeHostWriteContext } from "./host-write-context.mjs";
import { CoreError } from "@cairn-ink/core";
import { receiptAddressKey } from "./receipt-read-safety.mjs";
import { createHookAuthorizer, hostOperation, hostReceipt } from "../../core/src/service/entry.mjs";

/** @import { HostWriteHookPort, Scope, Tx } from "@cairn-ink/core/ports" */
/** @import { State } from "./unit-of-work.mjs" */
/** @import { MemoryHostHookTable } from "./index.d.mts" */

/** @param {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>} work
 * @param {ReturnType<typeof import("./raw.mjs").createRawPorts> | undefined} raw */
export function createMemoryHostWriteHooks({ uow, port, hostRead, hostWrite }, raw) {
  /** @type {HostWriteHookPort["priorReceipts"]} */
  const priorReceipts = (tx, scope, id) => port.read(tx, scope,
    getState => (getState().rows.get(scope.namespace)?.get(id)?.receipts ?? []).map(hostReceipt), true);
  /** @type {WeakMap<Tx, ((state: State, indexRevision: number) => void)[]>} */
  const finalizers = new WeakMap();
  const authority = createHookAuthorizer();

  /** @type {HostWriteHookPort} */
  const hookPort = {
    context: nodeHostWriteContext,
    bindHookAuthority: authority.bind,
    priorReceipts,

    async predecessorEvidence(tx, scope, id) {
      const active = await priorReceipts(tx, scope, id);
      const affectedMessages = raw ? await port.read(tx, scope, async getState => {
        const output = [];
        const state = getState();
        for (const { client, sessionId, messageId, role } of active) {
          const row = await raw.findVisibleSource(state, scope, { client, sessionId, messageId });
          if (row?.role === role) output.push({ client, sessionId, messageId });
        }
        return output;
      }, true) : [];
      return { priorReceipts: active, affectedMessages };
    },

    async beginCapture(tx, { scope }) {
      if (tx.readOnly) throw new CoreError("internal_error");
      await port.read(tx, scope, () => {
        if (hostCaptureEffects.has(tx)) throw new CoreError("internal_error");
        hostCaptureEffects.set(tx, []);
      }, true);
    },

    async captureWrites(tx, { scope }, result) {
      return port.read(tx, scope, () => {
        const effects = hostCaptureEffects.get(tx);
        if (!effects || effects.length !== result.memories.length) throw new CoreError("internal_error");
        return effects;
      }, true);
    },

    async captureSources(tx, { scope }, sources, messages) {
      if (!raw) return [];
      return port.read(tx, scope, async getState => {
        const state = getState();
        const verified = [];
        for (const source of sources) {
          if (state.receiptDenials.size && state.receiptDenials.has(await receiptAddressKey(scope.namespace, source))) continue;
          const row = await raw.findVisibleSource(state, scope, source);
          if (row?.content && row.content === messages[source.position].content &&
              row.role === source.role && row.occurredAtMs === source.occurredAtMs &&
              await raw.sourceLineageVisible(state, scope, row)) verified.push(source);
        }
        return verified;
      }, true);
    },

    async finalizeCapture(tx, { scope }, result, indexRevision) {
      // The Memory UoW also stamps the stored finish with this revision at commit.
      await port.read(tx, scope, () => { result.indexRevision = indexRevision; }, true);
    },

    async finalizeSave(tx, { scope }, indexRevision) {
      await port.write(tx, scope, "conditional", () => (getState, _markDirty, run) => {
        const pending = finalizers.get(tx);
        if (!pending) return;
        finalizers.delete(tx);
        for (const finalize of pending) finalize(getState(), indexRevision);
        run.stateWritten = true;
      }, true);
    },

    statementFailure() { return undefined; },
  };

  /** @returns {MemoryHostHookTable} */
  function createTable() {
    if (nodeHostWriteContext.getStore()) throw new CoreError("storage_transaction_active");
    const table = crypto.randomUUID();
    /** @param {State} state @param {Scope} scope @param {string} key @param {unknown} value */
    function set(state, scope, key, value) {
      const tables = state.hostTables ??= new Map();
      let namespaces = tables.get(table);
      if (!namespaces) tables.set(table, namespaces = new Map());
      let rows = namespaces.get(scope.namespace);
      if (!rows) namespaces.set(scope.namespace, rows = new Map());
      rows.set(key, value);
    }
    /** @param {State} state @param {Scope} scope @param {string} key */
    const read = (state, scope, key) => structuredClone(state.hostTables?.get(table)?.get(scope.namespace)?.get(key));
    /** @type {MemoryHostHookTable} */
    const fixture = {
      get(tx, scope, key) {
        return hostOperation(authority.authorize, tx, scope, "read", bound => hostRead(tx, bound, false, getState => read(getState(), bound, key), true));
      },
      put(tx, scope, key, value, indexed = false) {
        const copy = structuredClone(value);
        return hostOperation(authority.authorize, tx, scope, "write", bound => hostWrite(tx, bound, "conditional", () => (getState, _markDirty, run) => {
          set(getState(), bound, key, copy);
          run.stateWritten = true;
          if (indexed) run.cardWrites++;
        }, true));
      },
      stageSave(tx, scope, key, value) {
        const copy = structuredClone(value);
        return hostOperation(authority.authorize, tx, scope, "finalizeSave", async bound => {
          const pending = finalizers.get(tx) ?? [];
          pending.push((state, indexRevision) => set(state, bound, key, { value: copy, indexRevision }));
          finalizers.set(tx, pending);
        });
      },
      inspect(scope, key) {
        return uow.run(scope.owner, { readOnly: true }, tx => port.read(tx, scope, getState => read(getState(), scope, key)));
      },
    };
    return Object.freeze(fixture);
  }

  return { port: Object.freeze(hookPort), createTable };
}
