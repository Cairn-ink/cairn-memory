import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { countOpenAITokens } from '../../../adapters/openai/index.mjs';
import { prepareSourceCompetitionBatch, compileSourceCompetitionBatch } from '../../source-competition/index.mjs';
import { runSourceCompetition } from '../../source-competition/operator.mjs';
import { authorizeSourceCompetitionCapability } from '../../experiment-budget/request-guard.mjs';
import { inspectEmbeddingExperimentBudgetSnapshot } from '../../experiment-budget/index.mjs';
import { sourceRoleFixture, checkpointOptions, settleFixture, fakeResponse, urls } from '../../experiment-budget/test/source-role-ablation-fixture.mjs';

const sources = JSON.parse(readFileSync(new URL('../../source-competition/sources.json', import.meta.url)));
const evaluator = JSON.parse(readFileSync(new URL('../../source-competition/evaluator.json', import.meta.url)));
const plain = value => JSON.parse(JSON.stringify(value));
async function setup(t) {
  const f = sourceRoleFixture(t);
  f.capability = await authorizeSourceCompetitionCapability(checkpointOptions(f, {
    authorizationId: 'competition-operator-auth', executionId: 'competition-operator-execution' }));
  return f;
}
const options = (f, fetchImpl, persistSlot) => ({ ledger: f.ledger, policy: f.policy,
  benchmarkExtension: f.benchmarkExtension, sourceCompetitionCapability: f.capability,
  apiKey: 'synthetic-private-key-never-report', fetchImpl, persistSlot });
const item = (content = 'A bounded synthetic observation.', sourceIndices = [0]) =>
  ({ content, kind: 'fact', confidence: 0.9, sourceIndices });

test('C1 split assets exactly reconstruct frozen corpus, sixteen anchors and independent source-only preparation', () => {
  const reconstructed = { version: 'source-competition-preparation-v1',
    cases: sources.cases.map(source => ({ ...source,
      evaluator: evaluator.cases.find(row => row.ordinal === source.ordinal).evaluator })),
    prospectiveGate: evaluator.prospectiveGate };
  assert.equal(createHash('sha256').update(JSON.stringify(reconstructed, null, 2) + '\n').digest('hex'),
    evaluator.frozenCorpusSha256);
  assert.equal(sources.cases.length, 8);
  assert.equal(evaluator.prospectiveGate.achievableAnchors, 16);
  assert.equal(Object.hasOwn(sources, 'prospectiveGate'), false);
  assert.equal(sources.cases.every(row => !Object.hasOwn(row, 'evaluator')), true);
  const compiler = readFileSync(new URL('../../source-competition/index.mjs', import.meta.url), 'utf8');
  assert.equal(/JSON\.parse[^\n]*evaluator|import[^\n]*evaluator/.test(compiler), false);
  for (const source of sources.cases) {
    const control = prepareSourceCompetitionBatch({ ordinal: source.ordinal, arm: 'control', subBatch: 1 });
    const candidates = [1, 2].map(subBatch => prepareSourceCompetitionBatch({ ordinal: source.ordinal, arm: 'candidate', subBatch }));
    assert.deepEqual(candidates.flatMap(row => row.messageIndices), control.messageIndices);
    assert.deepEqual(plain(candidates.flatMap(row => row.snapshot.messages)), plain(control.snapshot.messages));
    const fromOriginal = candidates.flatMap(row => row.messageIndices.map(index => source.messages[index]));
    assert.deepEqual(fromOriginal, source.messages);
    assert.equal(candidates.every(row => row.catalog.entries.length <= 10 && row.localInputTokens <= 6000), true);
    assert.equal(control.request.system, candidates[0].request.system);
    assert.equal(control.request.system, candidates[1].request.system);
  }
  const late = prepareSourceCompetitionBatch({ ordinal: 2, arm: 'candidate', subBatch: 2 });
  assert.equal(late.catalog.entries.some(entry => entry.id === 'sc-2-m-11' && entry.start >= 1600), true);
  const correction = [1, 2].map(subBatch => prepareSourceCompetitionBatch({ ordinal: 5, arm: 'candidate', subBatch }));
  assert.equal(correction[0].messageIndices.includes(9), true);
  assert.equal(correction[1].messageIndices.includes(10), true);
  assert.equal(correction[1].messageIndices.includes(11), true);
});

