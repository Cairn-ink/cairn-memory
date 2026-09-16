import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openMemoryCore } from '../index.mjs';

const namespace = { ownerId: 'migration-lifecycle', scope: 'personal', projectId: null };
const reader = fileURLToPath(new URL('../../evaluation/architecture/migration-lifecycle-reader.mjs', import.meta.url));
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

// Event time is not arrival order. All text and identifiers are synthetic.
const timeline = [
  { id: 'hypothesis', eventTime: '2025-01-03', messages: [
    'Unconfirmed hypothesis on 2025-01-03: Production API-v1 clients may depend on legacy_code. Do not infer that field removal is allowed.' ] },
  { id: 'confirmation', eventTime: '2025-01-10', messages: [
    'Confirmed on 2025-01-10: Production API-v1 clients depend on legacy_code.',
    'Production legacy_code field removal is restricted while those API-v1 clients use it; this is not permission to remove the field.' ] },
  { id: 'retirement', eventTime: '2025-02-01', messages: [
    'Confirmed on 2025-02-01: the relevant Production API-v1 clients retired. Other dependencies remain unassessed; field removal has not been approved.' ] },
  { id: 'late-report', eventTime: '2025-01-15', messages: [
    'Historical report dated 2025-01-15, received after retirement: a Production API-v1 client still used legacy_code then. This does not establish current use.' ] },
  { id: 'unrelated-rule', eventTime: '2025-01-12', messages: [
    'Staging backup rule: keep daily snapshots for seven days. This rule is unaffected by Production API-v1 retirement.' ] },
];

function scriptedWriter(mode, calls) {
  const model = {
    contextWindow: 8192,
    countTokens: () => 1, // test convention, not a tokenizer
    extract: ({ input }) => ({ items: input.messages.map(message => ({
      content: message.content, kind: message.content.includes('removal is restricted') ? 'decision' : 'context',
      confidence: 0.8, sourceIndices: [message.index],
    })) }),
    qualifyCandidates: ({ input }) => ({ qualifications: input.items.map(item => {
      const evidenceIndex = item.candidates[0].candidateIndex;
      const isHypothesis = item.content.startsWith('Unconfirmed hypothesis');
      const isHistorical = item.content.startsWith('Historical report');
      const bad = mode === 'adversarial';
      const field = (value, cited = true) => ({ value, evidenceIndices: cited ? [evidenceIndex] : [] });
      const described = isHypothesis
        ? { subject: 'API-v1 clients', property: 'legacy_code dependency', scope: 'Production',
          applies: '2025-01-03 hypothesis', value: 'may depend', attribution: 'proposed', commitment: bad ? 'adopted' : 'unknown' }
        : item.content.startsWith('Confirmed on 2025-01-10')
          ? { subject: 'API-v1 clients', property: 'legacy_code dependency', scope: 'Production',
            applies: '2025-01-10', value: 'depend', attribution: 'direct', commitment: 'adopted' }
        : item.content.startsWith('Production legacy_code field removal')
          ? { subject: 'legacy_code', property: 'field removal restriction', scope: 'Production',
            applies: 'while API-v1 clients use it', value: 'restricted', attribution: 'direct', commitment: 'adopted' }
        : item.content.startsWith('Confirmed on 2025-02-01')
          ? { subject: 'relevant API-v1 clients', property: 'lifecycle', scope: 'Production',
            applies: '2025-02-01', value: 'retired; other dependencies unassessed', attribution: 'direct', commitment: 'adopted' }
        : isHistorical
          ? { subject: 'an API-v1 client', property: 'legacy_code use', scope: 'Production',
            applies: '2025-01-15 only', value: 'used then', attribution: 'reported', commitment: 'unknown' }
          : { subject: 'daily snapshots', property: 'backup retention', scope: 'Staging',
            applies: 'seven days', value: 'keep', attribution: 'direct', commitment: 'adopted' };
      return { itemIndex: item.itemIndex,
        ...Object.fromEntries(Object.entries(described).map(([name, value]) => [name, field(value)])),
      };
    }) }),
    classify: ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }),
    relate: ({ input }) => {
      const decision = input.memories.find(memory => memory.receipts.some(receipt => receipt.excerpt.includes('removal is restricted')));
      const premise = input.memories.find(memory => memory.receipts.some(receipt => receipt.excerpt.includes('clients depend on legacy_code')));
      const retirement = input.memories.find(memory => memory.receipts.some(receipt => receipt.excerpt.includes('clients retired')));
      const lateReport = input.memories.find(memory => memory.receipts.some(receipt => receipt.excerpt.startsWith('Historical report')));
      if (!decision || !premise) return { edges: [] };
      const edge = (from, to, relation) => ({ from: from.index, to: to.index, relation, fromReceipt: 0, toReceipt: 0 });
      return { edges: [edge(premise, decision, 'supports-decision'),
        ...(retirement ? [edge(retirement, premise, 'challenges-premise')] : []),
        ...(mode === 'adversarial' && lateReport ? [edge(lateReport, premise, 'challenges-premise')] : []),
      ] };
    },
  };
  return Object.fromEntries(Object.entries(model).map(([method, implementation]) => [method,
    typeof implementation !== 'function' || method === 'countTokens' ? implementation : request => {
      calls.push({ method, input: structuredClone(request.input) });
      return implementation(request);
    }]));
}

