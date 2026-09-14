import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const unwrap = result => { if (!result?.ok) throw new Error('source_loop_operation_failed'); return result.value; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ref = record => ({ memoryId: record.memory.id, revision: record.memory.revision });
const words = text => new Set(text.toLowerCase().match(/\p{Script=Han}|[\p{L}\p{N}]+/gu) ?? []);

function snapshot(core, namespace) {
  const result = []; let cursor;
  do {
    const page = unwrap(core.list({ namespace, limit: 50, ...(cursor ? { cursor } : {}) }));
    for (const memory of page.memories) {
      let receiptCursor, record;
      do {
        const detail = unwrap(core.get({ namespace, memoryId: memory.id, receiptLimit: 50,
          ...(receiptCursor ? { receiptCursor } : {}) }));
        record ??= { memory: detail.memory, receipts: [] };
        record.receipts.push(...detail.receipts); receiptCursor = detail.nextReceiptCursor;
      } while (receiptCursor);
      result.push(record);
    }
    cursor = page.nextCursor;
  } while (cursor);
  return result;
}

function coverage(records, required) {
  const present = new Set(records.flatMap(record => record.receipts.map(receipt => receipt.eventId)));
  return { required: required.length, present: required.filter(id => present.has(id)),
    missing: required.filter(id => !present.has(id)), semanticStatus: 'unassessed' };
}

/** Synthetic evaluation driver. Models/openCore are injected; no key or live transport discovery. */
export async function runSourceLoopControls({ openCore, model, cases }) {
  const fixtures = structuredClone(cases);
  if (typeof openCore !== 'function' || !model || !Array.isArray(fixtures) || !fixtures.length || fixtures.length > 8
    || fixtures.some(c => !c || typeof c.id !== 'string' || !c.id.trim() || c.id.length > 128
      || typeof c.query !== 'string' || !c.query.trim() || c.query.length > 4000
      || !Array.isArray(c.windows) || !c.windows.length || c.windows.length > 3
      || c.windows.some(w => !Array.isArray(w) || !w.length || w.length > 4
        || w.some(m => typeof m.id !== 'string' || !['user', 'assistant'].includes(m.role)
          || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 800))
      || !Array.isArray(c.requiredSourceIds) || !c.requiredSourceIds.length
      || new Set(c.windows.flat().map(m => m.id)).size !== c.windows.flat().length
      || new Set(c.requiredSourceIds).size !== c.requiredSourceIds.length
      || c.requiredSourceIds.some(id => !c.windows.flat().some(m => m.id === id)))
    || new Set(fixtures.map(c => c.id)).size !== fixtures.length) {
    throw new Error('invalid_source_loop_fixture');
  }
  const report = { version: 1, kind: 'synthetic-capture-restart-recall-basis-controls',
    semanticStatus: 'unassessed', captureQualification: 'source-bound-v2', cases: [] };
  for (const item of fixtures) {
    const path = join(mkdtempSync(join(tmpdir(), 'cairn-source-loop-')), 'memory.sqlite');
    const namespace = { ownerId: 'synthetic-source-loop', scope: 'personal', projectId: null };
    const record = { id: item.id, status: 'pending', captures: [], recall: null, controls: [], coldMatchesWarm: true };
    report.cases.push(record); let core;
    const close = () => { if (core) { unwrap(core.close()); core = null; } };
    try {
      for (const [index, messages] of item.windows.entries()) {
        core = openCore({ path, model, captureQualification: 'source-bound-v2' });
        const capture = await core.capture({ namespace, client: 'synthetic', sessionId: 'source-loop',
          eventId: `window-${index}`, messages });
        const warm = snapshot(core, namespace); close();
        core = openCore({ path }); const cold = snapshot(core, namespace); close();
        record.captures.push({ capture, warm, cold, coldMatchesWarm: same(warm, cold) });
        record.coldMatchesWarm &&= same(warm, cold);
        if (!capture.ok) break;
      }
      core = openCore({ path, model });
      const all = snapshot(core, namespace);
      record.capturedCoverage = coverage(all, item.requiredSourceIds);
      record.recall = await core.recall({ readSet: [namespace], query: item.query, limit: 6, contextMode: 'source-evidence' });
      const returnedReceipts = new Set(record.recall.ok ? record.recall.value.memories.flatMap(m => m.receipts.map(r => r.id)) : []);
      record.recalledCoverage = coverage(all.map(r => ({ ...r, receipts: r.receipts.filter(s => returnedReceipts.has(s.id)) })), item.requiredSourceIds);
      const ids = new Set(record.recall.ok ? record.recall.value.memories.map(m => m.memory.id) : []);
      const queryWords = words(item.query);
      const lexical = all.map((record, index) => ({ record, index,
        score: [...words(record.receipts.map(r => r.excerpt).join(' '))].filter(w => queryWords.has(w)).length }))
        .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 6).map(item => item.record);
      for (const [name, selected] of [['moc', all.filter(r => ids.has(r.memory.id))], ['lexical', lexical], ['captured-source-oracle', all]]) {
        const control = { name, refs: selected.map(ref), coverage: coverage(selected, item.requiredSourceIds), basis: null,
          status: selected.length === 0 ? 'missing-evidence' : selected.length > 6 ? 'over-ref-cap' : 'pending' };
        record.controls.push(control);
        if (name === 'moc' && !record.recall.ok) { control.status = 'recall-failed'; continue; }
        if (control.status !== 'pending') continue;
        control.basis = await core.reviewDecisionBasis({ namespace, refs: control.refs });
        control.status = control.basis.ok ? 'unassessed' : 'basis-failed';
      }
      record.readOnlyChecks = same(all, snapshot(core, namespace));
      record.status = record.coldMatchesWarm && record.readOnlyChecks && record.captures.length === item.windows.length
        && record.captures.every(c => c.capture.ok) ? 'observed' : 'observed-with-failures';
    } catch { record.status = 'failed'; record.error = 'source_loop_operation_failed'; }
    finally { close(); }
  }
  return report;
}
