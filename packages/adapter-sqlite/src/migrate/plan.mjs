import { normalizeForHash, prepareCoreText } from "@cairn-ink/core";
import { legacyIdentifier, refuse } from "../legacy/migration-input.mjs";
import { encodeContent, scopeKey, sha256 } from "../storage-values.mjs";
import { createRawLineage } from "../raw-lineage.mjs";
import { sessionHasher } from "../suppressions.mjs";
import { legacyEpoch, planSafety } from "./safety.mjs";

/** @import { SQLInputValue } from "node:sqlite" */
/** @import { LegacyInput, LegacyMemory } from "../legacy/migration-input.mjs" */
/** @import { InsertRow, Scope } from "@cairn-ink/core/ports" */

/** @param {{ owner_id: string, scope: string, project_id: string }} row @returns {Scope} */
function fromNamespace({ owner_id, scope, project_id }) {
  if (scope === "project") legacyIdentifier(project_id);
  else if (scope !== "personal" || project_id !== "") refuse("legacy_incomplete");
  return { owner: legacyIdentifier(owner_id), namespace: scope + "\0" + project_id };
}

/** @param {string} value */
function timestamp(value) {
  const parts = /^((?:\d{4}|[+-]\d{6})-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?Z$/u.exec(value);
  if (!parts) return refuse("legacy_incomplete");
  const whole = Date.parse(parts[1] + ".000Z");
  if (!Number.isSafeInteger(whole) || whole < 0 ||
      new Date(whole).toISOString() !== parts[1] + ".000Z") return refuse("legacy_incomplete");
  const us = BigInt(whole) * 1000n + BigInt((parts[2] ?? "").padEnd(6, "0"));
  if (us > 9223372036854775807n) return refuse("legacy_incomplete");
  return us;
}

/** @param {bigint} value */
function safeRevision(value) {
  if (value < 1n || value >= BigInt(Number.MAX_SAFE_INTEGER)) refuse("legacy_incomplete");
  return Number(value);
}

/** @param {unknown} value */
export function encodeEvidence(value) {
  return JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item);
}

/** @param {LegacyMemory} row @param {Set<string> | undefined} denials @param {boolean} provenHistory */
function memoryValues(row, denials, provenHistory) {
  const scope = fromNamespace(row);
  const historical = row.currentness === "historical";
  const deleted = row.deleted === 1n;
  const created = timestamp(row.created_at);
  const updated = timestamp(row.updated_at);
  const prefix = [...scopeKey(scope), legacyIdentifier(row.id), safeRevision(row.revision),
    created / 1000n, updated, Number(historical), Number(deleted)];
  if (deleted) return [...prefix, null, null, null];
  if (row.review_state === "awaiting" || !row.content || /[\u0000\uD800-\uDFFF]/u.test(row.content) ||
      sha256(row.content.toLowerCase()) !== row.fingerprint) {
    return refuse("legacy_incomplete");
  }

  const text = row.content;
  const textHash = "sha256:" + sha256(normalizeForHash(prepareCoreText(text)));
  const origin = row.origin === "explicit" ? "explicit" : "inferred";
  const { body } = encodeContent({
    text, textHash, kind: /** @type {InsertRow["kind"]} */ (row.kind), origin, confidence: row.confidence,
    source: { kind: origin === "explicit" ? "mcp" : "capture", client: null, sessionId: null },
    embedding: null,
  });
  // Retired history consumes the old fingerprint for admission but retains
  // that very revision for history. Other denials must still apply.
  const historyHash = historical && provenHistory && denials?.has(row.fingerprint) ? row.fingerprint : undefined;
  if ((denials?.has(row.fingerprint) && !historyHash) ||
      body.digests.some(({ value }) => value !== historyHash && denials?.has(value))) refuse("legacy_incomplete");
  const time = { createdAt: row.created_at, updatedAt: row.updated_at };
  return [...prefix, textHash, "sha256:" + row.fingerprint, JSON.stringify({ ...body, time, historyHash })];
}