async function run(t, mode, beforeClose = () => undefined) {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-migration-lifecycle-'));
  const path = join(directory, 'memory.sqlite');
  const calls = [];
  const core = openMemoryCore({ path, model: scriptedWriter(mode, calls),
    captureQualification: 'source-bound-v2', captureRationale: 'source-bound-v1' });
  t.after(() => { core.close(); rmSync(directory, { recursive: true, force: true }); });
  const writes = [];
  for (const [arrivalIndex, event] of timeline.entries()) {
    const capture = ok(await core.capture({ namespace, client: 'synthetic', sessionId: 'migration',
      eventId: event.id, causal: { streamId: 'incident', sequence: arrivalIndex + 1 },
      messages: event.messages.map((content, index) => ({ id: `${event.id}-${index}`, role: 'user', content })) }));
    assert.equal(capture.classification.status, 'applied');
    assert.equal(capture.rationale.status, 'reviewed');
    const stored = capture.admission.memories.map(ref => ok(core.get({ namespace, memoryId: ref.id,
      includeQualification: true })));
    writes.push({ eventId: event.id, eventTime: event.eventTime, arrivalIndex,
      reconciliation: capture.reconciliation, classification: capture.classification,
      rationale: capture.rationale, stored });
  }
  const audit = await beforeClose(core, writes);
  core.close();
  const cold = JSON.parse(execFileSync(process.execPath, [reader, path,
    'What changed about Production legacy_code removal, and what is still unknown?'], { encoding: 'utf8' }));
  assert.equal(cold.result.ok, true, JSON.stringify(cold.result));
  assert.equal(cold.completeSources.ok, true, JSON.stringify(cold.completeSources));
  if (process.env.CAIRN_MIGRATION_TRACE === '1') t.diagnostic(JSON.stringify({ mode, writes, writerCalls: calls, audit, cold }));
  return { path, writes, calls, audit, cold };
}

test('ML1-3 positive scripted integration persists source-qualified timeline across a cold recall process', async t => {
  const trace = await run(t, 'positive');
  const { writes, cold } = trace;
  assert.equal(writes.length, 5);
  assert.equal(writes[3].eventTime < writes[2].eventTime, true);
  for (const write of writes) {
    assert.deepEqual(write.reconciliation, { status: 'unresolved', reason: 'qualification_requires_identity', retiredCount: 0 });
    for (const detail of write.stored) {
      assert.equal(detail.memory.state, 'active');
      assert.equal(detail.qualification.version, 1);
      assert.ok(detail.qualification.anchors.length > 0);
      assert.equal(detail.receipts.length, 1);
    }
  }
  const retained = cold.result.value.memories;
  assert.equal(cold.result.value.coverage, 'complete');
  assert.equal(cold.completeSources.value.coverage, 'complete-current-admitted');
  assert.equal(cold.completeSources.value.semanticCoverage, 'unassessed');
  assert.equal(retained.length, 6);
  assert.equal(cold.completeSources.value.memories.length, 6);
  const content = retained.flatMap(item => item.receipts.map(receipt => receipt.excerpt)).join('\n');
  assert.deepEqual(new Set(cold.completeSources.value.memories.flatMap(item => item.receipts.map(receipt => receipt.excerpt))),
    new Set(retained.flatMap(item => item.receipts.map(receipt => receipt.excerpt))));
  for (const event of timeline) for (const source of event.messages) {
    assert.ok(content.includes(source), `missing ${event.id}: ${source}`);
  }
  const restriction = retained.find(item => item.receipts.some(receipt => receipt.excerpt.includes('removal is restricted')));
  assert.equal(restriction.rationale.status, 'reconfirmation-suggested');
  assert.ok(restriction.rationale.sources.some(source => source.receipts.some(receipt => receipt.excerpt.includes('clients retired'))));
  assert.equal(cold.inspected.length, 6);
  assert.ok(cold.inspected.every(result => result.ok && result.value.qualification?.version === 1));
  assert.equal(writes[0].stored[0].qualification.commitment, 'unknown');
  assert.equal(cold.inspected.find(result => result.value.receipts[0].excerpt.startsWith('Unconfirmed hypothesis')).value.qualification.commitment,
    'unknown');
  assert.equal(cold.inspected.find(result => result.value.receipts[0].excerpt.startsWith('Staging backup rule')).value.memory.state,
    'active');
  const unrelated = cold.inspected.find(result => result.value.receipts[0].excerpt.startsWith('Staging backup rule')).value;
  assert.equal(unrelated.qualification.slot.scope, 'Staging');
  assert.equal(unrelated.qualification.slot.property, 'backup retention');
  assert.ok(cold.calls.some(call => call.stage === 'rank'));
  // This proves evidence transmission, not that an agent answered safely.
});

