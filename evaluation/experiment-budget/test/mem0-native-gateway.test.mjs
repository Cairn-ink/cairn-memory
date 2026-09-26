import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync,
  truncateSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { PassThrough, Writable } from 'node:stream';
import { checkedMem0NativeArtifact, inspectMem0NativeArtifact } from '../mem0-native-artifact.mjs';
import { mem0NativeConfiguration, runMem0NativeCase } from '../mem0-native-gateway.mjs';
import { runNativeGatewayKernel } from '../mem0-native-runtime.mjs';
import { nativeFakeProvider, nativeFixture } from './mem0-native-fixture.mjs';

function miniature(t) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-y-artifact-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const venvRoot = join(root, 'venv');
  const pythonRoot = join(root, 'python');
  for (const dir of [join(venvRoot, 'bin'),
    join(venvRoot, 'lib/python3.11/site-packages/mem0/memory'),
    join(venvRoot, 'lib/python3.11/site-packages/mem0ai-2.2.0.dist-info'),
    join(pythonRoot, 'bin'), join(pythonRoot, 'lib/python3.11/encodings')]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(venvRoot, 'pyvenv.cfg'), `home = ${join(pythonRoot, 'bin')}\n`);
  writeFileSync(join(venvRoot, 'lib/python3.11/site-packages/mem0/memory/main.py'), 'x = 1\n');
  writeFileSync(join(venvRoot, 'lib/python3.11/site-packages/mem0ai-2.2.0.dist-info/METADATA'),
    'Name: mem0ai\nVersion: 2.2.0\n');
  writeFileSync(join(pythonRoot, 'bin/python3.11'), '#!/fake\n');
  writeFileSync(join(pythonRoot, 'lib/python3.11/encodings/__init__.py'), '# synthetic\n');
  symlinkSync(join(pythonRoot, 'bin/python3.11'), join(venvRoot, 'bin/python'));
  return { venvRoot, pythonRoot };
}

test('Y2 artifact digests include execution bytecode, reject detached descriptors and escapes', t => {
  const roots = miniature(t);
  const first = inspectMem0NativeArtifact(roots);
  assert.equal(Object.isFrozen(first), true);
  const bytecode = join(roots.venvRoot, 'lib/python3.11/site-packages/mem0/memory/main.pyc');
  writeFileSync(bytecode, 'synthetic bytecode A');
  const second = inspectMem0NativeArtifact(roots);
  assert.notEqual(first.dependencyLockSha256, second.dependencyLockSha256);
  assert.equal(first.sourceTreeSha256, second.sourceTreeSha256);
  assert.throws(() => checkedMem0NativeArtifact(first), { code: 'artifact_changed' });
  writeFileSync(bytecode, 'synthetic bytecode B');
  assert.notEqual(second.dependencyLockSha256,
    inspectMem0NativeArtifact(roots).dependencyLockSha256);
  const cycle = join(roots.venvRoot, 'loop');
  symlinkSync('.', cycle);
  assert.throws(() => inspectMem0NativeArtifact(roots), { code: 'artifact_link_cycle' });
  rmSync(cycle);
  const a = join(roots.venvRoot, 'a');
  const b = join(roots.venvRoot, 'b');
  mkdirSync(a); mkdirSync(b);
  symlinkSync('../b', join(a, 'to-b'));
  symlinkSync('../a', join(b, 'to-a'));
  assert.throws(() => inspectMem0NativeArtifact(roots), { code: 'artifact_link_cycle' });
  rmSync(join(b, 'to-a'));
  assert.doesNotThrow(() => inspectMem0NativeArtifact(roots));
  rmSync(join(a, 'to-b'));
  const metadata = join(roots.venvRoot, 'lib/python3.11/site-packages/mem0ai-2.2.0.dist-info/METADATA');
  writeFileSync(metadata, 'Name: mem0ai\nVersion: 2.2.1\n');
  assert.throws(() => inspectMem0NativeArtifact(roots), { code: 'invalid_artifact_version' });
  writeFileSync(metadata, 'Name: mem0ai\nVersion: 2.2.0\n');
  const link = join(roots.venvRoot, 'outside');
  symlinkSync('/etc/passwd', link);
  assert.throws(() => inspectMem0NativeArtifact(roots), { code: 'artifact_link_escape' });
});

test('Y2 sparse over-limit artifact rejects by stat before reading payload', t => {
  const roots = miniature(t);
  const oversized = join(roots.venvRoot, 'oversized-synthetic');
  writeFileSync(oversized, 'x');
  truncateSync(oversized, 1024 ** 3 + 1);
  assert.throws(() => inspectMem0NativeArtifact(roots), { code: 'artifact_byte_cap' });
});

