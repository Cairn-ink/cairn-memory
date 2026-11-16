import test from 'node:test';
import { runMatrixCase } from './fixtures/forget-episode-matrix.mjs';
import { setup, ok } from './fixtures/forget-episode.mjs';
import { noNeedles } from './fixtures/forget-episode-assertions.mjs';

// Paired forget/correct cases retain their original recording names.
const cases = [
  ['X_29_episodes', { layout: 29 }],
  ['X_33_episodes', { layout: 33 }],
  ['X_48_episodes', { layout: 48 }],
  ['X_53time_episodes', { layout: 53 }],
  ['X_53lineage_episodes', { layout: 53, cardLineage: true }],
  ['X_53time_different_messages_episodes', { layout: 53, differentMessages: true }],
];
for (const [name, options] of cases) for (const operation of ['forget', 'correct']) {
  const caseName = name === 'X_53time_episodes' && operation === 'correct' ? 'X_53time_correct_episodes' : name + ' ' + operation;
  test(caseName, { concurrency: false, timeout: 120000 }, t => runMatrixCase(t, options, operation));
}

// Direct Raw reader coverage is still pending on its separate branch.
test('pending direct Raw readers whole-result needle scan', {
  skip: 'Pending the direct-reader fix on its separate branch; this branch only withholds Episodes.'
}, async t => {
  for (const operation of ['forget', 'correct']) {
    const f = await setup(t, { layout: 53 });
    ok(await f.act(operation));
    noNeedles(await f.core.listRawConversations({ namespace: f.namespace, limit: 50 }));
    noNeedles(await f.core.getConversation({ namespace: f.namespace, conversationId: f.conversation.id, limit: 50 }));
  }
});
