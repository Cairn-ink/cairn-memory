import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, realpath, rename, stat, symlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { observeHostedPause, withHostedPauseGate, completeHostedPauseRotation } from '../hosted-pause.mjs';
import { withWriteObserver, privateWrite } from '../private-state.mjs';
import { stateLock } from '../state-lock.mjs';
import { hostedTargetId } from '../transport-hosted.mjs';

// Two host roots and a configured path that reaches the first one through a
// symlink: either the root itself (a profile alias) or one of its ancestors.
async function aliasedRoots(t, layout) {
  const base = await realpath(createTestWorkspace(t).path);
  const a = layout === 'root' ? join(base, 'a') : join(base, 'pa', 'data');
  const b = layout === 'root' ? join(base, 'b') : join(base, 'pb', 'data');
  await mkdir(a, { recursive: true, mode: 0o755 }); await mkdir(b, { recursive: true, mode: 0o755 });
  const link = join(base, 'profile');
  await symlink(layout === 'root' ? a : join(base, 'pa'), link);
  const configured = layout === 'root' ? link : join(link, 'data');
  const retarget = async () => {
    const next = join(base, 'next-profile');
    await symlink(layout === 'root' ? b : join(base, 'pb'), next);
    await rename(next, link);
  };
  return { base, a, b, configured, retarget };
}
async function loopbackServer(t) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, bytes: body.length });
    res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { requests, endpoint: `http://127.0.0.1:${server.address().port}` };
}
const pauseFile = (root, endpoint) => join(root, 'hosted-pause', hostedTargetId({ endpoint }) + '.json');
const markers = async root => (await readdir(join(root, 'hosted-pause-pending')).catch(() => []))
  .filter(name => name.endsWith('.json'));
const initial = { paused: false, generation: 0, enforced: true };

for (const layout of ['root', 'ancestor']) test(`retargeting the configured ${layout} path cannot publish into a root whose live sender holds its gate`, { timeout: 25000 }, async t => {
  const { base, a, b, configured, retarget } = await aliasedRoots(t, layout);
  const { requests, endpoint } = await loopbackServer(t);
  let remote = initial;
  t.mock.method(globalThis, 'fetch', async () => Response.json(remote));
  await observeHostedPause({ root: a, endpoint }, 'synthetic-only');
  await observeHostedPause({ root: b, endpoint }, 'synthetic-only');
  const ready = join(base, 'sender-ready');
  // Inherit the suite's isolated environment, as the other pause fixtures do.
  const child = fork(new URL('./fixtures/hosted-pause-alias-sender.mjs', import.meta.url), [b, endpoint, ready], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '', message;
  child.stderr.on('data', value => { stderr += value; });
  child.on('message', value => { message = value; });
  const done = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGCONT'); child.kill('SIGKILL'); }
    await done;
  });
  const until = performance.now() + 10000;
  while (!await stat(ready).then(() => true, () => false)) {
    assert.ok(performance.now() < until, `sender rendezvous: ${stderr}`);
    await delay(10);
  }
  const gate = join(b, 'hosted-pause.gate');
  assert.equal(JSON.parse(await readFile(gate, 'utf8')).pid, child.pid, 'the sender holds the destination gate');
  remote = { paused: true, generation: 1, enforced: true };
  let retargeted = false, published;
  try {
    published = await withWriteObserver(async ({ path, kind }) => {
      // Retarget after the first authoritative root write of this publication.
      if (!retargeted && kind === 'write' && basename(path) === 'hosted-pause-rotation.json') {
        retargeted = true; await retarget();
      }
    }, () => observeHostedPause({ root: configured, endpoint }, 'synthetic-only'));
  } catch (error) { published = error; }
  const destination = JSON.parse(await readFile(pauseFile(b, endpoint), 'utf8'));
  child.kill('SIGCONT');
  const outcome = await done;
  t.diagnostic(JSON.stringify({ retargeted, published: published?.message ?? published, destination,
    requests, outcome, message }));
  assert.equal(retargeted, true, 'the configured path was retargeted mid-publication');
  assert.equal(outcome.code, 0, 'synthetic sender completed');
  assert.equal(destination.paused && requests.length > 0, false,
    'no request starts after pause commits on the destination root');
  assert.deepEqual(destination, initial, 'the destination root keeps its own authority');
  assert.match(String(published?.message), /pause_unavailable/, 'the changed root fails closed');
});