test('Y3/Y4 rejects getters, unknown config keys and both lone surrogate forms before dispatch', async () => {
  assert.throws(() => mem0NativeConfiguration({ topK: 1, threshold: 0,
    childTimeoutMs: 1000, get httpTimeoutMs() { throw new Error('getter ran'); } }),
  { code: 'invalid_native_options' });
  assert.throws(() => mem0NativeConfiguration({ topK: 1, threshold: 0,
    childTimeoutMs: 1000, httpTimeoutMs: 1000, unexpected: true }),
  { code: 'invalid_native_options' });
  const configuration = mem0NativeConfiguration({ topK: 1, threshold: 0,
    childTimeoutMs: 1000, httpTimeoutMs: 1000 });
  for (const bad of ['\ud800', '\udc00']) {
    await assert.rejects(runMem0NativeCase({ artifact: {}, configuration,
      guard: {}, handle: {}, input: { batches: [[{ role: 'user', content: bad }]],
        query: 'synthetic' } }), { code: 'invalid_native_input' });
  }
  await assert.rejects(runMem0NativeCase({ artifact: {}, configuration,
    guard: {}, handle: {}, input: { batches: [[{ role: 'user', content: 'Synthetic.' }]],
      query: 'Synthetic?' }, forceProcessGroupLiveForTest: true }),
  { code: 'invalid_native_options' });
  assert.equal(readFileSync(new URL('../testing/mem0-native-child.py', import.meta.url), 'utf8')
    .includes('Memory.from_config'), true);
});

test('Y7 current mixed handle halts after local seal; stale handle cannot poison a later scope', async t => {
  const artifact = { sourceTreeSha256: '7'.repeat(64), dependencyLockSha256: '8'.repeat(64) };
  const configuration = { configurationSha256: '9'.repeat(64) };
  const f = nativeFixture(t, { artifact, configuration, httpTimeoutMs: 1000,
    fetchImpl: () => assert.fail('no physical request') });
  let handle;
  await assert.rejects(f.guard.withCaseScope(f.capability.schedule[0], async current => {
    handle = current;
    current.revoke();
    assert.equal(current.snapshot().status, 'failed');
    assert.equal(current.snapshot().reason, 'cancelled');
    current.halt();
    assert.equal(current.snapshot().reason, 'cancelled');
  }), { code: 'paid_work_halted' });
  assert.equal(f.guard.isHalted(), true);
  handle.halt();
  assert.equal(f.guard.isHalted(), true);
  f.guard.close();
});

