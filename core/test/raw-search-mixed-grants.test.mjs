import test from 'node:test';
import assert from 'node:assert/strict';
import { openRawSearch } from '../raw-search-index.mjs';
import { assembleThreeLayerContext } from '../context-read-three-layer.mjs';
import { installRawSearchTestClock } from '../testing/raw-search-clock.mjs';
import { sourceFixture, savedSource, ns } from '../testing/raw-source-fixtures.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';

test.beforeEach(installRawSearchTestClock);
for (const boundary of ['pre-projection', 'final']) test(`mixed native readers refuse revoked caller grants at ${boundary}`, async t => {
  const f = sourceFixture(t), sources = [];
  for (const [index, text] of ['telescope secret amber', 'telescope secret birch'].entries())
    sources.push(await savedSource(f, text, { sessionId: 'grant-' + index }));
  let denied = false;
  const first = await searchFixture(f, { setupHost(host) {
    const current = host.authority.isCurrent;
    host.authority.isCurrent = (grant, request) => denied && request.method === 'rawSearchSource' &&
      request.input.candidate?.conversationId === sources[1].conversationId ? null : current(grant, request);
  } });
  await first.maintain({ maxItems: 128, maxMs: 5000 });
  let found;
  for (let index = 0; index < 32; index++) {
    found = await first.search({ query: 'telescope' });
    if (found.candidates.length === 2 && found.coverage.status === 'complete') break;
    await first.tick({ maxItems: 128, maxMs: 5000 });
  }
  assert.equal(found.candidates.length, 2); assert.equal(found.coverage.status, 'complete');
  const second = await openRawSearch(first.options);
  f.workspace.defer(() => second.close());
  const searches = [await first.search({ query: 'telescope' }), await second.search({ query: 'telescope' }, first.host.token)];
  const candidates = searches.map((result, index) => result.candidates.find(c => c.conversationId === sources[index].conversationId));
  assert.ok(candidates.every(Boolean)); assert.notEqual(candidates[0].proof, candidates[1].proof);
  const handles = [await first.prepare(candidates[0]), await second.prepare(candidates[1], {}, first.host.token)];
  const raw = { coverage: 'included', rawSearch: { revalidate: values => first.service.revalidate(values) },
    items: handles.map((handle, index) => ({ handle, value: handle.value, key: 'turn-' + index, rank: index + 1 })) };
  const args = { prepared: [], counter: { id: 'synthetic-counter', countTokens: () => 1 },
    policy: { id: 'rank-first-whole-v1' }, budget: { maxTokens: 6000, maxItems: 24 }, query: 'telescope',
    readSet: [ns], representation: 'representation-v2-dated', deadlineAt: Infinity, snapshotOf: () => null };
  const allowed = assembleThreeLayerContext(args, raw);
  assert.equal(allowed.metered.items.length, 2); assert.equal(allowed.validateRaw(), true);
  denied = true;
  assert.deepEqual(first.service.revalidate([handles[0]]), [handles[0].value], 'the first reader grant remains current');
  if (boundary === 'final') assert.equal(allowed.validateRaw(), false);
  else {
    const refused = assembleThreeLayerContext(args, raw);
    assert.equal(refused.diagnostics.coverage.raw, 'partial'); assert.deepEqual(refused.metered.items, []);
    assert.equal(JSON.stringify(refused).includes('secret'), false);
  }
});
