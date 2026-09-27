import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { FRESH_SMOKE_TYPES } from '../live/reliability-smoke.mjs';
import { planIndexedWindowLongMemEvalCase,
  planQualifiedPrefixLongMemEvalCase } from './ingestion.mjs';
import { qualifiedSourcePairProtocol } from './public-comparison.mjs';

export const SOURCE_PAIR_COHORT_SCHEMA_VERSION = 'cairn-qualified-source-pair-cohorts-v1';
export const SOURCE_PAIR_PROJECTION_SCHEMA_VERSION = 'cairn-qualified-source-pair-projection-v1';
export const SOURCE_PAIR_COHORT_SEED = 'cairn-qualified-source-pair-cohorts-2026-09-25:';

const COHORT_KEYS = ['inventory', 'exclusions'];
const CASE_KEYS = ['history', 'question', 'namespace', 'answerModel', 'limits', 'armOrder',
  'reservations'];
const INVENTORY_KEYS = ['sourceQuestionId', 'questionType'];
const RESERVATION_KEYS = ['cairnCount', 'cairnGeneration', 'answer', 'judge'];
const TYPES = new Set(FRESH_SMOKE_TYPES);
const MAX_ID_UTF16 = 256;
const MAX_SNAPSHOT_NODES = 200_000;

export class SourcePairPreparationError extends Error {
  constructor(code) { super(code); this.name = 'SourcePairPreparationError'; this.code = code; }
}
const fail = (code) => { throw new SourcePairPreparationError(code); };
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const byteCompare = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const positiveSafe = (value) => Number.isSafeInteger(value) && value > 0;

const exact = (value, keys, code) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null
    || Reflect.ownKeys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) fail(code);
};

// Only JSON-shaped own data crosses this boundary. In particular, a getter
// cannot make validation and the subsequent protocol/projection see two values.
function snapshotData(value, state = { nodes: 0 }, depth = 0) {
  if (++state.nodes > MAX_SNAPSHOT_NODES || depth > 32) fail('invalid_options');
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== value.length + 1 || !Number.isSafeInteger(value.length)
      || keys.some((key) => typeof key !== 'string')
      || !Object.hasOwn(descriptors, 'length')) fail('invalid_options');
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = descriptors[index];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
        fail('invalid_options');
      }
      return snapshotData(descriptor.value, state, depth + 1);
    });
  }
  if (value === null || typeof value !== 'object'
    || Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null) fail('invalid_options');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (typeof key !== 'string' || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value')) fail('invalid_options');
    Object.defineProperty(result, key, { value: snapshotData(descriptor.value, state, depth + 1),
      enumerable: true, configurable: true, writable: true });
  }
  return result;
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function checkedAdd(a, b) {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) fail('projection_overflow');
  return sum;
}
function checkedMultiply(a, b) {
  const product = a * b;
  if (!Number.isSafeInteger(product)) fail('projection_overflow');
  return product;
}

function validId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_UTF16
    && id.isWellFormed() && id.trim().length > 0 && !id.includes('\0');
}

function cohort(idsByType, inventory) {
  const selected = new Set(idsByType.flatMap((entry) => entry.sourceQuestionIds));
  const sourceQuestionIdsPreparedOrder = inventory.filter((entry) =>
    selected.has(entry.sourceQuestionId)).map((entry) => entry.sourceQuestionId);
  const membership = [...selected].sort(byteCompare);
  return { byType: idsByType, sourceQuestionIdsPreparedOrder,
    membershipSha256: sha256(JSON.stringify(membership)),
    preparedOrderSha256: sha256(JSON.stringify(sourceQuestionIdsPreparedOrder)) };
}

