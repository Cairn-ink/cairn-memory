import { hostCaptureEffects } from "./host-write-context.mjs";
import { CoreError } from "../../core/src/index.mjs";
import { assertOutsideHostWriteHook, createHookAuthorizer, hostOperation, hostReceipt, registerHostWriteContext } from "../../core/src/service/entry.mjs";
import { requireHostFinish } from "./capture-finish.mjs";
import { namespaceKey } from "./memory-input.mjs";
import { advanceIndex, decodeReceipts, memoryReceiptsSql } from "./memory-rows.mjs";
import { createRawVisibility } from "./raw-visibility.mjs";
import { isReadStatement } from "./read-only.mjs";
import { requireLiveRun, runHostOperation, runOperation } from "./uow.mjs";

/** @import { HostWriteHookPort, Scope, Tx } from "../../core/src/ports/index.d.ts" */
/** @import { PostgresHostOperation, createPostgresHostWriteHookPort as createPort } from "./host-write-hooks.d.mts" */

const SCOPED_RECEIPTS = memoryReceiptsSql(`ARRAY(SELECT id FROM memories WHERE user_id = $1
  AND core_namespace IS NOT DISTINCT FROM $2 AND id = $3)`);

/** @param {Tx} tx @param {Scope} scope */
function requireWrite(tx, scope) {
  const run = requireLiveRun(tx, true);
  if (!run.pauseLock || tx.owner !== scope.owner) throw new CoreError("internal_error");
  return run;
}

/** @type {HostWriteHookPort["priorReceipts"]} */
export function readHostReceipts(tx, scope, id) {
  requireWrite(tx, scope);
  return runOperation(tx, async query => {
    const { rows } = await query(SCOPED_RECEIPTS, [tx.owner, namespaceKey(scope.namespace, true), id]);
    return (decodeReceipts(rows).get(id) ?? []).map(hostReceipt);
  });
}

/** @param {PostgresHostOperation} operation */
function copyOperation({ sql, mode }) {
  // SQL is registered by the trusted adapter composition. Callbacks supply only bound values.
  const read = mode === "read";
  if (typeof sql !== "string" || !/\$1\b/.test(sql) || !/\$2\b/.test(sql) ||
      sql.includes(";") || (read ? !isReadStatement(sql, false)
        : !["write", "indexed", "finalizeSave"].includes(mode) || !/^\s*(INSERT|UPDATE|DELETE|MERGE)\b/i.test(sql))) {
    throw new CoreError("invalid_input");
  }
  return { sql, mode };
}

