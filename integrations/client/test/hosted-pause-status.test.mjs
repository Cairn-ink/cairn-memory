import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, open, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { deferHostedPauseStatus, observeHostedPause, hostedPauseStatus } from '../hosted-pause.mjs';
import { privateWrite } from '../private-state.mjs';
import { hostedTargetId } from '../transport-hosted.mjs';

async function fixture(t) {
  const ws = createTestWorkspace(t), root = join(ws.path, 'state');
  await mkdir(root, { mode: 0o700 });
  const config = { root, endpoint: 'http://127.0.0.1:1' };
  let ok = true, now = Date.now() - 10000;
  const NativeDate = Date;
  class Clock extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  globalThis.Date = Clock;
  t.after(() => { globalThis.Date = NativeDate; });
  t.mock.method(globalThis, 'fetch', async () => ok
    ? Response.json({ paused: false, generation: 0, enforced: true })
    : new Response('', { status: 503 }));
  const scope = new AsyncLocalStorage();
  // Only this async writer's actual sync calls are gated. Other observers keep
  // using real fsync; the older writer stays inside its atomic publication.
  const handle = await open(join(ws.path, 'probe'), 'wx', 0o600);
  const prototype = Object.getPrototypeOf(handle), sync = prototype.sync;
  await handle.close();
  t.mock.method(prototype, 'sync', async function () {
    await scope.getStore()?.();
    return sync.call(this);
  });
  return {
    config, scope,
    at: () => new Date().toISOString(),
    tick: (ms = 1000) => { now += ms; },
    fail: () => { ok = false; }, succeed: () => { ok = true; },
    deferred: () => deferHostedPauseStatus(config, 'synthetic-token', new AbortController().signal),
    observe: () => observeHostedPause(config, 'synthetic-token'),
    status: () => hostedPauseStatus(config),
    statusFile: join(root, 'hosted-pause-status', hostedTargetId(config) + '.json'),
  };
}
function gate(t, f, syncNumber, work) {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let count = 0;
  const completed = f.scope.run(async () => {
    if (++count === syncNumber) { entered.resolve(); await release.promise; }
  }, work);
  // Always release on assertion failure; every rendezvous also has a test timeout.
  t.after(() => release.resolve());
  return { entered: entered.promise, release: () => release.resolve(), completed };
}
const expected = (state, observedAt) => ({ state, observedAt, stale: false });

for (const syncNumber of [1, 2]) test(`newer failure survives an available writer held at fsync ${syncNumber}`,
  { timeout: 10000 }, async t => {
    const f = await fixture(t), a = f.deferred();
    await a.observe(); const tA = f.at();
    const held = gate(t, f, syncNumber, () => a.publish());
    await held.entered;
    f.tick(); f.fail(); const tB = f.at();
    // The owner stays in its write beyond the old 250 ms acquisition window.
    await Promise.all([assert.rejects(f.observe(), /pause_unavailable/), delay(300)]);
    const during = await f.status();
    held.release(); await held.completed;
    assert.deepEqual(await f.status(), expected('unavailable', tB), 'newer_failure_survives_holder_completion');
    assert.deepEqual(during, expected('unavailable', tB), 'failure_visible_while_success_is_writing');
    t.diagnostic(JSON.stringify({ tA, tB, heldAtSync: syncNumber }));
  });

test('concurrent failures retain the newer observation when the older writer renames last',
  { timeout: 10000 }, async t => {
    const f = await fixture(t); f.fail();
    const held = gate(t, f, 1, () => assert.rejects(f.observe(), /pause_unavailable/));
    await held.entered;
    f.tick(); const newest = f.at();
    await assert.rejects(f.observe(), /pause_unavailable/);
    held.release(); await held.completed;
    assert.deepEqual(await f.status(), expected('unavailable', newest));
  });

