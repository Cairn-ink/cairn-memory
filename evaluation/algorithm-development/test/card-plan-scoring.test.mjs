import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { before, after } from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { countOpenAITokens } from '../../../adapters/openai/index.mjs';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade,
  upgradeExperimentBudgetForEmbeddings, inspectEmbeddingExperimentBudgetSnapshot } from '../../experiment-budget/index.mjs';
import { prepareCardPlanComparison } from '../card-plan-store.mjs';
import { createCardPlanComparisonManifest, runCardPlanComparison } from '../card-plan-runner.mjs';
import { createSourceBundleJudgePackets } from '../source-bundle-judging.mjs';
import { prepareCardPlanScoring, scoreCardPlanComparison } from '../card-plan-scoring.mjs';
import { redactSecrets } from '../../../plugins/cairn-memory/lib/redact.mjs';

const RUNTIME = '4309ff396834f60c237910493c2dc837e11de4dc';
const MODEL = 'gpt-4.1-mini-2025-04-14';
const sourceRaw = readFileSync(new URL('../card-plan-cases.json', import.meta.url), 'utf8');
const rubricRaw = readFileSync(new URL('../card-plan-rubric.json', import.meta.url), 'utf8');
const sources = JSON.parse(sourceRaw), rubric = JSON.parse(rubricRaw);
const judgeSeeds = { AB: '17'.repeat(32), C: '29'.repeat(32) };
const DENOMINATORS = { casesPerArm: 24, selectionSlots: 48, answerSlots: 72,
  answerable: 18, qualified: 6, sourceMessages: 288, anchors: 102 };
const PREPARATION_KEYS = ['version', 'status', 'integrity', 'bindings', 'provenance',
  'denominators', 'runtime', 'mechanical', 'judgeDomains', 'resources', 'limitations'];
const REPORT_KEYS = PREPARATION_KEYS.filter(key => key !== 'judgeDomains').concat(
  ['cases', 'judgments', 'summaries', 'paired', 'harms', 'gate']);
const orders = ['ABC', 'ACB', 'BAC', 'BCA', 'CAB', 'CBA'];
const sha = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
const frozen = value => {
  if (value && typeof value === 'object') {
    assert.equal(Object.isFrozen(value), true); Object.values(value).forEach(frozen);
  }
};
const field = (value, target) => ({ value,
  rationale: 'Scripted arithmetic control; no semantic model judgment or measured gain.',
  refs: value === 'unknown' || value === null ? [] : [{ targetId: target.targetId, start: 0, end: target.text.length }] });

// Fixture-only oracle deliberately uses the frozen rubric to arrange known
// coverage. It is not a retrieval algorithm or natural/model efficacy evidence.
function proposalFor(preparation, caseId, arm, empty = false) {
  const c = preparation.observation.cases.find(row => row.id === caseId);
  const r = rubric.cases.find(row => row.id === caseId);
  const sessions = r.requiredEvidenceSets[0].anchorIds.map(id => r.anchors.find(a => a.id === id).sessionId);
  const ids = sessions.map(id => c.captures[Number(id.slice(-2)) - 1].memory.id);
  let selected = ids.map(id => c.rankRequest.input.candidates.findIndex(row => row.memory.id === id));
  assert(selected.every(index => index >= 0));
  if (arm === 'A' && ['CQ01', 'CQ02', 'CQ03'].includes(caseId)) selected = selected.slice(0, -1);
  if (empty) selected = [];
  return arm === 'A' ? { refs: selected.map(index => {
    const row = c.rankRequest.input.candidates[index];
    return { namespaceIndex: row.namespaceIndex, memoryId: row.memory.id, revision: row.memory.revision };
  }) } : { selectedCards: selected, chains: selected.map((_, index) => ({
    members: [index], sources: [{ member: 0, receipt: 0 }], terminal: 0 })) };
}
function answerBody(text) {
  return { object: 'chat.completion', model: MODEL,
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } };
}
function rankBody(proposal) {
  return { object: 'response', model: MODEL, status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }],
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } };
}
function padded(body, bytes) {
  const text = JSON.stringify(body); assert(Buffer.byteLength(text) < bytes);
  return new Response(text + ' '.repeat(bytes - Buffer.byteLength(text)));
}
function replacementBody(body) {
  const prefix = Buffer.from(JSON.stringify(body).slice(0, -1) + ',"unusedPadding":"');
  const suffix = Buffer.from('"}');
  return Buffer.concat([prefix, Buffer.alloc(262144 - prefix.length - suffix.length, 0xff), suffix]);
}

function indexOf(artifacts) {
  return artifacts.map(({ name, text }) => ({ name, bytes: Buffer.byteLength(text), sha256: sha(text) }))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
// All reads are the test's explicit owned fresh fixture, never scorer discovery.
function collect(preparation, report) {
  const root = preparation.observation.outputRoot;
  const names = readdirSync(root).filter(name => name.endsWith('.json') || name.endsWith('.txt'))
    .filter(name => name !== 'original-ledger-history.json').sort();
  const referenced = new Set(['preparation.json', 'comparison-report.json']);
  if (names.includes('run-start.json')) referenced.add('run-start.json');
  for (const c of preparation.observation.cases) referenced.add(`${c.id}-preparation.json`);
  for (const c of report.cases) for (const slot of [...c.selections, ...c.answers])
    if (slot.artifact) referenced.add(basename(slot.artifact.path));
  for (const intent of report.attempts) {
    if (intent.requestArtifact) referenced.add(basename(intent.requestArtifact.path));
    if (intent.post?.responseArtifact) referenced.add(basename(intent.post.responseArtifact.path));
  }
  for (let i = 1; i <= report.attempts.reduce((n, row) => n + 1 + Number(row.post !== null), 0); i++)
    referenced.add(`record-${String(i).padStart(4, '0')}.json`);
  for (let i = 1; i <= report.checkpoints.length; i++) referenced.add(`checkpoint-${String(i).padStart(4, '0')}.json`);
  assert.deepEqual(names, [...referenced].sort(), 'filesystem list cross-checked against runtime references/sequences');
  const artifacts = names.map(name => ({ name, text: readFileSync(join(root, name), 'utf8') }));
  assert(artifacts.length <= 939);
  const metadata = artifacts.filter(row => row.name.endsWith('.json'));
  assert(metadata.every(row => Buffer.byteLength(row.text) <= 8 * 1024 * 1024));
  assert(metadata.reduce((n, row) => n + Buffer.byteLength(row.text), 0) <= 64 * 1024 * 1024);
  let nodes = 0, maximumDepth = 0;
  const charge = (value, depth = 0) => {
    nodes++; maximumDepth = Math.max(maximumDepth, depth);
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      void key; nodes++; charge(child, depth + 1);
    }
  };
  metadata.forEach(row => charge(JSON.parse(row.text)));
  assert(nodes <= 4000000); assert(maximumDepth <= 32);
  assert(artifacts.reduce((n, row) => n + Buffer.byteLength(row.text), 0) <= 256 * 1024 * 1024);
  assert(artifacts.filter(row => row.name.endsWith('-request.txt')).length <= 168);
  assert(artifacts.filter(row => row.name.endsWith('-response.txt')).length <= 168);
  assert(artifacts.every(row => !row.name.endsWith('-request.txt') || Buffer.byteLength(row.text) <= 262144));
  assert(artifacts.every(row => !row.name.endsWith('-response.txt') || Buffer.byteLength(row.text) <= 786432));
  console.log('CARD_SCORING_ENVELOPE=' + JSON.stringify({ mode: basename(root),
    files: artifacts.length, independentlyReferencedFiles: referenced.size, metadataNodes: nodes,
    metadataDepth: maximumDepth, metadataBytes: metadata.reduce((n, row) => n + Buffer.byteLength(row.text), 0),
    artifactBytes: artifacts.reduce((n, row) => n + Buffer.byteLength(row.text), 0),
    maximumRequestBytes: Math.max(0, ...artifacts.filter(row => row.name.endsWith('-request.txt')).map(row => Buffer.byteLength(row.text))),
    maximumResponseBytes: Math.max(0, ...artifacts.filter(row => row.name.endsWith('-response.txt')).map(row => Buffer.byteLength(row.text))) }));
  console.log('CARD_SCORING_ARTIFACT_INDEX=' + JSON.stringify({ mode: basename(root), index: indexOf(artifacts) }));
  return artifacts;
}
function headerOf(snapshot) {
  return Object.fromEntries(['schemaVersion', 'runId', 'limitMicroUsd', 'requestCap',
    'reservedMicroUsd', 'requestCount', 'state', 'historySha256'].map(key => [key, snapshot[key]]));
}
function packetOracle(fixture, domain) {
  const bindings = { sourcesSha256: sha(JSON.stringify(sources)), rubricSha256: sha(JSON.stringify(rubric)),
    preparationManifestSha256: fixture.report.manifest.preparationSha256,
    runManifestSha256: sha(JSON.stringify(fixture.report.manifest)),
    resultSha256: sha(fixture.input.artifacts.find(row => row.name === 'comparison-report.json').text),
    runtimeCommitSha: RUNTIME };
  const items = fixture.report.cases.flatMap((c, i) => c.answers.filter(slot =>
    (domain === 'AB' ? slot.arm !== 'C' : slot.arm === 'C') && slot.status === 'completed'
      && slot.disposition === 'answered' && slot.answer.isWellFormed() && slot.answer.length <= 16384)
    .map(slot => ({ slotId: slot.slotId, question: fixture.preparation.observation.cases[i].question,
      sources: sources[i].sessions, rubric: rubric.cases[i], answer: slot.answer,
      passages: JSON.parse(slot.packed.request.messages[1].content).evidence.flatMap(unit =>
        JSON.parse(unit.text).sources.map(({ recordedRole, text }) => ({ recordedRole, text }))) })));
  return createSourceBundleJudgePackets({ bindings, seedHex: judgeSeeds[domain], items });
}
function scriptedResponses(fixture, operation = () => {}) {
  return Object.fromEntries(['AB', 'C'].map(domain => {
    const set = fixture.packetSets[domain];
    return [domain, set.packets.map(packet => ({ judgeId: packet.judgeId, rawResponse: JSON.stringify({
      version: 'first-answer-judgment-v1', packetSha256: packet.packetSha256,
      items: packet.payload.items.map(item => {
        const slotId = set.privateMapping.find(row => row.judgeId === packet.judgeId && row.itemId === item.itemId).slotId;
        const caseId = slotId.slice(0, 4), arm = slotId.at(-1);
        const row = { itemId: item.itemId,
          correctness: field(arm === 'C' || arm === 'A' && ['CQ01', 'CQ02', 'CQ03'].includes(caseId) ? 'no' : 'yes', item.answer),
          support: field('yes', item.answer), unsupportedClaims: field(0, item.answer),
          staleClaims: field(0, item.originalSources[0]), severe: JSON.parse(item.rubric.text).severeConditions.map(condition =>
            ({ conditionId: condition.conditionId, ...field('no', item.answer) })) };
        operation({ row, item, domain, judgeId: packet.judgeId, slotId, caseId, arm }); return row;
      }),
    }) }))];
  }));
}

