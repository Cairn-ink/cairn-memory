import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openMemoryCore } from '../../core/contract.mjs';

const coldReader = fileURLToPath(new URL('./rationale-correction-cold-reader.mjs', import.meta.url));
const ok = result => { if (!result.ok) throw new Error(`rationale_correction_${result.error.code}`); return result.value; };
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function checkedCase(value, seedEdges) {
  if (!value || typeof value.id !== 'string' || !Array.isArray(value.events) ||
      value.events.length < 1 || value.events.length > 6 || !Array.isArray(seedEdges) || seedEdges.length > 10) {
    throw new Error('invalid_rationale_correction_case');
  }
  const ids = new Set();
  value.events.forEach((event, index) => {
    if (typeof event.id !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(event.id) || ids.has(event.id) ||
        event.arrivalIndex !== index || !/^\d{4}-\d{2}-\d{2}$/.test(event.eventDate) ||
        !['user', 'assistant'].includes(event.role) || typeof event.text !== 'string' ||
        !event.text.includes(event.eventDate.slice(0, 4)) || event.text.length < 1 || event.text.length > 600) {
      throw new Error('invalid_rationale_correction_case');
    }
    ids.add(event.id);
  });
  for (const edge of seedEdges) if (!ids.has(edge.from) || !ids.has(edge.to) ||
      !['supports-decision', 'challenges-premise'].includes(edge.relation)) {
    throw new Error('invalid_rationale_correction_case');
  }
}

function sourceSnapshot(core, namespace, refs) {
  return {
    records: refs.map(ref => core.get({ namespace, memoryId: ref.memoryId })),
    defaultGraphs: refs.map(ref => core.getRationale({ namespace, ...ref })),
    incidentGraphs: refs.map(ref => core.getRationale({ namespace, ...ref, view: 'incident-proposals' })),
  };
}

/** Offline diagnostic only. The model sees core's source-only relate payload, never this runner's rubric or old graph. */
export async function runRationaleCorrectionCase({ path, namespace, scenario, seedEdges, relate,
  countTokens = () => 1 }) {
  const tempRoot = realpathSync(tmpdir());
  const absent = candidate => {
    try { lstatSync(candidate); return false; }
    catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  };
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path ||
      !path.startsWith(`${tempRoot}${sep}`) ||
      !lstatSync(dirname(path)).isDirectory() || realpathSync(dirname(path)) !== dirname(path) ||
      ![path, `${path}-wal`, `${path}-shm`, `${path}-journal`].every(absent) ||
      typeof relate !== 'function' || typeof countTokens !== 'function') {
    throw new Error('invalid_rationale_correction_configuration');
  }
  const selected = structuredClone(scenario);
  const selectedSeed = structuredClone(seedEdges);
  const binding = structuredClone(namespace);
  checkedCase(selected, selectedSeed);
  const indices = new Map(selected.events.map((event, index) => [event.id, index]));
  const seed = { edges: selectedSeed.map(edge => ({ from: indices.get(edge.from), to: indices.get(edge.to),
    relation: edge.relation, fromReceipt: 0, toReceipt: 0 })) };
  let stage = 'seed'; let reviewCalls = 0;
  const core = openMemoryCore({ path, model: { contextWindow: 8192, countTokens,
    relate(request) { if (stage === 'seed') return seed; reviewCalls++; return relate(request); } } });
  let refs, seeded, before, review, after;
  try {
    refs = selected.events.map(event => {
      const memory = ok(core.admit({ namespace: binding, memory: { content: event.text, kind: 'context' },
        receipts: [{ client: 'rationale-correction-diagnostic', sessionId: selected.id,
          eventId: event.id, role: event.role, excerpt: event.text }] })).memory;
      return { memoryId: memory.id, revision: memory.revision };
    });
    seeded = await core.reviewRationale({ namespace: binding, refs });
    ok(seeded);
    before = sourceSnapshot(core, binding, refs);
    stage = 'review';
    review = await core.reviewRationale({ namespace: binding, refs, writeMode: 'replace-reviewed' });
    after = sourceSnapshot(core, binding, refs);
  } finally { core.close(); }
  const child = spawnSync(process.execPath, [coldReader, path, JSON.stringify(binding), JSON.stringify(refs)],
    { encoding: 'utf8', timeout: 10000, maxBuffer: 262144, env: { NODE_NO_WARNINGS: '1' } });
  if (child.status !== 0 || child.error) throw new Error('rationale_correction_cold_read_failed');
  let cold;
  try { cold = JSON.parse(child.stdout); } catch { throw new Error('rationale_correction_cold_read_failed'); }
  return { caseId: selected.id, eventIds: selected.events.map(event => event.id), refs,
    seed: seeded, before, review, after, cold, coldMatches: equal(after, cold), reviewCalls };
}

function tuple(edge) { return JSON.stringify([edge.from, edge.to, edge.relation, edge.fromReceipt, edge.toReceipt]); }

/** A fixture-specific diagnostic, not a semantic judge for future model outputs. */
export function assessSyntheticRationaleCorrection(report, rubricCase) {
  if (!report || !rubricCase || report.caseId !== rubricCase.id ||
      report.eventIds.length !== report.refs.length) throw new Error('invalid_rationale_correction_report');
  const byEvent = new Map(report.eventIds.map((id, index) => [id, {
    memoryId: report.refs[index].memoryId,
    receiptId: ok(report.before.records[index]).receipts[0].id,
  }]));
  const expected = rubricCase.expectedEdges.map(edge => {
    const from = byEvent.get(edge.from); const to = byEvent.get(edge.to);
    if (!from || !to) throw new Error('invalid_rationale_correction_rubric');
    return tuple({ from: from.memoryId, to: to.memoryId, relation: edge.relation,
      fromReceipt: from.receiptId, toReceipt: to.receiptId });
  }).sort();
  const actual = [...new Set(report.after.incidentGraphs.flatMap(result => ok(result).edges.map(tuple)))].sort();
  const decisionIndex = report.eventIds.indexOf(rubricCase.decision);
  if (decisionIndex < 0) throw new Error('invalid_rationale_correction_rubric');
  const structuralSuccess = report.review.ok === true;
  const sourcesUnchanged = equal(report.before.records, report.after.records);
  const syntheticFixturePass = structuralSuccess && report.reviewCalls === 1 && sourcesUnchanged && report.coldMatches &&
    equal(actual, expected) && ok(report.after.defaultGraphs[decisionIndex]).status === rubricCase.expectedDecisionStatus;
  return { structuralSuccess, syntheticFixturePass, sourcesUnchanged, coldMatches: report.coldMatches,
    observedEdgeCount: actual.length, expectedEdgeCount: expected.length,
    interpretationStatus: 'unassessed', independentSourceReviewRequired: true };
}
