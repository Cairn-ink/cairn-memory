import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { command, packageName } from '../build.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(sdk.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(sdk.resolve('@modelcontextprotocol/client/stdio'));
const preload = fileURLToPath(new URL('./fixtures/indexed-canonical-fetch.mjs', import.meta.url));
const policy = ['--capture-source-policy', 'indexed-staged-v1'];
const access = ['--capture-evidence-access', 'staged-v1'];
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => { assert.equal(result.ok, false); assert.equal(result.error.code, code); };
const messages = [{ role: 'assistant', content: 'a'.repeat(1100) + ' Synthetic suggestion, not adopted.' },
  { role: 'user', content: 'b'.repeat(1100) + ' LATE_INSTALLED_DETAIL: correction is current.' }];
const expected = batchId => messages.map((message, index) => ({ ...message,
  id: createHash('sha256').update(JSON.stringify(['cairn.mcp.submitted-message.v1', batchId, index])).digest('hex') }));

// The builder allocates its own directories. Bind its TMPDIR to this already
// owned workspace so even a throw before returning the report is cleaned.
function build(workspace) {
  const script = `import { buildArtifact } from ${JSON.stringify(new URL('../build.mjs', import.meta.url).href)};
    console.log(JSON.stringify(buildArtifact()));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: workspace.path, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: workspace.path, NODE_DISABLE_COMPILE_CACHE: '1' } });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  const artifact = JSON.parse(result.stdout);
  assert(artifact.artifactPath.startsWith(workspace.path + '/'));
  return artifact;
}
function install(workspace, artifact) {
  const project = join(workspace.path, 'app'); mkdirSync(project);
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'synthetic-canonical-install', private: true, version: '0.0.0' }), { flag: 'wx' });
  command('npm', ['install', '--prefix', project, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    artifact.artifactPath], project, artifact.userconfig);
  const installed = join(project, 'node_modules', packageName);
  for (const [file, sha] of Object.entries(artifact.sourceHashes)) {
    assert.equal(createHash('sha256').update(readFileSync(join(installed, file))).digest('hex'), sha, file);
  }
  return installed;
}
async function start(workspace, installed, path, { mode = 'empty', keyless = false, owner = 'installed-canonical',
  project, client = 'installed-client', flags = keyless ? access : policy } = {}) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', preload, join(installed, 'bin/cairn-memory.mjs'), '--db', path,
      '--owner', owner, '--client', client, '--session', 'installed-session',
      ...(project ? ['--project', project] : []), ...flags],
    env: { OPENAI_API_KEY: keyless ? '' : 'synthetic-not-a-provider-key', NODE_NO_WARNINGS: '1',
      SYNTHETIC_CANONICAL_MODE: mode, SYNTHETIC_CANONICAL_DENY_FETCH: keyless ? '1' : '0' }, stderr: 'pipe' });
  let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
  const clientHandle = new Client({ name: 'synthetic-installed-canonical-client', version: '1.0.0' });
  workspace.defer(() => clientHandle.close());
  await clientHandle.connect(transport);
  return { client: clientHandle, transport, close: () => clientHandle.close(),
    calls: () => [...stderr.matchAll(/synthetic_fetch:(\w+)/g)].map(match => match[1]) };
}
async function call(h, name, args = {}) {
  const response = await h.client.callTool({ name, arguments: args });
  const result = JSON.parse(response.content[0].text);
  assert.equal(Boolean(response.isError), !result.ok);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions'); return result;
}
const evidence = async (h, batchId) => ok(await call(h, 'inspect_capture_evidence', { batchId })).evidence;

test('H7 actual installed CLI preserves canonical recovery, no-qualification capture and cold isolation/replay fences',
  { timeout: 180000 }, async t => {
    const ws = createTestWorkspace(t, { prefix: 'installed-canonical-' });
    try {
      const artifact = build(ws), installed = install(ws, artifact);
      for (const mode of ['empty', 'malformed', 'failure', 'nonempty']) {
        const path = join(ws.path, `${mode}.sqlite`), batchId = `installed-${mode}`;
        const warm = await start(ws, installed, path, { mode });
        const captured = await call(warm, 'capture_memory', { batchId, messages });
        if (mode === 'empty' || mode === 'nonempty') assert.equal(ok(captured).qualificationStatus, 'not-requested');
        else error(captured, mode === 'failure' ? 'extraction_failed' : 'invalid_model_output');
        assert(!JSON.stringify(captured).includes('SYNTHETIC_PRIVATE_PROVIDER_ERROR'));
        const saved = await evidence(warm, batchId);
        assert.equal(saved.view.format, 'canonical-messages-v1');
        assert.deepEqual(saved.view.messages, expected(batchId));
        assert.deepEqual(saved.view.retainedSourceWindow, { maxUnitsPerMessage: 4000, truncatedMessageIndices: [] });
        const methods = warm.calls(); assert(methods.includes('cairn_extract'));
        assert(!methods.some(method => method.startsWith('cairn_qualif')));
        if (mode === 'nonempty') {
          const memoryId = captured.value.admission.memories[0].id;
          const memory = ok(await call(warm, 'inspect_memory', { memoryId, includeQualification: true }));
          assert.equal(memory.qualification, null); assert.equal(memory.receipts[0].excerpt, 'a'.repeat(800));
          assert.equal(memory.receipts[0].role, 'assistant');
          assert.equal(ok(await call(warm, 'capture_memory', { batchId, messages })).duplicate, true);
          assert.deepEqual(warm.calls(), methods); assert.equal((await evidence(warm, batchId)).expiresAt, saved.expiresAt);
        } else assert.deepEqual(ok(await call(warm, 'inspect_memory')).memories, []);
        if (mode === 'empty') {
          const send = warm.transport.send.bind(warm.transport); let frameBytes;
          warm.transport.send = message => {
            if (message.method === 'tools/call' && message.params.name === 'capture_memory') {
              frameBytes = Buffer.byteLength(JSON.stringify(message) + '\n');
            }
            return send(message);
          };
          const canonical = '中🙂"\\', nearId = 'installed-near-limit';
          const nearMessages = Array.from({ length: 8 }, (_, index) => ({
            role: index % 2 ? 'user' : 'assistant', content: canonical + '\t'.repeat(3995) }));
          ok(await call(warm, 'capture_memory', { batchId: nearId, messages: nearMessages }));
          assert(frameBytes >= 64000 && frameBytes <= 65536);
          assert.deepEqual((await evidence(warm, nearId)).view.messages.map(({ role, content }) => ({ role, content })),
            nearMessages.map(({ role }) => ({ role, content: canonical })));
        }
        await warm.close();
        const cold = await start(ws, installed, path, { keyless: true,
          flags: [...access, '--source-snapshot', 'current-admitted-v1'] });
        assert.deepEqual(await evidence(cold, batchId), saved);
        const sources = ok(await call(cold, 'read_memory_sources'));
        assert(!JSON.stringify(sources).includes('LATE_INSTALLED_DETAIL'));
        for (const patch of [{ owner: 'other-owner' }, { project: 'other-project' }, { client: 'other-client' }]) {
          const other = await start(ws, installed, path, { keyless: true, ...patch });
          assert.equal(await evidence(other, batchId), null); assert.deepEqual(other.calls(), []); await other.close();
        }
        ok(await call(cold, 'discard_capture_evidence', { batchId }));
        assert.equal((await evidence(cold, batchId)).view, null); assert.deepEqual(cold.calls(), []); await cold.close();
        const replay = await start(ws, installed, path, { mode: 'nonempty' });
        error(await call(replay, 'capture_memory', { batchId, messages }), 'capture_evidence_closed');
        assert.deepEqual(replay.calls(), []); await replay.close();
      }
    } finally {
      await ws.cleanup(); assert.equal(existsSync(ws.path), false, 'successful/failed installed paths remove owned scratch');
    }
  });

test('H7 deliberate owned offline-install failure also cleans partial projects and builder artifacts', async t => {
  const ws = createTestWorkspace(t, { prefix: 'installed-canonical-failure-' });
  try {
    const artifact = build(ws), invalid = join(ws.path, 'invalid.tgz');
    writeFileSync(invalid, 'synthetic invalid archive', { flag: 'wx' });
    assert.throws(() => install(ws, { ...artifact, artifactPath: invalid }), /artifact_command_failed/);
    assert(existsSync(join(ws.path, 'app/package.json')));
  } finally {
    await ws.cleanup(); assert.equal(existsSync(ws.path), false, 'intentional offline install failure is cleaned');
  }
});
