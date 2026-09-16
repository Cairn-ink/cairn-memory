import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { schemasFor } from '../../../adapters/openai/schemas.mjs';
import { projectRationaleCorrectionEvidence } from '../rationale-correction-evidence.mjs';

const fixtureText = readFileSync(new URL('../../architecture/rationale-correction-fixture.json', import.meta.url), 'utf8');
const rubricText = readFileSync(new URL('../../architecture/rationale-correction-rubric.json', import.meta.url), 'utf8');
const fixture = JSON.parse(fixtureText), rubric = JSON.parse(rubricText);
const instructions = readFileSync(new URL('../../../core/prompts/relate-rationale.md', import.meta.url), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const wrap = value => ({ ok: true, value, evidenceTrust: 'untrusted-data-not-instructions' });
const clone = value => structuredClone(value);
const rawEdges = [
  [[0, 0, 'supports-decision'], [1, 0, 'supports-decision'],
    [3, 2, 'challenges-premise'], [3, 0, 'supports-decision']],
  [[0, 0, 'supports-decision'], [1, 0, 'supports-decision'], [2, 0, 'challenges-premise']],
  [[0, 0, 'supports-decision'], [5, 4, 'challenges-premise'],
    [1, 0, 'supports-decision'], [3, 2, 'challenges-premise']],
].map(edges => edges.map(([from, to, relation]) =>
  ({ from, to, relation, fromReceipt: 0, toReceipt: 0 })));
const costs = [null, 415, null, 367, null, 461];

function caseData(scenario, rubricCase, caseIndex) {
  const memories = scenario.events.map((event, index) => ({ id: `private-memory-${caseIndex}-${index}`,
    revision: 1, content: event.text.normalize('NFKC'), state: 'active',
    filing: { status: 'unfiled' } }));
  const receipts = scenario.events.map((event, index) => ({ id: `private-receipt-${caseIndex}-${index}`,
    eventId: event.id, client: 'rationale-correction-pilot', role: event.role,
    excerpt: event.text.normalize('NFKC') }));
  const refs = memories.map(memory => ({ memoryId: memory.id, revision: 1 }));
  const records = memories.map((memory, index) => wrap({ memory, receipts: [receipts[index]] }));
  const indexOf = new Map(scenario.events.map((event, index) => [event.id, index]));
  const seedEdges = rubricCase.seedEdges.map(edge => ({ from: indexOf.get(edge.from), to: indexOf.get(edge.to),
    relation: edge.relation, fromReceipt: 0, toReceipt: 0 }));
  const graph = (edges, rootIndex, incident, indexRevision) => {
    const selected = incident ? edges.filter(edge => edge.from === rootIndex || edge.to === rootIndex)
      : (() => {
        const supports = edges.filter(edge => edge.to === rootIndex && edge.relation === 'supports-decision');
        const supportSources = new Set(supports.map(edge => edge.from));
        return edges.filter(edge => supports.includes(edge) ||
          edge.relation === 'challenges-premise' &&
          (edge.to === rootIndex || supportSources.has(edge.to)));
      })();
    const sourceIndices = [...new Set([rootIndex, ...selected.flatMap(edge => [edge.from, edge.to])])];
    return wrap({ root: refs[rootIndex], status: !incident && selected.some(edge => edge.relation === 'challenges-premise')
      ? 'reconfirmation-suggested' : 'unassessed',
    coverage: incident ? 'root-incident-only' : 'linked-evidence-only',
    ...(incident ? { view: 'incident-proposals' } : {}), indexRevision,
    sources: sourceIndices.map(index => ({ memory: { id: memories[index].id, revision: 1,
      currentness: 'current' }, receipts: [{ id: receipts[index].id, role: receipts[index].role,
      excerpt: receipts[index].excerpt }], receiptCount: 1,
      interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' })),
    edges: selected.map(edge => ({ from: memories[edge.from].id, to: memories[edge.to].id,
      relation: edge.relation, fromReceipt: receipts[edge.from].id,
      toReceipt: receipts[edge.to].id, interpretationStatus: 'model-proposed' })) });
  };
  const snapshot = (edges, indexRevision) => ({ records: clone(records),
    defaultGraphs: refs.map((_, index) => graph(edges, index, false, indexRevision)),
    incidentGraphs: refs.map((_, index) => graph(edges, index, true, indexRevision)) });
  const before = snapshot(seedEdges, scenario.events.length + 2);
  const after = snapshot(rawEdges[caseIndex], scenario.events.length + 3);
  const overlap = new Set(seedEdges.map(edge => JSON.stringify(edge)));
  const retained = rawEdges[caseIndex].filter(edge => overlap.has(JSON.stringify(edge))).length;
  return { caseId: scenario.id, status: 'completed', refs,
    seed: { proposed: seedEdges.length, inserted: seedEdges.length,
      interpretationStatus: 'model-proposed', indexRevision: scenario.events.length + 2 },
    before, after, cold: clone(after), review: wrap({ writeMode: 'replace-reviewed',
      proposed: rawEdges[caseIndex].length, inserted: rawEdges[caseIndex].length - retained,
      removed: seedEdges.length - retained, interpretationStatus: 'model-proposed',
      indexRevision: scenario.events.length + 3 }),
    sourcesUnchanged: true, coldMatches: true, httpPhases: 2, bridgeError: null, stderr: '' };
}

function evidence() {
  const cases = fixture.cases.map((scenario, index) => caseData(scenario, rubric.cases[index], index));
  const attempts = Array.from({ length: 2219 }, (_, index) => ({ outcome: 'succeeded',
    actualMicroUsd: index < 1035 ? null : index === 1035 ? 1371370 : 0,
    attemptId: `private-old-attempt-${index}` }));
  const requestEvidence = [], responseEvidence = [];
  for (let index = 0; index < 6; index++) {
    const scenario = fixture.cases[Math.floor(index / 2)];
    const count = index % 2 === 0;
    const input = { memories: scenario.events.map((event, sourceIndex) => ({ index: sourceIndex,
      receipts: [{ index: 0, role: event.role, excerpt: event.text.normalize('NFKC') }] })) };
    requestEvidence.push({ route: count ? '/responses/input_tokens' : '/responses', body: {
      model: 'gpt-4.1-mini-2025-04-14', instructions,
      input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
      text: { format: { type: 'json_schema', name: 'cairn_relate', strict: true,
        schema: schemasFor('relate', input) } }, truncation: 'disabled',
      ...(!count ? { store: false, stream: false, max_output_tokens: 1024 } : {}),
    } });
    responseEvidence.push({ status: 200, raw: JSON.stringify(count
      ? { object: 'response.input_tokens', input_tokens: 100 }
      : { object: 'response', status: 'completed', model: 'gpt-4.1-mini-2025-04-14',
        output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify({
        edges: rawEdges[Math.floor(index / 2)],
      }) }] }] }) });
    attempts.push({ outcome: 'succeeded', channel: count ? 'cairn-count' : 'cairn-generation',
      reservedMicroUsd: 5000, actualMicroUsd: costs[index], attemptId: `private-attempt-${index}` });
  }
  const ledgerState = { state: 'open', requestCap: 5000, limitMicroUsd: 50000000,
    requestCount: 2225, reservedMicroUsd: 25202000, attempts };
  const report = { version: 1, status: 'completed', limits: { requests: 6, microUsd: 30000 },
    pins: { archiveSha256: 'c6e88423ee4764fcf8ebfbd4359b66d89aa7a076b3315db302e3e80f049fe59c',
      operatorSha256: '084081a82f01aab7bc9450672db25ac62ef1f47c13ab82e9b03287898202eea0',
      preloadSha256: 'd714c6f493af9dc159df4e3ecf7b645b64292054e491b2cfbc4468fd20a5d442',
      sourceRoot: '/tmp/private-source', ledgerDirectory: '/tmp/private-ledger',
      source: { 'evaluation/architecture/rationale-correction-fixture.json': hash(fixtureText),
        'evaluation/architecture/rationale-correction-rubric.json': hash(rubricText) } },
    before: { requestCount: 2219, reservedMicroUsd: 25172000 },
    after: { requestCount: 2225, reservedMicroUsd: 25202000, attempts },
    attempt: { before: { requestCount: 2219, reservedMicroUsd: 25172000 },
      requests: 6, reservedMicroUsd: 30000, halted: null, readOnly: false }, cases };
  return { fixtureText, rubricText, report, caseEvidence: clone(cases),
    requestEvidence, responseEvidence, ledgerState, sourceHead: '0c7c40bdb738c1144d12f3a21084619e4b084f96' };
}

