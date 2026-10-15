import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createOpenAIModel } from '../index.mjs';
import { DEFAULT_MODEL } from '../profiles.mjs';

// New prospective capture contract; the private four-case diagnostics stay immutable.
const fetchGuard = mock.method(globalThis, 'fetch', () => assert.fail('native fetch is forbidden'));
after(() => fetchGuard.mock.restore());
const ns = { ownerId: 'null-title-capture-synthetic', scope: 'personal', projectId: null };
const title = 'Review preferences', alternative = 'Every-review diagram practice';
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const plain = value => JSON.parse(JSON.stringify(value));
const forbidden = () => assert.fail('cold read called a model');

function scriptedAdapter(mode) {
  const calls = [], proposals = [], diagnostics = [];
  let classifications = 0;
  const adapter = createOpenAIModel({ apiKey: 'synthetic-not-a-real-key', episodeModel: DEFAULT_MODEL,
    onDiagnostic: e => diagnostics.push(plain(e)),
    fetchImpl: async (url, options) => {
      assert.ok(['https://api.openai.com/v1/responses/input_tokens',
        'https://api.openai.com/v1/responses'].includes(String(url)));
      const payload = JSON.parse(options.body), method = payload.text.format.name;
      calls.push({ url: String(url), method });
      if (String(url).endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      const input = JSON.parse(payload.input[0].content[0].text);
      let output;
      if (method === 'cairn_extract') {
        const episode = Boolean(payload.text.format.schema.properties.items.items.anyOf);
        output = { items: [{ content: episode ? 'Use diagrams in every review.' : 'Use diagrams in reviews.',
          kind: 'instruction', confidence: 0.9, sourceIndices: [0], ...(episode ? { procedural: true } : {}) }] };
      } else if (method === 'cairn_interpretEpisode') {
        const field = value => ({ value, anchors: [{ sourceIndex: 0, start: 0, end: input.sources[0].text.length }] });
        output = { type: field('work'), language: 'en', gist: field('Discussed review habits.'),
          outcome: null, nextStep: field('Use diagrams in the next review.'), disposition: null };
      } else if (method === 'cairn_qualifyCandidates') {
        output = { qualifications: Object.fromEntries(input.items.map(item => [`item_${item.itemIndex}`, {
          itemIndex: item.itemIndex,
          ...Object.fromEntries(['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'].map(field =>
            [field, { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
              evidenceIndices: field === 'value' ? [item.candidates[0].candidateIndex] : [] }])),
          procedural: { evidenceIndices: [item.candidates[0].candidateIndex] },
        }])) };
      } else {
        assert.equal(method, 'cairn_classify');
        const second = ++classifications === 2;
        const existing = second && mode === 'existing-null-id'
          ? input.map.find(item => item.type === 'moc' && item.moc.level === 'L1' && item.moc.title === null) : null;
        if (second && mode === 'existing-null-id') assert.ok(existing);
        output = { items: input.memories.map(memory => ({ memoryId: memory.id,
          parentIds: existing ? [existing.moc.id] : [], ...(existing ? {} : {
            newL1: { title: second && mode === 'alternate-title' ? alternative : title, parentL2Ids: [] },
          }) })) };
      }
      return Response.json({ id: 'resp_synthetic', object: 'response', model: payload.model,
        status: 'completed', error: null, incomplete_details: null,
        output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
    } });
  const model = { ...adapter, classify: async request => {
    const input = plain(request.input), output = await adapter.classify(request);
    proposals.push({ input, output: plain(output) }); return output;
  } };
  return { model, calls, proposals, diagnostics };
}

async function scenario(t, mode) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-null-title-capture-' });
  const path = join(workspace.path, 'memory.sqlite'), f = scriptedAdapter(mode);
  const core = openMemoryCore({ path, model: f.model }); workspace.defer(() => core.close());
  const first = ok(await core.capture({ namespace: ns, client: 'demo', eventId: 'first', sessionId: 'session',
    messages: [{ id: 'first-source', role: 'user', content: 'Please use diagrams in reviews.' }] }));
  assert.equal(first.classification.status, 'applied');
  const firstId = first.admission.memories[0].id;
  const firstMemory = ok(core.get({ namespace: ns, memoryId: firstId })).memory;
  const topic = ok(core.map({ namespace: ns, purpose: 'classification' })).items.find(i => i.type === 'moc').moc;
  assert.equal(topic.title, title);
  if (mode !== 'visible-conflict') {
    const changed = ok(core.correct({ namespace: ns, memoryId: firstId, expectedRevision: firstMemory.revision,
      content: 'Use concise text in reviews.', kind: 'instruction',
      receipt: { client: 'demo', sessionId: 'session', eventId: 'correction', role: 'user', excerpt: 'Use concise text instead.' } }));
    ok(core.forget({ namespace: ns, memoryId: firstId, expectedRevision: changed.memory.revision }));
    assert.equal(core.get({ namespace: ns, memoryId: firstId }).error.code, 'memory_not_found');
    assert.deepEqual(ok(core.list({ namespace: ns })).memories, []);
  }
  const expectedTitle = mode === 'visible-conflict' ? title : null;
  assert.equal(ok(core.map({ namespace: ns, purpose: 'classification' })).items.find(i => i.type === 'moc').moc.title, expectedTitle);
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  const identity = () => plain(db.prepare('SELECT id,title,canonical_title,created_at FROM mocs WHERE id=?').get(topic.id));
  const sources = () => plain(db.prepare('SELECT * FROM moc_title_sources WHERE moc_id=? ORDER BY memory_id').all(topic.id));
  const beforeIdentity = identity(), beforeSources = sources(); core.close();
  const episodes = openMemoryCore({ path, model: f.model, captureQualification: 'source-bound-v2',
    captureEvidence: 'staged-v1', sessionEpisodes: { mode: 'episode-v1' } }); workspace.defer(() => episodes.close());
  const input = { namespace: ns, client: 'demo', eventId: 'episode-event', sessionId: 'episode-session',
    episodeContext: { clientLabel: 'Offline test', generation: 'initial', origin: 'ordinary' },
    messages: [{ id: 'episode-source', role: 'user', content: 'Please use diagrams in every review.' }] };
  const second = ok(await episodes.capture(input));
  assert.equal(second.episode.status, 'interpreted'); assert.equal(second.admission.memories.length, 1);
  const id = second.admission.memories[0].id, live = ok(episodes.get({ namespace: ns, memoryId: id }));
  assert.equal(live.procedural.procedural, true);
  assert.equal(live.procedural.anchors[0].receiptId, live.receipts[0].id);
  const calls = plain(f.calls), observation = ok(episodes.inspectAdmission({ namespace: ns, client: 'demo',
    eventId: input.eventId, includeInitialClassification: true }));
  assert.equal(ok(await episodes.capture(input)).duplicate, true); assert.deepEqual(f.calls, calls);
  episodes.close();
  const cold = openMemoryCore({ path, model: { contextWindow: f.model.contextWindow,
    countTokens: f.model.countTokens, extract: forbidden, classify: forbidden, select: forbidden, rank: forbidden } });
  workspace.defer(() => cold.close());
  const stored = ok(cold.get({ namespace: ns, memoryId: id }));
  const journal = ok(cold.inspectAdmission({ namespace: ns, client: 'demo', eventId: input.eventId,
    includeInitialClassification: true }));
  assert.deepEqual(journal.initialClassification, observation.initialClassification);
  const episode = ok(cold.getEpisode({ namespace: ns, episodeId: second.episode.id })).episode;
  assert.equal(stored.receipts.length, 1);
  assert.deepEqual({ client: stored.receipts[0].client, sessionId: stored.receipts[0].sessionId,
    eventId: stored.receipts[0].eventId, role: stored.receipts[0].role, excerpt: stored.receipts[0].excerpt },
  { client: input.client, sessionId: episode.sessionKey, eventId: input.messages[0].id,
    role: input.messages[0].role, excerpt: input.messages[0].content });
  assert.equal(cold.getEpisode({ namespace: { ...ns, ownerId: 'other' }, episodeId: second.episode.id }).ok, false);
  assert.equal(cold.get({ namespace: { ...ns, ownerId: 'other' }, memoryId: id }).ok, false);
  assert.deepEqual(identity(), beforeIdentity); assert.deepEqual(sources(), beforeSources);
  const catalog = ok(cold.map({ namespace: ns, purpose: 'classification' }));
  assert.equal(catalog.items.find(i => i.type === 'moc' && i.moc.id === topic.id).moc.title, expectedTitle);
  assert.equal(f.proposals.length, 2); assert.equal(f.proposals[1].input.mapExhausted, true);
  assert.equal(f.proposals[1].input.map.filter(i => i.type === 'moc').length, 1);
  assert.equal(f.proposals[1].input.map[0].moc.id, topic.id);
  assert.equal(f.proposals[1].input.map[0].moc.title, expectedTitle);
  assert.deepEqual(f.diagnostics.filter(e => e.stage === 'classify'), []);
  assert.equal(f.calls.filter(c => c.method === 'cairn_classify' && c.url.endsWith('/responses')).length, 2);
  return { second, stored, journal, topic, catalog, proposal: f.proposals[1].output };
}

test('NR1/6 adapter same hidden title applies with original NULL identity and cold receipt', async t => {
  const f = await scenario(t, 'same-hidden-title');
  assert.equal(f.second.classification.status, 'applied', JSON.stringify(f.second.classification));
  assert.equal(f.journal.initialClassification.status, 'applied');
  assert.deepEqual(f.stored.placements.map(p => [p.mocId, p.title]), [[f.topic.id, null]]);
  assert.equal(f.catalog.items.filter(i => i.type === 'moc').length, 1);
  assert.equal(f.proposal.items[0].newL1.title, title);
});
test('NR1 adapter still-visible collision refuses without losing admission or retrying', async t => {
  const f = await scenario(t, 'visible-conflict');
  assert.deepEqual(f.second.classification, { status: 'failed', error: { code: 'moc_title_conflict', retryable: false } });
  assert.equal(f.stored.memory.revision, 1); assert.equal(f.stored.memory.filing.status, 'unfiled');
  assert.deepEqual(f.stored.placements, []); assert.equal(f.journal.initialClassification.status, 'failed');
});
test('NR1 adapter alternate title applies without restoring the original NULL label', async t => {
  const f = await scenario(t, 'alternate-title');
  assert.equal(f.second.classification.status, 'applied'); assert.equal(f.journal.initialClassification.status, 'applied');
  assert.equal(f.stored.placements[0].title, alternative); assert.notEqual(f.stored.placements[0].mocId, f.topic.id);
});
test('NR1 adapter explicit existing NULL ID applies without synthesizing a new label', async t => {
  const f = await scenario(t, 'existing-null-id');
  assert.equal(f.second.classification.status, 'applied'); assert.equal(f.journal.initialClassification.status, 'applied');
  assert.deepEqual(f.stored.placements.map(p => [p.mocId, p.title]), [[f.topic.id, null]]);
  assert.deepEqual(f.proposal.items[0].parentIds, [f.topic.id]); assert.equal(Object.hasOwn(f.proposal.items[0], 'newL1'), false);
});