function post(socketPath, route, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, path: route, method: 'POST',
      headers: { host: 'unix-gateway', authorization: 'Bearer local-only-dummy-key',
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('end', () => resolve({ status: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.once('error', reject);
    request.end(body);
  });
}

function controlledChild(operate) {
  return ({ socket }) => {
    const child = new EventEmitter();
    child.pid = 987654;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let closed = false;
    child.complete = (code, value) => {
      if (closed) return;
      closed = true;
      child.stdout.end(value === undefined ? undefined
        : Buffer.isBuffer(value) ? value : JSON.stringify(value));
      child.stderr.end();
      setImmediate(() => {
        child.emit('exit', code, null);
        child.emit('close', code, null);
      });
    };
    child.stdin.once('finish', () => {
      Promise.resolve().then(() => operate(socket)).then((value) => {
        child.complete(0, value);
      }, () => child.complete(1));
    });
    return child;
  };
}

function controlledHarness(t, fetchImpl, { childTimeoutMs = 5000, httpTimeoutMs = 1000,
  forceProcessGroupLiveForTest = false } = {}) {
  const roots = miniature(t);
  const artifact = inspectMem0NativeArtifact(roots);
  const configuration = mem0NativeConfiguration({ topK: 3, threshold: 0,
    childTimeoutMs, httpTimeoutMs });
  const fixture = nativeFixture(t, { artifact, configuration, httpTimeoutMs, fetchImpl });
  let lastCaseRoot = null;
  let activeChildFile = new URL('../testing/mem0-native-child.py', import.meta.url).pathname;
  const run = (operate, stopChild = child => child.complete(143), onHandle = () => {},
    routeGuard = fixture.guard, startChildOverride = null, nativeInput = null) =>
    fixture.guard.withCaseScope(fixture.capability.schedule[0], handle => {
      onHandle(handle);
      return runNativeGatewayKernel({ artifact, roots: checkedMem0NativeArtifact(artifact),
        configuration: configuration.configuration,
        childFile: activeChildFile,
        guard: routeGuard, handle,
        input: nativeInput ?? { batches: [[{ role: 'user', content: 'Synthetic.' }]],
          query: 'Synthetic?' },
        scope: { caseId: fixture.capability.schedule[0].caseId } },
      { startChild: settings => {
        lastCaseRoot = dirname(settings.socket);
        return (startChildOverride ?? controlledChild(operate))(settings);
      }, stopChild, forceProcessGroupLiveForTest });
    });
  return { ...fixture, run, artifact, configuration, roots,
    useSyntheticChildFile: value => { activeChildFile = value; },
    lastCaseRoot: () => lastCaseRoot };
}

const output = () => ({ version: 'cairn-mem0-native-result-v1',
  verifiedAddRecords: 0, results: [] });
const nativeRow = attributedTo => ({ id: 'synthetic-id', memory: 'Synthetic fact.',
  score: 0.5, attributedTo });
const PYTHON_PROJECTION = `import json, runpy, sys, types
row = json.load(sys.stdin)
class Client:
    def __init__(self, **_): pass
    def with_options(self, **_): return self
    def close(self): pass
class Memory:
    @classmethod
    def from_config(cls, _): return cls()
    def __init__(self):
        self.llm = types.SimpleNamespace(client=Client())
        self.embedding_model = types.SimpleNamespace(client=Client())
    def add(self, *_args, **_kwargs): return {"results": []}
    def search(self, *_args, **_kwargs): return {"results": [row]}
httpx = types.ModuleType("httpx")
httpx.Client = Client
httpx.HTTPTransport = lambda **_kwargs: object()
mem0 = types.ModuleType("mem0")
mem0.Memory = Memory
sys.modules["httpx"] = httpx
sys.modules["mem0"] = mem0
run = runpy.run_path(sys.argv[1])["run"]
case = {"version": "cairn-mem0-native-child-input-v1", "socket": "/case/gateway.sock",
        "store": "/case/store", "userId": "synthetic-case", "topK": 3,
        "threshold": 0, "httpTimeoutMs": 1000,
        "input": {"batches": [[{"role": "user", "content": "Synthetic."}]],
                  "query": "Synthetic?"}}
try:
    print(json.dumps({"ok": True, "value": run(case)}, ensure_ascii=True))
except Exception as error:
    print(json.dumps({"ok": False, "error": type(error).__name__}))
`;
function projectedNative(row) {
  const childFile = new URL('../testing/mem0-native-child.py', import.meta.url).pathname;
  const result = spawnSync('/usr/bin/python3', ['-I', '-B', '-c', PYTHON_PROJECTION, childFile],
    { input: JSON.stringify(row), encoding: 'utf8', timeout: 3000,
      env: { PATH: '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, 'synthetic Python projection fixture exits cleanly');
  return JSON.parse(result.stdout);
}
const chatBody = () => JSON.stringify({ model: 'gpt-4.1-mini-2025-04-14', messages: [
  { role: 'system', content: 'Synthetic system.' },
  { role: 'user', content: 'Synthetic user.' }], max_tokens: 2000,
temperature: 0.1, top_p: 0.1, response_format: { type: 'json_object' }, store: false });
const embeddingBody = input => JSON.stringify({ model: 'text-embedding-3-small', input,
  dimensions: 1536, encoding_format: 'float' });
const embeddingResponse = count => ({ object: 'list', model: 'text-embedding-3-small',
  usage: { prompt_tokens: 1, total_tokens: 1 },
  data: Array.from({ length: count }, (_, index) => ({ object: 'embedding', index,
    embedding: Array.from({ length: 1536 }, (_, dimension) => dimension === 0 ? 1 : 0) })) });
const chatResponse = content => ({ object: 'chat.completion',
  model: 'gpt-4.1-mini-2025-04-14',
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] });

test('Y13 controlled process double crosses real UDS and X accounting inside ALS', async t => {
  const fake = nativeFakeProvider();
  const f = controlledHarness(t, fake.fetchImpl);
  try {
    const wrapped = await f.run(async socket => {
        const result = await post(socket, '/v1/chat/completions', chatBody());
        assert.equal(result.status, 200);
        return output();
      }, () => assert.fail('normal child must not need stop'));
    assert.equal(wrapped.status, 'completed');
    assert.equal(wrapped.value.status, 'completed');
    assert.equal(fake.requests.length, 1);
    assert.equal(f.guard.attempts().filter(attempt => attempt.outcome === null).length, 0);
    assert.equal(existsSync(f.lastCaseRoot()), false);
  } finally { f.guard.close(); }
});

test('Y10 parent accepts native empty attribution through actual gateway result', async t => {
  const f = controlledHarness(t, () => assert.fail('attribution projection reached provider'));
  try {
    const wrapped = await f.run(() => ({ ...output(), results: [nativeRow('')] }));
    assert.equal(wrapped.status, 'completed');
    assert.equal(wrapped.value.value.results[0].attributedTo, '');
    assert.equal(f.guard.isHalted(), false);
  } finally { f.guard.close(); }
});

test('Y10 Python child projects empty attribution through actual run path', () => {
  const projected = projectedNative({ id: 'synthetic-id', memory: 'Synthetic fact.',
    score: 0.5, attributed_to: '' });
  assert.equal(projected.ok, true);
  assert.equal(projected.value.results[0].attributedTo, '');
});

for (const [name, attribution] of [
  ['null', null], ['200 UTF-16 units', '😀'.repeat(100)],
]) {
  test(`Y10 parent preserves ${name} attribution`, async t => {
    const f = controlledHarness(t, () => assert.fail('attribution reached provider'));
    try {
      const wrapped = await f.run(() => ({ ...output(), results: [nativeRow(attribution)] }));
      assert.equal(wrapped.status, 'completed');
      assert.equal(wrapped.value.value.results[0].attributedTo, attribution);
    } finally { f.guard.close(); }
  });
}

for (const [name, attribution] of [
  ['non-string', 42], ['over 200 UTF-16 units', '😀'.repeat(101)],
  ['lone surrogate', '\ud800'],
]) {
  test(`Y10 parent rejects ${name} attribution globally`, async t => {
    const f = controlledHarness(t, () => assert.fail('bad attribution reached provider'));
    try {
      await assert.rejects(f.run(() => ({ ...output(), results: [nativeRow(attribution)] })),
        { code: 'callback_failed' });
      assert.equal(f.guard.isHalted(), true);
      assert.equal(f.guard.attempts().length, 0);
    } finally { f.guard.close(); }
  });
}

test('Y10 actual Python projection uses UTF-16 bounds and rejects malformed text', () => {
  const base = { id: 'synthetic-id', memory: 'Synthetic fact.', score: 0.5 };
  for (const [name, row, expectedAttribution] of [
    ['missing attribution', base, null],
    ['null attribution', { ...base, attributed_to: null }, null],
    ['200-unit attribution', { ...base, attributed_to: '😀'.repeat(100) }, '😀'.repeat(100)],
    ['200-unit ID', { ...base, id: '😀'.repeat(100) }, null],
    ['65536-unit memory', { ...base, memory: '😀'.repeat(32768) }, null],
  ]) {
    const projected = projectedNative(row);
    assert.equal(projected.ok, true, name);
    assert.equal(projected.value.results[0].attributedTo, expectedAttribution, name);
    assert.equal(projected.value.results[0].id, row.id, name);
    assert.equal(projected.value.results[0].memory, row.memory, name);
  }
  for (const [name, row] of [
    ['non-string attribution', { ...base, attributed_to: 42 }],
    ['202-unit attribution', { ...base, attributed_to: '😀'.repeat(101) }],
    ['lone-surrogate attribution', { ...base, attributed_to: '\ud800' }],
    ['202-unit ID', { ...base, id: '😀'.repeat(101) }],
    ['empty ID', { ...base, id: '' }],
    ['lone-surrogate ID', { ...base, id: '\ud800' }],
    ['65538-unit memory', { ...base, memory: '😀'.repeat(32769) }],
    ['empty memory', { ...base, memory: '' }],
    ['lone-surrogate memory', { ...base, memory: '\ud800' }],
  ]) {
    assert.equal(projectedNative(row).ok, false, name);
  }
});

test('Y12 closed child with live owned group halts globally and retains private root', async t => {
  const f = controlledHarness(t, () => assert.fail('live group reached provider'),
    { forceProcessGroupLiveForTest: true });
  try {
    await assert.rejects(f.run(() => output()), { code: 'callback_failed' });
    assert.equal(f.guard.isHalted(), true);
    const caseRoot = f.lastCaseRoot();
    assert.ok(caseRoot);
    assert.equal(existsSync(caseRoot), true);
    assert.equal(f.guard.attempts().length, 0);
    await assert.rejects(f.guard.withCaseScope(f.capability.schedule[1], async () => 'denied'),
      { code: 'paid_work_halted' });
  } finally {
    f.guard.close();
    const caseRoot = f.lastCaseRoot();
    // This controlled child is an in-process double with no live OS group.
    if (caseRoot && existsSync(caseRoot)) rmSync(caseRoot, { recursive: true });
  }
});

test('Y13 malformed child route is global with zero provider dispatch', async t => {
  const f = controlledHarness(t, () => assert.fail('malformed route reached provider'));
  try {
    await assert.rejects(f.run(socket => post(socket, '/v1/unknown', chatBody())),
      { code: 'callback_failed' });
    assert.equal(f.guard.isHalted(), true);
    assert.equal(f.guard.attempts().length, 0);
  } finally { f.guard.close(); }
});

test('Y13 priced embedding batch 500 remains failed; individual fallback gets new reservations', async t => {
  const sends = [];
  const f = controlledHarness(t, async (url, options) => {
    const body = JSON.parse(options.body);
    sends.push(body.input);
    if (body.input.length === 2) return new Response('{"error":"synthetic"}', { status: 500 });
    return Response.json(embeddingResponse(1));
  });
  try {
    const wrapped = await f.run(async socket => {
      assert.equal((await post(socket, '/v1/embeddings', embeddingBody(['a', 'b']))).status, 500);
      assert.equal((await post(socket, '/v1/embeddings', embeddingBody(['a']))).status, 200);
      assert.equal((await post(socket, '/v1/embeddings', embeddingBody(['b']))).status, 200);
      return output();
    });
    assert.equal(wrapped.status, 'completed');
    assert.deepEqual(sends, [['a', 'b'], ['a'], ['b']]);
    assert.deepEqual(f.guard.attempts().map(attempt => attempt.outcome),
      ['failed', 'succeeded', 'succeeded']);
    assert.equal(f.guard.isHalted(), false);
  } finally { f.guard.close(); }
});

test('Y13 known priced invalid payload seals locally and next arm may proceed', async t => {
  const f = controlledHarness(t, () => Response.json(chatResponse('{"memory":"wrong-shape"}')));
  try {
    const wrapped = await f.run(socket => post(socket, '/v1/chat/completions', chatBody()));
    assert.equal(wrapped.status, 'failed');
    assert.equal(wrapped.reason, 'invalid_payload');
    assert.equal(f.guard.isHalted(), false);
    assert.deepEqual(f.guard.attempts().map(attempt => [attempt.outcome,
      attempt.actualMicroUsd]), [['failed', 3]]);
    const next = await f.guard.withCaseScope(f.capability.schedule[1], async () => 'next-arm');
    assert.equal(next.status, 'completed');
  } finally { f.guard.close(); }
});

test('Y13 missing usage halts globally with unknown attempt and cannot advance arm', async t => {
  const f = controlledHarness(t, () => Response.json({ ...chatResponse('{"memory":[]}'), usage: null }));
  try {
    await assert.rejects(f.run(socket => post(socket, '/v1/chat/completions', chatBody())),
      { code: 'callback_failed' });
    assert.equal(f.guard.isHalted(), true);
    assert.deepEqual(f.guard.attempts().map(attempt => attempt.outcome), ['unknown']);
    await assert.rejects(f.guard.withCaseScope(f.capability.schedule[1], async () => 'denied'),
      { code: 'paid_work_halted' });
  } finally { f.guard.close(); }
});

test('Y13 changed inspected artifact halts before socket, child or provider', async t => {
  const roots = miniature(t);
  const artifact = inspectMem0NativeArtifact(roots);
  const configuration = mem0NativeConfiguration({ topK: 3, threshold: 0,
    childTimeoutMs: 5000, httpTimeoutMs: 1000 });
  const f = nativeFixture(t, { artifact, configuration, httpTimeoutMs: 1000,
    fetchImpl: () => assert.fail('artifact drift reached provider') });
  writeFileSync(join(roots.venvRoot, 'lib/python3.11/site-packages/mem0/memory/main.py'),
    'x = 2\n');
  try {
    await assert.rejects(f.guard.withCaseScope(f.capability.schedule[0], handle =>
      runMem0NativeCase({ artifact, configuration, guard: f.guard, handle,
        input: { batches: [[{ role: 'user', content: 'Synthetic.' }]], query: 'Synthetic?' } })),
    { code: 'callback_failed' });
    assert.equal(f.guard.isHalted(), true);
    assert.equal(f.guard.attempts().length, 0);
  } finally { f.guard.close(); }
});

test('Y13 caught active manifest mismatch still halts globally before socket or next arm',
  async t => {
    const artifact = { sourceTreeSha256: '7'.repeat(64), dependencyLockSha256: '8'.repeat(64) };
    const bound = mem0NativeConfiguration({ topK: 3, threshold: 0,
      childTimeoutMs: 5000, httpTimeoutMs: 1000 });
    const other = mem0NativeConfiguration({ topK: 2, threshold: 0,
      childTimeoutMs: 5000, httpTimeoutMs: 1000 });
    const f = nativeFixture(t, { artifact, configuration: bound, httpTimeoutMs: 1000,
      fetchImpl: () => assert.fail('mismatched manifest reached provider') });
    try {
      await assert.rejects(f.guard.withCaseScope(f.capability.schedule[0], async handle => {
        try {
          await runMem0NativeCase({ artifact, configuration: other, guard: f.guard, handle,
            input: { batches: [[{ role: 'user', content: 'Synthetic.' }]], query: 'Synthetic?' } });
        } catch { /* Deliberately swallowed by a trusted callback. */ }
        return 'false-success';
      }), { code: 'paid_work_halted' });
      assert.equal(f.guard.isHalted(), true);
      assert.equal(f.guard.attempts().length, 0);
      await assert.rejects(f.guard.withCaseScope(f.capability.schedule[1], async () => 'denied'),
        { code: 'paid_work_halted' });
    } finally { f.guard.close(); }
  });

test('Y13 artifact drift after child work globally halts before returning success', async t => {
  const f = controlledHarness(t, () => assert.fail('no synthetic HTTP expected'));
  try {
    const source = join(f.roots.venvRoot, 'lib/python3.11/site-packages/mem0/memory/main.py');
    await assert.rejects(f.run(async () => {
      writeFileSync(source, 'synthetic source changed after launch\n');
      return output();
    }), { code: 'callback_failed' });
    assert.equal(f.guard.isHalted(), true);
    assert.equal(f.guard.attempts().length, 0);
  } finally { f.guard.close(); }
});

test('Y13 child source drift after launch globally halts before returning success', async t => {
  const f = controlledHarness(t, () => assert.fail('no synthetic HTTP expected'));
  const childCopy = join(dirname(f.roots.venvRoot), 'synthetic-child.py');
  copyFileSync(new URL('../testing/mem0-native-child.py', import.meta.url), childCopy);
  f.useSyntheticChildFile(childCopy);
  try {
    await assert.rejects(f.run(async () => {
      writeFileSync(childCopy, '# synthetic child source changed after launch\n');
      return output();
    }), { code: 'callback_failed' });
    assert.equal(f.guard.isHalted(), true);
    assert.equal(f.guard.attempts().length, 0);
  } finally { f.guard.close(); }
});

test('Y13 priced response with synthetic B4 settlement fault cannot become native success',
  async t => {
    let f;
    const fetchImpl = () => {
      const db = new DatabaseSync(join(f.ledger.directory, 'experiment-budget.sqlite'));
      try { db.prepare('UPDATE attempts SET reserved_micro_usd = reserved_micro_usd + 1 '
        + 'WHERE outcome IS NULL').run(); }
      finally { db.close(); }
      return Response.json(chatResponse('{"memory":[]}'));
    };
    f = controlledHarness(t, fetchImpl);
    try {
      await assert.rejects(f.run(socket => post(socket, '/v1/chat/completions', chatBody())),
        { code: 'callback_failed' });
      assert.equal(f.guard.isHalted(), true);
      const [attempt] = f.guard.attempts();
      assert.equal(attempt.observedActualMicroUsd, 3);
      assert.equal(attempt.outcome, null);
      assert.equal(attempt.actualMicroUsd, null);
    } finally { f.guard.close(); }
  });

test('Y13 concurrent native requests do not create a second physical reservation', async t => {
  let accepted;
  const acceptedPromise = new Promise(resolve => { accepted = resolve; });
  const f = controlledHarness(t, () => {
    accepted();
    return new Promise(() => {});
  });
  try {
    await assert.rejects(f.run(async socket => {
      const first = post(socket, '/v1/chat/completions', chatBody()).catch(() => {});
      await acceptedPromise;
      const second = post(socket, '/v1/chat/completions', chatBody()).catch(() => {});
      await Promise.all([first, second]);
      return output();
    }), { code: 'callback_failed' });
    assert.equal(f.guard.isHalted(), true);
    assert.equal(f.guard.attempts().length, 1);
    assert.equal(f.guard.attempts()[0].outcome, 'unknown');
  } finally { f.guard.close(); }
});

test('Y13 controlled post-X promise never drains: cleanup globally halts', async t => {
  const f = controlledHarness(t, () => Response.json(chatResponse('{"memory":[]}')),
    { httpTimeoutMs: 100 });
  let routed;
  const routedPromise = new Promise(resolve => { routed = resolve; });
  const routeGuard = { ...f.guard,
    async mem0ChatFetch(...args) {
      await f.guard.mem0ChatFetch(...args); // Real X reserve, physical, settle.
      routed();
      return new Promise(() => {}); // Only the internal test double hangs.
    } };
  try {
    await assert.rejects(f.run(async socket => {
      post(socket, '/v1/chat/completions', chatBody()).catch(() => {});
      await routedPromise;
      return output();
    }, child => child.complete(143), () => {}, routeGuard), { code: 'callback_failed' });
    assert.equal(f.guard.isHalted(), true);
    assert.equal(f.guard.attempts().length, 1);
    assert.equal(f.guard.attempts()[0].outcome, 'succeeded');
  } finally {
    f.guard.close();
    const caseRoot = f.lastCaseRoot();
    // Only a controlled in-process promise was left pending, not an OS child.
    if (caseRoot && existsSync(caseRoot)) rmSync(caseRoot, { recursive: true });
  }
});

test('Y7 completed stale handle cannot halt a later arm', async t => {
  const artifact = { sourceTreeSha256: '7'.repeat(64), dependencyLockSha256: '8'.repeat(64) };
  const configuration = { configurationSha256: '9'.repeat(64) };
  const f = nativeFixture(t, { artifact, configuration, httpTimeoutMs: 1000,
    fetchImpl: () => assert.fail('no physical request') });
  try {
    let stale;
    const first = await f.guard.withCaseScope(f.capability.schedule[0], async handle => {
      stale = handle;
      return 'first';
    });
    assert.equal(first.status, 'completed');
    stale.halt();
    assert.equal(f.guard.isHalted(), false);
    const second = await f.guard.withCaseScope(f.capability.schedule[1], async () => 'second');
    assert.equal(second.status, 'completed');
  } finally { f.guard.close(); }
});

test('Y13 finite child watchdog locally cancels and reaps controlled hung child', async t => {
  const f = controlledHarness(t, () => assert.fail('hung child must not dispatch'),
    { childTimeoutMs: 50 });
  try {
    const result = await f.run(() => new Promise(() => {}));
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'cancelled');
    assert.equal(f.guard.isHalted(), false);
    const next = await f.guard.withCaseScope(f.capability.schedule[1], async () => 'next');
    assert.equal(next.status, 'completed');
  } finally { f.guard.close(); }
});

test('Y13 owned local revoke suppresses synthetic backpressured stdin EPIPE', async t => {
  const f = controlledHarness(t, () => assert.fail('revoked child must not dispatch'));
  let handle;
  let written = 0;
  const startBlockedChild = () => {
    const child = new EventEmitter();
    child.pid = 987654;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({ highWaterMark: 1,
      write(chunk) { written += chunk.length; /* Deliberately withhold callback. */ } });
    let closed = false;
    child.complete = code => {
      if (closed) return;
      closed = true;
      child.stdout.end(); child.stderr.end();
      setImmediate(() => child.emit('close', code, null));
    };
    setTimeout(() => {
      handle.revoke();
      const error = new Error('synthetic broken pipe');
      error.code = 'EPIPE';
      child.stdin.destroy(error);
      child.complete(143);
    }, 10);
    return child;
  };
  try {
    const result = await f.run(() => new Promise(() => {}), child => child.complete(143),
      current => { handle = current; }, f.guard, startBlockedChild,
      { batches: [[{ role: 'user', content: 'x'.repeat(256 * 1024) }]], query: 'synthetic' });
    assert.ok(written >= 256 * 1024);
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'cancelled');
    assert.equal(f.guard.isHalted(), false);
    const next = await f.guard.withCaseScope(f.capability.schedule[1], async () => 'next');
    assert.equal(next.status, 'completed');
  } finally { f.guard.close(); }
});

test('Y13 physical transport rejection settles unknown and globally halts', async t => {
  const f = controlledHarness(t, () => { throw new Error('synthetic transport failure'); });
  try {
    await assert.rejects(f.run(socket => post(socket, '/v1/chat/completions', chatBody())),
      { code: 'callback_failed' });
    assert.equal(f.guard.isHalted(), true);
    assert.deepEqual(f.guard.attempts().map(attempt => attempt.outcome), ['unknown']);
  } finally { f.guard.close(); }
});

test('Y13 revoked in-flight route seals and late provider completion cannot enter next arm',
  async t => {
    let handle;
    let accepted;
    const acceptedPromise = new Promise(resolve => { accepted = resolve; });
    let deliver;
    const physical = new Promise(resolve => { deliver = resolve; });
    const f = controlledHarness(t, () => { accepted(); return physical; });
    try {
      const running = f.run(socket => post(socket, '/v1/chat/completions', chatBody()),
        child => child.complete(143), current => { handle = current; });
      await acceptedPromise;
      handle.revoke();
      const sealed = await running;
      assert.equal(sealed.status, 'failed');
      assert.equal(sealed.reason, 'cancelled');
      assert.equal(f.guard.isHalted(), false);
      const prior = f.guard.attempts().length;
      deliver(Response.json(chatResponse('{"memory":[]}')));
      await new Promise(resolve => setTimeout(resolve, 25));
      const next = await f.guard.withCaseScope(f.capability.schedule[1], async () => 'next');
      assert.equal(next.status, 'completed');
      assert.equal(f.guard.attempts().length, prior);
    } finally { f.guard.close(); }
  });

test('Y13 fifth idle UDS connection globally halts before physical dispatch', async t => {
  const f = controlledHarness(t, () => assert.fail('idle sockets reached provider'));
  try {
    await assert.rejects(f.run(async socketPath => {
      const sockets = Array.from({ length: 5 }, () => net.createConnection(socketPath));
      for (const socket of sockets) socket.on('error', () => {});
      await new Promise(resolve => setTimeout(resolve, 30));
      for (const socket of sockets) socket.destroy();
      return output();
    }), { code: 'callback_failed' });
    assert.equal(f.guard.isHalted(), true);
    assert.equal(f.guard.attempts().length, 0);
  } finally { f.guard.close(); }
});

test('Y13 oversized child stdout is a global fault, not a plausible last line', async t => {
  const f = controlledHarness(t, () => assert.fail('oversized output reached provider'));
  try {
    await assert.rejects(f.run(() => ({ ...output(),
      extra: 'x'.repeat(2 * 1024 * 1024) })), { code: 'callback_failed' });
    assert.equal(f.guard.isHalted(), true);
    assert.equal(f.guard.attempts().length, 0);
  } finally { f.guard.close(); }
});

test('Y13 invalid UTF-8 child output is a global fault', async t => {
  const f = controlledHarness(t, () => assert.fail('invalid output reached provider'));
  try {
    await assert.rejects(f.run(() => Buffer.from([0xff, 0xfe])),
      { code: 'callback_failed' });
    assert.equal(f.guard.isHalted(), true);
    assert.equal(f.guard.attempts().length, 0);
  } finally { f.guard.close(); }
});

function sendRaw(socketPath, raw) {
  return new Promise(resolve => {
    const socket = net.createConnection(socketPath);
    socket.once('connect', () => socket.end(raw));
    socket.once('error', () => resolve());
    socket.once('close', () => resolve());
  });
}

test('Y6/Y11 malformed framing on an accepted socket after local seal is global', async t => {
  let handle;
  const f = controlledHarness(t, () => assert.fail('late malformed frame reached provider'));
  try {
    await assert.rejects(f.run(async socketPath => {
      const socket = net.createConnection(socketPath);
      socket.on('error', () => {});
      await new Promise(resolve => socket.once('connect', resolve));
      handle.revoke();
      socket.end('NOT HTTP\r\n\r\n');
      await new Promise(resolve => setTimeout(resolve, 30));
      return output();
    }, child => { setTimeout(() => child.complete(143), 100); },
    current => { handle = current; }), { code: 'callback_failed' });
    assert.equal(f.guard.isHalted(), true);
    assert.equal(f.guard.attempts().length, 0);
    await assert.rejects(f.guard.withCaseScope(f.capability.schedule[1], async () => 'denied'),
      { code: 'paid_work_halted' });
  } finally { f.guard.close(); }
});

const rawRequest = (headers, body) => `POST /v1/chat/completions HTTP/1.1\r\n` +
  `Host: unix-gateway\r\n${headers}\r\n${body}`;

test('Y6/Y11 malformed accepted JSON body after local seal is global', async t => {
  let handle;
  const f = controlledHarness(t, () => assert.fail('late malformed JSON reached provider'));
  try {
    await assert.rejects(f.run(async socketPath => {
      const socket = net.createConnection(socketPath);
      socket.on('error', () => {});
      await new Promise(resolve => socket.once('connect', resolve));
      socket.write(rawRequest('Authorization: Bearer local-only-dummy-key\r\n'
        + 'Content-Type: application/json\r\nContent-Length: 1\r\n', ''));
      await new Promise(resolve => setTimeout(resolve, 20));
      handle.revoke();
      socket.end('{');
      await new Promise(resolve => setTimeout(resolve, 30));
      return output();
    }, child => { setTimeout(() => child.complete(143), 120); },
    current => { handle = current; }), { code: 'callback_failed' });
    assert.equal(f.guard.isHalted(), true);
    assert.equal(f.guard.attempts().length, 0);
  } finally { f.guard.close(); }
});

for (const [name, raw] of [
  ['unknown identity header', rawRequest('Authorization: Bearer local-only-dummy-key\r\n'
    + 'Content-Type: application/json\r\nContent-Length: 2\r\nX-Other-Identity: spoof\r\n', '{}')],
  ['duplicate authorization', rawRequest('Authorization: Bearer local-only-dummy-key\r\n'
    + 'Authorization: Bearer spoof\r\nContent-Type: application/json\r\n'
    + 'Content-Length: 2\r\n', '{}')],
  ['invalid JSON body', rawRequest('Authorization: Bearer local-only-dummy-key\r\n'
    + 'Content-Type: application/json\r\nContent-Length: 1\r\n', '{')],
  ['oversized declared body', rawRequest('Authorization: Bearer local-only-dummy-key\r\n'
    + 'Content-Type: application/json\r\nContent-Length: 1048577\r\n', '')],
]) {
  test(`Y13 ${name} is global before provider dispatch`, async t => {
    const f = controlledHarness(t, () => assert.fail('malformed HTTP reached provider'));
    try {
      await assert.rejects(f.run(socketPath => sendRaw(socketPath, raw)),
        { code: 'callback_failed' });
      assert.equal(f.guard.isHalted(), true);
      assert.equal(f.guard.attempts().length, 0);
    } finally { f.guard.close(); }
  });
}

test('Y13 controlled unreaped child globally halts after finite TERM/KILL window', async t => {
  const f = controlledHarness(t, () => assert.fail('unreaped child reached provider'),
    { childTimeoutMs: 50 });
  try {
    await assert.rejects(f.run(() => new Promise(() => {}), () => {}),
      { code: 'callback_failed' });
    assert.equal(f.guard.isHalted(), true);
    assert.equal(f.guard.attempts().length, 0);
  } finally {
    f.guard.close();
    const caseRoot = f.lastCaseRoot();
    // The process is an in-process test double, never an OS child; after the
    // asserted global halt its exact private synthetic root is safe to remove.
    if (caseRoot && existsSync(caseRoot)) rmSync(caseRoot, { recursive: true });
  }
});

test('Y12 exited leader with held stdio is never signalled again and remains global', async t => {
  const f = controlledHarness(t, () => assert.fail('exited child reached provider'),
    { childTimeoutMs: 50 });
  const signals = [];
  const exitedWithHeldStdio = () => {
    const child = new EventEmitter();
    child.pid = 987654;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin.once('finish', () => setImmediate(() => child.emit('exit', 0, null)));
    return child;
  };
  try {
    await assert.rejects(f.run(() => new Promise(() => {}),
      (_child, signal) => { signals.push(signal); }, () => {}, f.guard,
      exitedWithHeldStdio), { code: 'callback_failed' });
    assert.deepEqual(signals, [], 'a reaped leader PID must not receive TERM or KILL');
    assert.equal(f.guard.isHalted(), true);
    assert.equal(f.guard.attempts().length, 0);
    assert.equal(existsSync(f.lastCaseRoot()), true);
  } finally {
    f.guard.close();
    const caseRoot = f.lastCaseRoot();
    // This process is an in-process double; no host PID or group was signalled.
    if (caseRoot && existsSync(caseRoot)) rmSync(caseRoot, { recursive: true });
  }
});
