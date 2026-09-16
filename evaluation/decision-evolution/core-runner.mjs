import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryCore } from '../../core/contract.mjs';
import { boundedText } from '../../core/validation.mjs';
import { validateFixture } from './contract.mjs';
import { observeRelate, projectRelateCalls, inspectRationaleLifecycle, sourceObservation } from './natural-rationale-trace.mjs';

const arms = ['source-evidence', 'sourceSnapshot'];
const errorCode = error => error?.error?.code ?? 'runner_error';

/** Occurrence, ingestion and actor are untrusted claims inside one submitted source message. */
export function encodeDecisionEvent(event) {
  return `[Event ${event.id} | actor: ${event.actor} | occurred: ${event.occurredAt} | ingested: ${event.ingestedAt}] ${event.text}`;
}

export function mapDecisionReceipts(items, receiptSources) {
  const evidence = [];
  const absentReceipts = [];
  const seen = new Set();
  for (const item of items) {
    for (const receipt of item.receipts ?? []) {
      const identity = `${item.memory.id}:${receipt.id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const sourceId = receiptSources.get(identity);
      if (sourceId) evidence.push({ sourceId, receiptId: receipt.id, memoryId: item.memory.id });
      else absentReceipts.push({ receiptId: receipt.id, memoryId: item.memory.id, reason: 'unindexed-receipt' });
    }
  }
  return { evidence, absentReceipts, sourceIds: [...new Set(evidence.map(row => row.sourceId))] };
}

/** Pure DTO projection; useful for testing linked-source plumbing without creating graph edges. */
export function mapDecisionArmEvidence(memories, arm, receiptSources) {
  const selected = mapDecisionReceipts(memories, receiptSources);
  if (arm !== 'rationale-evidence') return selected;
  return { ...mapDecisionReceipts(memories.flatMap(memory =>
    [memory, ...(memory.rationale?.sources ?? [])]), receiptSources),
  selectedSourceIds: selected.sourceIds,
  relationshipStatus: memories.some(memory => (memory.rationale?.edges?.length ?? 0) > 0)
    ? 'model-proposed' : 'unassessed-not-linked' };
}

function resultTrace(result, stage) {
  return result.ok ? { stage, status: 'ok' } : { stage, status: 'failed', error: errorCode(result) };
}

/** Runs a source-only fixture against actual local capture and read surfaces. No rubric is accepted. */
export async function runDecisionEvolutionCore({ fixture, modelFactory, includeRationale = false,
  coldReopen = false, beforeRead, beforeColdReopen, naturalRationaleTrace = false } = {}) {
  validateFixture(fixture);
  if (typeof modelFactory !== 'function' || typeof includeRationale !== 'boolean' ||
      typeof coldReopen !== 'boolean' || typeof naturalRationaleTrace !== 'boolean' ||
      (beforeRead !== undefined && typeof beforeRead !== 'function') ||
      (beforeColdReopen !== undefined && (typeof beforeColdReopen !== 'function' || !coldReopen))) {
    throw new TypeError('invalid runner options');
  }
  // Reject unsupported source sizes/characters before any case can write a database.
  const prepared = fixture.cases.map(item => item.events.map(event => {
    try {
      const encoded = encodeDecisionEvent(event);
      const complete = boundedText(encoded, 4000);
      const retained = boundedText(encoded, 800, true);
      return { id: event.id, retained, truncated: retained !== complete };
    } catch { throw new TypeError(`invalid encoded source: ${item.id}/${event.id}`); }
  }));
  const cases = [];
  for (const [caseIndex, item] of fixture.cases.entries()) {
    const injectedModel = await modelFactory({ caseId: item.id, language: item.language });
    const observedCalls = [];
    const model = naturalRationaleTrace ? observeRelate(injectedModel, observedCalls) : injectedModel;
    const path = join(mkdtempSync(join(tmpdir(), 'cairn-dei-')), 'memory.sqlite');
    const namespace = { ownerId: `dei-${item.id}`, scope: 'personal', projectId: null };
    const sourceByEventId = new Map(prepared[caseIndex].map(event => [event.id, event.retained]));
    const receiptSources = new Map();
    const truncatedSourceIds = prepared[caseIndex].filter(event => event.truncated).map(event => event.id);
    let core = openMemoryCore({ path, model, ...(naturalRationaleTrace ? {
      captureQualification: 'source-bound-v2', captureRationale: 'source-bound-v1' } : {}) });
    const captures = [];
    const sourceReceipts = [];
    const trace = [];
    try {
      for (const event of item.events) {
        const callOffset = observedCalls.length;
        const beforeCapture = naturalRationaleTrace
          ? inspectRationaleLifecycle(core, namespace, sourceReceipts, receiptSources) : undefined;
        const result = await core.capture({ namespace, client: 'dei-offline', sessionId: item.id,
          eventId: event.id, messages: [{ id: event.id, role: 'user', content: encodeDecisionEvent(event) }] });
        trace.push(resultTrace(result, `capture:${event.id}`));
        const entry = { sourceId: event.id, occurredAt: event.occurredAt, ingestedAt: event.ingestedAt,
          status: result.ok ? 'ok' : 'failed', ...(result.ok ? {
            admission: result.value.admission, classification: result.value.classification,
          } : { error: errorCode(result) }) };
        captures.push(entry);
        if (!result.ok) {
          if (naturalRationaleTrace) entry.naturalRationale = {
            observation: 'capture-failed', relateCalls: projectRelateCalls(observedCalls.slice(callOffset),
              sourceReceipts, truncatedSourceIds), beforeCapture,
            afterCapture: inspectRationaleLifecycle(core, namespace, sourceReceipts, receiptSources) };
          continue;
        }
        trace.push({ stage: `classification:${event.id}`, status: entry.classification.status,
          ...(entry.classification.error ? { error: entry.classification.error.code } : {}) });
        for (const admitted of result.value.admission.memories) {
          let cursor;
          const visitedCursors = new Set();
          for (let page = 0; ; page++) {
            const detail = core.get({ namespace, memoryId: admitted.id, receiptLimit: 100,
              ...(cursor ? { receiptCursor: cursor } : {}) });
            trace.push(resultTrace(detail, `receipt:${event.id}:${admitted.id}:${page}`));
            if (!detail.ok) { entry.receiptError = errorCode(detail); break; }
            for (const receipt of detail.value.receipts) {
              const identity = `${admitted.id}:${receipt.id}`;
              if (receiptSources.has(identity)) continue;
              const sourceId = sourceByEventId.get(receipt.eventId) === receipt.excerpt ? receipt.eventId : null;
              receiptSources.set(identity, sourceId);
              sourceReceipts.push({ sourceId, memoryId: admitted.id, receiptId: receipt.id,
                eventId: receipt.eventId, excerpt: receipt.excerpt,
                ...(naturalRationaleTrace ? { role: receipt.role } : {}) });
            }
            if (detail.value.exhausted) break;
            const next = detail.value.nextReceiptCursor;
            if (!next || visitedCursors.has(next)) {
              entry.receiptError = 'incomplete_receipt_pagination';
              trace.push({ stage: `receipt:${event.id}:${admitted.id}:${page + 1}`,
                status: 'failed', error: entry.receiptError });
              break;
            }
            visitedCursors.add(next);
            cursor = next;
          }
        }
        if (naturalRationaleTrace) {
          const relateCalls = projectRelateCalls(observedCalls.slice(callOffset), sourceReceipts, truncatedSourceIds);
          const afterCapture = inspectRationaleLifecycle(core, namespace, sourceReceipts, receiptSources);
          entry.naturalRationale = { captureRationale: result.value.rationale,
            observation: entry.receiptError ? 'source-inspection-incomplete'
              : sourceObservation(event.id, result.value.admission, sourceReceipts, relateCalls, afterCapture),
            relateCalls, beforeCapture, afterCapture };
        }
      }
      if (coldReopen) {
        if (beforeColdReopen) await beforeColdReopen({ core, namespace, captures: structuredClone(captures),
          sourceReceipts: structuredClone(sourceReceipts) });
        core.close(); core = openMemoryCore({ path, model, ...(naturalRationaleTrace ? {
          captureQualification: 'source-bound-v2', captureRationale: 'source-bound-v1' } : {}) });
        trace.push({ stage: 'cold-reopen', status: 'ok' });
        if (naturalRationaleTrace) {
          const afterColdReopen = inspectRationaleLifecycle(core, namespace, sourceReceipts, receiptSources);
          for (const entry of captures) entry.naturalRationale.afterColdReopen = afterColdReopen;
        }
      }
      if (beforeRead) await beforeRead({ core, namespace, captures: structuredClone(captures),
        sourceReceipts: structuredClone(sourceReceipts) });
      const capturedSourceIds = [...new Set(sourceReceipts.map(row => row.sourceId).filter(Boolean))];
      const questions = [];
      for (const question of item.questions) {
        const questionArms = {};
        for (const arm of includeRationale ? [...arms, 'rationale-evidence'] : arms) {
          const result = arm === 'sourceSnapshot'
            ? core.sourceSnapshot({ readSet: [namespace], limit: 12 })
            : await core.recall({ readSet: [namespace], query: question.text, contextMode: arm, limit: 12 });
          trace.push(resultTrace(result, `${arm}:${question.id}`));
          if (!result.ok) { questionArms[arm] = { status: 'failed', error: errorCode(result),
            sourceIds: [], evidence: [], absentReceipts: [], coverage: 'unavailable',
            sourceCoverage: { expectedEvents: item.events.length, capturedEvents: capturedSourceIds.length,
              returnedEvents: 0, unreturnedSourceIds: [...capturedSourceIds] } }; continue; }
          const value = result.value;
          const mapped = mapDecisionArmEvidence(value.memories, arm, receiptSources);
          questionArms[arm] = { status: 'ok', ...mapped,
            coverage: value.coverage ?? value.namespaces ?? 'selection-unassessed',
            sourceCoverage: { expectedEvents: item.events.length, capturedEvents: capturedSourceIds.length,
              returnedEvents: mapped.sourceIds.length,
              unreturnedSourceIds: capturedSourceIds.filter(id => !mapped.sourceIds.includes(id)) },
            ...(arm === 'rationale-evidence' ? { relationshipGeneration: naturalRationaleTrace
              ? 'automatic-source-bound-v1' : 'not-configured' } : {}) };
        }
        questions.push({ questionId: question.id, actor: question.actor, arms: questionArms });
      }
      cases.push({ caseId: item.id, split: item.split, language: item.language, namespace,
        sourceCount: item.events.length, capturedSourceIds, truncatedSourceIds,
        absentSourceIds: item.events.filter(event => !capturedSourceIds.includes(event.id)).map(event => event.id),
        captures, sourceReceipts, questions, trace,
        incompleteCapture: truncatedSourceIds.length > 0 || captures.some(capture => capture.status !== 'ok' || capture.receiptError ||
          !capturedSourceIds.includes(capture.sourceId)) });
    } finally { core.close(); }
  }
  return { fixtureVersion: fixture.version, cases };
}