test('C2/C4 actual adapter compiler pins count then generation without binding or modifying parsed proposals', async () => {
  const proposal = { items: [item('Unchanged proposal.', [1000])], diagnosticExtra: 'must remain' };
  const compiled = await compileSourceCompetitionBatch({ ordinal: 1, arm: 'control', subBatch: 1, scriptedOutput: proposal });
  assert.deepEqual(plain(compiled.output), proposal);
  assert.deepEqual(compiled.httpBodies.map(row => row.endpoint), ['/v1/responses/input_tokens', '/v1/responses']);
  const body = JSON.parse(compiled.httpBodies[1].bodyText);
  assert.equal(body.instructions, compiled.request.system);
  assert.equal(body.model, 'gpt-4.1-mini-2025-04-14');
  assert.equal(body.max_output_tokens, 1024);
});

test('C4/C6 actual guarded operator completes 24 slots/16 arms/48 sends, persisting before next request', async t => {
  const f = await setup(t);
  let sends = 0;
  const persisted = [];
  const report = await runSourceCompetition(options(f, async url => {
    assert.equal(persisted.length, Math.floor(sends / 2), 'no next slot before persistence resolves');
    const state = inspectEmbeddingExperimentBudgetSnapshot(f.ledger);
    assert.equal(state.requestCount, 5 + sends + 1);
    assert.equal(state.attempts.at(-1).outcome, null);
    sends++;
    return fakeResponse(url, { items: [item()] });
  }, async row => {
    assert.equal(row.persistence, 'pending');
    assert.equal(row.slot, persisted.length + 1);
    persisted.push(row);
  }));
  assert.equal(report.status, 'completed');
  assert.equal(report.quality, 'unassessed');
  assert.deepEqual(plain(report.counts), { completed: 24, refused: 0, not_run: 0 });
  assert.equal(report.logicalArms.length, 16);
  assert.equal(report.logicalArms.every(row => row.status === 'completed'), true);
  assert.equal(sends, 48);
  assert.equal(persisted.length, 24);
  assert.equal(report.results.every(row => row.persistence === 'persisted' && row.parsedObservation.state === 'observed'), true);
  assert.equal(report.results.every(row => row.items.length === 1 && row.items[0].receipts.length === 1), true);
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.ledger).attempts.filter(row => row.outcome === null).length, 0);
  assert.equal(JSON.stringify(report).includes('synthetic-private-key-never-report'), false);
});

test('C4 binding refusal preserves entire parsed proposals, later valid batch continues and logical refusal stays visible', async t => {
  const f = await setup(t);
  let generations = 0;
  const proposal = { items: [item('First valid.', [0]), item('Later invalid.', [999])], untouched: ['extra', 'fields'] };
  const persisted = [];
  const report = await runSourceCompetition(options(f, async url => {
    const output = url === urls.generation && ++generations === 2 ? proposal : { items: [item()] };
    return fakeResponse(url, output);
  }, async row => { persisted.push(row); }));
  assert.equal(report.status, 'completed');
  assert.equal(report.results[1].status, 'refused');
  assert.deepEqual(plain(report.results[1].parsedObservation.output), proposal);
  assert.equal(report.results[1].items.length, 0, 'whole invalid subbatch refused, no repaired partial admission');
  assert.equal(report.results[2].status, 'completed');
  assert.equal(report.logicalArms.find(row => row.ordinal === 1 && row.arm === 'candidate').status, 'refused');
  assert.equal(persisted.length, 24);
  assert.deepEqual(plain(report.counts), { completed: 23, refused: 1, not_run: 0 });
  proposal.items[0].content = 'caller mutation';
  assert.equal(report.results[1].parsedObservation.output.items[0].content, 'First valid.');
  assert.equal(Object.isFrozen(report.results[1].parsedObservation.output.items), true);
});

