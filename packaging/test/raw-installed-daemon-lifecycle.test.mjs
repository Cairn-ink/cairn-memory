import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { daemonLifecycleFixture, guardControlSource, productionBoundary } from './fixtures/raw-installed-daemon-lifecycle.mjs';

for (const client of ['claude-code', 'codex']) test(`installed daemon Raw lifecycle ${client}`, { timeout: 120000, skip: process.platform !== 'linux' }, async t => {
  const started = performance.now(), f = await daemonLifecycleFixture(t, { client });
  const originalSentinel = 'synthetic_raw_cobalt_original', controlSentinel = 'synthetic_raw_cobalt_control';
  const original = 'Synthetic cobalt survey plan. '.repeat(45) + originalSentinel;
  f.append(0, original); f.capture();
  const initial = f.probe(); assert.equal(initial.memories.length, 1);
  const memory = initial.memories[0].memory;
  assert.equal(JSON.stringify(initial.memories[0].receipts).includes(originalSentinel), false, 'Raw-only sentinel absent from Memory receipts');
  const query = sentinel => ({ query: sentinel, types: ['memory'], intent: 'current', semantic: false, maxTokens: 6000 });
  async function raw(session, sentinel, expected = true) {
    const deadline = performance.now() + 5000;
    let result, present, attempts = 0;
    do {
      result = await session.tool('read_memory_context', query(sentinel)); attempts++;
      assert.ok(Array.isArray(result.items), 'assembled items are explicit');
      present = result.items.flatMap(item => [item, ...(item.evidence ?? [])])
        .some(item => item.ref.type === 'raw' && item.body.includes(sentinel));
      if (!expected || present || performance.now() >= deadline) break;
      // Foreground capture and the already-attached daemon's index have
      // separate lifecycles. Await positive visibility within five cadences;
      // privacy exclusion is still checked on the very first response.
      await delay(50);
    } while (true);
    assert.equal(present, expected, 'actual Raw ref and source sentinel');
    if (attempts > 1) t.diagnostic(JSON.stringify({ client, rawVisibilityAttempts: attempts }));
    return result;
  }
  const firstOwner = await f.candidate(), a = await f.mcp(), b = await f.mcp();
  await f.attached(2);
  await raw(a, originalSentinel); await raw(b, originalSentinel);
  const exact = await f.mcp({ exact: true }); await f.attached(3); await raw(exact, originalSentinel); await exact.close(); await f.attached(2);
  f.append(1, 'Synthetic cobalt independent control ' + controlSentinel); f.capture(1, 'empty');
  const both = f.probe(), times = both.messages.map(row => row.occurred_at);
  assert.deepEqual([...new Set(times)].sort(), ['2020-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z'], 'persisted independent known event ranges');
  assert.equal(both.conversations.length, 2);
  for (const session of [a, b]) await raw(session, controlSentinel);
  let offset = f.traceLength();
  const replacement = 'Synthetic corrected cobalt survey interpretation.';
  const corrected = (await a.tool('correct_memory', { memoryId: memory.id, expectedRevision: memory.revision, content: replacement })).memory;
  f.assertWriteSince(offset, 'correction');
  assert.ok(f.probe().exclusions.length > 0, 'correction persists Raw exclusions even in the old-content control');
  assert.ok(corrected.revision > memory.revision, 'correction advances the requested revision');
  assert.equal(corrected.content, replacement, 'A returns the requested replacement');
  const observed = (await b.tool('inspect_memory', { memoryId: memory.id })).memory;
  assert.equal(observed.content, replacement, 'B observes the exact requested content');
  assert.equal(observed.revision, corrected.revision, 'B observes the exact corrected revision');
  await raw(b, originalSentinel, false); await raw(b, controlSentinel);
  assert.equal(f.probe().parts.some(part => part.text?.includes(originalSentinel)), true, 'retained original rows persist while withheld');
  offset = f.traceLength();
  await a.tool('forget_memory', { memoryId: memory.id, expectedRevision: corrected.revision });
  f.assertWriteSince(offset, 'forget');
  for (const session of [a, b]) {
    assert.equal((await session.tool('inspect_memory')).memories.some(value => value.id === memory.id), false);
    await raw(session, originalSentinel, false); await raw(session, controlSentinel);
  }
  await f.coldBoundary();
  const secondOwner = await f.candidate();
  assert.notEqual(secondOwner.incarnation, firstOwner.incarnation, 'cold candidate has a new incarnation');
  assert.notEqual(secondOwner.owner.pid, firstOwner.owner.pid, 'cold candidate has a new owner');
  const cold = await f.mcp(); await f.attached(1);
  await raw(cold, originalSentinel, false); await raw(cold, controlSentinel);
  assert.deepEqual((await cold.tool('inspect_memory')).memories, []);
  await f.coldBoundary(); await f.finish();
  t.diagnostic(JSON.stringify({ client, milliseconds: Math.round(performance.now() - started), servingLifetimes: 2, stopped: 2 }));
});

test('production inventory never imports the test instrumentation', () => {
  const files = JSON.parse(readFileSync(new URL('../artifact-files.json', import.meta.url), 'utf8'));
  productionBoundary(files, path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8'));
  assert.throws(() => productionBoundary(['adapters/mcp/fake.mjs'], () => "import '../../packaging/test/fixtures/raw-installed-daemon-lifecycle.mjs'"), /production must not import/);
});

for (const [name, expression] of [
  ['loopback TCP', "net.connect({port:9,host:'127.0.0.1'})"],
  ['outside unix socket', "net.connect({path:join(settings.directory,'..','outside.sock')})"],
  ['other unix socket', "net.createConnection({path:join(settings.directory,'other.sock')})"],
  ['relative unix socket', "new net.Socket().connect({path:'relative.sock'})"],
  ['abstract socket', "net.connect({path:'\\0synthetic'})"],
  ['port signature', "net.createConnection(9,'127.0.0.1')"],
  ['normalized TCP tuple', "new net.Socket().connect([{port:9,host:'127.0.0.1'}])"],
  ['fetch', "fetch('http://127.0.0.1/')"],
  ['HTTP', "http.get('http://127.0.0.1/')"],
  ['HTTPS', "https.request('https://127.0.0.1/')"],
  ['DNS callback', "dns.lookup('localhost',()=>{})"],
  ['DNS promise', "dnsPromises.resolve4('localhost')"],
  ['DNS resolver callback', "new dns.Resolver().resolve4('localhost',()=>{})"],
  ['DNS resolver promise', "new dnsPromises.Resolver().resolve4('localhost')"],
]) test('installed socket guard rejects ' + name, t => {
  const workspace = createTestWorkspace(t, { prefix: 'daemon-guard-' }), directory = join(workspace.path, 'runtime');
  mkdirSync(directory, { mode: 0o700 });
  const path = join(workspace.path, 'guard.mjs'), trace = join(workspace.path, 'trace.jsonl'); writeFileSync(trace, '');
  writeFileSync(path, guardControlSource({ installed: join(workspace.path, 'installed'), trace, directory, socket: join(directory, 'allowed.sock') }, expression));
  const result = spawnSync(process.execPath, [path], { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); t.diagnostic(`guard sentinel ${name}: rc=${result.status}`);
});
