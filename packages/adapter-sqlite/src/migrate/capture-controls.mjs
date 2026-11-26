import { CoreError } from "@cairn-ink/core";
import { decodeJson } from "../memory-rows.mjs";
import { scopeKey } from "../storage-values.mjs";

/** @import { CaptureKey, Scope } from "@cairn-ink/core/ports" */
/** @import { DatabaseSync } from "node:sqlite" */
/** @typedef {Pick<CaptureKey, "scope" | "client">} Selection */
/** @typedef {{ scope: Scope, client: string, storeId: string, targetId: string,
 * expectedControlRevision: number, expectedConsentGeneration: string,
 * expectedNamespaceGeneration: string, expectedRawRevision: number }} ManagedCaptureBinding */
/** @typedef {{ localAuthority?: ManagedCaptureBinding }} CaptureOptions */
/** @typedef {ReturnType<typeof migratedCaptureControls>} MigratedCaptureControls */
/** @typedef {{ owner_id: string, scope: string, project_id: string }} LegacyScope */
/** @typedef {{ scopedCaptureControls: boolean, localRawPrivacy: boolean, placementConversion?: boolean,
 * episodeControls: Array<LegacyScope & { paused: string, enabled: string, generation: string }>,
 * consent: Array<LegacyScope & { client: string, automatic_capture_enabled: string, revision: string,
 * target_id: string, consent_generation: string, raw_notice_version: string | null }>,
 * rawControls: Array<{ owner_id: string, client: string, enabled: string, revision: string }> }} Evidence */

/** @param {Scope} scope */
const scopeId = ({ owner, namespace }) => JSON.stringify([owner, namespace]);
/** @param {LegacyScope} row */
const fromLegacy = row => ({ owner: row.owner_id, namespace: row.scope + "\0" + row.project_id });
/** @param {string} owner @param {string} client */
const rawId = (owner, client) => JSON.stringify([owner, client]);
/** @param {Selection} key */
const consentId = ({ scope, client }) => JSON.stringify([scopeId(scope), client]);

/** @param {Pick<DatabaseSync, "prepare">} db */
export function readMigratedControls(db) {
  const row = db.prepare(`SELECT source_evidence, store_id
    FROM cairn_migration JOIN cairn_store USING (singleton)`).get();
  if (typeof row?.source_evidence !== "string") throw new CoreError("storage_error");
  const evidence = /** @type {Evidence} */ (decodeJson(row.source_evidence));
  if (evidence.scopedCaptureControls === true) return { evidence, storeId: String(row.store_id) };
}

/** @param {ReturnType<typeof readMigratedControls>} controls @param {ManagedCaptureBinding} [binding] */
export function migratedCaptureControls(controls, binding) {
  if (binding !== undefined && (!binding || !binding.scope || typeof binding.scope.owner !== "string" ||
      typeof binding.client !== "string" || typeof binding.storeId !== "string")) throw new CoreError("revision_conflict");
  const authority = binding === undefined ? undefined : { ...binding, scope: { ...binding.scope } };
  const namespaces = new Map(controls?.evidence.episodeControls.map(row => [scopeId(fromLegacy(row)), row]));
  const grants = new Map(controls?.evidence.consent.map(row => [consentId({ scope: fromLegacy(row), client: row.client }), row]));
  const raw = new Map(controls?.evidence.rawControls.map(row => [rawId(row.owner_id, row.client), row]));

  /** @param {Selection} key */
  function assertCapture(key) {
    const { scope, client } = key;
    const namespace = namespaces.get(scopeId(scope));
    const grant = grants.get(consentId(key));
    if (authority && (authority.storeId !== controls?.storeId || authority.client !== client ||
        scopeId(authority.scope) !== scopeId(scope))) throw new CoreError("revision_conflict");
    if (namespace?.paused === "1" || namespace?.enabled === "0" ||
        (authority && grant?.automatic_capture_enabled !== "1")) throw new CoreError("capture_disabled");
    if (authority && grant && (authority.targetId !== grant.target_id ||
        authority.expectedControlRevision !== Number(grant.revision) ||
        authority.expectedConsentGeneration !== grant.consent_generation ||
        authority.expectedNamespaceGeneration !== (namespace?.generation ?? "initial") ||
        authority.expectedRawRevision !== Number(raw.get(rawId(scope.owner, client))?.revision ?? 0))) {
      throw new CoreError("revision_conflict");
    }
  }

  return {
    assertCapture,
    /** @param {Scope} scope */
    rawReadable(scope) {
      const namespace = namespaces.get(scopeId(scope));
      return namespace?.paused !== "1" && namespace?.enabled !== "0";
    },
    /** @param {import("../storage-values.mjs").Connection} db @param {CaptureKey} key */
    assertOpenAdmission(db, { scope, client, eventId }) {
      if (controls && db.prepare(`SELECT 1 FROM cairn_migrated_raw_privacy
        WHERE owner_id=? AND namespace_key=? AND client_key=? AND kind='admission' AND selector=?`)
        .get(...scopeKey(scope), JSON.stringify(client), eventId)) throw new CoreError("capture_evidence_closed");
    },
    /** @param {Selection} key */
    rawDisposition(key) {
      assertCapture(key);
      if (raw.get(rawId(key.scope.owner, key.client))?.enabled === "0") return "tool_off";
      if (authority && grants.get(consentId(key))?.raw_notice_version === null) return "notice_required";
      return null;
    },
  };
}