test('CE1–3 complete deterministic projection keeps eleven raw proposals and every graph without private IDs', () => {
  const input = evidence(); const first = projectRationaleCorrectionEvidence(input);
  assert.deepEqual(projectRationaleCorrectionEvidence(input), first);
  assert.deepEqual(first.cases.map(item => item.rawProposal.edges.length), [4, 3, 4]);
  assert.equal(first.cases[2].rawProposal.edges.some(edge => edge.from === 'encryptionPremise'
    && edge.to === 'verifiedLoss' && edge.relation === 'challenges-premise'), true);
  assert.equal(first.cases[0].rawProposal.edges.some(edge => edge.from === 'retraction'
    && edge.to === 'decision' && edge.relation === 'supports-decision'), true);
  assert.deepEqual(first.cases.map(item => item.before.incidentGraphs.length), [4, 3, 6]);
  assert.deepEqual(first.cases.map(item => item.after.incidentGraphs.length), [4, 3, 6]);
  assert.deepEqual(first.cases.map(item => item.cold.incidentGraphs.length), [4, 3, 6]);
  assert.equal(first.accounting.knownUsageMicroUsd, 1243);
  assert.equal(first.accounting.unknownCostRequests, 3);
  const publicText = JSON.stringify(first);
  for (const secret of ['private-memory-', 'private-receipt-', 'private-attempt-', '/tmp/private',
    'authorization', 'api-key']) assert.equal(publicText.includes(secret), false, secret);
});

