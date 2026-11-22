import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createOpenAIModel } from '../../openai/index.mjs';
import { createCommitDispatcher } from '../../../core/commit-dispatch.mjs';
import { openDatabase } from '../../../core/database.mjs';
import { openMemoryCore } from '../../../core/index.mjs';
import { eventTimeFixture } from '../../../core/testing/receipt-event-time-fixture.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { startContextMaintenance } from '../server.mjs';
import { deferred, ns, ok } from './local-shared-support.mjs';

const countPath = '/v1/responses/input_tokens';
const generationPath = '/v1/responses';
const cardLine = 'The garden workshop uses the library meeting room.';

for (const layout of [29, 53]) {
  for (const shared of [false, true]) {
    for (const pause of [true, false]) {
      test(`Card provider ${pause ? 'stops after pause' : 'publishes while enabled'} on the ${shared ? 'shared' : 'standalone'} turn, layout ${layout}`,
        { timeout: 15000 }, async t => {
          const { path, workspace } = await seed(t, layout);
          const control = openMemoryCore({ path, raw: true, rawSearch: false });
          workspace.defer(() => control.close());
          const calls = [];
          let pauseCommitted = false;
          const model = createOpenAIModel({ apiKey: 'synthetic-only', async fetchImpl(url, request) {
            assert.equal(request.method, 'POST');
            const endpoint = new URL(url).pathname;
            const { input: messages, model: selectedModel } = JSON.parse(request.body);
            const { memories } = JSON.parse(messages[0].content[0].text);
            assert.match(memories[0].content, /garden workshop/);
            calls.push(endpoint);
            if (endpoint === countPath) {
              if (pause) {
                const { generation } = ok(control.getCaptureControl({ namespace: ns }));
                const updated = ok(control.setCapturePaused({ namespace: ns, expectedGeneration: generation, paused: true }));
                pauseCommitted = updated.paused;
              }
              return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
            }
            assert.equal(endpoint, generationPath);
            const value = { currentState: [{ text: cardLine, memoryIds: [memories[0].id] }], timeline: [], contradictions: [] };
            return Response.json({ object: 'response', model: selectedModel, status: 'completed', error: null, incomplete_details: null,
              usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 },
              output: [{ type: 'message', role: 'assistant', status: 'completed',
                content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
          } });
          const dispatcher = shared ? createCommitDispatcher({ strict: true }) : null;
          const open = () => openMemoryCore({ path, model });
          const core = dispatcher ? dispatcher.open(open) : open();
          workspace.defer(() => core.close());
          const completed = deferred();
          const loop = startContextMaintenance({ async maintainCards(input) {
            const pass = await core.maintainCards(input);
            completed.resolve(pass);
            return pass;
          } }, { readSet: [ns] }, { cards: true, semantic: false, host: shared,
            ...(dispatcher ? { run: work => dispatcher.run(work) } : {}) });
          workspace.defer(() => loop.close());
          // The production timer is unref'd. Keep its first turn alive and
          // time out explicitly if it never reports a maintenance outcome.
          let timer;
          try {
            const pass = ok(await Promise.race([completed.promise, new Promise((_, reject) => {
              timer = setTimeout(() => reject(Error('maintenance turn did not finish')), 10000);
            })]));
            assert.equal(pauseCommitted, pause, 'the token-count response commits the pause');
            assert.deepEqual(calls, pause ? [countPath] : [countPath, generationPath]);
            assert.equal(pass.modelCalls, 1);
            assert.equal(pass.state, pause ? 'paused' : 'ready', JSON.stringify(pass));
            assert.equal(pass.reason, pause ? 'namespace_paused' : undefined);
            assert.equal(pass.built.length, pause ? 0 : 1);
            const db = new DatabaseSync(path);
            try {
              assert.equal(db.prepare('PRAGMA user_version').get().user_version, layout);
              const cards = db.prepare("SELECT id FROM private_cards WHERE state='confirmed'").all();
              assert.deepEqual(cards.map(card => card.id), pass.built.map(card => card.id));
            } finally { db.close(); }
          } finally { clearTimeout(timer); await loop.close(); }
        });
    }
  }
}

async function seed(t, layout) {
  let path, workspace;
  if (layout === 53) ({ path, workspace } = await eventTimeFixture(t, 33));
  else {
    workspace = createTestWorkspace(t);
    path = join(workspace.path, 'store.sqlite');
    openDatabase(path, { privateCards: true, localControls: true }).close();
  }
  const core = openMemoryCore({ path, raw: true, rawSearch: false });
  const db = new DatabaseSync(path);
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, layout);
    for (let i = 0; i < 12; i++) {
      const content = `The garden workshop planning milestone ${i} records evidence marker${i}.`;
      const { memory } = ok(core.admit({ namespace: ns, memory: { content, kind: 'fact' },
        receipts: [{ client: 'synthetic', sessionId: 'conversation-' + (i % 6),
          eventId: 'milestone-' + i, role: 'user', excerpt: content }] }));
      db.prepare('UPDATE memories SET created_at=? WHERE id=?')
        .run(new Date(Date.UTC(2026, 0, 1 + i * 4)).toISOString(), memory.id);
    }
  } finally { db.close(); await core.close(); }
  return { path, workspace };
}
