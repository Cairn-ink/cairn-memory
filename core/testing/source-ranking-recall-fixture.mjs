// Shared synthetic assertions only; importing this fixture registers no tests
// and requires no optional provider/tokenizer dependencies.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openMemoryCore } from '../contract.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

export const personal = { ownerId: 'idf-capture', scope: 'personal', projectId: null };
export const project = { ...personal, scope: 'project', projectId: 'project' };
export const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const flatRef = (item, namespaceIndex) => ({ namespaceIndex, ...(item.type === 'unfiled' ? item.ref
  : { memoryId: item.ref.childId, revision: item.ref.childRevision }) });
const rankRef = item => ({ namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision });
export const query = 'generic amber copper quartz cobaltmarker';
export const exact = 'cobaltmarker: Ari adopted the cedar route for the observatory.';

export function scripted(counter = () => 1) {
  const calls = [];
  const model = { contextWindow: 16384, countTokens: counter,
    extract: ({ input }) => ({ items: input.messages.map(message => ({
      content: message.content.startsWith('cobaltmarker:') ? 'Compressed adopted route' : message.content,
      kind: 'fact', confidence: 0.8, sourceIndices: [message.index] })) }),
    classify: ({ input }) => ({ items: input.memories.map(memory => {
      if (memory.content.includes('unfiled')) return { memoryId: memory.id, parentIds: [] };
      const group = input.map.find(item => item.type === 'moc' && item.moc.level === 'L1');
      return { memoryId: memory.id, parentIds: group ? [group.moc.id] : [],
        ...(group ? {} : { newL1: { title: 'Observatory', parentL2Ids: [] } }) };
    }) }),
    selectGroups: () => ({ refs: [] }),
    select: ({ input }) => ({ refs: input.maps.flatMap(map => map.items
      .filter(item => item.label.includes('cobaltmarker')).map(item => flatRef(item, map.namespaceIndex)))
      .slice(0, input.maxRefs) }),
    rank: ({ input }) => ({ refs: input.candidates.filter(item => item.receipts
      .some(receipt => receipt.excerpt.includes('cobaltmarker'))).slice(0, input.limit).map(rankRef) }) };
  for (const method of ['select', 'rank', 'selectGroups']) {
    const callback = model[method];
    model[method] = async request => { calls.push({ method, input: structuredClone(request.input),
      system: request.system, maxOutputTokens: request.maxOutputTokens }); return callback(request); };
  }
  return { model, calls };
}

export async function capture(core, namespace, messages, eventId) {
  const result = ok(await core.capture({ namespace, client: 'synthetic', sessionId: 'idf', eventId,
    messages: messages.map((content, index) => ({ id: `${eventId}-${index}`, role: 'user', content })) }));
  assert.equal(result.classification.status, 'applied', JSON.stringify(result.classification));
  assert.equal(result.admission.memories.length, messages.length);
  return result.admission.memories;
}

// Both suites execute these same assertions. Core supplies the dependency-free
// default; the already provisioned OpenAI suite supplies its real o200k counter.
export async function assertRareSourceRecall(t, counter = () => 1) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-idf-capture-' });
  const path = join(workspace.path, 'memory.sqlite');
  const setup = scripted();
  let core = openMemoryCore({ path, model: setup.model }); workspace.defer(() => core.close());
  // 240 decoys exceed two real 100-row flat pages, regardless of random IDs.
  for (let start = 0; start < 240; start += 5) {
    await capture(core, personal, Array.from({ length: 5 }, (_, offset) =>
      `generic amber copper quartz crowd ${start + offset}`), `decoys-${start}`);
  }
  const target = (await capture(core, personal, [exact], 'fixed-target'))[0];
  const detail = ok(core.get({ namespace: personal, memoryId: target.id }));
  assert.equal(detail.memory.content.includes('cobaltmarker'), false);
  assert.equal(detail.memory.filing.status, 'filed');
  assert.equal(detail.receipts[0].excerpt, exact);
  core.close();
  for (const sourceCandidatePolicy of [undefined, 'bounded-keyset-v1']) {
    const options = sourceCandidatePolicy ? { sourceCandidatePolicy } : {};
    const baseline = scripted(counter);
    core = openMemoryCore({ path, model: baseline.model, ...options });
    const old = ok(await core.recall({ readSet: [personal], query, contextMode: 'source-evidence' }));
    assert.deepEqual(old.memories, []);
    assert.equal(baseline.calls.filter(call => call.method === 'select').length, 2);
    const oldWindows = baseline.calls.filter(call => call.method === 'select').flatMap(call => call.input.maps.flatMap(map => map.items));
    assert.ok(oldWindows.length > 0 && oldWindows.length <= 200);
    assert.equal(oldWindows.some(item => item.label.includes('cobaltmarker')), false);
    core.close();
    const enabled = scripted(counter);
    core = openMemoryCore({ path, model: enabled.model, sourceRankingPolicy: 'bounded-idf-v1', ...options });
    for (const contextMode of ['source-evidence', 'rationale-evidence']) {
      enabled.calls.length = 0;
      const result = ok(await core.recall({ readSet: [personal], query, contextMode }));
      assert.equal(result.memories[0]?.memory.id, target.id);
      assert.equal(result.memories[0]?.receipts[0].excerpt, exact);
      const visible = enabled.calls.filter(call => call.method === 'select').flatMap(call => call.input.maps.flatMap(map => map.items));
      assert.ok(visible.some(item => item.type === 'ref' && item.ref.childId === target.id && item.label === exact));
      assert.ok(enabled.calls.find(call => call.method === 'rank').input.candidates
        .some(item => item.memory.id === target.id && item.receipts[0].excerpt === exact));
      assert.deepEqual(enabled.calls.map(call => call.method), ['select', 'select', 'rank']);
      assert.ok(enabled.calls.every(call => call.maxOutputTokens === 1024));
      assert.equal(JSON.stringify(result).includes('ranking'), false);
      assert.equal(JSON.stringify(enabled.calls).includes('bounded-idf-v1'), false);
    }
    // V2 flat inputs stay exactly the same under the same ranking policy.
    enabled.calls.length = 0;
    ok(await core.recall({ readSet: [personal], query, contextMode: 'source-evidence' }));
    const flat = enabled.calls.filter(call => call.method === 'select');
    enabled.calls.length = 0;
    ok(await core.recall({ readSet: [personal], query, contextMode: 'source-evidence', selectionMode: 'moc-hierarchy-v2' }));
    assert.deepEqual(enabled.calls.filter(call => call.method === 'select'), flat);
    assert.equal(enabled.calls.filter(call => call.method === 'selectGroups').length, 1);
    core.close();
  }
}
