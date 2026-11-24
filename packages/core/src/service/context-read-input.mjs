import { identifier, isWellFormedText, revision, validateDenseArray, validateObject } from "../capture/validate.mjs";
import { CoreError } from "../errors.mjs";
import { compareUtf8 } from "../utf8.mjs";
import { scopeOf } from "./entry.mjs";

/** @import { Scope } from "../ports/common.d.ts" */
/** @import { ContextReadIntent, ContextReadRef, ContextReadSet, ContextReadType, FetchEvidenceInput,
  FindCandidatesInput } from "../ports/host.d.ts" */

export const CONTEXT_HORIZON = 24;
const readTypes = /** @type {const} */ (["memory", "card"]);

/** @param {Scope} scope */
export function legacyNamespace({ owner, namespace }) {
  if (namespace === null || namespace === "personal\0") {
    return { ownerId: owner, scope: "personal", projectId: null };
  }
  if (namespace.startsWith("project\0")) {
    return { ownerId: owner, scope: "project", projectId: identifier(namespace.slice(8)) };
  }
  throw new CoreError("invalid_input");
}

/** @param {Scope} scope */
function namespaceOrder(scope) {
  const { ownerId, scope: kind, projectId } = legacyNamespace(scope);
  return JSON.stringify([ownerId, kind, projectId]);
}

/** @param {unknown} value @returns {ContextReadSet} */
export function contextReadSet(value) {
  try {
    const { owner: suppliedOwner, namespaces, accessGenerations } = validateObject(value,
      ["owner", "namespaces", "accessGenerations"]);
    const owner = identifier(suppliedOwner);
    const slots = validateDenseArray(namespaces, 1, 2);
    const generations = validateDenseArray(accessGenerations, slots.length, slots.length);
    const pairs = slots.map((namespace, i) => {
      const scoped = scopeOf({ owner, namespace });
      return { namespace: scoped.namespace, order: namespaceOrder(scoped), generation: generation(generations[i]) };
    }).sort((left, right) => compareUtf8(left.order, right.order));
    if (pairs.length === 2 && (!pairs[1].namespace?.startsWith("project\0") ||
      (pairs[0].namespace !== null && pairs[0].namespace !== "personal\0"))) {
      throw new CoreError("invalid_input");
    }
    return { owner, namespaces: pairs.map(pair => pair.namespace), accessGenerations: pairs.map(pair => pair.generation) };
  } catch {
    throw new CoreError("authority_required");
  }
}

/** @param {unknown} value */
export function generation(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new CoreError("invalid_input");
  return value;
}

/** @param {unknown} value @returns {ContextReadIntent} */
export function intentOf(value) {
  if (value !== "current" && value !== "history") throw new CoreError("invalid_input");
  return value;
}

/** @param {unknown} value @param {number} fallback @param {number} maximum */
function boundedInteger(value, fallback, maximum) {
  if (value === undefined) return fallback;
  const number = revision(value);
  if (number > maximum) throw new CoreError("invalid_input");
  return number;
}

/** @param {unknown} value @returns {FindCandidatesInput & { semantic: boolean, limit: number, deadlineMs: number }} */
export function findCandidatesInput(value) {
  const { query, types, intent, semantic, limit, deadlineMs, cursor } = validateObject(value,
    ["query", "types", "intent", "semantic", "limit", "deadlineMs", "cursor"]);
  const selected = validateDenseArray(types, 1, readTypes.length);
  const normalized = readTypes.filter(type => selected.includes(type));
  if (normalized.length !== selected.length || !isWellFormedText(query) || query.includes("\0") ||
      !query.trim() || query.length > 4000 || (semantic !== undefined && typeof semantic !== "boolean")) {
    throw new CoreError("invalid_input");
  }
  if (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 8192)) throw new CoreError("invalid_cursor");
  return { query, types: normalized, intent: intentOf(intent), semantic: semantic ?? false,
    limit: boundedInteger(limit, 12, CONTEXT_HORIZON), deadlineMs: boundedInteger(deadlineMs, 1000, 5000), cursor };
}

/** @param {ContextReadSet} readSet @param {Scope} scope */
export function namespaceSlot(readSet, scope) {
  return readSet.owner === scope.owner ? readSet.namespaces.indexOf(scope.namespace) : -1;
}

/** @param {ContextReadRef} ref */
export function itemRef({ type, scope, id }) {
  return { type, namespace: scope.namespace, id };
}

/** @param {unknown} values @param {ContextReadSet} readSet @returns {ContextReadRef[]} */
export function qualifiedRefs(values, readSet) {
  const parsed = validateDenseArray(values, 1, CONTEXT_HORIZON).map(value => {
    const data = validateObject(value, ["scope", "type", "id", "revision", "bodyRevision"]);
    const scope = scopeOf(data.scope);
    if (namespaceSlot(readSet, scope) < 0) throw new CoreError("authority_required");
    const common = { scope, id: identifier(data.id), revision: revision(data.revision) };
    if (data.type === "card") return { type: /** @type {const} */ ("card"), ...common, bodyRevision: revision(data.bodyRevision) };
    if (data.type !== "memory" || Object.hasOwn(data, "bodyRevision")) throw new CoreError("invalid_input");
    return { type: /** @type {const} */ ("memory"), ...common };
  });
  if (new Set(parsed.map(ref => JSON.stringify(itemRef(ref)))).size !== parsed.length) throw new CoreError("invalid_input");
  return parsed;
}

/** @param {unknown} value @param {ContextReadSet} readSet @returns {FetchEvidenceInput & {responseByteLimit: number}} */
export function fetchEvidenceInput(value, readSet) {
  const data = validateObject(value, ["refs", "intent", "fences", "snapshot", "responseByteLimit"]);
  const responseByteLimit = boundedInteger(data.responseByteLimit, 65536, 65536);
  if (Object.hasOwn(data, "snapshot")) {
    if (["refs", "intent", "fences"].some(key => Object.hasOwn(data, key)) ||
        typeof data.snapshot !== "string" || data.snapshot.length > 16384) throw new CoreError("invalid_input");
    return { snapshot: data.snapshot, responseByteLimit };
  }
  const refs = qualifiedRefs(data.refs, readSet);
  const fences = Object.hasOwn(data, "fences") ?
    validateDenseArray(data.fences, refs.length, refs.length).map(value => {
      if (value === null || typeof value === "string" && value.length === 8 && /^[A-Za-z0-9_-]{8}$/.test(value)) return value;
      throw new CoreError("invalid_input");
    }) : undefined;
  return { refs, intent: intentOf(data.intent), fences, responseByteLimit };
}
/** @param {ContextReadSet} readSet */
export function readSetBinding(readSet) {
  const scopes = readSet.namespaces.map(namespace => legacyNamespace({ owner: readSet.owner, namespace }));
  // Hosted null is a separate physical scope from the encoded local personal namespace.
  return readSet.namespaces.includes(null) ? [scopes, readSet.namespaces] : scopes;
}