test('a root retargeted while its gate is busy fails closed and the marker replays in the pinned root', { timeout: 25000 }, async t => {
  const { a, b, configured, retarget } = await aliasedRoots(t, 'root');
  const { requests, endpoint } = await loopbackServer(t);
  let remote = initial;
  t.mock.method(globalThis, 'fetch', async () => Response.json(remote));
  await observeHostedPause({ root: a, endpoint }, 'synthetic-only');
  await observeHostedPause({ root: b, endpoint }, 'synthetic-only');
  // An in-process holder keeps the first root's gate without starting anything.
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let entered;
  const holding = new Promise(resolve => { entered = resolve; });
  const holder = withHostedPauseGate({ root: a, endpoint }, 0, async () => { entered(); await held; });
  await holding;
  remote = { paused: true, generation: 1, enforced: true };
  let retargeted = false;
  const publication = withWriteObserver(async ({ path, kind }) => {
    if (!retargeted && kind === 'write' && path.includes('hosted-pause-pending')) {
      retargeted = true; await retarget(); release();
    }
  }, () => observeHostedPause({ root: configured, endpoint }, 'synthetic-only', undefined,
    { deadlineMs: performance.now() + 5000 }));
  await assert.rejects(publication, /pause_unavailable/, 'the retargeted root fails closed');
  await holder;
  assert.equal(retargeted, true, 'the gate was busy and a marker was written');
  assert.deepEqual(JSON.parse(await readFile(pauseFile(b, endpoint), 'utf8')), initial, 'nothing committed in the new target');
  assert.deepEqual(await markers(b), [], 'no marker in the new target');
  assert.deepEqual(JSON.parse(await readFile(pauseFile(a, endpoint), 'utf8')), initial, 'nothing committed after the change');
  assert.equal((await markers(a)).length, 1, 'the marker stays in the pinned root');
  // The next holder of the pinned root replays the marker into that root only.
  await completeHostedPauseRotation({ root: a, endpoint });
  let starts = 0;
  assert.deepEqual(JSON.parse(await readFile(pauseFile(a, endpoint), 'utf8')), remote, 'replayed in the pinned root');
  assert.deepEqual(await markers(a), [], 'the marker is consumed');
  assert.deepEqual(JSON.parse(await readFile(pauseFile(b, endpoint), 'utf8')), initial, 'the new target is untouched');
  await assert.rejects(withHostedPauseGate({ root: a, endpoint }, 0, () => { starts++; }), /pause_unavailable/);
  assert.equal(starts, 0, 'nothing starts in the paused root');
  assert.equal(requests.length, 0, 'nothing was sent');
});

test('admission re-checks the configured path under the gate before start', async t => {
  const { b, configured, retarget } = await aliasedRoots(t, 'root');
  const endpoint = 'http://127.0.0.1:1';
  t.mock.method(globalThis, 'fetch', async () => Response.json(initial));
  const config = { root: configured, endpoint };
  await observeHostedPause(config, 'synthetic-only');
  await observeHostedPause({ root: b, endpoint }, 'synthetic-only');
  let starts = 0;
  await withHostedPauseGate(config, 0, guard => { guard.beforeStart(); starts++; });
  assert.equal(starts, 1, 'an unchanged alias is admitted');
  await retarget();
  await assert.rejects(withHostedPauseGate(config, 0, guard => { guard.beforeStart(); starts++; }), /pause_unavailable/);
  assert.equal(starts, 1, 'a changed alias is refused before start');
});

test('host-root locks and authority writes refuse a non-canonical root path', async t => {
  const { a, configured } = await aliasedRoots(t, 'ancestor');
  let ran = false;
  await assert.rejects(stateLock(join(configured, 'hosted-pause.gate'), async () => { ran = true; },
    { hostParent: true }), /state_path_changed/);
  await assert.rejects(privateWrite(join(configured, 'hosted-pause-rotation.json'), 'synthetic', { hostParent: true }),
    /state_path_changed/);
  assert.equal(ran, false, 'no work under a lock taken through an alias');
  assert.deepEqual(await readdir(a), [], 'nothing written through the alias');
  await stateLock(join(a, 'hosted-pause.gate'), async () => { ran = true; }, { hostParent: true });
  assert.equal(ran, true, 'the canonical root is unchanged');
});
