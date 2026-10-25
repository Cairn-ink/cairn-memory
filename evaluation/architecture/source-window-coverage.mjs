import { captureSnapshot } from '../../core/capture-input.mjs';
import { sourceWindowCatalog } from '../../core/source-windows.mjs';
import { identifier } from '../../core/validation.mjs';
import { types } from 'node:util';

const SCOPE = 'capture-members-only/current-read';
const MAX_WINDOWS = 64;
const MAX_MEMBERS = 5;
const MAX_RECEIPTS_PER_MEMBER = 100;

const unavailableReasons = new WeakMap();
function unavailable(reason) {
  const marker = {};
  unavailableReasons.set(marker, reason);
  throw marker;
}

// Read only own data properties. Diagnostic input may contain hostile getters;
// observing it must never execute more user code than the public call itself.
function own(value, key) {
  if (value === null || typeof value !== 'object' || types.isProxy(value)) throw new Error('shape');
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('shape');
  return descriptor.value;
}

function optional(value, key) {
  if (value === null || typeof value !== 'object' || types.isProxy(value)) throw new Error('shape');
  return Object.hasOwn(value, key) ? own(value, key) : undefined;
}

function entries(value, maximum) {
  if (types.isProxy(value) || !Array.isArray(value)) throw new Error('shape');
  const length = own(value, 'length');
  if (!Number.isSafeInteger(length) || length > maximum) throw new Error('shape');
  return Array.from({ length }, (_, index) => own(value, String(index)));
}

function safeInput(input) {
  const namespace = own(input, 'namespace');
  const result = {
    namespace: { ownerId: own(namespace, 'ownerId'), scope: own(namespace, 'scope'),
      projectId: own(namespace, 'projectId') },
    client: own(input, 'client'), sessionId: own(input, 'sessionId'),
    eventId: own(input, 'eventId'),
    messages: entries(own(input, 'messages'), 24).map(message => ({
      id: own(message, 'id'), role: own(message, 'role'), content: own(message, 'content'),
    })),
  };
  if (typeof result.namespace.ownerId !== 'string' || typeof result.namespace.scope !== 'string' ||
      result.namespace.projectId !== null && typeof result.namespace.projectId !== 'string' ||
      typeof result.client !== 'string' || typeof result.sessionId !== 'string' ||
      typeof result.eventId !== 'string' || result.messages.some(message =>
        typeof message.id !== 'string' || typeof message.role !== 'string' ||
        typeof message.content !== 'string')) throw new Error('shape');
  identifier(result.namespace.ownerId);
  if (result.namespace.scope === 'personal') {
    if (result.namespace.projectId !== null) throw new Error('shape');
  } else if (result.namespace.scope === 'project') identifier(result.namespace.projectId);
  else throw new Error('shape');
  return result;
}

const finiteCount = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const finiteRevision = value => Number.isSafeInteger(value) && value >= 1;

function offered(catalog, snapshot) {
  const groups = new Map();
  const windows = catalog.entries.map((entry, index) => {
    const key = JSON.stringify([snapshot.client, snapshot.sessionId, entry.id, entry.role, entry.content]);
    groups.set(key, (groups.get(key) ?? 0) + 1);
    return { ordinal: index + 1, key };
  });
  return { windows, groups };
}

function baseReport(offer, status, reason, suppressedCount = null) {
  const rows = offer?.windows ?? [];
  return { version: 1, scope: SCOPE, status, coverage: 'unavailable', reason,
    selection: 'unavailable', offeredCount: offer ? rows.length : null,
    uniqueOfferedCount: offer ? offer.groups.size : null,
    uniqueRetainedCount: null, uniqueUnmatchedCount: null, uniqueAmbiguousCount: null,
    suppressedCount, windows: rows.map(({ ordinal }) => ({ ordinal, retention: 'unavailable' })) };
}