test('ML3 adversarial qualification is visibly stored; structural success is not semantic success', async t => {
  const trace = await run(t, 'adversarial');
  const hypothesis = trace.writes[0].stored[0];
  assert.equal(hypothesis.qualification.commitment, 'adopted');
  assert.match(hypothesis.receipts[0].excerpt, /^Unconfirmed hypothesis/);
  assert.equal(trace.cold.result.value.memories.length, 6);
  assert.equal(trace.writes[2].reconciliation.retiredCount, 0);
  const restriction = trace.cold.result.value.memories.find(item => item.receipts.some(receipt => receipt.excerpt.includes('removal is restricted')));
  assert.ok(restriction.rationale.sources.some(source => source.receipts.some(receipt => receipt.excerpt.startsWith('Historical report'))));
  assert.ok(restriction.rationale.edges.some(edge => edge.relation === 'challenges-premise' &&
    restriction.rationale.sources.some(source => source.memory.id === edge.from &&
      source.receipts.some(receipt => receipt.excerpt.startsWith('Historical report')))));
});

test('ML4 public correction invalidates source-derived title and proposed rationale after restart', async t => {
  const trace = await run(t, 'positive', async (core, writes) => {
    const premiseId = writes[1].stored[0].memory.id;
    const restrictionId = writes[1].stored[1].memory.id;
    const retirementId = writes[2].stored[0].memory.id;
    const premise = ok(core.get({ namespace, memoryId: premiseId }));
    const title = 'Production API-v1 dependency';
    const indexRevision = ok(core.map({ namespace, purpose: 'classification' })).indexRevision;
    const placement = ok(core.applyPlacement({ namespace,
      proposal: { items: [{ memoryId: premiseId, parentIds: [], newL1: { title, parentL2Ids: [] } }] },
      expectedMemoryRevisions: [{ memoryId: premiseId, revision: premise.memory.revision }],
      expectedIndexRevision: indexRevision }));
    const moc = placement.createdMocs.find(item => item.level === 'L1');
    assert.ok(moc);
    assert.deepEqual(moc.titleSources, [{ memoryId: premiseId, memoryRevision: placement.memories[0].revision }]);
    const refs = [premiseId, restrictionId, retirementId].map(memoryId => {
      const memory = ok(core.get({ namespace, memoryId })).memory;
      return { memoryId, revision: memory.revision };
    });
    const reviewed = ok(await core.reviewRationale({ namespace, refs }));
    assert.ok(reviewed.inserted > 0);
    const before = ok(core.getRationale({ namespace, memoryId: restrictionId, revision: refs[1].revision }));
    assert.equal(before.status, 'reconfirmation-suggested');
    const corrected = ok(core.correct({ namespace, memoryId: premiseId,
      expectedRevision: refs[0].revision,
      content: 'Correction: the earlier Production API-v1 dependency report is withdrawn; other dependencies remain unassessed.',
      kind: 'context', receipt: { client: 'synthetic', sessionId: 'migration', eventId: 'premise-correction',
        role: 'user', excerpt: 'Correction: the earlier Production API-v1 dependency report is withdrawn; other dependencies remain unassessed.' } }));
    assert.equal(corrected.memory.revision, refs[0].revision + 1);
    return { title, mocId: moc.id, premiseId, restrictionId, restrictionRevision: refs[1].revision,
      correctedRevision: corrected.memory.revision, oldPremiseRevision: refs[0].revision };
  });
  const { cold, audit } = trace;
  assert.equal(cold.classificationMap.ok, true);
  assert.equal(cold.recallMap.ok, true);
  const stale = cold.classificationMap.value.items.find(item => item.type === 'moc' && item.moc.id === audit.mocId);
  assert.equal(stale.moc.title, null);
  assert.ok(!cold.recallMap.value.items.some(item => item.type === 'moc' && item.moc.id === audit.mocId));
  assert.ok(!cold.classificationMap.value.items.some(item => item.type === 'moc' && item.moc.title === audit.title));
  const restriction = cold.result.value.memories.find(item => item.memory.id === audit.restrictionId);
  assert.equal(restriction.rationale.status, 'unassessed');
  assert.equal(restriction.rationale.edges.length, 0);
  const corrected = cold.inspected.find(result => result.value.memory.id === audit.premiseId).value;
  assert.equal(corrected.memory.revision, audit.correctedRevision);
  assert.equal(corrected.qualification, null);
  assert.ok(corrected.receipts[0].excerpt.startsWith('Correction:'));
  const unrelated = cold.inspected.find(result => result.value.receipts[0].excerpt.startsWith('Staging backup rule')).value;
  assert.equal(unrelated.memory.revision, 1);
  assert.equal(unrelated.qualification.slot.scope, 'Staging');
});
