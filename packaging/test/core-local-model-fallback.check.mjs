import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildCoreLocalCandidate } from '../build-core-local.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

test('a configured model failure finishes Raw and acknowledges the same chunk', async t => {
  const { path } = createTestWorkspace(t);
  const bundle = join(path, 'bundle');
  const manifest = buildCoreLocalCandidate(bundle);
  const tar = spawnSync('tar', ['-xzf', join(bundle, manifest.archive.filename), '-C', path], { encoding: 'utf8' });
  assert.ifError(tar.error);
  assert.equal(tar.status, 0, tar.stderr);
  const { openStorage } = await import(join(path, 'package/packaging/core-local/adapter-slot.mjs'));
  const { dispatchCapture } = await import(join(path, 'package/packaging/core-local/capture-dispatch.mjs'));
  const { CoreError } = await import(join(path, 'package/packages/core/src/index.mjs'));
  let calls = 0;
  const database = join(path, 'capture.sqlite');
  const runtime = await openStorage(database, undefined, { model: {
    model: 'synthetic', contextWindow: 128_000, countTokens: () => 1,
    async call(stage) {
      calls++;
      assert.equal(stage, 'extract');
      throw new CoreError('model_timeout');
    },
  }, embedder: { model: 'synthetic', dimensions: 1, embed: () => assert.fail('extraction failed') } });
  const scope = { owner: 'capture-owner', namespace: 'personal\0' };
  const selection = { client: 'claude-code', sessionId: 'synthetic-session', eventId: 'synthetic-event' };
  const message = { id: 'synthetic-message', role: 'user', content: 'Place the canary notebook beside the fern.',
    occurredAtMs: 10 };
  try {
    const signal = new AbortController().signal;
    assert.deepEqual(await dispatchCapture(runtime.service, scope, selection, message, signal, false),
      { status: 'done', code: 'model_timeout' });
    assert.equal(calls, 1);
  } finally {
    await runtime.close();
  }
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    assert.equal(JSON.parse(db.prepare('SELECT content FROM cairn_raw_messages').get().content), message.content);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cairn_memories').get().count, 0);
  } finally {
    db.close();
  }
});

test('capture rejects non-hook commands with the legacy failure envelope', () => {
  const entry = fileURLToPath(new URL('../core-local/capture-cli.mjs', import.meta.url));
  const child = spawnSync(process.execPath, [entry, 'unknown'], { encoding: 'utf8' });
  assert.ifError(child.error);
  assert.equal(child.status, 1, child.stderr);
  assert.equal(child.stderr, '');
  assert.deepEqual(JSON.parse(child.stdout), { version: 'local-raw-setup-v1', status: 'blocked', reason: 'invalid_input',
    foreground: true, hookTimeoutSeconds: 160 });
});
