import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { assembleSourceLinkedEvidence } from '../../architecture/source-linked-evidence-model.mjs';
import { assembleSourceDiverseSelection } from '../../architecture/source-diverse-selection-model.mjs';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade,
  inspectEmbeddingExperimentBudgetSnapshot, upgradeExperimentBudgetForEmbeddings } from '../../experiment-budget/index.mjs';
import { createAlgorithmDevelopmentTransport, freezeObservation } from '../transport.mjs';
import * as runners from '../runner.mjs';

const key = 'synthetic-bundle-offline-secret';
const text = ['Billing contact handles PO-63.', 'Mural purchase order PO-63 refers to AC-17.',
  'Signed agreement AC-17 names Mina.', ...Array.from({ length: 8 }, (_, index) => `Unrelated inventory entry ${index}.`)];
const cases = (capacity = false, crowded = false) => freezeObservation(Array.from({ length: 24 }, (_, index) => ({
  id: `D${String(index + 1).padStart(2, '0')}`, family: 'synthetic-bundle-control',
  question: { text: 'mural billing', date: '2026-10-10' },
  sessions: Array.from({ length: capacity ? 4 : 2 }, (_, session) => ({ id: `session-${session}`,
    eventTime: '2026-10-09T12:00:00Z', messages: text.slice(session * 3, Math.min(session * 3 + 3, capacity ? 10 : crowded ? 6 : 5)).map((content, turn) => ({
      role: turn % 2 ? 'assistant' : 'user', content,
    })) })),
})));
const ref = candidate => ({ namespaceIndex: candidate.namespaceIndex,
  memoryId: candidate.memory.id, revision: candidate.memory.revision });
const envelope = output => Response.json({ object: 'response', model: 'gpt-4.1-mini-2025-04-14',
  status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });

