import { ledgerDropSelector, ledgerRowKey } from "../../core/src/ledger/index.mjs";
import { refreshFinishRevisions } from "./capture-finish.mjs";
import { guardOwner, inputText, invalid, namespaceKey } from "./memory-input.mjs";
import { advanceIndex, canonicalReceiptId } from "./memory-rows.mjs";
import { runOperation } from "./uow.mjs";

/** @import { Scope, Tx } from "../../core/src/ports/index.d.ts" */
/** @import { QuantityLedgerRow, QuantityLedgerStore } from "../../core/src/ports/quantity-ledger.d.ts" */
/** @import { Query } from "./memory-rows.mjs" */

const SCOPE = "l.user_id = $1 AND l.core_namespace IS NOT DISTINCT FROM $2";
const COLUMNS = `memory_id, receipt_id, source_client, source_session_id, source_message_id,
  ledger_key, text_hash, date_ms, ordinal, kind,
  measure, category, value, unit, quantity_group, period, comparator`;
const INSERT = `INSERT INTO core_quantity_ledger (user_id, core_namespace, ${COLUMNS})
  SELECT $1, $2, ${COLUMNS}
  FROM jsonb_to_recordset($3::jsonb) AS batch(
    memory_id text, receipt_id text, source_client text, source_session_id text, source_message_id text,
    ledger_key text, text_hash text, date_ms bigint, ordinal bigint,
    kind text, measure text, category text, value double precision, unit text, quantity_group text,
    period text, comparator text)
  WHERE NOT EXISTS (SELECT 1 FROM core_quantity_ledger l
    WHERE ${SCOPE} AND l.memory_id = batch.memory_id AND l.ledger_key = batch.ledger_key)
  RETURNING 1`;

const SELECT = `SELECT memory_id AS "memoryId", receipt_id AS "receiptId", text_hash AS "textHash",
  date_ms::text AS date, ordinal::text, kind, measure, category, encode(float8send(value), 'hex') AS value, unit,
  quantity_group AS "group", period, comparator FROM core_quantity_ledger l WHERE ${SCOPE}`;
const ORDER = "ORDER BY date_ms, ledger_key";

/** @param {Query} query @param {string} owner @param {string | null} namespace @param {readonly string[]} memoryIds */
async function receiptSources(query, owner, namespace, memoryIds) {
  const { rows } = await query(`SELECT r.memory_id, r.client, r.session_id, r.message_id
    FROM core_memory_receipts r JOIN memories m ON m.user_id = r.user_id AND m.id = r.memory_id
    WHERE r.user_id = $1 AND m.core_namespace IS NOT DISTINCT FROM $2
      AND r.memory_id = ANY($3::text[]) AND r.forgotten_at IS NULL`, [owner, namespace, memoryIds]);
  return new Map(await Promise.all(rows.map(async ({ memory_id, client, session_id, message_id }) => {
    const id = await canonicalReceiptId(owner, namespace, memory_id, { client, sessionId: session_id, messageId: message_id });
    return /** @type {const} */ ([id, { source_client: client, source_session_id: session_id, source_message_id: message_id }]);
  })));
}

/** @param {Record<string, any>} row @returns {QuantityLedgerRow} */
function readRow(row) {
  // PostgreSQL's float text output can round when extra_float_digits is zero.
  const value = new DataView(new ArrayBuffer(8));
  value.setBigUint64(0, BigInt(`0x${row.value}`));
  return /** @type {QuantityLedgerRow} */ ({ ...row,
    date: Number(row.date), ordinal: Number(row.ordinal), value: value.getFloat64(0),
    measure: JSON.parse(row.measure), category: JSON.parse(row.category), unit: JSON.parse(row.unit),
  });
}

