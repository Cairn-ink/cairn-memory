import './p2e-offline.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSet } from '../../evaluation/context-read-p2e/fixtures.mjs';
import { safetyFixtures } from '../../evaluation/context-read-p2e/inventory.mjs';
import { SAFETY_CELLS, checkSafety } from '../../evaluation/context-read-p2e/safety.mjs';
import { executeSafety } from './p2e-safety.mjs';

const surfaces = ['candidates', 'assembly', 'evidence', 'private-metadata'];
const kinds = ['capabilities', 'result'];
const sides = ['withCanary', 'withoutCanary'];
const identify = r => r.type === 'memory' ? `${r.memoryId}@${r.revision}` : `${r.cardId}@${r.revision}:${r.bodyRevision}`;
const memoryRef = memoryId => ({ type: 'memory', memoryId, revision: 1, namespace: readSet[0] });
const caps = () => ({ ok: true, value: { channels: { semantic: { configured: true } } } });
const trace = () => ({ effective: 'hybrid', semantic: { coverage: 'complete', queryEmbeddingAttempts: 1, degradedReason: null } });
const result = (items = []) => ({ ok: true, value: { items, trace: trace() } });

async function collectScope(id, leakSurface, leakKind = 'capabilities') {
  const setup = { input: { readSet }, credential: {}, fixtureIdentity: identify, close() {},
    evidenceInput: { refs: [memoryRef('history-eligible')], readSet, intent: 'history' },
    withCanaryOptions: surface => ({ surface, canary: true }), withoutCanaryOptions: surface => ({ surface, canary: false }) };
  return executeSafety({ prepareSafetyCell: async cell => cell === id ? setup : { close() {} } }, {
    withReader: async (options, credential, operation) => {
      const response = kind => {
        const envelope = kind === 'capabilities' ? caps() : result();
        if (options.surface === leakSurface && kind === leakKind) envelope.value.diagnostics = { outOfScopeTargetCount: Number(options.canary) };
        return envelope;
      };
      return operation({ getContextReadCapabilities: async () => response('capabilities'),
        findCandidates: async () => response('result'), contextRead: async () => response('result'), fetchCandidateEvidence: async () => response('result') }, credential);
    },
  });
}

for (const id of ['scope/cross-owner', 'scope/cross-namespace']) {
  test(`fix3 ${id}: capability and result count differences fail through the collector`, async () => {
    assert.equal(checkSafety(await collectScope(id))[id].status, 'passed');
    for (const surface of surfaces) for (const kind of kinds) {
      const scored = checkSafety(await collectScope(id, surface, kind))[id];
      assert.equal(scored.status, 'failed', `${surface}/${kind}`);
      assert.equal(scored.violations, 1);
    }
  });

  test(`fix3 ${id}: both sides of every capability and result pair are mandatory`, async () => {
    const clean = await collectScope(id);
    assert.equal(clean[id].returns.length, 16);
    // These mutations use the old public observation shape too, so omission
    // assertions reproduce the defect without depending on a new export.
    for (const surface of surfaces) for (const kind of kinds) for (const side of sides) {
      const bad = structuredClone(clean);
      const row = bad[id].returns.findIndex(r => r.surface === surface && r.kind === kind && (r.side === side || r.side === undefined));
      assert.ok(row >= 0);
      bad[id].returns.splice(row, 1);
      assert.equal(checkSafety(bad)[id].status, 'incomplete', `${surface}/${kind}/${side}`);
    }
    assert.equal(clean[id].scopeComparisons.length, 8);
    for (let i = 0; i < 8; i++) for (const side of sides) {
      const missing = structuredClone(clean); delete missing[id].scopeComparisons[i][side];
      assert.equal(checkSafety(missing)[id].status, 'incomplete');
      const duplicate = structuredClone(clean); duplicate[id].scopeComparisons.push(duplicate[id].scopeComparisons[i]);
      assert.equal(checkSafety(duplicate)[id].status, 'incomplete');
      const detached = structuredClone(clean);
      detached[id].scopeComparisons[i][side] = structuredClone(detached[id].scopeComparisons[i][side]);
      detached[id].scopeComparisons[i][side].value.unobservedCount = 1;
      assert.equal(checkSafety(detached)[id].status, 'incomplete', 'comparison must match the inspected ledger');
    }
  });
}