async function comparison({ treatment = 'source-diverse-linked-v1', seed = 'billing',
  mutation, preRankFailure = false, fatalHttp = false, assertChain = false } = {}) {
  const workspace = createTestWorkspace(null, { prefix: 'cairn-evidence-bundle-runner-' });
  let transport;
  workspace.defer(() => transport?.close());
  try {
    const configuration = { directory: join(workspace.path, 'ledger'), runId: randomUUID(),
      limitMicroUsd: 400_000_000, requestCap: 100_000 };
    createExperimentBudget(configuration).close();
    const before = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
    upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 },
      expectedHistorySha256: before.historySha256 });
    const state = inspectEmbeddingExperimentBudgetSnapshot(configuration);
    const outputDirectory = join(workspace.path, 'output'); mkdirSync(outputDirectory);
    let current, activeArm, changed = false, rankCounts = 0;
    const fetchImpl = async (url, options) => {
      assert.equal(options.headers.Authorization, `Bearer ${key}`);
      const body = JSON.parse(options.body);
      if (fatalHttp) return Response.json({ error: { message: 'synthetic authentication failure' } }, { status: 401 });
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
      if (url.endsWith('/chat/completions')) return Response.json({ object: 'chat.completion', model: body.model,
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Scripted transport control.' } }],
        usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 } });
      const input = JSON.parse(body.input[0].content[0].text), method = body.text.format.name;
      if (method === 'cairn_extract') return envelope({ items: seed === 'zero-memory' ? [] : input.messages.flatMap(message => {
        const base = { kind: 'context', confidence: 0.8, sourceIndices: [message.index] };
        if (seed !== 'capacity' && message.content.includes('Billing contact')) {
          return ['first', 'second', 'third'].map(view => ({ ...base, content: `Billing view ${view}.` }));
        }
        return [{ ...base, content: message.content.slice(0, 600) }];
      }) });
      if (method === 'cairn_classify') return envelope({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) });
      if (method === 'cairn_select') {
        const visible = input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled').map(item => ({
          label: item.label, ref: { namespaceIndex: map.namespaceIndex, ...item.ref },
        })));
        let selected = seed === 'empty' ? [] : visible.filter(item => item.label.includes(seed === 'irrelevant' ? 'Unrelated' : 'Billing'));
        if (seed === 'capacity') selected = [...selected, ...visible.filter(item => item.label.includes('Unrelated')).slice(0, 5)];
        return envelope({ refs: selected.map(item => item.ref).slice(0, input.maxRefs) });
      }
      if (mutation && !changed) {
        changed = true;
        const target = input.candidates.find(candidate => mutation.target !== 'added'
          ? candidate.receipts.some(receipt => receipt.excerpt.includes('Billing contact'))
          : candidate.receipts.some(receipt => receipt.excerpt.includes('Mural purchase')));
        assert.ok(target);
        const { namespace } = runners.prepareAlgorithmDevelopmentCase(current.source);
        const core = openMemoryCore({ path: join(outputDirectory, `${String(current.ordinal).padStart(2, '0')}-${current.id}`, 'memory.sqlite') });
        try {
          const args = { namespace, memoryId: target.memory.id, expectedRevision: target.memory.revision };
          const result = mutation.action === 'forget' ? core.forget(args) : core.correct({ ...args,
            content: 'Corrected synthetic control.', kind: 'context', receipt: {
              client: 'synthetic', sessionId: 'mutation', eventId: 'corrected', role: 'user', excerpt: 'Corrected.',
            } });
          assert.equal(result.ok, true);
        } finally { core.close(); }
      }
      let ranked = input.candidates.filter(candidate => candidate.receipts.some(receipt =>
        receipt.excerpt.includes(seed === 'irrelevant' ? 'Unrelated' : 'Billing contact'))).slice(0, 1);
      if (seed === 'capacity') ranked = [...ranked, ...input.candidates.filter(candidate => candidate.receipts.some(receipt =>
        receipt.excerpt.includes('Unrelated'))).slice(0, 5)];
      return envelope({ refs: ranked.map(ref) });
    };
    transport = createAlgorithmDevelopmentTransport({ configuration, checkpoint: { requestCount: 0, reservedMicroUsd: 0 },
      historySha256: state.historySha256, apiKey: key, fetchImpl });
    const sources = cases(seed === 'capacity', seed === 'crowded'), durable = [];
    const observed = { ...transport,
      beginCase(value) { current = { ...value, source: sources.find(source => source.id === value.id) }; transport.beginCase(value); },
      beginArm(name) { activeArm = name; rankCounts = 0; transport.beginArm(name); },
      model: { ...transport.model, countTokens(value) {
        let data; try { data = JSON.parse(value); } catch { return transport.model.countTokens(value); }
        if (preRankFailure && activeArm === 'full' && data.input?.candidates && ++rankCounts === 3) return 6001;
        return transport.model.countTokens(value);
      } } };
    // Put the added-source mutation on the treatment-first second case, where
    // selection has actually made that source rank-visible.
    if (mutation?.target === 'added') {
      const originalBeginCase = observed.beginCase;
      observed.beginCase = value => { originalBeginCase(value); changed = value.ordinal !== 2; };
    }
    const report = await runners.runAlgorithmDevelopmentComparison({ cases: sources, transport: observed,
      outputDirectory, treatment, onCase: row => { durable.push(row); } });
    assert.equal(report.observations.length, 24); assert.equal(durable.length, 24);
    assert.equal(report.observations.flatMap(row => Object.values(row.arms)).length, 48);
    assert.equal(JSON.stringify(report).includes(key), false);
    if (assertChain) {
      const arm = report.observations[0].arms.baseline;
      assert.ok(arm.packed, JSON.stringify(report.observations[0]));
      const evidence = JSON.parse(arm.packed.request.messages[1].content).evidence;
      assert.equal(['Billing contact', 'Mural purchase', 'Signed agreement'].filter(fragment =>
        evidence.some(unit => unit.text.includes(fragment))).length, 3,
      'Ordinary selection/ranking must retain the complete chain in actual packed request');
    }
    return report;
  } finally {
    await workspace.cleanup();
    assert.equal(existsSync(workspace.path), false, 'Only owned synthetic scratch is removed even on assertion failure');
    if (assertChain) console.log(JSON.stringify({ control: 'ordinary-chain-negative', ownedScratchRemoved: true }));
  }
}