test('an older failure completing after a newer available cannot win',
  { timeout: 10000 }, async t => {
    const f = await fixture(t); f.fail();
    const held = gate(t, f, 1, () => assert.rejects(f.observe(), /pause_unavailable/));
    await held.entered;
    f.tick(); f.succeed(); const newest = f.at();
    const a = f.deferred(); await a.observe(); await a.publish();
    held.release(); await held.completed;
    assert.deepEqual(await f.status(), expected('available', newest));
  });

test('a newer available observation supersedes an older failure', async t => {
  const f = await fixture(t); f.fail();
  await assert.rejects(f.observe(), /pause_unavailable/);
  f.tick(); f.succeed(); const newest = f.at();
  const a = f.deferred(); await a.observe(); await a.publish();
  assert.deepEqual(await f.status(), expected('available', newest));
});

test('an older deferred available arriving last cannot supersede a newer failure', async t => {
  const f = await fixture(t), a = f.deferred();
  await a.observe(); f.tick(); f.fail(); const newest = f.at();
  await assert.rejects(f.observe(), /pause_unavailable/); await a.publish();
  assert.deepEqual(await f.status(), expected('unavailable', newest));
});

test('failure wins equal timestamps regardless of publication order', async t => {
  const f = await fixture(t), a = f.deferred();
  await a.observe(); f.fail(); const at = f.at();
  await assert.rejects(f.observe(), /pause_unavailable/); await a.publish();
  assert.deepEqual(await f.status(), expected('unavailable', at));
  f.succeed(); await f.observe();
  assert.deepEqual(await f.status(), expected('unavailable', at));
});

for (const syncNumber of [1, 2]) test(`interrupted failure at fsync ${syncNumber} leaves only real observations`,
  { timeout: 10000 }, async t => {
    const f = await fixture(t);
    await privateWrite(f.statusFile, JSON.stringify({ version: 1, state: 'available', observedAt: f.at() }));
    const before = await f.status(); f.tick(); f.fail(); const at = f.at();
    let count = 0;
    await f.scope.run(() => {
      if (++count === syncNumber) throw new Error('synthetic_sync_interruption');
    }, () => assert.rejects(f.observe(), /pause_unavailable/));
    assert.deepEqual(await f.status(), syncNumber === 1 ? before : expected('unavailable', at));
    // The legacy success file remains readable and is never edited by a new record.
    assert.equal(JSON.parse(await readFile(f.statusFile, 'utf8')).state, 'available');
  });

test('status merges legacy records by time and successful publication repairs malformed legacy JSON', async t => {
  const f = await fixture(t); await f.observe();
  f.tick(); const failedAt = f.at();
  await privateWrite(f.statusFile, JSON.stringify({ version: 1, state: 'unavailable', observedAt: failedAt }));
  assert.deepEqual(await f.status(), expected('unavailable', failedAt));
  f.tick(); await f.observe();
  assert.deepEqual(await f.status(), expected('available', f.at()));
  await privateWrite(f.statusFile, '{');
  assert.deepEqual(await f.status(), expected('available', f.at()));
});

test('pruning keeps the newest timestamp and does not refresh stale observations', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 4; i++) { await f.observe(); f.tick(); }
  const directory = f.statusFile + '.observations';
  assert.equal((await readdir(directory)).length, 1, 'completed_writers_prune_older_records');
  const at = (await f.status()).observedAt;
  f.tick(300001);
  assert.deepEqual(await f.status(), { state: 'available', observedAt: at, stale: true });
});

test('temporary records are ignored and a mismatched committed name is invalid', async t => {
  const f = await fixture(t); await f.observe(); const before = await f.status();
  const directory = f.statusFile + '.observations';
  await privateWrite(join(directory, 'unfinished.tmp'), '{');
  assert.deepEqual(await f.status(), before);
  f.tick();
  const name = f.at().replace(/\D/gu, '') + '.unavailable.json';
  await privateWrite(join(directory, name), JSON.stringify({ version: 1, state: 'available', observedAt: f.at() }));
  assert.deepEqual(await f.status(), { state: 'observation invalid' });
});
