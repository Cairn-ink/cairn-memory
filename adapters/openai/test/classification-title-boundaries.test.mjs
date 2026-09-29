import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createOpenAIModel } from '../index.mjs';

const namespace = { ownerId: 'title-boundary-test', scope: 'project', projectId: 'synthetic' };
const foreign = { ...namespace, projectId: 'foreign-synthetic' };
const client = 'synthetic-title-boundaries';
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const refused = (result, code) => {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, code);
};
const proposal = (input, placement) => ({ items: input.memories.map(memory => ({
  memoryId: memory.id, parentIds: [], ...placement,
})) });
const newTopic = (input, title, parents = {}) => proposal(input, {
  newL1: { title, parentL2Ids: [], ...parents },
});
const wireTopic = (input, title, level = 'L1') => {
  const item = input.map.find(entry => entry.type === 'moc'
    && entry.moc.level === level && entry.moc.title === title);
  assert.ok(item, `Expected visible ${level} topic ${title}`);
  return item.moc;
};

function fixture(t, classifyOutput) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-title-boundaries-' });
  const requests = [];
  const timings = [];
  const diagnostics = [];
  let classify = classifyOutput;
  const adapter = createOpenAIModel({ apiKey: 'synthetic-offline-key',
    onPhaseTiming: event => timings.push(event), onDiagnostic: event => diagnostics.push(event),
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      assert.ok(String(url).endsWith('/input_tokens') || String(url).endsWith('/responses'));
      if (String(url).endsWith('/input_tokens')) {
        return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      }
      const method = body.text.format.name;
      const input = JSON.parse(body.input[0].content[0].text);
      assert.ok(['cairn_extract', 'cairn_classify'].includes(method));
      requests.push({ method, input });
      if (method === 'cairn_extract') assert.equal(input.inputMode, 'indexed-windows-v1');
      const output = method === 'cairn_extract'
        ? { items: [{ content: input.messages[0].content, kind: 'fact', confidence: 0.9, sourceIndices: [0] }] }
        : classify(input);
      return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
    } });
  const core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'), model: adapter,
    captureSourcePolicy: 'indexed-evidence-v1' });
  workspace.defer(() => core.close());
  const map = (ns = namespace) => ok(core.map({ namespace: ns, purpose: 'classification' }));
  const get = (memoryId, ns = namespace) => ok(core.get({ namespace: ns, memoryId }));
  const capture = async (eventId, content, ns = namespace) => ok(await core.capture({ namespace: ns,
    client, sessionId: 'synthetic-session', eventId,
    messages: [{ id: `source-${eventId}`, role: 'user', content }] }));
  return { core, map, get, capture, timings, diagnostics,
    setClassifier: output => { classify = output; },
    classificationRequests: () => requests.filter(request => request.method === 'cairn_classify'),
  };
}

const topic = (f, title, level = 'L1', ns = namespace) => {
  const item = f.map(ns).items.find(entry => entry.type === 'moc'
    && entry.moc.level === level && entry.moc.title === title);
  assert.ok(item, `Expected stored ${level} topic ${title}`);
  return item.moc;
};
const topology = f => f.map().items.filter(item => item.type === 'moc'
  || (item.type === 'ref' && item.ref.childType === 'moc'));
const parentEdge = (f, parentId, childId) => f.map().items.find(item => item.type === 'ref'
  && item.ref.childType === 'moc' && item.ref.parentId === parentId && item.ref.childId === childId);
const memoryEdge = (f, parentId, childId) => f.map().items.find(item => item.type === 'ref'
  && item.ref.childType === 'memory' && item.ref.parentId === parentId && item.ref.childId === childId);

function assertCompleted(f) {
  assert.deepEqual(f.diagnostics, []);
  assert.equal(f.timings.filter(event => event.stage === 'classify'
    && event.phase === 'output_validation' && event.outcome === 'completed').length,
  f.classificationRequests().length);
}