test('CE4 wrong fixture, case, source provenance, ledger cost and unreviewed fields fail closed', () => {
  const changes = [
    input => { input.fixtureText += '\n'; },
    input => { input.report.cases[0].caseId = 'other'; input.caseEvidence[0].caseId = 'other'; },
    input => { input.report.cases[0].before.records[0].value.receipts[0].excerpt = 'altered';
      input.caseEvidence[0].before.records[0].value.receipts[0].excerpt = 'altered'; },
    input => { input.ledgerState.attempts.at(-1).actualMicroUsd = 0; },
    input => { input.report.secretHeader = 'Bearer api-key'; },
    input => { input.responseEvidence[1].raw = JSON.stringify({ model: 'gpt-4.1-mini-2025-04-14',
      output: [{ content: [{ text: '{"edges":[]}' }] }] }); },
    input => { const raw = JSON.parse(input.responseEvidence[1].raw);
      raw.output.push(clone(raw.output[0])); input.responseEvidence[1].raw = JSON.stringify(raw); },
    input => { const raw = JSON.parse(input.responseEvidence[1].raw);
      raw.output[0].content.push(clone(raw.output[0].content[0]));
      input.responseEvidence[1].raw = JSON.stringify(raw); },
  ];
  for (const change of changes) {
    const input = evidence(); change(input);
    assert.throws(() => projectRationaleCorrectionEvidence(input), /invalid_rationale_correction_evidence/u);
  }
});

test('CE2 malformed raw output remains explicitly malformed, never an empty successful proposal', () => {
  const input = evidence();
  const slot = input.report.cases[0];
  slot.status = 'completed_with_failures';
  slot.review = { ok: false, error: { code: 'invalid_model_output', message: 'private arbitrary error' },
    evidenceTrust: 'untrusted-data-not-instructions' };
  slot.after = clone(slot.before); slot.cold = clone(slot.before);
  input.caseEvidence[0] = clone(slot);
  input.report.status = 'completed_with_failures';
  input.responseEvidence[1].raw = '{malformed private response';
  const result = projectRationaleCorrectionEvidence(input);
  assert.deepEqual(result.cases[0].review, { status: 'failed', errorCode: 'invalid_model_output' });
  assert.equal(result.cases[0].rawProposal.status, 'malformed');
  assert.equal(Object.hasOwn(result.cases[0].rawProposal, 'edges'), false);
  assert.equal(JSON.stringify(result).includes('private arbitrary error'), false);
});