test('C4 empty valid extraction is completed, not a structural refusal', async t => {
  const f = await setup(t);
  const report = await runSourceCompetition(options(f, async url => fakeResponse(url), async () => {}));
  assert.equal(report.results.every(row => row.status === 'completed' && row.items.length === 0), true);
});

test('C4 malformed provider response is unobserved, stops operation and retains all not-run positions', async t => {
  const f = await setup(t);
  let sends = 0;
  const report = await runSourceCompetition(options(f, async url => {
    sends++;
    return url === urls.count ? fakeResponse(url) : Response.json({ secretError: 'synthetic-private-key-never-report' });
  }, async () => {}));
  assert.equal(report.status, 'halted');
  assert.equal(report.results[0].parsedObservation.state, 'not_observed');
  assert.equal(report.results.slice(1).every(row => row.status === 'not_run'), true);
  assert.equal(report.logicalArms.length, 16);
  assert.equal(sends, 2);
  assert.equal(JSON.stringify(report).includes('synthetic-private-key-never-report'), false);
});

test('C4 malformed JSON, upstream output bounds and reachable observation depth refusal stay distinct', async t => {
  let nested = 'bounded leaf';
  for (let depth = 0; depth < 12; depth++) nested = { next: nested };
  const depthProposal = { items: [], extra: nested };
  const oversizedProposal = { items: [], extra: '界'.repeat(20_000) + '"'.repeat(3_000) };
  assert.ok(JSON.stringify(depthProposal).length < 40_000);
  assert.ok(countOpenAITokens(JSON.stringify(depthProposal)) <= 1024,
    'the depth probe must reach the observer through unchanged real output-token limits');
  assert.ok(JSON.stringify(oversizedProposal).length < 40_000);
  assert.ok(countOpenAITokens(JSON.stringify(oversizedProposal)) > 1024,
    'the earlier oversized fixture is an upstream rejection control, not an observer-byte probe');
  for (const mode of ['malformed', 'upstream-bounds', 'observation-depth']) {
    const f = await setup(t);
    let sends = 0;
    const report = await runSourceCompetition(options(f, async url => {
      sends++;
      if (url === urls.count) return fakeResponse(url);
      if (mode === 'upstream-bounds') return fakeResponse(url, oversizedProposal);
      if (mode === 'observation-depth') return fakeResponse(url, depthProposal);
      const response = await fakeResponse(url).json();
      response.output[0].content[0].text = 'not JSON';
      return Response.json(response);
    }, async () => {}));
    assert.equal(sends, 2);
    assert.equal(report.status, 'halted');
    assert.equal(report.results[0].status, 'refused');
    assert.equal(report.results[0].parsedObservation.state,
      mode === 'observation-depth' ? 'unavailable' : 'not_observed');
    assert.equal(report.results[0].parsedObservation.output, null);
    assert.equal(report.results.slice(1).every(row => row.status === 'not_run'), true);
  }
});

test('C4 persistence rejection and post-persist foreign history are distinct, both halt without replay', async t => {
  for (const mode of ['reject', 'foreign']) {
    const f = await setup(t);
    let sends = 0, persists = 0;
    const report = await runSourceCompetition(options(f, async url => { sends++; return fakeResponse(url); }, async () => {
      persists++;
      if (mode === 'reject') throw new Error('synthetic-private-key-never-report');
      settleFixture(f, 1, 1);
    }));
    assert.equal(report.status, 'halted');
    assert.equal(report.reason, mode === 'reject' ? 'persistence_failed' : 'execution_halted');
    assert.equal(report.results[0].persistence, mode === 'reject' ? 'failed' : 'persisted');
    assert.equal(report.results.slice(1).every(row => row.status === 'not_run'), true);
    assert.equal(sends, 2);
    assert.equal(persists, 1);
    assert.equal(JSON.stringify(report).includes('synthetic-private-key-never-report'), false);
  }
});