let workspace, fixtures;
before(async () => {
  workspace = createTestWorkspace(null, { prefix: 'card-plan-scoring-shared-' });
  try {
    fixtures = {};
    for (const mode of ['complete', 'C-unjudgeable', 'edges', 'before-start', 'checkpoint-mismatch', 'replacement', 'read-state-drift', 'unaffordable', 'net-loss', 'pre-dispatch-failure', 'CW-transformed-success', 'CW-redacted-failure', 'ordinary-BOM-boundaries']) {
      const preparation = await prepareCardPlanComparison({ outputRoot: join(workspace.path, mode) });
      const configuration = { directory: join(workspace.path, `${mode}-ledger`), runId: randomUUID(),
        limitMicroUsd: mode === 'unaffordable' ? 39000000 : 400000000, requestCap: 100000 };
      createExperimentBudget(configuration).close();
      const old = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
      upgradeExperimentBudgetForEmbeddings({ ...configuration,
        expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, expectedHistorySha256: old.historySha256 });
      const initial = inspectEmbeddingExperimentBudgetSnapshot(configuration), calls = [], records = [];
      let active, maximumRaw = null;
      const report = await runCardPlanComparison({ preparation,
        manifest: createCardPlanComparisonManifest(preparation.observation), configuration,
        checkpoint: { requestCount: mode === 'checkpoint-mismatch' ? 1 : 0, reservedMicroUsd: 0 },
        historySha256: initial.historySha256, apiKey: mode === 'before-start' ? '' : 'synthetic_scoring_key',
        signal: new AbortController().signal,
        onRecord(row) {
          active = row; records.push(row);
          if (mode === 'pre-dispatch-failure' && row.phase === 'pre') throw Error('synthetic-pre-dispatch-observation-failure');
        },
        onCheckpoint(row) {
          if (mode === 'edges' && row.slotId === 'CQ24-answer-A') throw Error('synthetic-after-extraction-close-failure');
          if (mode === 'CW-transformed-success' && row.slotId === 'CQ01-answer-C'
            || mode === 'ordinary-BOM-boundaries' && row.slotId === 'CQ01-answer-C'
            || mode === 'CW-redacted-failure' && row.slotId === 'CQ01-answer-A') throw Error('synthetic-review-prefix-stop');
        },
        async fetchImpl(url, init) {
          assert.equal(init.redirect, 'error');
          const slotId = active.slotId, caseId = slotId.slice(0, 4), arm = slotId.at(-1);
          calls.push({ url, slotId, requestSha256: sha(init.body) });
          if (url.endsWith('/input_tokens')) {
            if (mode === 'CW-redacted-failure' && slotId === 'CQ01-selection-B') return Response.json({
              object: 'response.input_tokens', input_tokens: 100, diagnostic: 'sk-' + 'x'.repeat(20) }, { status: 500 });
            if (mode === 'ordinary-BOM-boundaries' && arm === 'A') {
              const text = JSON.stringify({ object: 'response.input_tokens', input_tokens: 100 });
              return new Response('\uFEFF' + text + ' '.repeat(65536 - 3 - Buffer.byteLength(text)));
            }
            return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
          }
          if (url.endsWith('/responses')) {
            const proposal = proposalFor(preparation, caseId, arm, mode === 'edges' && slotId === 'CQ01-selection-B');
            if (mode === 'net-loss' && arm === 'B' && ['CQ04', 'CQ05', 'CQ06'].includes(caseId)) {
              proposal.selectedCards.pop(); proposal.chains.pop();
            }
            if (mode === 'read-state-drift') {
              const db = new DatabaseSync(preparation.observation.cases[0].path);
              try { db.prepare("UPDATE receipts SET excerpt = excerpt || ' synthetic changed' WHERE memory_id = ?")
                .run(proposal.refs[0].memoryId); } finally { db.close(); }
            }
            const body = rankBody(proposal);
            if (mode === 'CW-transformed-success' && slotId === 'CQ01-selection-B') body.diagnostic = 'sk-' + 'x'.repeat(20);
            if (mode === 'ordinary-BOM-boundaries' && arm === 'A') {
              const text = JSON.stringify(body);
              return new Response('\uFEFF' + text + ' '.repeat(262144 - 3 - Buffer.byteLength(text)));
            }
            return Response.json(body);
          }
          let text = rubric.cases.find(row => row.id === caseId).acceptableQualifiedAnswer;
          if (mode === 'edges') {
            if (slotId === 'CQ02-answer-A') text = ' \t ';
            if (slotId === 'CQ05-answer-A') text = 'Answer \ud800';
            if (slotId === 'CQ04-answer-C') text = ' '.repeat(60000) + 'X';
          }
          if (mode === 'C-unjudgeable' && slotId === 'CQ04-answer-C') text = ' '.repeat(60000) + 'X';
          assert(countOpenAITokens(text) <= 512, 'genuine transport output token predicate');
          if (mode === 'replacement') {
            maximumRaw = replacementBody(answerBody(text)); return new Response(maximumRaw);
          }
          const body = answerBody(text);
          if (mode === 'ordinary-BOM-boundaries') {
            const encoded = JSON.stringify(body);
            return new Response('\uFEFF' + encoded + ' '.repeat(262144 - 3 - Buffer.byteLength(encoded)));
          }
          if (mode === 'complete' && slotId === 'CQ08-answer-A') body.usage = { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 };
          return mode === 'complete' && slotId === 'CQ24-answer-A' ? padded(body, 262144) : Response.json(body);
        } });
      assert.deepEqual(report.cases.map(c => c.id), sources.map(c => c.id));
      assert.equal(report.cases.flatMap(c => c.selections).length, 48);
      assert.equal(report.cases.flatMap(c => c.answers).length, 72);
      const artifacts = collect(preparation, report), artifactIndexSha256 = sha(JSON.stringify(indexOf(artifacts)));
      const record = { version: 'synthetic-card-scoring-execution-v1', mode, runtimeCommitSha: RUNTIME,
        artifactIndexSha256, preparationSha256: report.manifest.preparationSha256, status: report.status,
        physicalCalls: calls.length, recordCount: records.length, callSlots: calls.map(row => row.slotId) };
      const input = { sourceRaw, rubricRaw, artifacts, execution: { runtimeCommitSha: RUNTIME,
        artifactIndexSha256, originalHistoryHeader: report.originalHistory ? headerOf(initial) : null,
        provenanceRecordSha256: sha(JSON.stringify(record)) }, judgeSeeds };
      const fixture = { preparation, report, input, calls, records, initial, record, maximumRaw };
      fixture.packetSets = Object.fromEntries(['AB', 'C'].map(domain => [domain, packetOracle(fixture, domain)]));
      fixtures[mode] = fixture;
      if (mode === 'replacement' || mode === 'read-state-drift') console.log('CARD_SCORING_FAILURE_SHAPE=' + JSON.stringify({ mode,
        reportFailure: report.failure, slots: [...report.cases[0].selections, ...report.cases[0].answers].map(slot => ({
          slotId: slot.slotId, status: slot.status, disposition: slot.disposition, failure: slot.failure,
          failureEvidence: slot.failureEvidence, stateFailure: slot.stateFailure, cleanupFailure: slot.cleanupFailure,
          stateChecks: slot.stateChecks, assemblyPresent: slot.assembly !== null && slot.assembly !== undefined,
          evidencePresent: slot.evidence !== null && slot.evidence !== undefined,
          authoritativeReads: slot.authoritativeReads?.map(row => ({ input: row.input, resultOk: row.result.ok, error: row.result.error })) })),
        posts: report.attempts.map(row => row.post) }));
      console.log('CARD_SCORING_EXECUTION_RECORD=' + JSON.stringify(record));
      console.log('CARD_SCORING_FIXTURE=' + JSON.stringify({ ...record, callSlots: undefined,
        provenanceRecordSha256: input.execution.provenanceRecordSha256, files: artifacts.length,
        metadataBytes: artifacts.filter(row => row.name.endsWith('.json')).reduce((n, row) => n + Buffer.byteLength(row.text), 0),
        artifactBytes: artifacts.reduce((n, row) => n + Buffer.byteLength(row.text), 0),
        denominators: DENOMINATORS, ABItems: fixture.packetSets.AB.packets[0].payload.items.length,
        CItems: fixture.packetSets.C.packets[0].payload.items.length }));
    }
  } catch (failure) { await workspace.cleanup(); throw failure; }
}, { timeout: 1800000 });
after(async () => {
  if (workspace) {
    await workspace.cleanup(); await assert.rejects(access(workspace.path), { code: 'ENOENT' });
    console.log('CARD_SCORING_SHARED_CLEANUP=removed-owned-workspace');
  }
});