function assertCollision(f, value, eventId, source) {
  assert.deepEqual(value.classification, { status: 'failed',
    error: { code: 'moc_title_conflict', retryable: false } });
  assert.equal(value.admission.memories.length, 1);
  const memoryId = value.admission.memories[0].id;
  const detail = f.get(memoryId);
  assert.equal(detail.memory.filing.status, 'unfiled');
  assert.deepEqual(detail.placements, []);
  assert.deepEqual(detail.receipts.map(receipt => receipt.excerpt), [source]);
  assert.equal(ok(f.core.inspectAdmission({ namespace, client, eventId,
    includeInitialClassification: true })).initialClassification.status, 'failed');
  assertCompleted(f);
  return memoryId;
}

test('T01 visible exact duplicate fails; explicit wire-catalog reuse applies', async t => {
  const title = 'Visible synthetic topic';
  const f = fixture(t, input => newTopic(input, title));
  assert.equal((await f.capture('visible-seed', 'Synthetic seed evidence.')).classification.status, 'applied');
  const existing = topic(f, title);
  const before = topology(f);
  f.setClassifier(input => {
    wireTopic(input, title);
    assert.equal(input.mapExhausted, true);
    return newTopic(input, title);
  });
  const source = 'Synthetic second source evidence.';
  assertCollision(f, await f.capture('visible-collision', source), 'visible-collision', source);
  assert.deepEqual(topology(f), before);
  f.setClassifier(input => proposal(input, { parentIds: [wireTopic(input, title).id] }));
  const reused = await f.capture('visible-reuse', 'Synthetic explicit reuse evidence.');
  assert.equal(reused.classification.status, 'applied');
  assert.equal(f.get(reused.admission.memories[0].id).placements[0].mocId, existing.id);
  assert.equal(f.map().items.filter(item => item.type === 'moc').length, 1);
  assertCompleted(f);
});

test('T02 case, NFKC and whitespace aliases collide through actual adapter and capture', async t => {
  const title = 'Synthetic Topic';
  for (const [name, variant] of [
    ['case', 'SYNTHETIC TOPIC'],
    ['nfkc', 'Ｓｙｎｔｈｅｔｉｃ Ｔｏｐｉｃ'],
    ['whitespace', '  Synthetic\t\n Topic  '],
  ]) {
    const f = fixture(t, input => newTopic(input, title));
    assert.equal((await f.capture(`${name}-seed`, `Synthetic ${name} seed source.`)).classification.status, 'applied');
    const before = topology(f);
    f.setClassifier(input => {
      wireTopic(input, title);
      assert.equal(input.mapExhausted, true);
      return newTopic(input, variant);
    });
    const source = `Synthetic ${name} collision source.`;
    assertCollision(f, await f.capture(`${name}-collision`, source), `${name}-collision`, source);
    assert.deepEqual(topology(f), before);
  }
});

test('T03 invalidated source hides title but retains reservation without diagnostic disclosure', async t => {
  const title = 'Reserved synthetic topic';
  const f = fixture(t, input => newTopic(input, title));
  const seeded = await f.capture('hidden-seed', 'Synthetic source to invalidate.');
  assert.equal(seeded.classification.status, 'applied');
  const existing = topic(f, title);
  const memory = f.get(seeded.admission.memories[0].id).memory;
  ok(f.core.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision }));
  const hidden = f.map().items.find(item => item.type === 'moc' && item.moc.id === existing.id);
  assert.equal(hidden.moc.title, null);
  assert.equal(JSON.stringify(f.map()).includes(title), false);
  const before = topology(f);
  f.setClassifier(input => {
    assert.equal(input.mapExhausted, true);
    assert.equal(input.map.length, 1);
    assert.equal(input.map[0].moc.level, 'L1');
    assert.equal(input.map[0].moc.title, null);
    assert.equal(JSON.stringify(input).includes(title), false);
    return newTopic(input, title);
  });
  const source = 'Synthetic independent current evidence.';
  const failed = await f.capture('hidden-collision', source);
  assertCollision(f, failed, 'hidden-collision', source);
  assert.deepEqual(topology(f), before);
  assert.equal(JSON.stringify(failed.classification).includes(title), false);
  assert.equal(JSON.stringify(f.diagnostics).includes(title), false);
  assert.deepEqual(f.diagnostics, []);
});

