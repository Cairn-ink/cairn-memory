import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalCaptureTransport } from '../raw/local-transport.mjs';
import { localProcessScope } from '../raw/local-process.mjs';
import { transportFixture } from './fixtures/local-transport-workspace.mjs';

const refusal = uncertain => error => error.code === 'local_capture_transport_failed' && error.message === error.code && error.uncertain === uncertain &&
  !/synthetic-(source|key)-sentinel/.test(String(error));
for (const client of ['claude-code', 'codex']) for (const project of [false, true]) test(`B4a ${client}/${project ? 'project' : 'personal'} fixed argv, frozen request and closed environment`, async t => {
  const f = transportFixture(t, { client, project });
  f.set('complete', { keyName: f.config.provider.apiKeyEnv });
  const options = { ...f.options, env: { CAIRN_SYNTHETIC_API_KEY: 'synthetic-key-sentinel', NODE_OPTIONS: '--require=synthetic-source-sentinel',
    HTTP_PROXY: 'synthetic-source-sentinel', ANTHROPIC_API_KEY: 'synthetic-key-sentinel', LD_PRELOAD: 'synthetic-source-sentinel' } };
  const transport = createLocalCaptureTransport(options), pending = transport.capture(f.request);
  options.home = '/wrong'; f.authority.targetId = 'wrong'; f.request.event_id = 'mutated'; f.request.messages[0].content = 'mutated';
  const result = await pending; assert.equal(result.status, 200); assert.equal(Object.isFrozen(transport), true);
  const observed = f.observed(); assert.equal(observed.eventId, 'synthetic-event'); assert.equal(observed.sourceMatches, true); assert.equal(observed.selectedKeyMatches, true);
  assert.deepEqual(observed.environmentKeys, ['CAIRN_SYNTHETIC_API_KEY', 'HOME', 'LANG', 'PATH']);
  assert.deepEqual(observed.argv.slice(0, 3), ['--config', f.configPath, '--config-digest']); assert.match(observed.argv[3], /^[a-f0-9]{64}$/);
});

test('B4a full authority, routing, constructor and own-data credential checks refuse before capture', async t => {
  for (const field of ['storeId', 'targetId', 'expectedConsentGeneration', 'expectedNamespaceGeneration']) {
    const f = transportFixture(t, { project: true }), expectedAuthority = structuredClone(f.authority); expectedAuthority[field] = 'different';
    await assert.rejects(createLocalCaptureTransport({ ...f.options, expectedAuthority }).capture(f.request), refusal(false)); assert.equal(f.observed(), null);
  }
  const f = transportFixture(t); let accessed = 0;
  const env = { get CAIRN_SYNTHETIC_API_KEY() { accessed++; throw Error(); } };
  await assert.rejects(createLocalCaptureTransport({ ...f.options, env }).capture(f.request), refusal(false)); assert.equal(accessed, 0);
  f.config.provider.apiKeyEnv = 'NODE_OPTIONS'; f.save();
  await assert.rejects(createLocalCaptureTransport(f.options).capture(f.request), refusal(false));
  for (const patch of [{ extra: true }, { deadlineMs: 2999 }, { home: 'relative' }, { env: new Proxy({}, {}) }])
    assert.throws(() => createLocalCaptureTransport({ ...f.options, ...patch }), refusal(false));
  assert.equal(f.observed(), null);
});

test('B4a version probe refuses old, malformed, nonzero and overlarge versions before capture', async t => {
  for (const probe of [{ version: 'v22.15.9\n' }, { version: 'v24.15.0-beta.1\n' }, { version: 'v24.15.0\nextra\n' }, { status: 7 }, { probeFlood: true }]) {
    const f = transportFixture(t);
    await assert.rejects(createLocalCaptureTransport({ ...f.options, nodeExecutable: f.executable(probe) }).capture(f.request), refusal(false));
    assert.equal(f.observed(), null);
  }
});

test('B4a data-only requests refuse getters, proxies, sparse arrays and unknown fields before spawning', async t => {
  const f = transportFixture(t); let accessed = 0;
  const accessor = { ...f.request };
  Object.defineProperty(accessor, 'event_id', { enumerable: true, get() { accessed++; throw Error(); } });
  const sparse = structuredClone(f.request); sparse.messages.length = 2;
  for (const request of [accessor, new Proxy(f.request, {}), sparse, { ...f.request, unknown: true }])
    await assert.rejects(createLocalCaptureTransport(f.options).capture(request), refusal(false));
  assert.equal(accessed, 0); assert.equal(f.observed(), null);
});