const assess = (fixture, operation) => scoreCardPlanComparison({ ...fixture.input,
  firstResponses: scriptedResponses(fixture, operation) });
const armOf = (report, id, arm) => report.cases.find(row => row.caseId === id).arms[arm];
function valid(report, preparation = false) {
  keys(report, preparation ? PREPARATION_KEYS : REPORT_KEYS);
  assert.equal(report.version, preparation ? 'card-plan-scoring-preparation-v1' : 'card-plan-scoring-report-v1');
  assert.equal(report.status, preparation ? 'ready' : 'assessed');
  assert.deepEqual(report.integrity, { status: 'valid', reason: null });
  assert.deepEqual(report.denominators, DENOMINATORS); frozen(report);
}
function denied(report, reason) {
  assert.equal(report.status, 'denied'); assert.equal(report.integrity.status, 'denied');
  assert.match(report.integrity.reason, /^[a-z][a-z0-9_]{1,127}$/u);
  if (reason !== undefined) assert.equal(report.integrity.reason, reason);
  assert.deepEqual(report.denominators, DENOMINATORS); frozen(report);
  for (const key of ['bindings', 'mechanical', 'resources']) assert.equal(report[key], null);
  if (report.version === 'card-plan-scoring-report-v1') {
    for (const key of ['summaries', 'paired', 'harms', 'judgments']) assert.equal(report[key], null);
    assert.equal(report.gate.mechanismPromising, false);
  }
}

test('ST1 fixture preconditions: fresh actual runtime, complete 24/48/72, first HTTP and honest edge transitions', () => {
  assert.equal(Buffer.byteLength(sourceRaw), 90785); assert.equal(Buffer.byteLength(rubricRaw), 76804);
  assert.equal(sha(sourceRaw), '9a426a536efd97c8b61a7aed9890a399f7e6f8cb72758cc2c1fbc2c78605a48f');
  assert.equal(sha(rubricRaw), 'c0aea913f90bd8437a455f5d9048dfd26364120b15822dccd0ff452ed4447d8c');
  const full = fixtures.complete;
  assert.equal(full.report.status, 'completed'); assert.equal(full.calls.length, 168);
  assert.equal(full.records.length, 336); assert.equal(full.report.checkpoints.length, 120);
  assert.equal(full.report.resources.answersCompleted, 72);
  assert.equal(full.report.resources.reservedMicroUsd, 840000);
  const smallUsage = full.report.attempts.find(row => row.slotId === 'CQ08-answer-A').post;
  assert.deepEqual(smallUsage.usage, { input_tokens: 3, output_tokens: 3, total_tokens: 6 });
  assert.equal(smallUsage.actualMicroUsd, 7, 'literal pinned ordinary floating-point ceil; not rational CW pricing');
  assert(full.report.ledgerReconciliation.appendedAttempts.every(row => row.outcome !== null));
  for (const [i, c] of full.report.cases.entries()) {
    assert.deepEqual(c.selectionOrder, i % 2 ? ['B', 'A'] : ['A', 'B']);
    assert.deepEqual(c.answerOrder, [...orders[i % 6]]);
    assert.equal(c.answers[2].selectionSlotId, c.answers[1].selectionSlotId);
    const calls = full.calls.slice(i * 7, i * 7 + 7);
    assert.deepEqual(calls.map(row => row.slotId), c.selectionOrder.flatMap(arm =>
      [`${c.id}-selection-${arm}`, `${c.id}-selection-${arm}`]).concat(c.answerOrder.map(arm => `${c.id}-answer-${arm}`)));
  }
  const max = full.report.attempts.find(row => row.slotId === 'CQ24-answer-A').post.responseArtifact;
  assert.equal(max.bytes, 262144);
  const edge = fixtures.edges.report;
  assert.equal(edge.status, 'halted'); assert.equal(edge.failure.code, 'card_plan_persistence_failure');
  assert.deepEqual(edge.cases[0].selections[1].assembly.proposal, { selectedCards: [], chains: [] });
  assert.deepEqual(edge.cases[0].answers[1].packed, edge.cases[0].answers[2].packed);
  assert.equal(edge.cases[1].answers[0].failure.code, 'invalid_answer_response');
  assert.equal(edge.cases[1].answers[0].answer, null);
  assert.equal(edge.cases[4].answers[0].status, 'completed');
  assert.equal(edge.cases[4].answers[0].answer.isWellFormed(), false);
  assert.equal(edge.cases[3].answers[2].status, 'completed');
  assert.equal(edge.cases[3].answers[2].answer.length, 60001);
  const partial = edge.cases[23].answers[0];
  assert.equal(partial.status, 'failed'); assert.equal(partial.disposition, 'answer-failed');
  assert.equal(typeof partial.result.answer, 'string'); assert.equal(partial.answer, partial.result.answer);
  const early = fixtures['before-start'];
  assert.equal(early.report.failure.code, 'invalid_card_plan_configuration');
  assert.equal(early.input.artifacts.some(row => row.name === 'run-start.json'), false);
  assert.equal(early.report.resources.initialRequestCount, null); assert.equal(early.input.execution.originalHistoryHeader, null);
  const mismatch = fixtures['checkpoint-mismatch'];
  assert.equal(mismatch.report.failure.code, 'card_plan_checkpoint_mismatch');
  assert.equal(mismatch.report.resources.initialRequestCount, 0);
  assert.equal(mismatch.input.execution.originalHistoryHeader, null); assert.equal(mismatch.report.originalHistory, null);
  assert.equal(mismatch.input.artifacts.some(row => row.name.startsWith('checkpoint-')), false);
  assert.equal(mismatch.input.artifacts.some(row => row.name === 'run-start.json'), true);
  const replacement = fixtures.replacement;
  assert.equal(replacement.maximumRaw.length, 262144); assert.equal(replacement.report.status, 'halted');
  const retained = replacement.input.artifacts.find(row => row.name.endsWith('-response.txt') && Buffer.byteLength(row.text) > 262144);
  assert(retained); assert(Buffer.byteLength(retained.text) <= 786432);
  assert.equal(retained.text, replacement.maximumRaw.toString('utf8'));
  assert.equal(replacement.report.cases[0].answers[0].answer, null);
  const drift = fixtures['read-state-drift'].report, failed = drift.cases[0].selections[0];
  assert.equal(drift.status, 'halted'); assert.equal(failed.status, 'failed');
  assert.equal(failed.failure.code, 'storage_error');
  assert.equal(drift.failure.code, 'card_plan_store_drift');
  assert.equal(failed.stateFailure.code, 'card_plan_store_drift');
  assert.equal(failed.cleanupFailure.code, 'card_plan_store_drift');
  assert.deepEqual(failed.stateChecks.map(row => row.phase), ['before']);
  assert.equal(failed.evidence, null); assert.equal(failed.assembly, null);
  assert.equal(failed.authoritativeReads.length, 0, 'genuine pre-assembly drift; partial-read branch not reached');
  assert.equal(fixtures.unaffordable.report.failure.code, 'algorithm_unaffordable');
  assert.equal(fixtures.unaffordable.report.resources.initialRequestCount, 0);
  assert.equal(fixtures.unaffordable.report.originalHistory, null);
  const nondispatched = fixtures['pre-dispatch-failure'];
  assert.equal(nondispatched.report.status, 'halted'); assert.equal(nondispatched.calls.length, 0);
  assert.equal(nondispatched.report.attempts.length, 1); assert.equal(nondispatched.report.attempts[0].dispatched, false);
  assert.equal(nondispatched.report.resources.reservedIntents, 1);
});