test('T04 duplicate new L2 fails atomically; existing visible L2 reference succeeds', async t => {
  const parentTitle = 'Synthetic parent';
  const f = fixture(t, input => newTopic(input, 'Synthetic first child', { newL2Title: parentTitle }));
  assert.equal((await f.capture('l2-seed', 'Synthetic first hierarchy evidence.')).classification.status, 'applied');
  const parent = topic(f, parentTitle, 'L2');
  const before = topology(f);
  f.setClassifier(input => {
    wireTopic(input, parentTitle, 'L2');
    assert.equal(input.mapExhausted, true);
    return newTopic(input, 'Synthetic second child', { newL2Title: parentTitle });
  });
  const source = 'Synthetic second hierarchy evidence.';
  assertCollision(f, await f.capture('l2-collision', source), 'l2-collision', source);
  assert.deepEqual(topology(f), before);
  f.setClassifier(input => newTopic(input, 'Synthetic second child', {
    parentL2Ids: [wireTopic(input, parentTitle, 'L2').id],
  }));
  const reused = await f.capture('l2-reuse', 'Synthetic explicit parent reference evidence.');
  assert.equal(reused.classification.status, 'applied');
  const child = topic(f, 'Synthetic second child');
  assert.ok(parentEdge(f, parent.id, child.id));
  assert.ok(memoryEdge(f, child.id, reused.admission.memories[0].id));
  assert.equal(f.map().items.filter(item => item.type === 'moc' && item.moc.level === 'L2').length, 1);
  assertCompleted(f);
});

test('T05 parent-free duplicate refuses; explicit reuse exposes pre-existing unseen ancestry', async t => {
  const childTitle = 'Synthetic T';
  const parentTitle = 'Synthetic P';
  const f = fixture(t, input => newTopic(input, childTitle, { newL2Title: parentTitle }));
  assert.equal((await f.capture('topology-seed', 'Synthetic hierarchy seed evidence.')).classification.status, 'applied');
  const child = topic(f, childTitle);
  const parent = topic(f, parentTitle, 'L2');
  assert.ok(parentEdge(f, parent.id, child.id));
  const before = topology(f);
  f.setClassifier(input => {
    wireTopic(input, childTitle);
    wireTopic(input, parentTitle, 'L2');
    assert.equal(input.mapExhausted, true);
    assert.ok(input.map.every(item => item.type === 'moc'));
    assert.ok(input.map.every(item => !Object.hasOwn(item.moc, 'parentIds')
      && !Object.hasOwn(item.moc, 'parentL2Ids')));
    return newTopic(input, childTitle);
  });
  const source = 'Synthetic intended parent-free placement evidence.';
  const refusedId = assertCollision(f, await f.capture('topology-collision', source), 'topology-collision', source);
  assert.deepEqual(topology(f), before);
  assert.equal(memoryEdge(f, child.id, refusedId), undefined);
  f.setClassifier(input => proposal(input, { parentIds: [wireTopic(input, childTitle).id] }));
  const explicit = await f.capture('topology-explicit', 'Synthetic explicit existing-topic choice.');
  assert.equal(explicit.classification.status, 'applied');
  const explicitId = explicit.admission.memories[0].id;
  assert.ok(parentEdge(f, parent.id, child.id));
  assert.ok(memoryEdge(f, child.id, explicitId));
  assert.equal(f.get(explicitId).placements[0].mocId, child.id);
  assert.deepEqual(f.get(refusedId).placements, []);
  assertCompleted(f);
});

