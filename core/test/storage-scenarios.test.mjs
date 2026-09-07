import assert from 'node:assert/strict';
import test from 'node:test';
import { runStorageScenario } from '../testing/storage-scenarios.mjs';

// Independently authored public examples, not copies of the private oracle.
const input = () => ({
  memories: [{ id: 'note', ownerId: 'tester', projectId: 'sandbox',
    content: 'Show a sequence diagram for the handshake.', kind: 'instruction',
    origin: 'explicit', revision: 1, updatedAt: '2025-08-01T00:00:00.000Z',
    receipt: { id: 'source', excerpt: 'Show a sequence diagram for the handshake.' } }],
  memoryCases: [{ id: 'inspection', namespace: { ownerId: 'tester', projectId: 'sandbox' },
    setupMemoryIds: ['note'], steps: [{ operation: 'get', memoryId: 'note', modelAvailable: false }],
    expected: { status: 'ok', memoryIds: ['note'], runtimeMemoryIds: ['note'], receiptIds: ['source'],
      modelCalls: 0, receiptExcerpts: { source: 'Show a sequence diagram for the handshake.' } } }],
});

test('scenario adapter compares real SQLite content and source identities', () => {
  assert.equal(runStorageScenario(input(), 'inspection').status, 'passed');
});
test('scenario adapter rejects unsupported actions and assertion fields', () => {
  const corpus = input();
  corpus.memoryCases[0].steps.push({ operation: 'recall', query: 'How do I learn protocols?' });
  assert.throws(() => runStorageScenario(corpus, 'inspection'), /unsupported operation/);
  corpus.memoryCases[0].steps.pop();
  corpus.memoryCases[0].expected.coverage = 'complete';
  assert.throws(() => runStorageScenario(corpus, 'inspection'), /unsupported field/);
});
test('scenario adapter does not pass invented receipts or unexpected failures', () => {
  const corpus = input();
  corpus.memoryCases[0].expected.receiptExcerpts.source = 'This was never provided.';
  assert.throws(() => runStorageScenario(corpus, 'inspection'));
  const failure = input();
  failure.memoryCases[0].namespace.ownerId = 'someone-else';
  assert.throws(() => runStorageScenario(failure, 'inspection'));
});