test('SC1–SC6/SJ1: closed schema, full source/run identities, shared B selection and separate AB/C packets', async () => {
  const f = fixtures.complete, before = sha(JSON.stringify(f.input));
  const prepared = await prepareCardPlanScoring(f.input); valid(prepared, true);
  assert.equal(sha(JSON.stringify(f.input)), before);
  assert.equal(JSON.stringify(prepared.bindings), JSON.stringify(f.packetSets.AB.bindings));
  assert.deepEqual(prepared.judgeDomains, f.packetSets);
  assert.equal(prepared.mechanical.selections.length, 48); assert.equal(prepared.mechanical.answers.length, 72);
  assert.equal(prepared.provenance.sourceRawSha256, sha(sourceRaw));
  assert.equal(prepared.provenance.rubricRawSha256, sha(rubricRaw));
  assert.equal(prepared.provenance.artifactIndexSha256, f.input.execution.artifactIndexSha256);
  assert.equal(prepared.provenance.externalAttestation, 'required-not-code-verified');
  assert.equal(prepared.provenance.originalHistory.verification, 'descriptor-header-and-new-deltas-only');
  assert.equal(prepared.resources.physicalCalls, 168); assert.equal(prepared.resources.reservedIntents, 168);
  assert.equal(prepared.resources.compliance.status, 'satisfied');
  assert.equal(prepared.resources.rssBytes, null); assert.equal(prepared.resources.serviceCostMicroUsd, null);
});

test('SM1–SM3: exact 24 pairs, source sets, scripted +3 sole AB gate, C diagnostic never winner or Stage2 passage', async () => {
  const report = await assess(fixtures.complete); valid(report);
  for (const arm of ['A', 'B', 'C']) for (const [group, count] of [['all', 24], ['answerable', 18], ['qualified', 6]]) {
    const s = report.summaries[arm][group];
    assert.equal(s.cases, count); assert.equal(s.completed + s.failed + s.notRun, count);
    assert.equal(s.correctness.correct + s.correctness.incorrect + s.correctness.unresolved, count);
    assert.equal(s.supportedCorrect.true + s.supportedCorrect.false + s.supportedCorrect.unknown, count);
  }
  assert.deepEqual(report.summaries.A.all.correctness, { correct: 21, incorrect: 3, unresolved: 0 });
  assert.deepEqual(report.summaries.B.all.correctness, { correct: 24, incorrect: 0, unresolved: 0 });
  assert.equal(report.summaries.A.all.completeRequiredCases, 21); assert.equal(report.summaries.B.all.completeRequiredCases, 24);
  const first = fixtures.complete.report.cases[0], firstRubric = rubric.cases[0], anchor = firstRubric.anchors[0];
  const sourceIndex = sources[0].sessions.findIndex(s => s.id === anchor.sessionId);
  const coordinate = first.selections[1].evidence.provenance.flatMap(p => p.coordinates)
    .find(p => p.originalSessionIndex === sourceIndex && p.originalTurnIndex === anchor.messageIndex);
  assert(coordinate); assert.equal(coordinate.classification, 'metadata-or-mixed');
  assert.equal(coordinate.originalStartUtf16, null); assert.equal(coordinate.originalEndUtf16, null);
  const preparedCase = fixtures.complete.preparation.observation.cases[0];
  const window = preparedCase.plan.cairnPlan.batches[coordinate.batchIndex].indexedWindows[coordinate.windowIndex];
  const origin = preparedCase.plan.originMap.turns.find(t => t.renderedTurnId === coordinate.renderedTurnId);
  assert(window.start < origin.bodyStart && window.end > origin.bodyEnd, 'real whole window contains wrapper and body');
  assert.equal(window.content.slice(origin.bodyStart - window.start, origin.bodyEnd - window.start),
    sources[0].sessions[sourceIndex].messages[anchor.messageIndex].content);
  assert.equal(report.cases[0].arms.B.evidence.anchors.find(a => a.id === anchor.id).present, true,
    'exact original-body intersection credits the anchor without crediting wrapper bytes');
  assert.equal(report.paired.BminusA.completeRequiredNet, 3);
  assert.deepEqual(report.paired.BminusA.completeRequiredGains, ['CQ01', 'CQ02', 'CQ03']);
  assert.deepEqual(report.paired.BminusA.completeRequiredLosses, []);
  assert.equal(report.paired.BminusA.supportedCorrect.lower, 3); assert.equal(report.paired.BminusA.supportedCorrect.upper, 3);
  assert.equal(report.paired.BminusA.rawCorrectness.lower, 3); assert.equal(report.paired.BminusA.rawCorrectness.lowerReachesThree, true);
  assert.equal(report.paired.BminusA.supportedCorrect.pairs.length, 24);
  assert.equal(report.paired.CminusB.diagnosticOnly, true); assert.equal(report.paired.CminusB.supportedCorrect.lower, -24);
  assert.equal(report.gate.mechanismPromising, true); assert.equal(report.gate.Stage2Passed, false);
  assert.equal(report.gate.productDefaultAdvancement, false); assert.equal(report.harms.D12Cleared, false);
  assert.equal(report.harms.AB.known, true);
  for (const c of report.cases) for (const arm of ['A', 'B', 'C']) {
    const row = c.arms[arm], selected = fixtures.complete.report.cases.find(r => r.id === c.caseId).selections[arm === 'A' ? 0 : 1];
    const sourceIds = new Set(selected.evidence.provenance.map(p => sources.find(s => s.id === c.caseId)
      .sessions[p.coordinates[0].originalSessionIndex].id));
    const r = rubric.cases.find(r => r.id === c.caseId);
    assert.deepEqual(row.evidence.anchors, r.anchors.map(a => ({ id: a.id, present: sourceIds.has(a.sessionId) })));
    assert.equal(row.evidence.completeRequired, r.requiredEvidenceSets.every(set =>
      set.anchorIds.every(id => sourceIds.has(r.anchors.find(a => a.id === id).sessionId))));
  }
  const cWins = await assess(fixtures.complete, ({ row, arm, item }) => {
    row.correctness = field(arm === 'C' ? 'yes' : 'no', item.answer);
  });
  assert.equal(cWins.paired.CminusB.rawCorrectness.lower, 24); assert.equal(cWins.gate.mechanismPromising, false);
});

test('SM1: three-valued conjunction has any-false precedence and honest paired bounds', async () => {
  const report = await assess(fixtures.complete, ({ row, arm, caseId, item }) => {
    if (arm === 'A' && caseId === 'CQ01') row.correctness = field('unknown', item.answer);
    if (arm === 'B' && caseId === 'CQ04') row.support = field('unknown', item.answer);
    if (arm === 'B' && caseId === 'CQ05') row.unsupportedClaims = field(null, item.answer);
    if (arm === 'A' && caseId === 'CQ06') row.correctness = field('no', item.answer);
  });
  assert.equal(armOf(report, 'CQ01', 'A').supportedCorrect, false, 'incomplete source set is definitive false despite unknown correctness');
  assert.equal(armOf(report, 'CQ01', 'A').rawCorrectness, null);
  assert.equal(armOf(report, 'CQ04', 'B').supportedCorrect, null);
  assert.equal(armOf(report, 'CQ05', 'B').supportedCorrect, null, 'zero unsupported claims is mandatory');
  assert.equal(armOf(report, 'CQ06', 'A').supportedCorrect, false);
  assert.equal(report.paired.BminusA.supportedCorrect.lower, 2); assert.equal(report.paired.BminusA.supportedCorrect.upper, 4);
  assert.equal(report.paired.BminusA.rawCorrectness.lower, 3); assert.equal(report.paired.BminusA.rawCorrectness.upper, 4);
  assert.equal(report.gate.mechanismPromising, false);
  assert.equal(report.summaries.B.all.unsupported.knownClaims, 0);
  assert.equal(report.summaries.B.all.unsupported.claims, null);
  assert.equal(report.summaries.B.all.unsupported.unknownJudgmentQuestions, 1);
});

test('SJ2/SJ3: missing, malformed, oversized and disagreed first judgments preserve original literal/hash and unknowns', async () => {
  for (const raw of [null, '{"partial":', 'x'.repeat(4194305)]) {
    const f = fixtures.complete, firstResponses = scriptedResponses(f); firstResponses.AB[0].rawResponse = raw;
    const report = await scoreCardPlanComparison({ ...f.input, firstResponses }); valid(report);
    const judged = report.judgments.AB.judges[0];
    assert.equal(judged.rawSha256, raw === null ? null : sha(raw));
    assert.equal(judged.rawResponse, raw?.length > 4194304 ? null : raw);
    assert.equal(report.summaries.B.all.correctness.unresolved, 24);
    assert.equal(report.harms.AB.known, false); assert.equal(report.gate.mechanismPromising, false);
  }
  const report = await assess(fixtures.complete, ({ row, arm, caseId, judgeId, item }) => {
    if (arm === 'B' && caseId === 'CQ04' && judgeId === 'B') row.correctness = field('no', item.answer);
  });
  assert.equal(armOf(report, 'CQ04', 'B').rawCorrectness, null);
  assert.equal(armOf(report, 'CQ04', 'B').judgment.fields.correctness.reason, 'disagreement');
});