/** @type {typeof createPort} */
export function createPostgresHostWriteHookPort({ context, operations = {}, rawVisibility }) {
  const statements = new Map(Object.entries(operations).map(([name, operation]) => [name, copyOperation(operation)]));
  const raw = rawVisibility && createRawVisibility(rawVisibility);
  registerHostWriteContext(context);
  const authority = createHookAuthorizer();
  /** @type {WeakMap<Tx, {sql: string, values: unknown[]}[]>} */
  const staged = new WeakMap();

  return Object.freeze(/** @type {ReturnType<createPort>} */ ({
    execute(tx, scope, name, values = []) {
      const operation = statements.get(name);
      const params = structuredClone([...values]);
      return hostOperation(authority.authorize, tx, scope, operation?.mode === "read" ? "read" : "write", bound => {
        requireWrite(tx, bound);
        if (!operation || operation.mode === "finalizeSave") throw new CoreError("host_write_hook_failed");
        return runHostOperation(tx, async (query, run) => {
          const result = await query(operation.sql, [tx.owner, namespaceKey(bound.namespace, true), ...params]);
          if (operation.mode === "indexed" && result.rowCount !== 0) await advanceIndex(query, tx.owner, run, { perCall: true });
          return result;
        });
      });
    },

    stageSave(tx, scope, name, values = []) {
      const operation = statements.get(name);
      const params = structuredClone([...values]);
      return hostOperation(authority.authorize, tx, scope, "finalizeSave", async bound => {
        requireWrite(tx, bound);
        if (operation?.mode !== "finalizeSave") throw new CoreError("host_write_hook_failed");
        const pending = staged.get(tx) ?? [];
        pending.push({ sql: operation.sql, values: params });
        staged.set(tx, pending);
      });
    },

    transactionIsolation(tx, scope) {
      return hostOperation(authority.authorize, tx, scope, "read", bound => {
        requireWrite(tx, bound);
        return runHostOperation(tx, async query => {
          const { rows } = await query("SHOW transaction_isolation");
          if (typeof rows[0]?.transaction_isolation !== "string") throw new CoreError("internal_error");
          return rows[0].transaction_isolation;
        });
      });
    },

    context,
    bindHookAuthority: authority.bind,
    priorReceipts: readHostReceipts,

    async predecessorEvidence(tx, scope, id) {
      const priorReceipts = await readHostReceipts(tx, scope, id);
      if (!raw || scope.namespace !== null || !priorReceipts.length) return { priorReceipts, affectedMessages: [] };
      const affectedMessages = await runOperation(tx, async query => {
        const { rows } = await query(`SELECT DISTINCT r.client, r.session_id AS "sessionId", r.message_id AS "messageId"
          FROM raw_messages r JOIN core_memory_receipts p ON (r.user_id, r.client, r.session_id, r.message_id, r.role)
            = (p.user_id, p.client, p.session_id, p.message_id, p.role)
          WHERE r.user_id = $1 AND p.memory_id = $2 AND p.forgotten_at IS NULL ORDER BY 1, 2, 3`, [tx.owner, id]);
        return rows;
      });
      return { priorReceipts, affectedMessages };
    },

    async beginCapture(tx, { scope }) {
      assertOutsideHostWriteHook();
      requireWrite(tx, scope);
      if (hostCaptureEffects.has(tx)) throw new CoreError("internal_error");
      hostCaptureEffects.set(tx, []);
    },

    async captureWrites(tx, key, result) {
      assertOutsideHostWriteHook();
      requireWrite(tx, key.scope);
      requireHostFinish(tx, key, result);
      const effects = hostCaptureEffects.get(tx);
      if (!effects || effects.length !== result.memories.length) throw new CoreError("internal_error");
      return effects;
    },

    async captureSources(tx, { scope, client, sessionId }, sources, messages) {
      requireWrite(tx, scope);
      if (scope.namespace !== null || !sources.length) return [];
      if (!raw) throw new CoreError("capability_unavailable");
      return runOperation(tx, async query => {
        const visibility = await raw(query, scope.owner, [client]);
        if (visibility.withheldClients.includes(client)) return [];
        const { rows } = await query(`SELECT r.id, r.message_id, r.role, r.content,
              (EXTRACT(EPOCH FROM r.occurred_at) * 1000)::text AS occurred_ms
          FROM raw_messages r WHERE r.user_id = $1 AND r.client = $2 AND r.session_id = $3
            AND r.message_id = ANY($4::text[])
            AND (r.client, r.session_id) NOT IN (
              SELECT client, session_id FROM jsonb_to_recordset($5::jsonb) AS f(client text, session_id text))
            AND NOT EXISTS (SELECT 1 FROM core_memory_receipts p
              WHERE (p.user_id, p.client, p.session_id, p.message_id) =
                (r.user_id, r.client, r.session_id, r.message_id) AND p.forgotten_at IS NOT NULL)`,
        [scope.owner, client, sessionId, sources.map(source => source.messageId), visibility.sessions]);
        const persisted = new Map(rows.map(row => [row.message_id, row]));
        const verified = [];
        for (const source of sources) {
          const row = persisted.get(source.messageId);
          const archived = messages[source.position];
          if (!row || row.role !== source.role || row.content !== archived.content || !row.content ||
              (row.occurred_ms === null ? null : Number(row.occurred_ms)) !== source.occurredAtMs) continue;
          const visible = await visibility.visibleBatch([{
            ref: { type: "raw", id: row.id, namespace: null }, client, sessionId, messageId: source.messageId,
            role: row.role, content: row.content, occurredAtMs: source.occurredAtMs, score: 0,
          }]);
          if (visible.length) verified.push(source);
        }
        return verified;
      });
    },

    async finalizeCapture(tx, key, result, indexRevision) {
      requireWrite(tx, key.scope);
      requireHostFinish(tx, key, result);
      await runOperation(tx, async query => {
        const { rows } = await query(`UPDATE capture_events SET core_result = jsonb_set(core_result, '{indexRevision}', to_jsonb($6::bigint))
          WHERE user_id = $1 AND core_namespace IS NOT DISTINCT FROM $2 AND client = $3 AND session_id = $4
            AND event_id = $5 AND status = 'completed' RETURNING 1`,
        [tx.owner, key.scope.namespace, key.client, key.sessionId, key.eventId, indexRevision]);
        if (rows.length !== 1) throw new CoreError("internal_error");
        result.indexRevision = indexRevision;
      });
    },

    async finalizeSave(tx, { scope }, indexRevision) {
      assertOutsideHostWriteHook();
      requireWrite(tx, scope);
      const pending = staged.get(tx);
      if (!pending) return;
      staged.delete(tx);
      await runOperation(tx, async query => {
        for (const operation of pending) await query(operation.sql, [tx.owner, namespaceKey(scope.namespace, true),
          indexRevision, ...operation.values]);
      });
    },

    statementFailure(tx) {
      return requireLiveRun(tx, true).statementFailure;
    },
  }));
}