/** @param {readonly QuantityLedgerRow[]} rows */
function encodeBatch(rows) {
  const batch = new Map();
  for (const row of rows) {
    const key = ledgerRowKey(row);
    if (batch.has(key)) continue;
    batch.set(key, {
      memory_id: row.memoryId, receipt_id: row.receiptId, ledger_key: key, text_hash: row.textHash,
      date_ms: row.date, ordinal: row.ordinal, kind: row.kind, quantity_group: row.group,
      period: row.period, comparator: row.comparator, value: Object.is(row.value, -0) ? "-0" : String(row.value),
      // JSON escaping preserves NUL in quantity labels without putting a NUL in PostgreSQL text.
      measure: JSON.stringify(row.measure), category: JSON.stringify(row.category), unit: JSON.stringify(row.unit),
    });
  }
  return [...batch.values()];
}

/** @param {{allowNonNullNamespace?: boolean}} [options] @returns {QuantityLedgerStore} */
export function createPostgresQuantityLedgerStore({ allowNonNullNamespace = false } = {}) {
  /** @param {Tx} tx @param {Scope} scope @param {boolean} [write] @returns {[string, string | null]} */
  function scoped(tx, scope, write) {
    guardOwner(tx, scope, write);
    return [tx.owner, namespaceKey(scope.namespace, allowNonNullNamespace)];
  }

  return {
    async put(tx, scope, rows) {
      const [owner, namespace] = scoped(tx, scope, true);
      if (!rows.length) return { inserted: 0 };
      const batch = encodeBatch(rows);
      return runOperation(tx, async (query, run) => {
        const sources = await receiptSources(query, owner, namespace, [...new Set(batch.map(row => row.memory_id))]);
        const attributed = batch.map(row => ({ ...row, ...sources.get(row.receipt_id) }));
        const { rows: inserted } = await query(INSERT, [owner, namespace, JSON.stringify(attributed)]);
        if (inserted.length) {
          await advanceIndex(query, tx.owner, run, { perCall: true });
          await refreshFinishRevisions(tx, query);
        }
        return { inserted: inserted.length };
      });
    },

    async dropWhere(tx, scope, selector) {
      const by = ledgerDropSelector(selector);
      const values = scoped(tx, scope, true);
      const id = inputText(Object.getOwnPropertyDescriptor(selector, "id")?.value);
      const column = by === "memoryId" ? "memory_id" : "receipt_id";
      return runOperation(tx, async (query, run) => {
        const { rows: dropped } = await query(`DELETE FROM core_quantity_ledger l
          WHERE ${SCOPE} AND l.${column} = $3 RETURNING 1`, [...values, id]);
        if (dropped.length) {
          await advanceIndex(query, tx.owner, run, { perCall: true });
          await refreshFinishRevisions(tx, query);
        }
        return { dropped: dropped.length };
      });
    },

    async listForMemory(tx, scope, memoryId) {
      const values = [...scoped(tx, scope), inputText(memoryId)];
      return runOperation(tx, async query => {
        const { rows } = await query(`${SELECT} AND l.memory_id = $3 ${ORDER}`, values);
        return rows.map(readRow);
      });
    },

    async list(tx, scope, { fromMs, toMs }) {
      const values = scoped(tx, scope);
      if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs)) invalid();
      return runOperation(tx, async query => {
        const { rows } = await query(`${SELECT} AND l.date_ms >= $3 AND l.date_ms < $4 ${ORDER}`,
          [...values, fromMs, toMs]);
        return rows.map(readRow);
      });
    },

    async terms(tx, scope) {
      const values = scoped(tx, scope);
      return runOperation(tx, async query => {
        const { rows } = await query(`SELECT DISTINCT t.term COLLATE "C" AS term
          FROM core_quantity_ledger l JOIN memories m
            ON m.user_id = l.user_id AND m.core_namespace IS NOT DISTINCT FROM l.core_namespace AND m.id = l.memory_id
          CROSS JOIN LATERAL (VALUES (l.measure), (l.category), (to_json(l.quantity_group)::text)) AS t(term)
          WHERE ${SCOPE} AND m.currentness = 'current' ORDER BY term`, values);
        return rows.map(({ term }) => JSON.parse(term));
      });
    },
  };
}
