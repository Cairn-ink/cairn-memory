import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCardBodySafetyV1 } from '../content-safety-classifier.mjs';

const identity = kind => ({ storeId: 'synthetic-store', ownerId: 'synthetic-owner', scope: 'personal',
  projectId: '', kind, key: 'synthetic-' + kind, incarnation: 'synthetic-' + kind, version: '["v1",1]' });
const evidence = { origin: 'memories', digest: 'a'.repeat(64) };
const observation = () => ({ version: 1, body: { identity: identity('card'), titleUtf8: '41', bodyUtf8: '42' },
  edges: [{ identity: identity('memory'), evidence, state: { exists: true } }], suppressionFacts: [], coverage: null });

for (const reason of ['user_forget', 'correction_supersession', 'purge', 'privacy_erase', 'account_erasure']) {
  test(`pure classifier: ${reason} wins over live bindings and incomplete lineage`, () => {
    const input = observation();
    input.edges.push({ ...input.edges[0], identity: identity('receipt'), state: { exists: false } });
    input.suppressionFacts.push({ target: identity('memory'), reason, evidence });
    const before = structuredClone(input);
    assert.deepEqual(classifyCardBodySafetyV1(input), { status: 'known-suppressed', reasons: [reason] });
    assert.deepEqual(input, before);
  });
}
for (const variant of ['plain', 'empty', 'authoredInput', 'superseded', 'hard-deleted', 'trustedProof', 'fake-header']) {
  test(`pure classifier never infers complete or suppression: ${variant}`, () => {
    const input = observation();
    if (variant === 'empty' || variant === 'authoredInput') input.edges = [];
    if (variant === 'authoredInput') input.authoredInput = { text: 'Synthetic own writing' };
    if (variant === 'superseded') input.edges[0].state.currentness = 'historical';
    if (variant === 'hard-deleted') input.edges[0].state.exists = false;
    if (variant === 'trustedProof') input.trustedProof = true;
    if (variant === 'fake-header') input.coverage = { complete: true, header: { completeness: 'complete', origin: 'user-authored' }, sources: [] };
    assert.equal(classifyCardBodySafetyV1(input).status, 'unknown');
  });
}
test('suppression matches the full identity, never another owner/version', () => {
  for (const key of ['storeId', 'ownerId', 'scope', 'projectId', 'kind', 'key', 'incarnation', 'version']) {
    const input = observation();
    input.suppressionFacts.push({ target: { ...identity('memory'), [key]: 'other' }, reason: 'user_forget', evidence });
    assert.equal(classifyCardBodySafetyV1(input).status, 'unknown');
  }
});