test('C4 transport rejection settles unknown, stops at two sends and exposes no exception text', async t => {
  const f = await setup(t);
  let sends = 0;
  const report = await runSourceCompetition(options(f, async url => {
    sends++;
    if (url === urls.generation) throw new Error('synthetic-private-key-never-report');
    return fakeResponse(url);
  }, async () => {}));
  assert.equal(sends, 2);
  assert.equal(report.status, 'halted');
  assert.equal(report.results[0].parsedObservation.state, 'not_observed');
  assert.equal(report.results[0].attempts[1].outcome, 'unknown');
  assert.equal(report.results.slice(1).every(row => row.status === 'not_run'), true);
  assert.equal(JSON.stringify(report).includes('synthetic-private-key-never-report'), false);
  const state = inspectEmbeddingExperimentBudgetSnapshot(f.ledger);
  assert.equal(state.requestCount, 7);
  assert.equal(state.attempts.filter(row => row.outcome === null).length, 0);
});

test('C4 option accessors reject without invocation, and configuration/callback data are detached', async t => {
  const f = await setup(t);
  let getterCalls = 0, sends = 0;
  const accessor = options(f, async url => { sends++; return fakeResponse(url); }, async () => {});
  Object.defineProperty(accessor, 'apiKey', { enumerable: true, get() { getterCalls++; return 'never'; } });
  await assert.rejects(runSourceCompetition(accessor), error => error.message === 'invalid_source_competition_operator');
  assert.equal(getterCalls, 0);
  assert.equal(sends, 0);
  const config = options(f, async url => { sends++; return fakeResponse(url); }, async () => {});
  const running = runSourceCompetition(config);
  config.sourceCompetitionCapability = { invalid: true };
  config.fetchImpl = () => assert.fail('mutated callback invoked');
  config.persistSlot = () => assert.fail('mutated callback invoked');
  const report = await running;
  assert.equal(report.status, 'completed');
  assert.equal(sends, 48);
});

test('C5 regression any observed candidate refusal dominates its later not-run subbatch', async t => {
  let sends = 0, generations = 0;
  const f = await setup(t);
  const report = await runSourceCompetition(options(f, async url => {
    sends++;
    if (url === urls.generation && ++generations === 2) return Response.json({ malformed: true });
    return fakeResponse(url, { items: [item()] });
  }, async () => {}));
  assert.equal(report.status, 'halted');
  assert.equal(sends, 4);
  assert.equal(report.results.length, 24);
  assert.deepEqual(plain(report.counts), { completed: 1, refused: 1, not_run: 22 });
  assert.equal(report.logicalArms.length, 16);
  assert.equal(report.results[0].status, 'completed');
  assert.equal(report.results[0].items[0].content, item().content);
  assert.equal(report.results[0].items[0].receipts.length, 1);
  assert.equal(report.results[0].persistence, 'persisted');
  assert.equal(report.results[1].status, 'refused');
  assert.equal(report.results[1].parsedObservation.state, 'not_observed');
  assert.equal(report.results[2].status, 'not_run');
  const candidate = report.logicalArms.find(row => row.ordinal === 1 && row.arm === 'candidate');
  assert.deepEqual([...candidate.slots], [2, 3]);
  assert.equal(candidate.status, 'refused');
});

test('C5 regression completed candidate subbatch plus later not-run remains not-run, with valid evidence intact', async t => {
  let sends = 0;
  const f = await setup(t);
  const report = await runSourceCompetition(options(f, async url => { sends++; return fakeResponse(url, { items: [item()] }); }, async row => {
    if (row.slot === 2) settleFixture(f, 1, 1);
  }));
  assert.equal(report.status, 'halted');
  assert.equal(report.reason, 'execution_halted');
  assert.equal(sends, 4);
  assert.deepEqual(plain(report.counts), { completed: 2, refused: 0, not_run: 22 });
  assert.equal(report.results.length, 24);
  assert.equal(report.logicalArms.length, 16);
  assert.equal(report.results[1].status, 'completed');
  assert.equal(report.results[1].persistence, 'persisted');
  assert.equal(report.results[1].items[0].content, item().content);
  assert.equal(report.results[1].items[0].receipts.length, 1);
  assert.equal(report.results[2].status, 'not_run');
  assert.equal(report.logicalArms.find(row => row.ordinal === 1 && row.arm === 'candidate').status, 'not_run');
});