test('T06 source-bound namespace, revision, level and hierarchy-link guards remain authoritative', async t => {
  const f = fixture(t, input => newTopic(input, 'Foreign reserved topic', { newL2Title: 'Foreign parent' }));
  assert.equal((await f.capture('guard-foreign', 'Synthetic foreign source.', foreign)).classification.status, 'applied');
  const foreignChild = topic(f, 'Foreign reserved topic', 'L1', foreign);
  const foreignParent = topic(f, 'Foreign parent', 'L2', foreign);
  f.setClassifier(input => {
    assert.equal(input.map.length, 0);
    assert.equal(input.mapExhausted, true);
    assert.equal(JSON.stringify(input).includes('Foreign'), false);
    return newTopic(input, 'Foreign reserved topic', { newL2Title: 'Local parent' });
  });
  assert.equal((await f.capture('guard-local', 'Synthetic local seed source.')).classification.status, 'applied');
  const localChild = topic(f, 'Foreign reserved topic');
  const localParent = topic(f, 'Local parent', 'L2');
  assert.notEqual(localChild.id, foreignChild.id);
  f.setClassifier(input => {
    assert.equal(input.map.some(item => item.moc?.title === 'Foreign parent'), false);
    assert.ok(input.map.every(item => /^c[0-9a-z]+$/.test(item.moc.id)));
    return proposal(input, {});
  });
  const targetCapture = await f.capture('guard-target', 'Synthetic guarded target source.');
  assert.equal(targetCapture.classification.status, 'applied');
  const targetId = targetCapture.admission.memories[0].id;
  const beforeDetail = f.get(targetId);
  const beforeMap = f.map();
  const apply = (placement, overrides = {}) => f.core.applyPlacement({ namespace,
    proposal: { items: [{ memoryId: targetId, parentIds: [], ...placement }] },
    expectedMemoryRevisions: [{ memoryId: targetId, revision: beforeDetail.memory.revision }],
    expectedIndexRevision: beforeMap.indexRevision, ...overrides });
  refused(apply({ parentIds: [foreignChild.id] }), 'moc_not_found');
  refused(apply({ parentIds: [localParent.id] }), 'invalid_ref');
  refused(apply({ newL1: { title: 'Guarded new topic', parentL2Ids: [foreignParent.id] } }), 'moc_not_found');
  refused(apply({ newL1: { title: 'Guarded new topic', parentL2Ids: [localChild.id] } }), 'invalid_ref');
  refused(apply({ parentIds: [localChild.id] }, {
    expectedMemoryRevisions: [{ memoryId: targetId, revision: beforeDetail.memory.revision + 1 }],
  }), 'revision_conflict');
  refused(apply({ parentIds: [localChild.id] }, {
    expectedIndexRevision: beforeMap.indexRevision - 1,
  }), 'index_revision_conflict');
  const link = { namespace, parentId: localParent.id, expectedParentRevision: localParent.revision,
    childId: localChild.id, expectedChildRevision: localChild.revision,
    expectedIndexRevision: beforeMap.indexRevision };
  refused(f.core.linkMocs({ ...link, parentId: foreignParent.id }), 'moc_not_found');
  refused(f.core.linkMocs({ ...link, parentId: localChild.id }), 'invalid_ref');
  refused(f.core.linkMocs({ ...link, expectedParentRevision: localParent.revision + 1 }), 'revision_conflict');
  refused(f.core.linkMocs({ ...link, expectedChildRevision: localChild.revision + 1 }), 'revision_conflict');
  refused(f.core.linkMocs({ ...link, expectedIndexRevision: beforeMap.indexRevision - 1 }), 'index_revision_conflict');
  assert.deepEqual(f.get(targetId), beforeDetail);
  assert.deepEqual(f.map(), beforeMap);
  assert.equal(memoryEdge(f, localChild.id, targetId), undefined);
  assertCompleted(f);
});
