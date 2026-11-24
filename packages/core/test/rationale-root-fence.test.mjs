import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decisionContext } from '../src/index.mjs';
import { planRationaleEdges, webHash } from '../src/rationale/store-plan.mjs';
import { rationaleFixture } from './fixtures/rationale/store.mjs';

async function challengeFixture() {
  const fixture = rationaleFixture([
    { id: 'root', excerpt: 'The chosen approach depends on the premise.' },
    { id: 'challenger', excerpt: 'The premise no longer holds.' },
  ]);
  const { state, store, scope, uow } = fixture;
  const [edge] = await planRationaleEdges({ sources: [...state.sources.values()] }, [
    { from: 1, to: 0, relation: 'challenges-premise', fromReceipt: 0, toReceipt: 0 },
  ], webHash);
  await uow.run(scope.owner, { readOnly: false }, tx => store.insert(tx, scope, edge));
  return { ...fixture, memoryId: 'root' };
}

function rejectMemory(t, { retrieval: { fence } }, rejectedId) {
  const { assertVisible } = fence;
  t.mock.method(fence, 'assertVisible', (tx, scope, refs) =>
    assertVisible(tx, scope, refs.filter(({ id }) => id !== rejectedId)));
}

test('decision context rejects a fenced root before reading evidence or edges', async t => {
  const options = await challengeFixture();
  rejectMemory(t, options, options.memoryId);
  const evidence = t.mock.method(options.store, 'sourceEvidence');
  const incoming = t.mock.method(options.store, 'incoming');

  await assert.rejects(decisionContext(options), { name: 'CoreError', code: 'memory_not_found' });
  assert.equal(evidence.mock.callCount(), 0);
  assert.equal(incoming.mock.callCount(), 0);
});

test('decision context omits an incoming challenge from a fenced non-root endpoint', async t => {
  const options = await challengeFixture();
  assert.deepEqual(await decisionContext(options), {
    status: 'reconfirmation-suggested',
    refs: [{ id: 'challenger', revision: 1, relation: 'challenges-premise', direction: 'incoming' }],
  });

  rejectMemory(t, options, 'challenger');
  assert.deepEqual(await decisionContext(options), { status: 'unassessed', refs: [] });
});