/** @param {LegacyInput} source */
export function planMigration(source) {
  const { memories, receipts, denials, namespaceEpochs, history, episodeControls, consent, rawControls } = source;
  /** @type {Map<string, { denials: bigint, epoch: bigint, generation: number }>} */
  const owners = new Map();
  /** @param {string} owner */
  const ownerState = owner => {
    legacyIdentifier(owner);
    const state = owners.get(owner) ?? { denials: 0n, epoch: 0n, generation: 1 };
    owners.set(owner, state);
    return state;
  };
  /** @type {Map<string, Set<string>>} */
  const byScope = new Map();
  const markers = denials.map(row => {
    const keys = scopeKey(fromNamespace(row));
    const state = ownerState(keys[0]);
    const key = JSON.stringify(keys);
    const set = byScope.get(key) ?? new Set();
    set.add(row.fingerprint);
    byScope.set(key, set);
    state.denials++;
    return [...keys, row.fingerprint];
  });
  for (const row of namespaceEpochs) {
    const { owner } = fromNamespace(row);
    const state = ownerState(owner);
    if (row.epoch > state.epoch) state.epoch = row.epoch;
  }
  for (const row of episodeControls) {
    ownerState(fromNamespace(row).owner);
    legacyIdentifier(row.generation);
  }
  for (const row of [...consent, ...rawControls]) {
    if ("scope" in row) fromNamespace(row);
    const state = ownerState(row.owner_id);
    state.generation = Math.max(state.generation, safeRevision(row.revision));
  }
  const byId = new Map(memories.map(row => [row.id, row]));
  const retired = new Set(history.map(row => {
    const previous = byId.get(row.previous_memory_id);
    const replacement = byId.get(row.replacement_memory_id);
    const key = JSON.stringify(fromNamespace(row));
    if (!previous || !replacement || JSON.stringify(fromNamespace(previous)) !== key ||
        JSON.stringify(fromNamespace(replacement)) !== key || previous.currentness !== "historical" ||
        previous.revision <= row.previous_revision || replacement.revision < row.replacement_revision) {
      refuse("legacy_incomplete");
    }
    return previous.id;
  }));
  const tombstoneHashes = new Set(memories.filter(row => row.deleted === 1n).map(row =>
    JSON.stringify([...scopeKey(fromNamespace(row)), row.fingerprint])));
  const memoryRows = memories.map(row => {
    const scope = fromNamespace(row);
    ownerState(scope.owner);
    const keys = scopeKey(scope);
    const proven = retired.has(row.id) && !tombstoneHashes.has(JSON.stringify([...keys, row.fingerprint]));
    return memoryValues(row, byScope.get(JSON.stringify(keys)), proven);
  });

  /** @type {Map<string, { ordinal: number, addresses: Set<string> }>} */
  const receiptOrder = new Map();
  const withheldReceipts = source.withheldReceipts;
  /** @type {SQLInputValue[][]} */
  const receiptRows = [];
  for (const row of receipts) {
    const memory = byId.get(row.memory_id);
    if (!memory || memory.deleted === 1n) return refuse("legacy_incomplete");
    const keys = scopeKey(fromNamespace(memory));
    const client = legacyIdentifier(row.client);
    const sessionId = legacyIdentifier(row.session_id);
    const messageId = legacyIdentifier(row.event_id);
    timestamp(row.created_at);
    const eventKey = JSON.stringify([client, sessionId, messageId]);
    const state = receiptOrder.get(row.memory_id) ?? { ordinal: 0, addresses: new Set() };
    const id = legacyIdentifier(row.id);
    const sourceKey = state.addresses.has(eventKey) ? JSON.stringify([client, sessionId, messageId, id]) : eventKey;
    state.addresses.add(eventKey);
    receiptOrder.set(row.memory_id, state);
    const body = { client, sessionId, messageId, role: row.role, occurredAtMs: null,
      legacy: { id, excerpt: row.excerpt, createdAt: row.created_at, canonicalRead: true,
        spans: source.archive.spans.get(id) } };
    receiptRows.push([...keys, row.memory_id, ++state.ordinal, sourceKey, row.receipt_key, JSON.stringify(body)]);
  }
  const epochs = Array.from(owners, ([owner, state]) =>
    [owner, (state.epoch > state.denials ? state.epoch : state.denials).toString()]);
  const ownerEpochs = source.safety ? source.safety.epochs.map(row =>
    [legacyIdentifier(row.owner_id), legacyEpoch(row).toString()]) : epochs;
  const safety = planSafety(source, fromNamespace, encodeEvidence);
  // An unlisted namespace is enabled in the legacy store. No scoped row
  // proves that even a newly created namespace must be paused.
  const pause = Array.from(owners, ([owner, state]) => [owner, 0, state.generation]);
  const revisions = Array.from(owners.keys(), owner => [owner, 1]);
  const archiveKey = source.rawPrivacy?.key;
  const lineage = archiveKey ? createRawLineage(archiveKey, sessionHasher(archiveKey, true)) : null;
  const anchors = lineage ? source.archive.anchors.flatMap(({ scope, client, sessionId, message }) =>
    lineage.anchorRows(scope, { client, sessionId }, [message])) : [];
  const closed = new Map();
  for (const row of [...source.admissions, ...source.registered]) {
    const tuple = [...scopeKey(fromNamespace(row)), JSON.stringify(legacyIdentifier(row.client)),
      "admission", legacyIdentifier(row.event_id), "null"];
    closed.set(JSON.stringify(tuple), tuple);
  }
  const ledger = { closed: closed.size, completed: 0, invalidated: 0, registered: source.registered.length };
  for (const { state } of source.admissions) {
    if (state === "completed") ledger.completed++;
    else ledger.invalidated++;
  }
  return {
    memoryRows, receiptRows, markers, epochs: ownerEpochs, pause, revisions, withheldReceipts,
    anchors, closed: [...closed.values()], ledger, safety,
    evidence: encodeEvidence({ history, namespaceEpochs, episodeControls, consent, rawControls, scopedCaptureControls: true, withheldReceipts,
      legacyRawHashing: source.rawPrivacy !== null, localRawPrivacy: source.localRawPrivacy, rawDeletionActions: source.rawPrivacy?.actions ?? [],
      rawDeletionEffects: source.rawPrivacy?.effects ?? [], archived: source.archive.counts, ledger, dropped: source.dropped }),
    pausedOwners: pause.filter(([, paused]) => paused === 1).map(([owner]) => String(owner)).sort(),
  };
}