function captureMembers(response) {
  if (own(response, 'ok') !== true) return { status: 'failed', reason: 'capture_failed' };
  const value = own(response, 'value');
  if (optional(value, 'processing') === true) return { status: 'processing', reason: 'processing' };
  if (optional(value, 'duplicate') === true) return { status: 'duplicate', reason: 'duplicate' };
  if (own(value, 'duplicate') !== false || own(value, 'qualificationStatus') !== 'not-requested') {
    throw new Error('shape');
  }
  const catalog = own(value, 'sourceWindowCatalog');
  if (own(catalog, 'version') !== 1 || own(catalog, 'semanticCoverage') !== 'unassessed') {
    throw new Error('shape');
  }
  const admission = own(value, 'admission');
  const members = entries(own(admission, 'memories'), MAX_MEMBERS);
  const suppressedCount = own(admission, 'suppressedCount');
  if (!finiteCount(suppressedCount, MAX_MEMBERS)) throw new Error('shape');
  const revisions = new Map();
  for (const member of members) {
    const id = own(member, 'id'), revision = own(member, 'revision');
    if (typeof id !== 'string' || !id || !finiteRevision(revision) || revisions.has(id)) throw new Error('shape');
    revisions.set(id, revision);
  }
  const classification = own(value, 'classification');
  const classStatus = own(classification, 'status');
  if (classStatus === 'applied') {
    const classified = entries(own(classification, 'memoryRevisions'), MAX_MEMBERS);
    const seen = new Set();
    for (const row of classified) {
      const id = own(row, 'memoryId'), revision = own(row, 'revision');
      if (!revisions.has(id) || seen.has(id) || !finiteRevision(revision) ||
          revision < revisions.get(id)) throw new Error('shape');
      seen.add(id); revisions.set(id, revision);
    }
  } else if (classStatus !== 'skipped' && classStatus !== 'failed') throw new Error('shape');
  return { status: suppressedCount ? 'suppressed' : 'observed',
    reason: suppressedCount ? 'suppressed' : classStatus === 'failed' ? 'classification_failed' : 'none',
    revisions, suppressedCount, windowCount: own(catalog, 'windowCount') };
}

function inspect(read, identity, expected) {
  const result = read({ namespace: { ...identity.namespace }, client: identity.client,
    eventId: identity.eventId });
  if (own(result, 'ok') !== true) unavailable('read_unavailable');
  const value = own(result, 'value');
  if (own(value, 'status') !== 'completed' || own(value, 'suppressedCount') !== 0) {
    unavailable('stale');
  }
  const members = entries(own(value, 'members'), MAX_MEMBERS);
  if (members.length !== expected.size) unavailable('stale');
  const seen = new Set();
  const rows = [];
  for (const member of members) {
    if (own(member, 'status') !== 'current') unavailable('stale');
    const id = own(member, 'memoryId'), revision = own(member, 'revision');
    if (seen.has(id) || expected.get(id) !== revision) unavailable('stale');
    seen.add(id);
    rows.push({ id, revision });
  }
  return rows;
}

function currentReceipts(read, namespace, members) {
  const keys = new Set();
  for (const member of members) {
    const result = read({ namespace: { ...namespace }, memoryId: member.id,
      receiptLimit: MAX_RECEIPTS_PER_MEMBER });
    if (own(result, 'ok') !== true) unavailable('read_unavailable');
    const value = own(result, 'value');
    const memory = own(value, 'memory');
    const returnedNamespace = own(memory, 'namespace');
    if (own(memory, 'id') !== member.id || own(memory, 'revision') !== member.revision ||
        own(returnedNamespace, 'ownerId') !== namespace.ownerId ||
        own(returnedNamespace, 'scope') !== namespace.scope ||
        own(returnedNamespace, 'projectId') !== namespace.projectId) {
      unavailable('stale');
    }
    if (own(value, 'exhausted') !== true || optional(value, 'nextReceiptCursor') !== null) {
      unavailable('incomplete');
    }
    const receipts = entries(own(value, 'receipts'), MAX_RECEIPTS_PER_MEMBER);
    const receiptCount = own(memory, 'receiptCount');
    if (!finiteCount(receiptCount, MAX_RECEIPTS_PER_MEMBER) || receiptCount !== receipts.length) {
      unavailable('incomplete');
    }
    for (const receipt of receipts) {
      const tuple = [own(receipt, 'client'), own(receipt, 'sessionId'),
        own(receipt, 'eventId'), own(receipt, 'role'), own(receipt, 'excerpt')];
      if (tuple.some(value => typeof value !== 'string') ||
          tuple.slice(0, 3).some(value => value.length > 200 || !value.isWellFormed()) ||
          !['user', 'assistant'].includes(tuple[3]) ||
          tuple[4].length > 800 || !tuple[4].isWellFormed()) throw new Error('read');
      keys.add(JSON.stringify(tuple));
    }
  }
  return keys;
}

