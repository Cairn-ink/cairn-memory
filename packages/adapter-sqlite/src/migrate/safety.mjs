import { factBody, factIncarnationBody, validateSuppressionFact } from "@cairn-ink/core";
import { refuse } from "../legacy/migration-input.mjs";
import { scopeKey, sha256 } from "../storage-values.mjs";
import { factSlot } from "../suppressions.mjs";

/** @import { SQLInputValue } from "node:sqlite" */
/** @import { LegacyInput, LegacySafetyFact } from "../legacy/migration-input.mjs" */
/** @import { FactOrigin, Scope } from "@cairn-ink/core" */

/** @param {{epoch_hi: bigint, epoch_lo: bigint}} row */
export const legacyEpoch = ({ epoch_hi, epoch_lo }) => (epoch_hi << 32n) | epoch_lo;

/** @param {LegacySafetyFact} row @returns {FactOrigin} */
function origin(row) {
  if (row.evidence_origin === "canonical-tombstone") return "backfill";
  if (row.reason === "user_forget") return "forget";
  if (row.reason === "correction_supersession") return "correct";
  return "import";
}

/** @param {LegacySafetyFact} row @param {Scope} scope */
function memoryFact(row, scope) {
  let throughRevision;
  if (row.match_mode === "revision-through") {
    const selector = JSON.parse(row.source_version);
    if (!Array.isArray(selector) || selector.length !== 2 || selector[0] !== "memory-revision-through-v1" ||
        !Number.isSafeInteger(selector[1]) || selector[1] < 1) {
      refuse("legacy_safety_unrepresentable");
    }
    throughRevision = selector[1];
  } else if (row.match_mode !== "incarnation") refuse("legacy_safety_unrepresentable");
  return validateSuppressionFact({ ...scope, actionId: row.action_id, origin: origin(row),
    kind: "identity", memoryId: row.stable_key, ...(throughRevision !== undefined && { throughRevision }) });
}

/**
 * Store the source vocabulary with its exact provenance. Supported memory
 * selectors also run in the shared matcher under the corresponding I3 fact.
 * @param {LegacyInput} source @param {(row: Pick<LegacySafetyFact, "owner_id" | "scope" | "project_id">) => Scope} fromNamespace
 * @param {(value: unknown) => string} encode
 */
export function planSafety(source, fromNamespace, encode) {
  /** @type {SQLInputValue[][]} */
  const rows = [];
  /** @type {Map<string, SQLInputValue[]>} */
  const facts = new Map();
  for (const row of source.safety?.facts ?? []) {
    if (row.scope === "owner" || row.kind === "namespace" || row.kind === "owner") refuse("legacy_safety_unrepresentable");
    const scope = fromNamespace(row);
    const keys = scopeKey(scope);
    const epoch = legacyEpoch(row).toString();
    rows.push([...keys, "fact", row.fact_id, epoch, row.reason, row.evidence_origin, encode(row)]);
    if (row.kind !== "memory") continue;
    const fact = memoryFact(row, scope);
    const time = Date.parse(row.recorded_at);
    if (!Number.isSafeInteger(time) || time < 0) refuse("legacy_safety_unrepresentable");
    const slot = factSlot(fact);
    // Source epochs and parallel reasons remain in rows even when they
    // share a single visibility predicate in the I3 matcher.
    facts.set(JSON.stringify([...keys, slot]), [...keys, slot, row.fact_id,
      sha256(factIncarnationBody(fact)), epoch, time, JSON.stringify(fact.actionId), factBody(fact)]);
  }
  for (const row of source.safety?.reservations ?? []) {
    const keys = scopeKey(fromNamespace(row));
    rows.push([...keys, "reservation", JSON.stringify([row.kind, row.stable_key]), null, null, row.evidence_origin, encode(row)]);
  }
  return { rows, facts: [...facts.values()] };
}