test('SM2: C-only unknowns cannot block AB; qualified uncertainty and per-condition severe additions do block', async () => {
  const textOnly = await assess(fixtures['C-unjudgeable']); valid(textOnly);
  assert.equal(armOf(textOnly, 'CQ04', 'C').judgeEligibility.reason, 'answer-text-over-judge-limit');
  assert.equal(textOnly.harms.AB.known, true); assert.equal(textOnly.gate.mechanismPromising, true);
  assert.equal(textOnly.summaries.C.all.correctness.unresolved, 1);
  const cOnly = await assess(fixtures.complete, ({ row, domain, item }) => {
    if (domain === 'C') { row.correctness = field('unknown', item.answer); row.support = field('unknown', item.answer);
      row.unsupportedClaims = field(null, item.answer); row.staleClaims = field(null, item.answer);
      row.severe.forEach(s => Object.assign(s, field('unknown', item.answer))); }
  });
  assert.equal(cOnly.gate.mechanismPromising, true); assert.equal(cOnly.harms.AB.known, true);
  const qualified = await assess(fixtures.complete, ({ row, arm, caseId, item }) => {
    if (arm === 'B' && caseId === 'CQ19') row.correctness = field('unknown', item.answer);
  });
  assert.equal(qualified.gate.mechanismPromising, false);
  assert(qualified.gate.reasons.includes('qualified-supported-correct-regression'));
  const severe = await assess(fixtures.complete, ({ row, arm, caseId, item }) => {
    if (arm === 'B' && caseId === 'CQ01') Object.assign(row.severe[0], field('yes', item.answer));
    if (arm === 'A' && caseId === 'CQ02') Object.assign(row.severe[0], field('yes', item.answer));
  });
  assert.equal(severe.gate.mechanismPromising, false);
  assert(severe.harms.AB.severe.some(row => row.caseId === 'CQ01' && row.conditionIndex === 0 && row.added));
});

test('SC5/SJ3/SM1: genuine empty C, rejected whitespace, unjudgeable first text and failed-after-extraction stay explicit', async () => {
  const f = fixtures.edges, prepared = await prepareCardPlanScoring(f.input); valid(prepared, true);
  assert.equal(prepared.judgeDomains.AB.packets[0].payload.items.length, 45);
  assert.equal(prepared.judgeDomains.C.packets[0].payload.items.length, 23);
  const report = await assess(f); valid(report); assert.equal(report.runtime.status, 'halted');
  assert.equal(armOf(report, 'CQ01', 'B').evidence.completeRequired, false);
  assert.deepEqual(armOf(report, 'CQ01', 'C').evidence, armOf(report, 'CQ01', 'B').evidence);
  for (const id of ['CQ02', 'CQ24']) {
    const row = armOf(report, id, 'A'); assert.equal(row.judgeEligibility.status, 'excluded');
    assert.equal(row.supportedCorrect, false); assert.equal(row.rawCorrectness, false);
    assert.equal(row.safety.status, 'unobserved'); assert.equal(row.judgment, null);
  }
  const partial = armOf(report, 'CQ24', 'A');
  assert.equal(partial.actualAnswer, true); assert.equal(partial.execution, 'failed');
  assert.equal(partial.answerSerializedSha256, sha(JSON.stringify(f.report.cases[23].answers[0].answer)));
  assert.equal(partial.judgeEligibility.reason, 'runtime-not-completed-answered');
  for (const [id, arm, reason] of [['CQ05', 'A', 'ill-formed-answer-text'], ['CQ04', 'C', 'answer-text-over-judge-limit']]) {
    const row = armOf(report, id, arm); assert.equal(row.execution, 'completed');
    assert.equal(row.judgeEligibility.reason, reason); assert.equal(row.evidence.completeRequired, true);
    assert.equal(row.supportedCorrect, null);
    assert.equal(row.rawCorrectness, null); assert.equal(row.safety.status, 'unobserved');
    const literal = f.report.cases.find(c => c.id === id).answers.find(row => row.arm === arm).answer;
    assert.equal(row.answerSerializedSha256, sha(JSON.stringify(literal)));
    assert.match(row.responseArtifactSha256, /^[a-f0-9]{64}$/u);
  }
  assert.equal(report.summaries.A.all.completed, 22); assert.equal(report.summaries.A.all.failed, 2);
  assert.equal(report.summaries.A.all.correctness.unresolved, 3);
  assert.equal(report.summaries.A.all.unsupported.unobservedQuestions, 3);
  assert.equal(report.summaries.C.all.unsupported.unobservedQuestions, 1);
  assert.equal(report.harms.AB.known, false); assert.equal(report.gate.mechanismPromising, false);
});

test('SC6/SM1: genuine pre-start and inspected-but-unretained-history halts retain unknown resource coverage and all denominators', async () => {
  for (const mode of ['before-start', 'checkpoint-mismatch', 'replacement', 'unaffordable', 'read-state-drift', 'pre-dispatch-failure']) {
    const f = fixtures[mode], prepared = await prepareCardPlanScoring(f.input); valid(prepared, true);
    const report = await assess(f); valid(report); assert.equal(report.runtime.status, 'halted');
    assert.equal(report.resources.compliance.status, 'unverified'); assert.equal(report.gate.mechanismPromising, false);
    if (!['replacement', 'read-state-drift', 'pre-dispatch-failure'].includes(mode)) for (const arm of ['A', 'B', 'C']) {
      const s = report.summaries[arm].all; assert.equal(s.notRun, 24);
      assert.deepEqual(s.correctness, { correct: 0, incorrect: 0, unresolved: 24 });
      assert.equal(s.supportedCorrect.false, 24); assert.equal(s.unsupported.unobservedQuestions, 24);
      assert.equal(report.resources.initialReservedMicroUsd, null);
      assert.equal(report.provenance.originalHistory, null);
      assert.equal(s.anchors.unknown, 102); assert.equal(s.anchors.present, 0); assert.equal(s.anchors.absent, 0);
    }
    if (mode === 'read-state-drift') {
      assert.equal(report.mechanical.selections[0].execution, 'failed');
      assert.equal(report.mechanical.selections[0].evidence.completeRequired, false);
      assert.equal(report.summaries.A.all.anchors.unknown, 102);
    }
    if (mode === 'pre-dispatch-failure') {
      assert.equal(report.resources.physicalCalls, 0); assert.equal(report.resources.reservedIntents, 1);
      assert.equal(report.resources.unknownCostCalls, 1);
    }
  }
});

// Clone retained data and rebind byte descriptors/index. This intentionally
// does NOT regenerate derived preparation/run identities. Each attack below
// asserts its actual targeted reason, including explicitly named outer rejects.
function tampered(fixture, changes) {
  const input = clone(fixture.input), map = new Map(input.artifacts.map(row => [row.name, row]));
  for (const [name, change] of changes) {
    const entry = map.get(name); assert(entry, name);
    if (typeof change === 'string') entry.text = change;
    else { const parsed = JSON.parse(entry.text); change(parsed); entry.text = JSON.stringify(parsed); }
  }
  for (let pass = 0; pass < 4; pass++) for (const row of input.artifacts.filter(row => row.name.endsWith('.json'))) {
    const parsed = JSON.parse(row.text);
    const walk = value => {
      if (!value || typeof value !== 'object') return;
      if (typeof value.path === 'string' && typeof value.sha256 === 'string' && typeof value.bytes === 'number') {
        const target = map.get(basename(value.path));
        if (target) { value.bytes = Buffer.byteLength(target.text); value.sha256 = sha(target.text); }
      }
      Object.values(value).forEach(walk);
    };
    walk(parsed); row.text = JSON.stringify(parsed);
  }
  input.execution.artifactIndexSha256 = sha(JSON.stringify(indexOf(input.artifacts)));
  return input;
}

// Public response controls alter only retained copies, preserving all derived
// post/descriptor identities. They never represent genuine provider outputs.
function responseTampered(fixture, intent, text, { wrongBytes = false, responseSha256, responseBytes } = {}) {
  const name = basename(intent.post.responseArtifact.path);
  const changes = [[name, text]];
  for (const artifact of fixture.input.artifacts.filter(a => a.name.endsWith('.json'))) {
    changes.push([artifact.name, value => {
      const walk = row => {
        if (!row || typeof row !== 'object') return;
        if (row.attemptId === intent.attemptId && row.phase === 'post') {
          if (Object.hasOwn(row, 'responseSha256')) row.responseSha256 = responseSha256 ?? sha(text);
          if (Object.hasOwn(row, 'responseBytes')) row.responseBytes = responseBytes ?? Buffer.byteLength(text) + Number(wrongBytes);
        }
        Object.values(row).forEach(walk);
      };
      walk(value);
    }]);
  }
  return tampered(fixture, changes);
}

