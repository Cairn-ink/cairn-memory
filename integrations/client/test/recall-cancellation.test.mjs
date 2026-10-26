import assert from 'node:assert/strict';
import test from 'node:test';
import fsPromises, { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { resolveClient, projectKey } from '../pairing.mjs';
import { createHmac } from 'node:crypto';
import { withWriteObserver } from '../private-state.mjs';
import { createJsonPoster, hostedTargetId } from '../transport-hosted.mjs';
import { withLockClock } from '../testing/lock-contention.mjs';

const key = '12345678-1234-4234-8234-123456789abc';
const fixture = fileURLToPath(new URL('../../../plugins/cairn-memory/test/fixtures/recall-deadline-cancellation.mjs', import.meta.url));
const rendezvous = () => {
  let resolve;
  const promise = new Promise(done => resolve = done);
  return { promise, resolve };
};
async function home(t) {
  const workspace = createTestWorkspace(t, { prefix: 'recall-cancellation-' });
  const root = join(workspace.path, '.cairn-memory');
  await mkdir(root, { mode: 0o700 });
  return { workspace, root, options: { client: 'claude', home: workspace.path, env: {} } };
}
function child(t, mode, root, abortAt, onMessage = () => {}) {
  const processChild = spawn(process.execPath, [fixture, mode, root], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const messages = []; let stdout = '', stderr = '';
  processChild.stdout.on('data', chunk => stdout += chunk);
  processChild.stderr.on('data', chunk => stderr += chunk);
  processChild.on('message', event => {
    messages.push(event); onMessage(event);
    if (event.kind === abortAt) processChild.send({ kind: 'abort' });
  });
  const done = new Promise((resolve, reject) => {
    processChild.once('error', reject);
    processChild.once('close', (code, signal) => resolve({ code, signal }));
  });
  t.after(async () => {
    if (processChild.exitCode === null && processChild.signalCode === null) processChild.kill('SIGKILL');
    await done;
  });
  return { pid: processChild.pid, send: event => processChild.send(event), async result() {
    assert.deepEqual(await done, { code: 0, signal: null });
    assert.equal(stdout, ''); assert.equal(stderr, '');
    return messages;
  } };
}

test('binding discovery cancellation in key-publication lock acquisition preserves the abort reason and state', async t => {
  const f = await home(t), lock = join(f.root, '.project-key.lock');
  // Obtain a PID which has really exited, rather than guessing a dead PID.
  const dead = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  assert.equal(await new Promise(resolve => dead.once('close', resolve)), 0);
  const owner = { pid: dead.pid, token: key };
  await writeFile(join(f.root, 'project-key'), key + '\n', { mode: 0o600 });
  await writeFile(lock, JSON.stringify(owner), { mode: 0o600 });
  await writeFile(`${lock}.owner-${owner.pid}-${owner.token}`, JSON.stringify(owner), { mode: 0o600 });
  const before = (await readdir(f.root)).sort();
  const reached = rendezvous(), release = rendezvous(), controller = new AbortController();
  const original = fsPromises.link; let hits = 0;
  fsPromises.link = async function (source, destination) {
    if (destination === lock) { hits++; reached.resolve(); await release.promise; }
    return original(source, destination);
  };
  syncBuiltinESMExports();
  try {
    const pending = resolveClient({ ...f.options, signal: controller.signal });
    const rejected = assert.rejects(pending, error => error === controller.signal.reason);
    await reached.promise; controller.abort(); release.resolve(); await rejected;
    assert.equal(hits, 1);
    assert.deepEqual((await readdir(f.root)).sort(), before);
    assert.equal(await readFile(join(f.root, 'project-key'), 'utf8'), key + '\n');
    assert.deepEqual(JSON.parse(await readFile(lock, 'utf8')), owner);
  } finally { release.resolve(); fsPromises.link = original; syncBuiltinESMExports(); }
  // The next uncancelled discovery can recover the old lock; no cancelled
  // contender file or partial publication remains (reaper tombstones are durable).
  await resolveClient(f.options);
  const names = await readdir(f.root);
  assert.ok(!names.includes('.project-key.lock'));
  assert.ok(!names.includes('.project-key.pending'));
  assert.deepEqual(names.filter(name => name.startsWith('.project-key.lock.owner-')), []);
});

test('binding discovery stops between session-evidence reads and closes the scan on cancellation', async t => {
  const f = await home(t), directory = join(f.root, 'sessions');
  await mkdir(directory, { mode: 0o700 });
  for (const digit of ['a', 'b']) await writeFile(join(directory, digit.repeat(64) + '.json'),
    JSON.stringify({ offset: -1 }), { mode: 0o600 });
  const reached = rendezvous(), release = rendezvous(), controller = new AbortController();
  const original = fsPromises.open, originalOpendir = fsPromises.opendir;
  let reads = 0, scannedDirectory;
  fsPromises.open = async function (path, ...args) {
    const file = await original(path, ...args);
    if (String(path).startsWith(directory + '/')) {
      const read = file.readFile.bind(file);
      file.readFile = async (...readArgs) => {
        const bytes = await read(...readArgs);
        if (++reads === 1) { reached.resolve(); await release.promise; }
        return bytes;
      };
    }
    return file;
  };
  fsPromises.opendir = async function (...args) {
    const dir = await originalOpendir(...args);
    scannedDirectory = dir;
    return dir;
  };
  syncBuiltinESMExports();
  try {
    const pending = resolveClient({ ...f.options, signal: controller.signal });
    const rejected = assert.rejects(pending, error => error === controller.signal.reason);
    await reached.promise; controller.abort(); release.resolve(); await rejected;
    assert.equal(reads, 1);
    // Node 22 throws synchronously on a closed Dir; Node 24 rejects the promise.
    await assert.rejects(async () => scannedDirectory.read(), error => error.code === 'ERR_DIR_CLOSED');
    assert.deepEqual(await readdir(f.root), ['sessions']);
  } finally {
    release.resolve(); fsPromises.open = original; fsPromises.opendir = originalOpendir; syncBuiltinESMExports();
  }
});

test('cancellation after key staging finishes the bounded publication without partial key or lock state', async t => {
  const f = await home(t), controller = new AbortController();
  await assert.rejects(withWriteObserver(({ path }) => {
    if (path === join(f.root, '.project-key.pending')) controller.abort();
  }, () => projectKey(f.root, { home: f.workspace.path, signal: controller.signal })),
  error => error === controller.signal.reason);
  const published = (await readFile(join(f.root, 'project-key'), 'utf8')).trim();
  assert.deepEqual(JSON.parse(await readFile(join(f.root, 'created-by'), 'utf8')),
    { version: 1, client: 'claude', fingerprint: createHmac('sha256', published).update('cairn-memory:binding:v1').digest('hex') });
  assert.deepEqual((await readdir(f.root)).sort(), ['created-by', 'project-key']);
  assert.equal(await projectKey(f.root, { create: false, home: f.workspace.path }), published);
});

for (const mode of ['publication', 'expired-before-fetch', 'dispatch-lock', 'fetch-started', 'successor']) {
  test(`R16 cancellation at ${mode} preserves unused permits and fences started/newer attempts across dead-owner recovery`, async t => {
    const f = await home(t), directory = join(f.root, 'hosted-quota');
    const targetId = hostedTargetId({ endpoint: 'https://synthetic.invalid' });
    const statePath = join(directory, `${targetId}.json`);
    const resetAt = '2026-10-02T00:00:00Z';
    const fresh = { mode: 'open', resetAt: null, until: null, attempt: null };
    const capture = { ...fresh, mode: 'quota_reached', resetAt };
    await mkdir(directory, { mode: 0o700 });
    await writeFile(statePath, JSON.stringify({ version: 2, operations: {
      recall: { ...fresh, mode: 'ready', resetAt }, capture,
    } }), { mode: 0o600 });
    const pending = child(t, mode, f.root, mode === 'dispatch-lock' ? 'dispatch-wait' :
      mode === 'fetch-started' ? 'fetch-started' : 'reserved');
    const messages = await pending.result(), result = messages.find(message => message.kind === 'result');
    assert.equal(messages.filter(message => message.kind === 'reserved').length, 1);
    if (mode === 'dispatch-lock') assert.equal(messages.filter(message => message.kind === 'dispatch-wait').length, 1);
    assert.equal(result.attempts, mode === 'fetch-started' ? 1 : 0);
    const expected = ['fetch-started', 'successor'].includes(mode) ? 'in_flight' : 'ready';
    assert.equal(result.operation.mode, expected);
    assert.equal(result.operation.resetAt, resetAt);
    if (expected === 'in_flight') assert.equal(result.operation.attempt.pid, pending.pid);
    else assert.equal(result.operation.attempt, null);
    const recovered = await child(t, 'recover', f.root).result();
    assert.equal(recovered.find(message => message.kind === 'recovered').mode,
      expected === 'ready' ? 'ready' : 'quota_reached');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(state.operations.capture, capture);
    assert.equal(state.operations.recall.attempt, null);
    assert.deepEqual(await readdir(directory), [`${targetId}.json`]);
    assert.deepEqual(await readdir(f.root), ['hosted-quota']);
  });
}

for (const mode of ['free', 'cancelled-contention', 'active-signal-contention', 'no-signal-contention']) {
  test(`R16 unused permit restoration uses its logical lock budget (${mode})`, async t => {
    const f = await home(t), directory = join(f.root, 'hosted-quota');
    const endpoint = 'https://synthetic.invalid', targetId = hostedTargetId({ endpoint });
    const statePath = join(directory, `${targetId}.json`), lock = statePath + '.lock';
    const fresh = { mode: 'open', resetAt: null, until: null, attempt: null };
    await mkdir(directory, { mode: 0o700 });
    await writeFile(statePath, JSON.stringify({ version: 2, operations: {
      recall: { ...fresh, mode: 'ready' }, capture: fresh,
    } }), { mode: 0o600 });
    const controller = new AbortController(), post = createJsonPoster({ root: f.root, targetId,
      endpoint, token: 'synthetic-token' });
    let attempts = 0, holder, holderDone, before, ownerBytes, ownerFile, ownerFileBytes, namesBefore;
    t.mock.method(globalThis, 'fetch', () => { attempts++; throw new Error('unexpected_fetch'); });
    try {
      await withLockClock(t, async clock => {
        const reply = await post.reply('/api/memory/recall', { query: 'Synthetic question', limit: 6 },
          2000, undefined, mode === 'no-signal-contention' ? undefined : controller.signal, async () => {
            before = await readFile(statePath, 'utf8');
            assert.equal(JSON.parse(before).operations.recall.mode, 'in_flight');
            if (mode !== 'free') {
              const ready = rendezvous();
              holder = child(t, 'hold-quota-lock', f.root, undefined,
                event => { if (event.kind === 'lock-held') ready.resolve(); });
              holderDone = holder.result();
              await Promise.race([ready.promise, holderDone.then(() => {
                throw new Error('foreign_holder_exited_before_acquisition');
              })]);
              ownerBytes = await readFile(lock, 'utf8');
              assert.equal(JSON.parse(ownerBytes).pid, holder.pid);
              assert.notEqual(holder.pid, process.pid);
              namesBefore = (await readdir(directory)).sort();
              ownerFile = namesBefore.find(name => name.includes('.owner-'));
              ownerFileBytes = await readFile(join(directory, ownerFile), 'utf8');
            }
            if (mode === 'free' || mode === 'cancelled-contention') controller.abort();
            throw new Error('dispatch_not_started');
          });
        assert.equal(reply.status, 'unavailable'); assert.equal(attempts, 0);
        // Logical polling exhausts exactly the chosen window while the foreign
        // process stays live; no wall-clock threshold or sleep decides success.
        assert.equal(clock.elapsed(), mode === 'free' ? 0 : mode === 'no-signal-contention' ? 2000 : 250);
        const state = JSON.parse(await readFile(statePath, 'utf8'));
        assert.deepEqual(state.operations.capture, fresh);
        if (mode === 'free') {
          assert.deepEqual(state.operations.recall, { ...fresh, mode: 'ready' });
          assert.deepEqual(await readdir(directory), [`${targetId}.json`]);
        } else {
          assert.equal(await readFile(statePath, 'utf8'), before);
          assert.equal(await readFile(lock, 'utf8'), ownerBytes);
          assert.equal(await readFile(join(directory, ownerFile), 'utf8'), ownerFileBytes);
          assert.deepEqual((await readdir(directory)).sort(), namesBefore);
        }
      });
    } finally {
      if (holder) { holder.send({ kind: 'release' }); await holderDone; }
    }
    assert.deepEqual(await readdir(directory), [`${targetId}.json`]);
  });
}