function observedReport(offer, keys) {
  let retained = 0, unmatched = 0, ambiguous = 0;
  for (const [key, occurrences] of offer.groups) {
    if (!keys.has(key)) unmatched++;
    else if (occurrences > 1) ambiguous++;
    else retained++;
  }
  const coverage = ambiguous ? 'ambiguous' : retained === offer.groups.size ? 'complete'
    : retained === 0 ? 'none' : 'partial';
  return { version: 1, scope: SCOPE, status: 'observed', coverage,
    reason: ambiguous ? 'ambiguous' : 'none', selection: 'unavailable',
    offeredCount: offer.windows.length, uniqueOfferedCount: offer.groups.size,
    uniqueRetainedCount: retained, uniqueUnmatchedCount: unmatched,
    uniqueAmbiguousCount: ambiguous, suppressedCount: 0,
    windows: offer.windows.map(({ ordinal, key }) => ({ ordinal,
      retention: !keys.has(key) ? 'unmatched' : offer.groups.get(key) > 1 ? 'ambiguous' : 'retained' })) };
}

/** Evaluation-only, one-shot observation of one actual public capture call. */
export function createIndexedSourceWindowObserver() {
  let phase = 'new', offer = null, identity = null, outcome = null, threw = false;
  return {
    async capture(core, input) {
      if (phase !== 'new') throw new TypeError('observer_already_used');
      phase = 'capturing';
      try {
        const snapshot = captureSnapshot(safeInput(input), undefined, 'indexed-evidence-v1');
        const catalog = sourceWindowCatalog(snapshot);
        if (catalog.entries.length > MAX_WINDOWS) throw new Error('shape');
        offer = offered(catalog, snapshot);
        identity = { namespace: snapshot.namespace, client: snapshot.client, eventId: snapshot.eventId };
      } catch { /* Preserve the public call; the report will be unavailable. */ }
      try {
        const response = await core.capture(input);
        try { outcome = captureMembers(response); }
        catch { outcome = { status: 'unavailable', reason: 'invalid_capture' }; }
        return response;
      }
      catch (error) { threw = true; throw error; }
      finally { phase = 'settled'; }
    },
    finish(reads) {
      if (phase !== 'settled') return baseReport(null, 'unavailable', 'observer_unavailable');
      phase = 'finished';
      const savedOffer = offer, savedIdentity = identity, members = outcome, failed = threw;
      offer = null; identity = null; outcome = null;
      if (failed) return baseReport(savedOffer, 'failed', 'capture_failed');
      if (!savedOffer || !savedIdentity) return baseReport(null,
        members?.status === 'failed' ? 'failed' : 'unavailable', 'invalid_input');
      if (members.status === 'unavailable') return baseReport(savedOffer, 'unavailable', members.reason);
      if (members.status !== 'observed') {
        return baseReport(savedOffer, members.status, members.reason, members.suppressedCount ?? null);
      }
      if (members.windowCount !== savedOffer.windows.length) {
        return baseReport(savedOffer, 'unavailable', 'invalid_capture');
      }
      try {
        const before = inspect(own(reads, 'inspectAdmission'), savedIdentity, members.revisions);
        const keys = currentReceipts(own(reads, 'get'), savedIdentity.namespace, before);
        inspect(own(reads, 'inspectAdmission'), savedIdentity, members.revisions);
        const report = observedReport(savedOffer, keys);
        if (members.reason === 'classification_failed') report.reason = 'classification_failed';
        return report;
      } catch (error) {
        const reason = error !== null && typeof error === 'object'
          ? unavailableReasons.get(error) ?? 'read_unavailable' : 'read_unavailable';
        return baseReport(savedOffer, 'unavailable', reason);
      }
    },
  };
}