if (process.argv.includes('--ordinary-negative')) {
  await comparison({ treatment: 'source-diverse-v1', assertChain: true });
} else {
  test('B3/B5/B6/B10 actual-core fake-HTTP bundle restores selected chain through rank and answer requests', async () => {
    const report = await comparison();
    assert.equal(report.schemaVersion, 'source-diverse-linked-requested-answer-comparison-v1');
    assert.equal(report.fatal, null);
    assert.deepEqual(report.armPolicies, { baseline: 'ordinary-v1', full: 'source-diverse-linked-v1' });
    for (const row of report.observations) {
      assert.deepEqual(row.order, row.ordinal % 2 ? ['baseline', 'full'] : ['full', 'baseline']);
      assert.equal(row.navigation.firstCandidateIdentityEqual, true);
      assert.equal(row.navigation.coreInputSequenceEqual, true);
      const rawSelect = name => row.arms[name].modelCalls.find(call => call.method === 'select');
      assert.deepEqual(rawSelect('baseline'), rawSelect('full'));
      for (const name of ['baseline', 'full']) {
        const arm = row.arms[name];
        assert.equal(arm.status, 'completed', JSON.stringify(arm));
        assert.equal(arm.stateBefore, row.capture.stateSha256); assert.equal(arm.stateAfter, row.capture.stateSha256);
        assert.equal(arm.effectiveSelections.length, 1); assert.equal(arm.effectiveRanks.length, 1);
        assert.equal(arm.modelCalls.filter(call => call.method === 'select').length, 1);
        const rank = arm.modelCalls.filter(call => call.method === 'rank'); assert.equal(rank.length, 1);
        assert.equal(arm.records.length, 5, 'one count+generation each for select/rank, one answer; no wrapper provider calls');
        for (const method of ['select', 'rank']) {
          const raw = arm.modelCalls.find(call => call.method === method);
          const wire = JSON.parse(arm.records.find(record => record.method === method && record.endpoint === 'responses').requestBody);
          assert.deepEqual(JSON.parse(wire.input[0].content[0].text), raw.input);
          assert.equal(wire.model, report.model); assert.equal(wire.max_output_tokens, raw.maxOutputTokens);
        }
        const effective = arm.effectiveRanks[0];
        assert.deepEqual({ input: effective.input, system: effective.system, maxOutputTokens: effective.maxOutputTokens },
          { input: rank[0].input, system: rank[0].system, maxOutputTokens: rank[0].maxOutputTokens });
        if (name === 'full') {
          const linked = assembleSourceLinkedEvidence(rank[0].input, rank[0].output);
          assert.deepEqual(effective.output, linked.output);
          assert.deepEqual(effective.diagnostics, linked.diagnostics);
          assert.equal(effective.addedRefs.length, 2);
          const selection = arm.effectiveSelections[0];
          const first = selection.publicReads.slice(0, selection.publicReads.length / 2);
          const { namespace } = runners.prepareAlgorithmDevelopmentCase(row.source);
          assert.deepEqual(assembleSourceDiverseSelection(selection.input, rawSelect(name).output, { readSet: [namespace],
            inspections: first.map(read => ({ ref: { namespaceIndex: 0, memoryId: read.input.memoryId,
              revision: read.response.value.memory.revision }, response: read.response })) }).output, selection.output);
        } else assert.deepEqual(effective.output, rank[0].output);
        const answer = arm.records.filter(record => record.method === 'answer'); assert.equal(answer.length, 1);
        assert.deepEqual(JSON.parse(answer[0].requestBody), arm.packed.request);
        const units = JSON.parse(arm.packed.request.messages[1].content).evidence.map(unit => JSON.parse(unit.text));
        assert.deepEqual(units, arm.recalled.memories.map(item => ({ format: 'source-role-evidence-v1',
          sources: item.receipts.map(receipt => ({ recordedRole: receipt.role, text: receipt.excerpt })) })));
        const chain = ['Billing contact', 'Mural purchase', 'Signed agreement'].filter(fragment =>
          units.some(unit => unit.sources.some(source => source.text.includes(fragment))));
        assert.equal(chain.length, name === 'full' ? 3 : 1);
      }
    }
  });
  test('B10 ordinary-chain negative catches the missing chain and cleans scratch', async () => {
    await assert.rejects(comparison({ treatment: 'source-diverse-v1', assertChain: true }), /complete chain/);
  });
  for (const seed of ['empty', 'zero-memory', 'irrelevant', 'capacity', 'crowded']) test(`B4/B10 ${seed} seeds keep existing bounded assembly semantics`, async () => {
    const report = await comparison({ seed }); assert.equal(report.fatal, null);
    for (const row of report.observations) {
      const arm = row.arms.full; assert.equal(arm.status, 'completed');
      if (seed === 'empty' || seed === 'zero-memory') {
        assert.deepEqual(arm.effectiveRanks, []); assert.deepEqual(arm.recalled.memories, []);
        if (seed === 'zero-memory') {
          assert.deepEqual(row.capture.receipts, []);
          assert.equal(arm.effectiveSelections.length, 1);
          assert.deepEqual(arm.effectiveSelections[0].input.maps[0].items, []);
          assert.deepEqual(arm.effectiveSelections[0].output, { refs: [] });
          assert.deepEqual(arm.effectiveSelections[0].publicReads, []);
        }
      }
      else if (seed === 'irrelevant') assert.deepEqual(arm.effectiveRanks[0].addedRefs, []);
      else if (seed === 'crowded') {
        const selected = arm.effectiveSelections[0]; assert.equal(selected.diagnostics.additions.length, 4);
        const candidates = arm.effectiveRanks[0].input.candidates;
        const selectedSources = new Set(candidates.flatMap(candidate => candidate.receipts.map(receipt => receipt.excerpt)));
        const retainedSources = new Set(row.capture.receipts.flatMap(detail => detail.receipts.map(receipt => receipt.excerpt)));
        assert.equal(retainedSources.size, 6); assert.equal(selectedSources.size, 5);
        const missing = [...retainedSources].filter(source => !selectedSources.has(source)); assert.equal(missing.length, 1);
        assert.equal(arm.evidence.units.some(unit => unit.text.includes(missing[0])), false,
          'Rank assembly cannot manufacture a source omitted by bounded selection');
      }
      else {
        assert.equal(arm.effectiveRanks[0].output.refs.length, 6);
        assert.equal(arm.effectiveRanks[0].addedRefs.length, 2);
        assert.equal(arm.effectiveRanks[0].displacedRefs.length, 2);
        assert.deepEqual(arm.effectiveRanks[0].displacedRefs, arm.effectiveRanks[0].diagnostics.displacedSeeds);
      }
    }
  });
  test('B6/B10 rank pre-delegation failure records effective failure without inventing raw call', async () => {
    const report = await comparison({ preRankFailure: true }); assert.equal(report.fatal, null);
    const arm = report.observations[0].arms.full;
    assert.equal(arm.status, 'unresolved');
    assert.equal(arm.effectiveRanks.length, 1);
    assert.equal(arm.effectiveRanks[0].failure, 'context_budget_exceeded');
    assert.equal(arm.effectiveRanks[0].output, null);
    assert.equal(arm.modelCalls.filter(call => call.method === 'rank').length, 0);
  });
  for (const target of ['seeded', 'added']) for (const action of ['correct', 'forget']) {
    test(`B4/B10 ${target} evidence ${action} during rank invalidates actual core and retains all slots`, async () => {
      const report = await comparison({ mutation: { target, action } });
      assert.equal(report.fatal, 'captured_state_changed');
      const arm = report.observations[target === 'added' ? 1 : 0].arms[target === 'added' ? 'full' : 'baseline'];
      assert.equal(arm.status, 'unresolved'); assert.equal(arm.recalled, null); assert.equal(arm.packed, null);
      assert.equal(report.observations.at(-1).arms.full.status, 'unresolved');
    });
  }
  test('B3/B10 fatal HTTP failures retain all 24/48 unresolved slots with trace arrays', async () => {
    const report = await comparison({ fatalHttp: true }); assert.ok(report.fatal);
    assert.equal(report.observations.flatMap(row => Object.values(row.arms)).filter(arm => arm.status === 'unresolved').length, 48);
    for (const row of report.observations) for (const arm of Object.values(row.arms)) {
      assert.deepEqual(arm.effectiveRanks, []); assert.deepEqual(arm.effectiveSelections, []);
    }
  });
}