// Public evidence is constructed independently of fixture title/body fields.
const memory = { type: 'memory', ref: memoryRef('safety-target'), content: 'The synthetic cedar key opens the blue cabinet.' };
const card = { type: 'card', ref: { type: 'card', cardId: 'safety-card-target', revision: 2, bodyRevision: 1,
  namespace: { ownerId: 'synthetic-owner', scope: 'project', projectId: 'project-1' } },
title: 'Synthetic copper token', body: 'The synthetic copper token opens the old drawer.' };
const history = { type: 'memory', ref: memoryRef('history-eligible'), content: 'A qualified historical amber key belonged to the archive.' };
const mutationCells = SAFETY_CELLS.filter(id => !id.startsWith('scope/') && !id.startsWith('semantic-false/') && !id.startsWith('owner-purge/'));

async function collectMutations(injectSlot = -1, payload = 'ref') {
  let calls = 0;
  return executeSafety({ prepareSafetyCell: async id => {
    if (!mutationCells.includes(id)) return { close() {} };
    let removed = false, postSlot = 0;
    const target = id.includes('/card/') ? card : memory;
    return { credential: {}, input: { readSet, intent: id.split('/').at(-1) }, fixtureIdentity: identify, close() {},
      prepareSurface: async () => { removed = false; }, readerOptions: async () => ({ target, removed, capture: envelope => {
        if (postSlot++ === injectSlot) {
          if (payload === 'ref') envelope.value.leak = { nested: { ref: target.ref } };
          if (payload === 'body') envelope.value.leak = target.body ?? target.content;
        }
        return envelope;
      } }),
      historyReaderOptions() { return this.readerOptions(); },
      atMutationBoundary: async (surface, operation) => { removed = true; await operation(); return { canonicalSnapshot: 'after', mutationAcknowledged: true, stoppedAndDrained: true }; },
    };
  } }, {
    semanticCallCount: () => calls,
    withReader: async (options, credential, operation) => {
      const capture = envelope => options.removed ? options.capture(envelope) : envelope;
      return operation({ getContextReadCapabilities: async () => capture(caps()),
        findCandidates: async input => { calls++; return capture(result(options.removed ? input.intent === 'history' ? [history] : [] : [options.target])); },
        contextRead: async () => { calls++; return capture(result()); },
        fetchCandidateEvidence: async input => capture(result(input.refs[0].memoryId === 'history-eligible' ? [history] : options.removed ? [] : [options.target])),
      }, credential);
    },
  });
}

test('fix3 Card gold: canonical title/body fields also define the embedding text', () => {
  const cards = safetyFixtures().canaries.filter(c => c.type === 'card');
  assert.equal(cards.length, 3);
  for (const target of cards) {
    assert.equal(typeof target.title, 'string'); assert.ok(target.title.length > 0);
    assert.equal(typeof target.body, 'string'); assert.ok(target.body.length > 0);
    assert.equal(target.text, `${target.title}\n${target.body}`);
  }
  assert.equal(cards.find(c => c.id === card.ref.cardId).title, card.title);
  assert.equal(cards.find(c => c.id === card.ref.cardId).body, card.body);
});

test('fix3 Card positive control: clean collector responses pass all 96 mutation cells', async () => {
  const observations = await collectMutations(), scored = checkSafety(observations);
  assert.equal(mutationCells.length, 96);
  for (const id of mutationCells) assert.equal(scored[id].status, 'passed', id);
  assert.equal(mutationCells.filter(id => scored[id].status === 'passed').length, 96);
  // Each canonical Card field, typed revision and namespace is independently
  // required, even when all four initial refetches are internally consistent.
  const id = mutationCells.find(id => id.includes('/card/'));
  for (const damage of [i => i.title = 'wrong title', i => i.body = 'wrong body', i => i.ref.bodyRevision++, i => i.ref.namespace.projectId = 'unselected']) {
    const bad = structuredClone(observations);
    for (const row of bad[id].initial) damage(row.evidence.envelope.value.items[0]);
    assert.equal(checkSafety(bad)[id].status, 'incomplete');
  }
});

test('fix3 injection controls: all 2496 post-mutation slots reject forbidden refs and body-only leaks', async () => {
  let rejected = 0;
  for (const payload of ['ref', 'body']) for (let slot = 0; slot < 26; slot++) {
    const observations = await collectMutations(slot, payload), scored = checkSafety(observations);
    for (const id of mutationCells) {
      assert.equal(observations[id].postMutationReads.length, 26);
      assert.equal(scored[id].status, 'failed', `${id}/${slot}/${payload}`);
      assert.ok(scored[id].violations > 0); rejected++;
    }
  }
  assert.equal(rejected, 4992);
});
