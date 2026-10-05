// Content-free diagnostic tests: genuine kernel, v3 guard and UDS; controlled child only.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { checkedMem0NativeArtifact, inspectMem0NativeArtifact } from '../mem0-native-artifact.mjs';
import { mem0NativeConfiguration } from '../mem0-native-gateway.mjs';
import { runNativeGatewayKernel } from '../mem0-native-runtime.mjs';
import { nativeFakeProvider } from '../test/mem0-native-fixture.mjs';
import { nativeHttpTimeoutFixture } from './native-http-timeout-fixture.mjs';

function artifactFor(t) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-nhc-artifact-' });
  const venvRoot = join(workspace.path, 'venv'), pythonRoot = join(workspace.path, 'python');
  for (const directory of [join(venvRoot, 'bin'),
    join(venvRoot, 'lib/python3.11/site-packages/mem0/memory'),
    join(venvRoot, 'lib/python3.11/site-packages/mem0ai-2.2.0.dist-info'),
    join(pythonRoot, 'bin'), join(pythonRoot, 'lib/python3.11/encodings')]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(join(venvRoot, 'pyvenv.cfg'), `home = ${join(pythonRoot, 'bin')}\n`);
  fs.writeFileSync(join(venvRoot, 'lib/python3.11/site-packages/mem0/memory/main.py'), '# synthetic\n');
  fs.writeFileSync(join(venvRoot, 'lib/python3.11/site-packages/mem0ai-2.2.0.dist-info/METADATA'),
    'Name: mem0ai\nVersion: 2.2.0\n');
  fs.writeFileSync(join(pythonRoot, 'bin/python3.11'), '#!/fake-never-execute\n');
  fs.writeFileSync(join(pythonRoot, 'lib/python3.11/encodings/__init__.py'), '# synthetic\n');
  fs.symlinkSync(join(pythonRoot, 'bin/python3.11'), join(venvRoot, 'bin/python'));
  return inspectMem0NativeArtifact({ venvRoot, pythonRoot });
}

export function syntheticPost(socketPath, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, path: '/v1/embeddings', method: 'POST',
      headers: { host: 'unix-gateway', authorization: 'Bearer local-only-dummy-key',
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
      response.once('error', reject);
    });
    request.once('error', reject); request.end(body);
  });
}

export async function nativeClientErrorProbe(t, mode, prefix = 1) {
  const artifact = artifactFor(t);
  const configuration = mem0NativeConfiguration({ topK: 1, threshold: 0,
    childTimeoutMs: 10_000, httpTimeoutMs: 2000 });
  const fake = nativeFakeProvider();
  const fixture = nativeHttpTimeoutFixture(t, { artifact, configuration, fetchImpl: fake.fetchImpl });
  let childClosed = false, caseRoot, operation, rawClosed = true, innerError, outerError, result;
  if (mode === 'header-timeout') {
    // Synthetic acceleration of Node's default 30s expiry scan only. The
    // kernel's actual 2s header deadline and all safety timers are unchanged.
    const original = http.createServer;
    t.mock.method(http, 'createServer', (options, listener) =>
      original({ ...options, connectionsCheckingInterval: 10 }, listener));
  }
  const embedding = JSON.stringify({ model: 'text-embedding-3-small', input: ['synthetic'],
    dimensions: 1536, encoding_format: 'float' });
  try {
    try {
      result = await fixture.guard.withCaseScope(fixture.capability.schedule[0], async handle => {
        try {
          return await runNativeGatewayKernel({ artifact, roots: checkedMem0NativeArtifact(artifact),
            configuration: configuration.configuration,
            childFile: fileURLToPath(new URL('./mem0-native-child.py', import.meta.url)),
            guard: fixture.guard, handle, input: { batches: [[{ role: 'user', content: 'x' }]], query: 'x' },
            scope: { caseId: fixture.capability.schedule[0].caseId } }, {
            startChild({ socket }) {
              caseRoot = dirname(socket);
              const child = new EventEmitter();
              child.pid = 987654;
              child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
              child.complete = code => {
                if (childClosed) return;
                childClosed = true;
                if (code === 0) child.stdout.end(JSON.stringify({ version: 'cairn-mem0-native-result-v1',
                  verifiedAddRecords: 0, results: [] }));
                else child.stdout.end();
                child.stderr.end();
                setImmediate(() => { child.emit('exit', code, null); child.emit('close', code, null); });
              };
              child.stdin.once('finish', () => {
                operation = (async () => {
                  for (let index = 0; index < prefix; index++) assert.equal(await syntheticPost(socket, embedding), 200);
                  if (mode === 'healthy') return;
                  if (mode === 'bad-json') { await syntheticPost(socket, '{'); return; }
                  const raw = net.connect(socket);
                  rawClosed = false;
                  raw.on('error', () => {}); raw.resume();
                  const closed = new Promise(resolve => raw.once('close', () => { rawClosed = true; resolve(); }));
                  await new Promise((resolve, reject) => { raw.once('connect', resolve); raw.once('error', reject); });
                  const partial = 'POST /v1/embeddings HTTP/1.1\r\nHost: unix-';
                  if (mode === 'bad-header') raw.end('POST /v1/embeddings HTTP/1.1\r\nBad Header: x\r\n\r\n');
                  else if (mode === 'partial-eof') raw.end(partial);
                  else if (mode === 'header-timeout') raw.write(partial);
                  else assert.fail('unknown synthetic fault');
                  await closed;
                })();
                operation.then(() => child.complete(0), () => child.complete(1));
              });
              return child;
            }, stopChild: child => child.complete(137),
          });
        } catch (error) { innerError = error; throw error; }
      });
    } catch (error) { outerError = error; }
    if (operation) await Promise.allSettled([operation]);
    const attempts = fixture.guard.attempts();
    assert.equal(attempts.length, prefix);
    assert.ok(attempts.every(attempt => attempt.outcome === 'succeeded'
      && Number.isSafeInteger(attempt.actualMicroUsd) && attempt.transportTermination === 'response'));
    assert.ok(fixture.guard.getState().attempts.every(attempt => attempt.outcome !== null));
    assert.equal(childClosed, true); assert.equal(rawClosed, true);
    assert.equal(fs.existsSync(caseRoot), false);
    if (mode === 'healthy') {
      assert.equal(innerError, undefined); assert.equal(outerError, undefined);
      assert.equal(result.status, 'completed'); assert.equal(fixture.guard.isHalted(), false);
      let entered = 0;
      await fixture.guard.withCaseScope(fixture.capability.schedule[1], () => { entered++; });
      assert.equal(entered, 1);
    } else {
      assert.equal(innerError?.code, mode === 'bad-json' ? 'native_gateway_failed' : 'native_http_invalid');
      assert.equal(outerError?.code, 'callback_failed'); assert.equal(fixture.guard.isHalted(), true);
      assert.equal(fixture.guard.caseScopeSnapshot().status, 'active');
      assert.equal(fixture.guard.caseScopeSnapshot().reason, null);
      assert.equal(fixture.guard.caseOutcomes().scopes.length, 0);
      await assert.rejects(fixture.guard.withCaseScope(fixture.capability.schedule[1], () =>
        assert.fail('halted next scope entered')), { code: 'paid_work_halted' });
    }
    return { innerError, outerError, prefix, requests: fake.requests.length };
  } finally { fixture.guard.close(); }
}