test('R1/SC4–SC5: public strict CW grammar and successful body proof, without widening ordinary grammar', async t => {
  const f = fixtures.complete, before = sha(JSON.stringify(f.input));
  valid(await prepareCardPlanScoring(f.input), true);
  const find = (slotId, count = false) => f.report.attempts.find(r => r.slotId === slotId
    && (!slotId.includes('selection') || (r.post.kind === 'count' || r.post.endpoint === 'responses/input_tokens') === count));
  const bc = find('CQ01-selection-B', true), bg = find('CQ01-selection-B'),
    ac = find('CQ01-selection-A', true), ag = find('CQ01-selection-A'), aa = find('CQ01-answer-A');
  const textOf = intent => f.input.artifacts.find(a => a.name === basename(intent.post.responseArtifact.path)).text;
  const btext = textOf(bg), proposal = JSON.parse(btext);
  proposal.output[0].content[0].text = proposal.output[0].content[0].text.replace('{"selectedCards":', '{"selectedCards":[],"selectedCards":');
  const pad = (intent, bytes) => textOf(intent) + ' '.repeat(bytes - Buffer.byteLength(textOf(intent)));
  const withField = (value, child) => JSON.stringify({ ...value, unused: child });
  const nodes = value => 1 + (value && typeof value === 'object' ? Object.values(value).reduce((n, v) => n + nodes(v), 0) : 0);
  const body = JSON.parse(btext), nodeBoundary = withField(body, Array(100000 - nodes(body) - 1).fill(0));
  let depth32 = 0; for (let i = 0; i < 31; i++) depth32 = [depth32];
  const negatives = [
    ['decoded-envelope-duplicate', bg, btext.replace('"status":"completed"', '"status":"completed","\\u0073tatus":"completed"'), 'cw_response_json_mismatch'],
    ['proposal-duplicate', bg, JSON.stringify(proposal), 'cw_response_json_mismatch'],
    ['usage-duplicate', bg, btext.replace('"input_tokens":100', '"input_tokens":100,"input_tokens":100'), 'cw_response_json_mismatch'],
    ['count-duplicate', bc, textOf(bc).replace('"input_tokens":100', '"input_tokens":100,"input_tokens":100'), 'cw_response_json_mismatch'],
    ['count-extra-field', bc, withField(JSON.parse(textOf(bc)), 0), 'count_response_mismatch'],
    ['nodes-100001', bg, withField(body, Array(100001 - nodes(body) - 1).fill(0)), 'cw_response_json_mismatch'],
    ['depth-33', bg, withField(body, [depth32]), 'cw_response_json_mismatch'],
    ['CW-count-65537', bc, pad(bc, 65537), 'successful_response_bounds_mismatch'],
    ['CW-generation-262145', bg, pad(bg, 262145), 'successful_response_bounds_mismatch'],
    ['ordinary-count-65537', ac, pad(ac, 65537), 'successful_response_bounds_mismatch'],
    ['ordinary-generation-262145', ag, pad(ag, 262145), 'successful_response_bounds_mismatch'],
    ['ordinary-answer-262145', aa, pad(aa, 262145), 'successful_response_bounds_mismatch'],
    ['ordinary-wrong-responseBytes', aa, textOf(aa), 'successful_response_bytes_mismatch', { wrongBytes: true }],
    ['CW-missing-original-hash', bg, btext, 'insufficient_original_cw_proof', { responseSha256: 'not-a-hash' }],
    ['CW-different-original-hash', bg, btext, 'insufficient_original_cw_proof', { responseSha256: '0'.repeat(64) }],
  ];
  for (const [name, intent, text, reason, options] of negatives) await t.test(name, async () => {
    if (intent.post.kind) assert.equal(redactSecrets(text), text, 'direct CW identity, not transformed raw invention');
    denied(await prepareCardPlanScoring(responseTampered(f, intent, text, options)), reason);
  });
  const positives = [
    ['ordinary-duplicate', ac, textOf(ac).replace('"input_tokens":100', '"input_tokens":100,"input_tokens":100')],
    ['CW-count-65536', bc, pad(bc, 65536)], ['CW-generation-262144', bg, pad(bg, 262144)],
    ['ordinary-count-65536', ac, pad(ac, 65536)], ['ordinary-answer-262144', aa, pad(aa, 262144)],
    ['CW-nodes-100000', bg, nodeBoundary], ['CW-depth-32', bg, withField(body, depth32)],
  ];
  for (const [name, intent, text] of positives) await t.test(name, async () => {
    if (intent.post.kind) assert.equal(redactSecrets(text), text);
    valid(await prepareCardPlanScoring(responseTampered(f, intent, text)), true);
  });
  assert.equal(sha(JSON.stringify(f.input)), before);
});

test('R1/SC4: genuine successful CW redaction lacks original proof; genuine failed redaction remains failure', async () => {
  const success = fixtures['CW-transformed-success'], failed = fixtures['CW-redacted-failure'];
  for (const f of [success, failed]) {
    assert.equal(f.report.status, 'halted'); assert.equal(f.report.failure.code, 'card_plan_persistence_failure');
    assert.equal(f.report.cases.length, 24); assert.equal(f.report.cases.flatMap(c => c.answers).length, 72);
  }
  const successfulSlot = success.report.cases[0].selections[1];
  assert.equal(successfulSlot.status, 'completed');
  const post = success.report.attempts.find(r => r.slotId === successfulSlot.slotId && r.post.kind === 'generation').post;
  const text = success.input.artifacts.find(a => a.name === basename(post.responseArtifact.path)).text;
  assert.equal(post.outcome, 'succeeded'); assert.match(post.responseSha256, /^[a-f0-9]{64}$/u);
  assert.notEqual(post.responseSha256, sha(text)); assert(text.includes('[REDACTED]'));
  const reportHash = sha(JSON.stringify(success.report)), inputHash = sha(JSON.stringify(success.input));
  denied(await prepareCardPlanScoring(success.input), 'insufficient_original_cw_proof');
  denied(await assess(success), 'insufficient_original_cw_proof');
  assert.equal(sha(JSON.stringify(success.report)), reportHash); assert.equal(sha(JSON.stringify(success.input)), inputHash);
  const failedSlot = failed.report.cases[0].selections[1];
  assert.equal(failedSlot.status, 'failed');
  const failedPost = failed.report.attempts.find(r => r.slotId === failedSlot.slotId).post;
  assert.notEqual(failedPost.outcome, 'succeeded');
  const failedText = failed.input.artifacts.find(a => a.name === basename(failedPost.responseArtifact.path)).text;
  assert.notEqual(failedPost.responseSha256, sha(failedText)); assert(failedText.includes('[REDACTED]'));
  const prepared = await prepareCardPlanScoring(failed.input); valid(prepared, true);
  const selection = prepared.mechanical.selections.find(s => s.slotId === failedSlot.slotId);
  assert.equal(selection.evidence.status, 'unobserved'); assert.equal(selection.evidence.completeRequired, false);
  assert.equal(prepared.mechanical.answers.find(s => s.slotId === 'CQ01-answer-B').judgeEligibility.status, 'excluded');
  console.log('CARD_SCORING_R1_REDACTION=' + JSON.stringify({ success: { slot: successfulSlot.status, post: post.outcome,
    rawSha256: post.responseSha256, retainedSha256: sha(text), physicalCalls: success.calls.length },
    failed: { slot: failedSlot.status, failure: failedSlot.failure, post: failedPost.outcome, failureCode: failedPost.failureCode,
      rawSha256: failedPost.responseSha256, retainedSha256: sha(failedText), physicalCalls: failed.calls.length } }));
});

test('BOM/SC5: genuine ordinary physical byte limits retain BOM while decoded responseBytes excludes exactly one', async () => {
  const f = fixtures['ordinary-BOM-boundaries'], before = sha(JSON.stringify(f.input));
  assert.equal(f.calls.length, 7); assert.equal(f.records.length, 14); assert.equal(f.report.status, 'halted');
  assert.deepEqual(f.report.cases[0].selections.map(s => s.status), ['completed', 'completed']);
  assert.deepEqual(f.report.cases[0].answers.map(s => s.status), ['completed', 'completed', 'failed']);
  valid(await prepareCardPlanScoring(f.input), true); const assessed = await assess(f); valid(assessed);
  const ordinary = f.report.attempts.filter(r => !Object.hasOwn(r.post, 'kind'));
  assert.equal(ordinary.length, 5, 'A count/generation and all three ordinary answer transports');
  for (const intent of ordinary) {
    const text = f.input.artifacts.find(a => a.name === basename(intent.post.responseArtifact.path)).text;
    const maximum = intent.post.endpoint === 'responses/input_tokens' ? 65536 : 262144;
    assert.equal(intent.post.outcome, 'succeeded'); assert.equal(text.codePointAt(0), 0xfeff);
    assert.equal(Buffer.byteLength(text), maximum); assert.equal(intent.post.responseBytes, maximum - 3);
    assert.equal(intent.post.responseArtifact.sha256, sha(text), 'literal retained BOM remains bound');
    assert.equal(Buffer.byteLength(new TextDecoder('utf8', { fatal: true }).decode(Buffer.from(text))), maximum - 3);
    denied(await prepareCardPlanScoring(responseTampered(f, intent, text)), 'successful_response_bytes_mismatch');
    const oversized = text + ' ';
    denied(await prepareCardPlanScoring(responseTampered(f, intent, oversized,
      { responseBytes: Buffer.byteLength(oversized) - 3 })), 'successful_response_bounds_mismatch');
  }
  const count = ordinary.find(r => r.post.endpoint === 'responses/input_tokens');
  const countText = f.input.artifacts.find(a => a.name === basename(count.post.responseArtifact.path)).text;
  const doubleBOM = '\uFEFF\uFEFF' + JSON.stringify(JSON.parse(countText.slice(1)));
  denied(await prepareCardPlanScoring(responseTampered(f, count, doubleBOM,
    { responseBytes: Buffer.byteLength(doubleBOM) - 3 })), 'successful_transport_mismatch');
  assert.equal(sha(JSON.stringify(f.input)), before);
  console.log('CARD_SCORING_BOM=' + JSON.stringify({ actualRuntimeOutput: true,
    ordinaryPosts: ordinary.map(r => ({ slotId: r.slotId, endpoint: r.post.endpoint,
      outcome: r.post.outcome, retainedBytes: r.post.responseArtifact.bytes, decodedResponseBytes: r.post.responseBytes })),
    eligible: assessed.mechanical.answers.filter(r => r.judgeEligibility.status === 'eligible').map(r => r.slotId) }));
});

