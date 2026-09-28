import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeModel, request, interpretation, qualifications, setup, captureInput, ok, ns, prompts } from './openai-episodes.mjs';
import { createQualificationTextCatalog } from '../../../core/qualification-text-catalog.mjs';

const input = () => ({ items: [{ itemIndex: 0, content: 'Use diagrams', kind: 'preference',
  candidates: [{ candidateIndex: 3, role: 'user', text: 'Use diagrams' }] },
{ itemIndex: 1, content: 'Be concise', kind: 'instruction', candidates: [{ candidateIndex: 7, role: 'user', text: 'Be concise' }] }] });
const extractInput = () => ({ messages: [{ index: 0, role: 'user', content: 'Use diagrams' }] });

test('E10 automatic qualification tags preserve exact candidate IDs in inline and adaptive modes', async () => {
  for (const catalog of [false, true]) for (const tagged of [false, true]) {
    const original = input(), output = qualifications(original);
    if (!tagged) Object.values(output.qualifications).forEach(entry => { delete entry.procedural; });
    const f = fakeModel({ qualificationInputMode: catalog ? 'adaptive-text-catalog-v1' : 'inline', respond: () => output });
    const data = catalog ? createQualificationTextCatalog(original).catalog : original;
    const req = request('qualify-episode-candidates', data);
    if (catalog) assert.equal(f.model.fitsQualificationRequest(req), true);
    const decoded = await f.model.qualifyCandidates(req);
    assert.deepEqual(decoded, { qualifications: Object.values(output.qualifications) });
    assert.equal(f.calls.length, 2);
    assert.equal(JSON.stringify(f.calls[0].payload.text.format.schema).includes('evidenceSlots'), false);
    assert.equal(f.calls[0].payload.instructions.includes('original candidate indices'), true);
    assert.deepEqual(f.calls[0].payload.text.format.schema, f.calls[1].payload.text.format.schema);
  }
});

test('E10 extraction permits optional true only for preferences and instructions', async () => {
  for (const kind of ['fact', 'preference', 'decision', 'instruction', 'context']) for (const tag of [undefined, true, false, null]) {
    const output = { items: [{ content: 'Use diagrams', kind, confidence: 0.9, sourceIndices: [0],
      ...(tag === undefined ? {} : { procedural: tag }) }] };
    const f = fakeModel({ respond: () => output });
    const result = f.model.extract(request('extract-episode-sources', extractInput()));
    if (tag === undefined || (tag === true && ['preference', 'instruction'].includes(kind))) assert.deepEqual(await result, output);
    else await assert.rejects(result, { code: 'invalid_model_output' });
  }
});

test('E2/E10 qualification rejects partial items, ineligible tags, duplicate, foreign and excessive evidence', async () => {
  const mutations = [
    output => { delete output.qualifications.item_1; },
    output => { output.qualifications.item_0.procedural = null; },
    output => { output.qualifications.item_0.procedural.evidenceIndices = []; },
    output => { output.qualifications.item_0.procedural.evidenceIndices = [7]; },
    output => { output.qualifications.item_0.procedural.evidenceIndices = [3, 3]; },
    output => { output.qualifications.item_0.procedural.evidenceIndices = [3, 3, 3, 3, 3]; },
    output => { output.qualifications.item_0.subject.value = 'x'.repeat(161); },
    output => { output.qualifications.item_0.subject.value = '\udfff'; },
    output => { output.qualifications.item_0.itemIndex = 1; },
    output => { delete output.qualifications.item_0.commitment; },
  ];
  for (const mutate of mutations) {
    const output = qualifications(input()); mutate(output);
    const f = fakeModel({ respond: () => output });
    await assert.rejects(f.model.qualifyCandidates(request('qualify-episode-candidates', input())), { code: 'invalid_model_output' });
    assert.equal(f.calls.length, 2);
  }
  for (const kind of ['fact', 'decision', 'context']) {
    const data = input(), output = qualifications(data); data.items[0].kind = kind;
    const f = fakeModel({ respond: () => output });
    await assert.rejects(f.model.qualifyCandidates(request('qualify-episode-candidates', data)), { code: 'invalid_model_output' });
  }
});

test('E1/E8/E10 fake HTTP capture retains sources, binds procedural receipts and replays without calls', async t => {
  const f = setup(t);
  const captured = ok(await f.core.capture(captureInput()));
  assert.equal(captured.episode.status, 'interpreted');
  assert.equal(captured.admission.status, 'completed');
  const memoryId = captured.admission.memories[0].id;
  const memory = ok(f.core.get({ namespace: ns, memoryId }));
  assert.equal(memory.procedural.procedural, true);
  assert.equal(memory.procedural.origin, 'model');
  assert.equal(memory.procedural.anchors[0].receiptId, memory.receipts[0].id);
  assert.equal(memory.receipts[0].sessionId.startsWith('s1:'), true);
  const episode = ok(f.core.getEpisode({ namespace: ns, episodeId: captured.episode.id }));
  assert.equal(episode.episode.semanticSupport, 'unassessed');
  assert.equal(episode.episode.modelMetadata.adapter, 'openai');
  assert.equal(episode.episode.modelMetadata.model, f.model.episodeMetadata.model);
  assert.ok(episode.sources.items.length > 0);
  const count = f.calls.length;
  ok(await f.core.capture(captureInput()));
  ok(f.core.sessionStartContext({ namespace: ns }));
  assert.equal(f.calls.length, count);
  assert.equal(JSON.stringify(f.calls).includes('private-session'), false);
  assert.equal(f.calls[2].payload.instructions, prompts['extract-episode-sources']);
  ok(f.core.forgetEpisode({ namespace: ns, episodeId: episode.episode.id, expectedRevision: episode.episode.revision }));
  assert.equal(f.core.get({ namespace: ns, memoryId }).error.code, 'memory_not_found');
});

test('E8 only a fresh quick episode skips extraction; the next batch uses automatic tag schemas', async t => {
  const f = setup(t, { respond: (method, input) => {
    if (method === 'interpretEpisode') return interpretation(input, 'quick-one-off-question');
    if (method === 'extract') return { items: [{ content: 'Use diagrams', kind: 'preference', confidence: 1,
      sourceIndices: [0], procedural: true }] };
    if (method === 'qualifyCandidates') return qualifications(input);
    return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
  } });
  const first = ok(await f.core.capture(captureInput()));
  assert.equal(first.admission.memories.length, 0);
  assert.equal(f.calls.length, 2);
  const second = ok(await f.core.capture(captureInput(2)));
  assert.equal(second.admission.memories.length, 1);
  assert.equal(f.calls.filter(call => call.payload.text.format.name === 'cairn_interpretEpisode').length, 2);
  assert.equal(f.calls.filter(call => call.payload.text.format.name === 'cairn_qualifyCandidates').length, 2);
});
