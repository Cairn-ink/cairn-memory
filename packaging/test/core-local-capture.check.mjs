import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { dispatchCapture } from '../core-local/capture-dispatch.mjs';
import { trustedBinding } from '../core-local/capture-binding.mjs';

const cli = fileURLToPath(new URL('../core-local/capture-cli.mjs', import.meta.url));
const scope = { owner: 'synthetic-owner', namespace: 'project\0synthetic-project' };
const selection = { client: 'claude-code', sessionId: 'synthetic-session', eventId: 'synthetic-event' };
const message = { id: 'synthetic-message', role: 'user', occurredAtMs: 0, content: 'Synthetic capture content.' };

test('automatic capture binds admission, recovery and finish to the same event and payload', async () => {
  const calls = [];
  const controller = new AbortController();
  const service = {
    async enqueueCapture(...args) { calls.push(['admit', ...args]); return { status: 'duplicate' }; },
    async captureStatus(...args) { calls.push(['status', ...args]); return { status: 'done' }; },
    async runCapture(...args) { calls.push(['run', ...args]); return { status: 'done', result: { memories: [] } }; },
  };
  assert.deepEqual(await dispatchCapture(service, scope, selection, message, controller.signal, true), { status: 'done' });
  assert.deepEqual(calls, [
    ['admit', scope, { ...selection, messages: [message] }],
    ['status', scope, selection.eventId, { client: selection.client }],
    ['run', scope, selection, { signal: controller.signal }],
  ]);
});

test('a ledger status is insufficient for acknowledgement and an admission refusal never runs', async () => {
  const signal = new AbortController().signal;
  const unused = () => assert.fail('runner should not be called');
  for (const [admit, expected] of [
    [() => ({ status: 'paused' }), 'authority_changed'],
    [() => ({ status: 'blocked' }), 'capture_refused'],
    [() => { throw Object.assign(Error(), { code: 'capability_unavailable' }); }, 'capture_refused'],
  ]) {
    const result = await dispatchCapture({ enqueueCapture: admit, captureStatus: unused, runCapture: unused },
      scope, selection, message, signal, true);
    assert.deepEqual(result, { status: 'blocked', reason: expected });
  }
  const busy = { enqueueCapture: () => ({ status: 'duplicate' }), captureStatus: () => ({ status: 'done' }),
    runCapture: () => ({ status: 'processing' }) };
  assert.deepEqual(await dispatchCapture(busy, scope, selection, message, signal, true), { status: 'processing' });
});

test('malformed input and stale binding stay silent with SQLite denied', () => {
  const generation = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const path = '/synthetic/core-' + generation;
  const binding = { version: 'core-local-capture-v1', phase: 'armed', generation, database: '/synthetic/candidate.sqlite',
    device: '1', inode: '2', attemptId: generation, migrationId: generation, attestation: 'a'.repeat(64),
    legacyDigest: 'b'.repeat(64), sourceRoot: '/synthetic/source', sourceIdentity: { device: '1', inode: '3' },
    supportPath: '/synthetic/plugin', executable: '/synthetic/engine/capture-cli.mjs',
    authority: { version: 'local-capture-authority-v1', targetId: 'synthetic-target', storeId: 'synthetic-store',
      namespace: { ownerId: scope.owner, scope: 'personal', projectId: null }, client: selection.client,
      expectedControlRevision: 1, expectedConsentGeneration: generation, expectedNamespaceGeneration: 'initial', expectedRawRevision: 0 } };
  assert.equal(trustedBinding(binding, path).generation, generation);
  assert.throws(() => trustedBinding(binding, '/synthetic/core-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), { reason: 'authority_changed' });
  for (const input of ['{', JSON.stringify({ hook_event_name: 'Stop', session_id: 'synthetic', transcript_path: '/synthetic/source/a' })]) {
    const result = spawnSync(process.execPath, ['--no-experimental-sqlite', cli, 'hook', '--installation', path, '--event', 'Stop'],
      { env: {}, input, encoding: 'utf8', timeout: 3000 });
    assert.ifError(result.error);
    assert.deepEqual({ code: result.status, stdout: result.stdout, stderr: result.stderr }, { code: 0, stdout: '', stderr: '' });
  }
});