test('SC1–SC6: literal tamper classes deny integrity with no scores, gains or repairs', async t => {
  const f = fixtures.complete;
  const attacks = [
    ['source-raw', () => ({ ...f.input, sourceRaw: sourceRaw + ' ' })],
    ['rubric-raw', () => ({ ...f.input, rubricRaw: rubricRaw + ' ' })],
    ['runtime-pin', () => ({ ...f.input, execution: { ...f.input.execution, runtimeCommitSha: '0'.repeat(40) } })],
    ['artifact-index', () => ({ ...f.input, execution: { ...f.input.execution, artifactIndexSha256: '0'.repeat(64) } })],
    ['missing-case', () => {
      const input = clone(f.input); input.artifacts = input.artifacts.filter(row => row.name !== 'CQ24-preparation.json');
      input.execution.artifactIndexSha256 = sha(JSON.stringify(indexOf(input.artifacts))); return input;
    }],
    ['missing-read', () => tampered(f, [['CQ01-selection-B.json', slot => { slot.authoritativeReads.pop(); }]])],
    ['capture-role', () => tampered(f, [['CQ01-preparation.json', c => { c.captures[0].receipts[0].role = 'assistant'; }]])],
    ['snapshot', () => tampered(f, [['CQ01-preparation.json', c => { c.stateAfter.logical.userVersion++; }]])],
    ['ordinary-prompt', () => tampered(f, [['CQ01-preparation.json', c => { c.rankRequest.system += ' '; }]])],
    ['ordinary-query', () => tampered(f, [['CQ01-preparation.json', c => { c.rankRequest.input.query += ' changed'; }]])],
    ['compiled-selection', () => tampered(f, [['CQ01-selection-B.json', slot => { slot.assembly.proposal.selectedCards.reverse(); }]])],
    ['shared-C-selection', () => tampered(f, [['CQ01-answer-C.json', slot => { slot.selectionSlotId = 'CQ01-selection-A'; }]])],
    ['answer-request', () => tampered(f, [['CQ01-answer-B.json', slot => { slot.requestBody += ' '; }]])],
    ['organization', () => tampered(f, [['CQ01-answer-C.json', slot => {
      const user = JSON.parse(slot.packed.request.messages[1].content), card = JSON.parse(user.evidence[0].text);
      card.unverifiedOrganization.chains = []; user.evidence[0].text = JSON.stringify(card);
      slot.packed.request.messages[1].content = JSON.stringify(user);
    }]])],
    ['reservation', () => tampered(f, [['comparison-report.json', r => { r.attempts[0].reservedMicroUsd = 1; }]])],
    ['owner-delta', () => tampered(f, [['checkpoint-0001.json', row => { row.after.reservedMicroUsd++; }]])],
    ['post-record', () => tampered(f, [['record-0002.json', row => { row.actualMicroUsd = 0; }]])],
    ['response-body', () => {
      const input = clone(f.input), entry = input.artifacts.find(row => row.name.endsWith('-response.txt'));
      entry.text += ' '; input.execution.artifactIndexSha256 = sha(JSON.stringify(indexOf(input.artifacts))); return input;
    }],
    ['duplicate-artifact', () => ({ ...f.input, artifacts: [...f.input.artifacts.slice(0, -1), f.input.artifacts[0]] })],
    ['foreign-name', () => ({ ...fixtures['before-start'].input,
      artifacts: [...fixtures['before-start'].input.artifacts, { name: 'foreign.json', text: '{}' }] })],
    ['parent-path', () => ({ ...f.input, artifacts: [{ name: '../preparation.json', text: '{}' }, ...f.input.artifacts.slice(1)] })],
    ['raw-metadata-duplicate-key', () => {
      const input = clone(f.input), row = input.artifacts.find(row => row.name === 'preparation.json');
      row.text = '{"version":"discarded",' + row.text.slice(1);
      input.execution.artifactIndexSha256 = sha(JSON.stringify(indexOf(input.artifacts))); return input;
    }],
    ['fake-empty-success', () => tampered(fixtures.edges, [['CQ02-answer-A.json', slot => {
      slot.status = 'completed'; slot.disposition = 'answered'; slot.answer = ''; slot.failure = null;
    }]])],
    ['invent-original-history', () => ({ ...fixtures['checkpoint-mismatch'].input, execution: {
      ...fixtures['checkpoint-mismatch'].input.execution, originalHistoryHeader: headerOf(fixtures['checkpoint-mismatch'].initial) } })],
  ];
  const reasons = {
    'source-raw': 'source_identity_mismatch', 'rubric-raw': 'rubric_identity_mismatch', 'runtime-pin': 'runtime_pin_mismatch',
    'artifact-index': 'artifact_index_mismatch', 'missing-case': 'missing_referenced_artifact', 'missing-read': 'authoritative_read_mismatch',
    'capture-role': 'capture_source_mismatch', snapshot: 'snapshot_identity_mismatch', 'ordinary-prompt': 'ordinary_prompt_or_candidates_mismatch',
    'ordinary-query': 'frozen_rank_query_or_limits_mismatch',
    'compiled-selection': 'compiled_selection_mismatch', 'shared-C-selection': 'slot_summary_mismatch', 'answer-request': 'literal_request_mismatch',
    organization: 'answer_projection_mismatch', reservation: 'reservation_mismatch', 'owner-delta': 'checkpoint_artifact_mismatch',
    'post-record': 'post_record_mismatch', 'response-body': 'artifact_descriptor_mismatch', 'duplicate-artifact': 'artifact_name_or_duplicate',
    'foreign-name': 'artifact_name_or_duplicate', 'parent-path': 'artifact_name_or_duplicate',
    'raw-metadata-duplicate-key': 'noncanonical_metadata_json', 'fake-empty-success': 'slot_summary_mismatch',
    'invent-original-history': 'unretained_history_mismatch',
  };
  for (const [name, change] of attacks) await t.test(name, async () => {
    const input = change(); denied(await prepareCardPlanScoring(input), reasons[name]);
    denied(await scoreCardPlanComparison({ ...input, firstResponses: scriptedResponses(f) }), reasons[name]);
  });
});

test('SC2: descriptor-first input denial rejects poison, cycles, sparse arrays and bounds without executing hooks', async t => {
  let hooks = 0;
  const f = fixtures.complete;
  const attacks = [
    ['getter', () => Object.defineProperty({ ...f.input }, 'artifacts', { enumerable: true, get() { hooks++; return []; } })],
    ['proxy', () => new Proxy({}, { ownKeys() { hooks++; return []; }, getPrototypeOf() { hooks++; return Object.prototype; } })],
    ['inherited-hook', () => Object.setPrototypeOf({ ...f.input }, { toJSON() { hooks++; return {}; } })],
    ['sparse', () => { const input = clone(f.input); delete input.artifacts[0]; return input; }],
    ['cycle', () => { const input = clone(f.input); input.execution = input; return input; }],
    ['unknown-field', () => ({ ...f.input, extra: true })],
    ['equal-seeds', () => ({ ...f.input, judgeSeeds: { AB: judgeSeeds.AB, C: judgeSeeds.AB } })],
    ['uppercase-seed', () => ({ ...f.input, judgeSeeds: { ...judgeSeeds, AB: 'AB'.repeat(32) } })],
    ['excess-files', () => ({ ...f.input, artifacts: Array.from({ length: 940 }, (_, i) => ({ name: `foreign-${i}.json`, text: '{}' })) })],
    ['metadata-file-bound', () => ({ ...f.input, artifacts: [{ name: 'preparation.json', text: ' '.repeat(8388609) }] })],
    ['response-file-bound', () => ({ ...f.input, artifacts: [{ name: `${randomUUID()}-response.txt`, text: ' '.repeat(786433) }] })],
  ];
  for (const [name, change] of attacks) await t.test(name, async () => { denied(await prepareCardPlanScoring(change())); });
  assert.equal(hooks, 0);
});

