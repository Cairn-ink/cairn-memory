import assert from 'node:assert/strict';
import { test } from 'node:test';
import { relatePlaced } from '../src/index.mjs';
import { modelReturning, rationaleFixture } from './fixtures/rationale/store.mjs';

test('evidence forgotten while the pre-send gate is pending never reaches the provider', async () => {
  const f = rationaleFixture([{ id: 'root', excerpt: 'A private decision.' }]);
  const phases = [];
  let calls = 0;
  const gate = { async assertOpen(owner, phase) {
    assert.equal(owner, f.scope.owner);
    phases.push(phase);
    if (phase === 'pre-send') {
      await Promise.resolve();
      f.mutate('root', 'forget');
    }
  } };
  const result = await relatePlaced({ ...f, refs: [f.guard('root')], gate,
    model: modelReturning(() => {
      calls++;
      return { edges: [] };
    }),
  });
  assert.equal(f.state.sources.has('root'), false);
  assert.deepEqual(result.error, { code: 'revision_conflict', retryable: false });
  assert.equal(calls, 0, 'Forgotten evidence reached the provider');
  assert.deepEqual(phases, ['pre-send']);
  assert.equal(f.writes, 0);
});