/** Blind, deterministic membership only; supplied exclusions must be audited elsewhere. */
export function selectSourcePairCohorts(options) {
  const data = snapshotData(options);
  exact(data, COHORT_KEYS, 'invalid_options');
  const { inventory, exclusions } = data;
  if (!Array.isArray(inventory) || inventory.length !== 500) fail('invalid_inventory');
  const seen = new Set();
  for (const entry of inventory) {
    exact(entry, INVENTORY_KEYS, 'invalid_inventory');
    if (!validId(entry.sourceQuestionId) || !TYPES.has(entry.questionType)
      || seen.has(entry.sourceQuestionId)) fail('invalid_inventory');
    seen.add(entry.sourceQuestionId);
  }
  if (!Array.isArray(exclusions) || exclusions.length > inventory.length) fail('invalid_exclusions');
  const excluded = new Set();
  for (const id of exclusions) {
    if (!validId(id) || !seen.has(id) || excluded.has(id)) fail('invalid_exclusions');
    excluded.add(id);
  }
  const allocation = FRESH_SMOKE_TYPES.map((questionType) => {
    const ranked = inventory.filter((entry) => entry.questionType === questionType
      && !excluded.has(entry.sourceQuestionId)).map(({ sourceQuestionId }) => ({ sourceQuestionId,
      rank: sha256(`${SOURCE_PAIR_COHORT_SEED}${sourceQuestionId}`) }))
      .sort((a, b) => byteCompare(a.rank, b.rank)
        || byteCompare(a.sourceQuestionId, b.sourceQuestionId));
    if (ranked.length < 6) fail('insufficient_type');
    return { questionType, development: ranked[0].sourceQuestionId,
      holdout: ranked.slice(1, 6).map((entry) => entry.sourceQuestionId) };
  });
  const development = cohort(allocation.map(({ questionType, development: sourceQuestionId }) =>
    ({ questionType, sourceQuestionIds: [sourceQuestionId] })), inventory);
  const holdout = cohort(allocation.map(({ questionType, holdout: sourceQuestionIds }) =>
    ({ questionType, sourceQuestionIds })), inventory);
  return freeze({ schemaVersion: SOURCE_PAIR_COHORT_SCHEMA_VERSION, seed: SOURCE_PAIR_COHORT_SEED,
    // Explicit tuples make this source-order identity independent of JSON key order.
    inventoryOrderSha256: sha256(JSON.stringify(inventory.map(({ sourceQuestionId, questionType }) =>
      [sourceQuestionId, questionType]))),
    exclusionsSha256: sha256(JSON.stringify([...excluded].sort(byteCompare))),
    exclusionCount: excluded.size, development, holdout });
}

/** Conservative source-derived ceiling; it neither opens a grant nor asserts prompt fit. */
export function projectSourcePairCase(options) {
  const data = snapshotData(options);
  exact(data, CASE_KEYS, 'invalid_options');
  exact(data.reservations, RESERVATION_KEYS, 'invalid_reservations');
  if (RESERVATION_KEYS.some((key) => !positiveSafe(data.reservations[key]))) {
    fail('invalid_reservations');
  }
  const { reservations, ...caseData } = data;
  let protocol, prefix, indexed;
  try {
    protocol = qualifiedSourcePairProtocol(caseData);
    const planInput = { history: caseData.history, namespace: caseData.namespace };
    prefix = planQualifiedPrefixLongMemEvalCase(planInput);
    indexed = planIndexedWindowLongMemEvalCase(planInput);
  } catch { fail('invalid_case'); }
  if (!prefix.executable || !indexed.executable) fail('nonexecutable_plan');
  if (!isDeepStrictEqual(prefix.batches.map((batch) => batch.captureInput),
    indexed.batches.map((batch) => batch.captureInput))
    || !isDeepStrictEqual(prefix.batches.map((batch) => batch.sourceMap),
      indexed.batches.map((batch) => batch.sourceMap))) fail('plan_mismatch');
  const batchCounts = { qualifiedPrefix: prefix.batches.length, indexedWindows: indexed.batches.length };
  const modelMethods = checkedAdd(checkedMultiply(3,
    checkedAdd(batchCounts.qualifiedPrefix, batchCounts.indexedWindows)), 6);
  const upperCounts = { cairnCount: modelMethods, cairnGeneration: modelMethods, answer: 2, judge: 2 };
  const generation = { requests: checkedAdd(checkedMultiply(2, modelMethods), 2),
    reservedMicroUsd: checkedAdd(checkedMultiply(modelMethods,
      checkedAdd(reservations.cairnCount, reservations.cairnGeneration)),
    checkedMultiply(2, reservations.answer)) };
  const scoring = { requests: 2, reservedMicroUsd: checkedMultiply(2, reservations.judge) };
  const total = { requests: checkedAdd(generation.requests, scoring.requests),
    reservedMicroUsd: checkedAdd(generation.reservedMicroUsd, scoring.reservedMicroUsd) };
  return freeze({ schemaVersion: SOURCE_PAIR_PROJECTION_SCHEMA_VERSION, protocol, batchCounts,
    upperCounts, phases: { generation, scoring }, total, reservations,
    limitations: { modelContextFitEstablished: false, semanticSourceCoverage: 'unassessed' } });
}