test('SC1: source trace keeps scoring evaluator-only and trusted imports free of runtime creation/discovery', () => {
  const text = readFileSync(new URL('../card-plan-scoring.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /from ['"][^'"]*(?:card-plan-runner|card-plan-store|experiment-budget|\/transport|\/core\/contract)[^'"]*['"]/u);
  assert.doesNotMatch(text, /\b(?:fetch|readFileSync|writeFileSync|DatabaseSync|openMemoryCore|runCardPlanComparison)\s*\(/u);
});

test('ST2: caller mutation after invocation cannot rewrite retained header, first responses or input artifacts', async () => {
  const f = fixtures.complete, input = clone(f.input), firstResponses = scriptedResponses(f);
  const pending = scoreCardPlanComparison({ ...input, firstResponses });
  input.execution.originalHistoryHeader.limitMicroUsd = 1;
  firstResponses.AB[0].rawResponse = null; firstResponses.C.reverse();
  input.artifacts[0].text = '{}';
  const result = await pending; valid(result);
  assert.equal(result.gate.mechanismPromising, true);
  assert.equal(result.provenance.originalHistory.header.limitMicroUsd, 400000000);
  assert.equal(result.judgments.AB.judges[0].status, 'valid');
  assert.equal(Object.isFrozen(input.execution.originalHistoryHeader), false, 'caller object never frozen');
});

test('ST2/SM2: net source gains subtract genuine losses; known claim offsets do not conceal claim-level increases', async () => {
  const loss = await assess(fixtures['net-loss']); valid(loss);
  assert.deepEqual(loss.paired.BminusA.completeRequiredGains, ['CQ01', 'CQ02', 'CQ03']);
  assert.deepEqual(loss.paired.BminusA.completeRequiredLosses, ['CQ04', 'CQ05', 'CQ06']);
  assert.equal(loss.paired.BminusA.completeRequiredNet, 0);
  assert(loss.gate.reasons.includes('net-complete-required-gain-below-one'));
  const offset = await assess(fixtures.complete, ({ row, arm, caseId, item }) => {
    if (arm === 'A' && caseId === 'CQ08' || arm === 'B' && caseId === 'CQ09') row.staleClaims = field(2, item.originalSources[0]);
  });
  assert.equal(offset.harms.AB.stale.addedQuestions, 0); assert.equal(offset.harms.AB.stale.addedClaims, 0);
  assert.equal(offset.gate.mechanismPromising, true, 'known aggregate stale offsets permitted; severe remains per-condition');
  for (const name of ['unsupportedClaims', 'staleClaims']) {
    const result = await assess(fixtures.complete, ({ row, arm, caseId, item }) => {
      if (arm !== 'C' && caseId === 'CQ08') {
        row[name] = field(arm === 'A' ? 1 : 2, item.answer);
        if (name === 'unsupportedClaims') row.support = field('no', item.answer);
      }
    });
    const label = name === 'unsupportedClaims' ? 'unsupported' : 'stale';
    assert.equal(result.harms.AB[label].addedQuestions, 0); assert.equal(result.harms.AB[label].addedClaims, 1);
    assert.equal(result.paired.BminusA.supportedCorrect.lower, 3);
    assert.equal(result.gate.mechanismPromising, false); assert(result.gate.reasons.includes(`${label}-harm-increased`));
  }
});

test('ST2/SJ3: malformed refs/items stay fieldwise unknown; literal first artifacts are unchanged', async () => {
  const f = fixtures.complete;
  const firstResponses = scriptedResponses(f), raw = JSON.parse(firstResponses.AB[0].rawResponse);
  raw.items[0].correctness.refs[0].end = 999999;
  raw.items[1].unsupportedClaims.refs[0].targetId = 'missing-target';
  raw.items[2].severe[0].refs = [];
  firstResponses.AB[0].rawResponse = JSON.stringify(raw);
  const report = await scoreCardPlanComparison({ ...f.input, firstResponses }); valid(report);
  assert.equal(report.judgments.AB.judges[0].rawResponse, firstResponses.AB[0].rawResponse);
  assert.equal(report.judgments.AB.judges[0].status, 'partial');
  assert(report.judgments.AB.items.some(row => row.fields.correctness.reason === 'invalid-or-missing'));
  assert(report.judgments.AB.items.some(row => row.fields.unsupportedClaims.reason === 'invalid-or-missing'));
  assert(report.judgments.AB.items.some(row => row.severe.some(f => f.reason === 'invalid-or-missing')));
  assert.equal(report.gate.mechanismPromising, false);
});

test('ST2/SC6: exact pinned ordinary estimator, arbitrary cost tamper and history affordability/identity reasons', async t => {
  const f = fixtures.complete, small = f.report.attempts.find(row => row.slotId === 'CQ08-answer-A');
  const postName = `record-${String(small.post.sequence).padStart(4, '0')}.json`;
  const cp = f.report.checkpoints.find(row => row.slotId === small.slotId);
  const changed = tampered(f, [[postName, row => { row.actualMicroUsd = 6; }],
    [`checkpoint-${String(cp.sequence).padStart(4, '0')}.json`, row => { row.deltas[0].actualMicroUsd = 6; }],
    ['comparison-report.json', row => {
      row.attempts.find(r => r.attemptId === small.attemptId).post.actualMicroUsd = 6;
      row.checkpoints.find(r => r.slotId === small.slotId).deltas[0].actualMicroUsd = 6;
      row.ledgerReconciliation.appendedAttempts.find(r => r.attemptId === small.attemptId).actualMicroUsd = 6;
      row.resources.partialKnownMicroUsd--;
    }]]);
  denied(await prepareCardPlanScoring(changed), 'known_cost_mismatch');
  const controls = [
    ['ceiling', h => { h.limitMicroUsd = 400000001; }, 'history_affordability_mismatch'],
    ['protected-and-stricter-floor', h => { h.reservedMicroUsd = 360000001; }, 'history_affordability_mismatch'],
    ['request-floor', h => { h.requestCap = 1967; }, 'history_affordability_mismatch'],
    ['state', h => { h.state = 'overrun'; }, 'history_affordability_mismatch'],
    ['count', h => { h.requestCount++; }, 'history_descriptor_mismatch'],
    ['history-hash', h => { h.historySha256 = '0'.repeat(64); }, 'history_descriptor_mismatch'],
    ['fixed-run-id', h => { h.runId = randomUUID(); }, 'final_ledger_identity_mismatch'],
  ];
  for (const [name, change, reason] of controls) await t.test(name, async () => {
    const input = clone(f.input); change(input.execution.originalHistoryHeader);
    denied(await prepareCardPlanScoring(input), reason);
  });
});

test('ST2/SC4: semantic-equal but literal-different ordinary request is not repaired', async () => {
  const f = fixtures.complete, first = f.report.attempts[0], requestName = basename(first.requestArtifact.path);
  const old = f.input.artifacts.find(row => row.name === requestName).text, changed = old + ' ';
  assert.deepEqual(JSON.parse(old), JSON.parse(changed));
  const update = row => { row.requestBytes = Buffer.byteLength(changed); row.localInputTokens = countOpenAITokens(changed); };
  const input = tampered(f, [[requestName, changed], ['record-0001.json', update], ['record-0002.json', update],
    ['comparison-report.json', row => { update(row.attempts[0].post); }]]);
  denied(await prepareCardPlanScoring(input), 'literal_request_mismatch');
});

test('ST2/SC2: reachable aggregate/count/node/depth/key bounds reject before identity use', async t => {
  const f = fixtures.complete;
  const cases = [
    ['metadata-aggregate', () => Array.from({ length: 9 }, (_, i) => ({
      name: `CQ${String(i + 1).padStart(2, '0')}-preparation.json`, text: JSON.stringify({ pad: 'x'.repeat(7500000) }) })), 'metadata_aggregate_limit'],
    ['metadata-nodes', () => [{ name: 'preparation.json', text: JSON.stringify({ pad: Array(2000001).fill(0) }) }], 'metadata_traversal_limit'],
    ['metadata-depth', () => {
      let nested = 0; for (let i = 0; i < 33; i++) nested = { nested };
      return [{ name: 'preparation.json', text: JSON.stringify(nested) }];
    }, 'metadata_traversal_limit'],
    ['request-count', () => Array.from({ length: 169 }, () => ({ name: `${randomUUID()}-request.txt`, text: '{}' })), 'body_count_limit'],
    ['response-count', () => Array.from({ length: 169 }, () => ({ name: `${randomUUID()}-response.txt`, text: '{}' })), 'body_count_limit'],
    ['request-size', () => [{ name: `${randomUUID()}-request.txt`, text: 'x'.repeat(262145) }], 'artifact_file_limit'],
    ['illegal-key', () => [{ name: 'preparation.json', text: '{"__proto__":1}' }], 'invalid_metadata_key'],
    ['illegal-identity-unicode', () => [{ name: 'preparation.json', text: JSON.stringify({ identity: '\ud800' }) }], 'invalid_metadata_unicode'],
  ];
  for (const [name, artifacts, reason] of cases) await t.test(name, async () => {
    denied(await prepareCardPlanScoring({ ...f.input, artifacts: artifacts() }), reason);
  });
  const early = fixtures['before-start'], input = clone(early.input);
  input.artifacts.push({ name: 'CQ01-answer-B.json', text: '{}' });
  input.execution.artifactIndexSha256 = sha(JSON.stringify(indexOf(input.artifacts)));
  denied(await prepareCardPlanScoring(input), 'unreferenced_artifact');
});

test('ST2: explicit owned cleanup runs after setup/assertion failure and is idempotent', async () => {
  for (const mode of ['setup', 'assertion']) {
    const owner = createTestWorkspace(null, { prefix: `card-scoring-${mode}-cleanup-` });
    let caught = false;
    try { if (mode === 'setup') throw Error('synthetic-setup-failure'); assert.fail('synthetic-assertion-failure'); }
    catch { caught = true; }
    finally { await owner.cleanup(); await owner.cleanup(); }
    assert.equal(caught, true); await assert.rejects(access(owner.path), { code: 'ENOENT' });
  }
});