test('B4a process primitive refuses a broken stdin pipe and reaps the actual child', async t => {
  const f = transportFixture(t), pidPath = join(f.workspace.path, 'broken-stdin-pid');
  const scope = localProcessScope(4000);
  try {
    // Larger than a kernel pipe deliberately exercises the primitive's EPIPE
    // branch. Product requests remain independently bounded to65536 bytes.
    await assert.rejects(scope.run(process.execPath, ['--input-type=module', '-e',
      `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(pidPath)},String(process.pid));process.stdin.destroy();process.stdout.write('{}\\n');setTimeout(()=>{},100);`],
    { HOME: f.home, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, Buffer.alloc(1024 * 1024)), refusal(true));
    assert.throws(() => process.kill(Number(readFileSync(pidPath, 'utf8')), 0), { code: 'ESRCH' });
  } finally { scope.close(); }
});

for (const mode of ['duplicate', 'processing', 'quota', 'incomplete', 'refused']) test(`B4a closed ${mode} reply is distinct from completed admission`, async t => {
  const f = transportFixture(t); f.set(mode); const result = await createLocalCaptureTransport(f.options).capture(f.request);
  assert.equal(result.status, { duplicate: 200, processing: 202, quota: 429, incomplete: 503, refused: 403 }[mode]);
  if (mode === 'duplicate') assert.equal(result.body.duplicate, true);
});

for (const mode of ['wrong-part', 'unknown-error', 'invalid-utf8', 'flood', 'stderr-flood', 'no-newline', 'two-lines', 'nonzero']) test(`B4a ${mode} never becomes an acknowledgement`, async t => {
  const f = transportFixture(t); f.set(mode);
  await assert.rejects(createLocalCaptureTransport(f.options).capture(f.request), refusal(true));
});

test('B4a an owned existing 0755 HOME is valid without changing its permissions', async t => {
  const f = transportFixture(t); chmodSync(f.home, 0o755);
  assert.equal((await createLocalCaptureTransport(f.options).capture(f.request)).status, 200);
  assert.equal(statSync(f.home).mode & 0o777, 0o755);
});

test('B4a executable removed after successful probe is known not started at capture spawn', async t => {
  const f = transportFixture(t);
  await assert.rejects(createLocalCaptureTransport({ ...f.options, nodeExecutable: f.executable({ removeSelf: true }) }).capture(f.request), refusal(false));
  assert.equal(f.observed(), null);
});

test('B4a selected key is absent from actual version probe environment', async t => {
  const f = transportFixture(t);
  const response = await createLocalCaptureTransport({ ...f.options, nodeExecutable: f.executable(),
    env: { CAIRN_SYNTHETIC_API_KEY: 'synthetic-key-sentinel', NODE_OPTIONS: '--require=untrusted' } }).capture(f.request);
  assert.equal(response.status, 200); assert.deepEqual(f.probeObserved().environmentKeys, ['HOME', 'LANG', 'PATH']);
});

test('B4a abort before any await never probes or captures', async t => {
  const f = transportFixture(t), transport = createLocalCaptureTransport({ ...f.options, nodeExecutable: f.executable() });
  await assert.rejects(transport.capture(f.request, { signal: AbortSignal.abort() }), refusal(false));
  assert.equal(f.probeObserved(), null); assert.equal(f.observed(), null);
});

test('B4a forged/proxied signals and own method overrides cannot leak operation timers or invoke accessors', async t => {
  const f = transportFixture(t), count = () => process.getActiveResourcesInfo().filter(name => name === 'Timeout').length;
  const before = count(), controller = new AbortController(); let accessed = 0;
  for (const signal of [Object.create(AbortSignal.prototype), new Proxy(controller.signal, {})]) {
    await assert.rejects(createLocalCaptureTransport(f.options).capture(f.request, { signal }), refusal(false));
    assert.equal(count(), before); assert.equal(f.observed(), null);
  }
  for (const field of ['addEventListener', 'removeEventListener', 'aborted']) Object.defineProperty(controller.signal, field,
    { get() { accessed++; throw Error('synthetic-source-sentinel'); } });
  assert.equal((await createLocalCaptureTransport(f.options).capture(f.request, { signal: controller.signal })).status, 200);
  assert.equal(count(), before); assert.equal(accessed, 0);
  controller.abort();
  await assert.rejects(createLocalCaptureTransport(f.options).capture(f.request, { signal: controller.signal }), refusal(false));
  assert.equal(count(), before); assert.equal(accessed, 0);
});

test('B4a public signal Proxy refusal never invokes a caller getPrototypeOf trap', async t => {
  const f = transportFixture(t); let invoked = 0;
  const before = process.getActiveResourcesInfo().filter(name => name === 'Timeout').length;
  const signal = new Proxy(new AbortController().signal, {
    getPrototypeOf() { invoked++; return AbortSignal.prototype; },
    get() { invoked++; throw Error('synthetic-source-sentinel'); },
  });
  await assert.rejects(createLocalCaptureTransport(f.options).capture(f.request, { signal }), refusal(false));
  assert.equal(invoked, 0); assert.equal(f.observed(), null);
  assert.equal(process.getActiveResourcesInfo().filter(name => name === 'Timeout').length, before);
});

for (const ignoreTerm of [false, true]) test(`B4a cancellation reaps actual ${ignoreTerm ? 'SIGTERM-ignoring' : 'cooperative'} capture child`, async t => {
  const f = transportFixture(t); f.set('hang', { ignoreTerm });
  const controller = new AbortController(), pending = createLocalCaptureTransport(f.options).capture(f.request, { signal: controller.signal });
  const settled = assert.rejects(pending, refusal(true));
  let observed;
  for (let attempt = 0; attempt < 100 && !observed; attempt++) { try { observed = f.observed(); } catch {} if (!observed) await delay(10); }
  assert.ok(observed); const start = performance.now(); controller.abort(); await settled;
  if (ignoreTerm) assert.ok(performance.now() - start >= 900);
  assert.throws(() => process.kill(observed.pid, 0), { code: 'ESRCH' });
});

test('B4a a valid reply followed by a hang reaches deadline and is reaped, never accepted', async t => {
  const f = transportFixture(t); f.set('reply-hang');
  await assert.rejects(createLocalCaptureTransport({ ...f.options, deadlineMs: 3000 }).capture(f.request), refusal(true));
  assert.throws(() => process.kill(f.observed().pid, 0), { code: 'ESRCH' });
});

test('B4a hanging version probe is terminated within shared deadline without capture', async t => {
  const f = transportFixture(t);
  await assert.rejects(createLocalCaptureTransport({ ...f.options, deadlineMs: 3000, nodeExecutable: f.executable({ hang: true }) }).capture(f.request), refusal(false));
  assert.equal(f.observed(), null); assert.throws(() => process.kill(f.probeObserved().pid, 0), { code: 'ESRCH' });
});
