import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, appendFile, mkdir, lstat, copyFile, symlink, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { assertFixtureClients, fixtureBinaryGuard } from './fixture-clients.mjs';
import { engineCacheComplete, skipMissingEngineCache } from './engine-cache.mjs';
import { SERDE_MARKERS } from '../../../integrations/codex/schema-evidence.mjs';

const packageRoot = process.env.CAIRN_SETUP_TEST_PACKAGE || fileURLToPath(new URL('../', import.meta.url));
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const session = '11111111-1111-4111-8111-111111111111';
const needCache = t => engineCacheComplete(process.env.CAIRN_SETUP_NPM_CACHE) ||
  (skipMissingEngineCache(t, 'Packed capture installation needs the four pinned dependency tarballs in CAIRN_SETUP_NPM_CACHE.'), false);
async function run(command, args, { input, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], ...options });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.on('error', reject);
    const timer = setTimeout(() => child.kill('SIGKILL'), 150000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    child.stdin.end(input);
  });
}
async function fixture(t, { codex = true, failedQualification = false, cloud = false, interactive = false } = {}) {
  const ws = createTestWorkspace(t, { prefix: 'packed-local-capture-' });
  const home = join(ws.path, 'home'), bin = join(ws.path, 'bin'), root = join(home, '.cairn-memory');
  await mkdir(home, { mode: 0o700 }); await mkdir(bin, { mode: 0o700 });
  const npmrc = join(ws.path, '.npmrc'); await writeFile(npmrc, 'registry=https://registry.npmjs.org/\n', { mode: 0o600 });
  const npmEnv = { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, npm_config_userconfig: npmrc,
    npm_config_cache: process.env.CAIRN_SETUP_NPM_CACHE, TMPDIR: ws.path };
  const packed = join(ws.path, 'packed'); await mkdir(packed);
  const pack = await run('npm', ['pack', packageRoot, '--ignore-scripts', '--json', '--pack-destination', packed], { env: npmEnv, cwd: ws.path });
  assert.equal(pack.code, 0, pack.stderr); t.diagnostic('npm pack exit 0');
  const archive = join(packed, JSON.parse(pack.stdout)[0].filename);
  const extracted = await run('tar', ['-xzf', archive, '-C', packed], { env: npmEnv, cwd: ws.path });
  assert.equal(extracted.code, 0, extracted.stderr);
  const pkg = join(packed, 'package');
  const paths = {}, calls = {};
  for (const client of codex ? ['claude', 'codex'] : ['claude']) {
    paths[client] = join(ws.path, client + '.json'); calls[client] = join(ws.path, client + '.calls');
    const initial = client === 'codex' ? { version: '0.162.0', failSchema: failedQualification,
      formatEvidence: fileURLToPath(new URL('../../../integrations/codex/test/fixtures/', import.meta.url)) } : { installed: cloud };
    await writeFile(paths[client], JSON.stringify(initial)); await writeFile(calls[client], '');
    let source = `#!${process.execPath}\n${fixtureBinaryGuard(ws.path)}process.env.FAKE_STATE=${JSON.stringify(paths[client])};process.env.FAKE_CALLS=${JSON.stringify(calls[client])};\n` +
      await readFile(new URL(`./fake-${client}.mjs`, import.meta.url), 'utf8');
    if (client === 'codex') {
      const evidence = await json(new URL('../../../integrations/codex/test/fixtures/binary-0.162.0/format.json', import.meta.url));
      source += '\n/*\n' + Object.values(evidence.hooks).map(value => JSON.stringify(value, null, 2)).join('\n') + '\n' + SERDE_MARKERS.join('\n') + '\n*/\n';
    }
    await writeFile(join(bin, client), source, { mode: 0o755 });
  }
  // Keep discovery fake-only. Node's directory may also contain real clients;
  // the engine adds its Node/npm path privately when installing dependencies.
  const env = { HOME: home, CODEX_HOME: join(home, '.codex'), CAIRN_MEMORY_HOME: root, TMPDIR: ws.path,
    PATH: bin, LANG: 'en_US.UTF-8',
    CAIRN_SETUP_NPM_CACHE: process.env.CAIRN_SETUP_NPM_CACHE, CAIRN_SETUP_NPM_OFFLINE: '1' };
  const harness = join(ws.path, 'setup.mjs');
  await writeFile(harness, `import{main}from ${JSON.stringify(pathToFileURL(join(pkg, 'lib/setup.mjs')).href)};
    process.exitCode=await main(process.argv.slice(2),{interactive:${interactive},prompt:async()=> 'yes'});`);
  const setup = async (args = ['setup', '--local'], { expected = 0, packagePath } = {}) => {
    assertFixtureClients(env, ws.path);
    const result = await run(process.execPath, [packagePath ? join(packagePath, 'bin/memory.mjs') : harness, ...args], { env, cwd: ws.path });
    assert.equal(result.signal, null); assert.equal(result.code, expected, result.stdout + result.stderr);
    t.diagnostic(`${args.join(' ')} exit ${result.code}`);
    return result.stdout;
  };
  const descriptor = () => json(join(root, 'installation.json'));
  const native = client => json(join(home, client === 'claude' ? '.claude/settings.json' : '.codex/hooks.json'));
  const hook = async (event, transcript, id = session) => {
    assertFixtureClients(env, ws.path);
    const config = await native('claude');
    const command = config.hooks[event].flatMap(group => group.hooks).find(hook => hook.type === 'command').command;
    const result = await run('/bin/sh', ['-c', command], { env, cwd: ws.path,
      input: JSON.stringify({ hook_event_name: event, session_id: id, transcript_path: transcript }) });
    assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, '');
    t.diagnostic(`${event} native hook exit ${result.code}`);
  };
  const append = async (path, text) => appendFile(path, JSON.stringify({ type: 'user', uuid: 'synthetic-' + Date.now(),
    timestamp: new Date().toISOString(), promptSource: 'typed', message: { content: [{ type: 'text', text }] } }) + '\n', { mode: 0o600 });
  return { ws: ws.path, home, bin, root, env, pkg, setup, descriptor, native, hook, append, paths, calls };
}
async function mcp(f, t) {
  assertFixtureClients(f.env, f.ws);
  const d = await f.descriptor(), receipt = d.clients.claude.vector;
  const executable = join(f.root, 'engine', receipt.engineId, 'app/node_modules/cairn-memory-local-preview/bin/cairn-memory.mjs');
  const child = spawn(receipt.node, [executable, '--db', d.database.path, '--owner', d.ownerId,
    ...(d.projectId ? ['--project', d.projectId] : [])], { cwd: f.ws, env: f.env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume(); let sequence = 0, buffer = ''; const pending = new Map();
  child.stdout.on('data', bytes => {
    buffer += bytes;
    for (;;) { const end = buffer.indexOf('\n'); if (end < 0) break;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line) continue;
      const value = JSON.parse(line); if (pending.has(value.id)) { const callback = pending.get(value.id); pending.delete(value.id); callback(value); }
    }
  });
  const closed = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  let ended = false;
  const close = async () => {
    if (ended) return; ended = true; child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    const outcome = await closed; clearTimeout(timer);
    assert.equal(outcome.code, 0, 'MCP child exits cleanly'); assert.equal(outcome.signal, null); t.diagnostic('MCP child exit 0');
  };
  t.after(close);
  const request = async (method, params) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.get(id)?.({ error: 'timeout' }); pending.delete(id); }, 20000);
    const result = await new Promise(resolve => { pending.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
    clearTimeout(timer); assert.equal(result.error, undefined, JSON.stringify(result.error)); return result.result;
  };
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic-capture-test', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const call = async (name, args) => {
    const result = await request('tools/call', { name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    if (name === 'read_memory_context') return result;
    const value = JSON.parse(result.content[0].text); assert.equal(value.ok, true, JSON.stringify(value)); return value.value;
  };
  const search = () => call('read_memory_context', { query: 'copper telescope', types: ['memory'], intent: 'current', semantic: false, deadlineMs: 5000 });
  return { call, search, close, request };
}
async function searchCaptured(reader) {
  let value;
  for (let attempt = 0; attempt < 50; attempt++) {
    value = await reader.search();
    if (JSON.stringify(value).includes('copper telescope')) return value;
    await delay(100);
  }
  assert.fail('Captured Raw must be searchable through the registered MCP server; final content: ' + JSON.stringify(value?.content));
}

test('fixture client guard rejects leaked Node bin and escaping clients before execution', async t => {
  const ws = createTestWorkspace(t, { prefix: 'client-guard-proof-' });
  const fixture = join(ws.path, 'fixture'), bin = join(fixture, 'bin'), marker = join(ws.path, 'ran');
  await mkdir(bin, { recursive: true, mode: 0o700 });
  const source = `#!${process.execPath}\n${fixtureBinaryGuard(fixture)}\n` +
    `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'ran');`;
  for (const client of ['codex', 'claude']) await writeFile(join(bin, client), source, { mode: 0o755 });
  assert.deepEqual(Object.keys(assertFixtureClients({ PATH: bin }, fixture)), ['codex', 'claude']);
  // No lookup, import, spawn or version probe in Node's directory is allowed.
  assert.throws(() => assertFixtureClients({ PATH: bin + ':' + dirname(process.execPath) }, fixture),
    /fixture client guard: PATH entry outside fixture directory/);
  await assert.rejects(lstat(marker), { code: 'ENOENT' });
  const outside = join(ws.path, 'codex'); await copyFile(join(bin, 'codex'), outside);
  await unlink(join(bin, 'codex')); await symlink(outside, join(bin, 'codex'));
  assert.throws(() => assertFixtureClients({ PATH: bin }, fixture),
    /fixture client guard: binary target outside fixture directory/);
  const refused = await run(process.execPath, [outside], { env: { HOME: fixture, PATH: bin } });
  assert.equal(refused.code, 1); assert.match(refused.stderr, /fixture client guard: binary outside fixture directory/);
  await assert.rejects(lstat(marker), { code: 'ENOENT' });
  const accepted = await run(process.execPath, [join(bin, 'claude')], { env: { HOME: fixture, PATH: bin } });
  assert.equal(accepted.code, 0, accepted.stderr); assert.equal(await readFile(marker, 'utf8'), 'ran');
});

for (const interactive of [false, true]) test(`packed default capture, notice once, idempotence and status (${interactive ? 'interactive' : 'noninteractive'})`, { timeout: 150000 }, async t => {
  if (!needCache(t)) return;
  const f = await fixture(t, { interactive });
  const output = await f.setup();
  assert.equal(output.match(/Conversation text from this tool/g)?.length, 2);
  assert.match(output, /Codex: approve.*\/hooks/);
  for (const client of ['claude', 'codex']) {
    const settings = await f.native(client);
    assert.ok(settings.hooks.SessionStart); assert.ok(settings.hooks.Stop); assert.ok(settings.hooks.PreCompact);
    if (client === 'codex') assert.ok(settings.hooks.UserPromptSubmit);
    const capture = await json(join(f.root, 'capture', client, 'capture.json'));
    const d = await f.descriptor(); assert.equal(capture.databasePath, d.database.path);
    assert.equal(capture.authority.namespace.ownerId, d.ownerId);
    assert.equal(capture.interpretation, 'raw-only'); assert.equal(capture.raw.capBytes, 200000000);
    assert.equal(capture.usage.root, join(f.root, 'capture-usage'));
  }
  const before = await Promise.all(['claude', 'codex'].map(client => f.native(client)));
  const keys = await Promise.all(['claude', 'codex'].map(client => readFile(join(f.root, 'capture', client, 'identity.key'))));
  assert.doesNotMatch(await f.setup(), /Conversation text from this tool/);
  assert.deepEqual(await Promise.all(['claude', 'codex'].map(client => f.native(client))), before);
  assert.deepEqual(await Promise.all(['claude', 'codex'].map(client => readFile(join(f.root, 'capture', client, 'identity.key')))), keys);
  const probeCount = (await readFile(f.calls.codex, 'utf8')).split('\n').filter(line => line.includes('generate-json-schema')).length;
  const status = await f.setup(['status']);
  assert.match(status, /Claude Code local capture: on/); assert.match(status, /Codex local capture: on/);
  assert.match(status, /200,000,000/);
  assert.equal((await readFile(f.calls.codex, 'utf8')).split('\n').filter(line => line.includes('generate-json-schema')).length, probeCount);
});

test('packed Codex zero-history off/on and engine qualification status never probes', { timeout: 150000 }, async t => {
  if (!needCache(t)) return;
  const f = await fixture(t); await f.setup(['setup', '--local', '--no-capture']);
  await f.setup(['config', '--local-capture', 'on', '--client', 'codex']);
  const key = await readFile(join(f.root, 'capture/codex/identity.key'));
  await f.setup(['config', '--local-capture', 'off', '--client', 'codex']);
  assert.equal((await f.native('codex')).hooks.Stop, undefined);
  await f.setup(['config', '--local-capture', 'on', '--client', 'codex']);
  assert.deepEqual(await readFile(join(f.root, 'capture/codex/identity.key')), key);
  await appendFile(join(f.bin, 'codex'), '\n// synthetic updated binary\n');
  const probes = text => text.split('\n').filter(line => line.includes('generate-json-schema')).length;
  const before = probes(await readFile(f.calls.codex, 'utf8'));
  // Cache-only engine status describes the last observed host, even if the
  // binary has since changed. The installer must not rediscover it itself.
  assert.match(await f.setup(['status']), /Codex format qualification: qualified \(qualified\)/);
  const d = await f.descriptor(), receipt = d.clients.codex.vector;
  const module = pathToFileURL(join(f.root, 'engine', receipt.engineId,
    'app/node_modules/cairn-memory-local-preview/integrations/codex/qualification.mjs')).href;
  const observation = await run(receipt.node, ['--input-type=module', '-e',
    `const q=await import(${JSON.stringify(module)});await q.observeHost(${JSON.stringify(join(f.root, 'capture-support/codex/installation.json'))},await q.resolveCLI(process.env));`],
    { env: f.env, cwd: f.ws });
  assert.equal(observation.code, 0, observation.stderr);
  const pending = await f.setup(['status']);
  assert.match(pending, /Codex local capture: blocked \(qualification_required\)/);
  assert.match(pending, /Codex format qualification: pending \(qualification_pending\)/);
  assert.equal(probes(await readFile(f.calls.codex, 'utf8')), before);
  await f.setup(); assert.match(await f.setup(['status']), /Codex local capture: on/);
  assert.ok(probes(await readFile(f.calls.codex, 'utf8')) > before);
});

test('packed Traditional Chinese notice appears once and describes controls and limits', { timeout: 150000 }, async t => {
  if (!needCache(t)) return;
  const f = await fixture(t, { codex: false });
  const output = await f.setup(['setup', '--local', '--lang', 'zh']);
  assert.match(output, /明文 Raw/); assert.match(output, /200,000,000/); assert.match(output, /30\s+分鐘/);
  assert.match(output, /config --local-capture\s+off/);
  assert.doesNotMatch(await f.setup(['setup', '--local', '--lang', 'zh']), /明文 Raw/);
});

test('packed failed Codex qualification keeps setup usable, reports waiting, status never probes', { timeout: 150000 }, async t => {
  if (!needCache(t)) return;
  const f = await fixture(t, { failedQualification: true });
  assert.match(await f.setup(), /Codex capture waits for format qualification/);
  assert.ok((await f.descriptor()).clients.codex);
  const hooks = await f.native('codex');
  for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop', 'PreCompact']) assert.ok(hooks.hooks[event]);
  assert.equal((await json(join(f.root, 'capture/codex/installation.json'))).phase, 'active');
  assert.ok((await lstat(join(f.root, 'capture/codex/identity.key'))).isFile());
  const before = await readFile(f.calls.codex, 'utf8');
  const status = await f.setup(['status']);
  assert.match(status, /Codex local capture: blocked \(qualification_required\)/);
  assert.match(status, /Codex format qualification: pending \(qualification_pending\)/);
  assert.match(status, /rerun setup after a Codex\s+update/);
  const probes = text => text.split('\n').filter(line => line.includes('generate-json-schema')).length;
  assert.equal(probes(await readFile(f.calls.codex, 'utf8')), probes(before));
  // A real engine background attempt against the failing fake publishes the
  // failed DTO. Exercise its production API rather than forging a cache record.
  const d = await f.descriptor(), receipt = d.clients.codex.vector;
  const engine = join(f.root, 'engine', receipt.engineId, 'app/node_modules/cairn-memory-local-preview');
  assertFixtureClients(f.env, f.ws);
  const failed = await run(receipt.node, ['--input-type=module', '-e',
    `const q=await import(${JSON.stringify(pathToFileURL(join(engine, 'integrations/codex/qualification.mjs')).href)});
     const local=await import(${JSON.stringify(pathToFileURL(join(engine, 'integrations/client/raw/local-codex-qualification.mjs')).href)});
     await local.runLocalQualification(${JSON.stringify(join(f.root, 'capture-support/codex/installation.json'))},await q.resolveCLI(process.env));`],
    { env: f.env, cwd: f.ws });
  assert.equal(failed.code, 0, failed.stderr);
  const afterFailure = await readFile(f.calls.codex, 'utf8');
  const failedStatus = await f.setup(['status']);
  assert.match(failedStatus, /Codex format qualification: failed \(probe_failed\)/);
  assert.match(failedStatus, /rerun setup after a Codex\s+update/);
  assert.equal(probes(await readFile(f.calls.codex, 'utf8')), probes(afterFailure));
});

test('packed --no-capture, config on/off/on and uninstall/setup preserve searchable Raw and identity', { timeout: 150000 }, async t => {
  if (!needCache(t)) return;
  const f = await fixture(t, { codex: false }); await f.setup(['setup', '--local', '--no-capture']);
  assert.match(await f.setup(['status']), /local capture: off/);
  await assert.rejects(f.native('claude'), { code: 'ENOENT' });
  await f.setup(['config', '--local-capture', 'on']);
  const transcript = join(f.home, '.claude/projects/synthetic.jsonl'); await writeFile(transcript, '', { mode: 0o600 });
  await f.hook('SessionStart', transcript); await f.append(transcript, 'copper telescope before disable'); await f.hook('Stop', transcript);
  const reader = await mcp(f, t); await searchCaptured(reader); await reader.close();
  const key = await readFile(join(f.root, 'capture/claude/identity.key'));
  await f.setup(['config', '--local-capture', 'off']); assert.equal((await f.native('claude')).hooks.Stop, undefined);
  await f.append(transcript, 'not captured while off'); await f.setup(['config', '--local-capture', 'on']);
  assert.match(await f.setup(['status']), /local capture: on/);
  const reenabled = await mcp(f, t); await searchCaptured(reenabled); await reenabled.close();
  await f.setup(['uninstall', '--local', '--yes']);
  assert.equal((await f.native('claude')).hooks.Stop, undefined);
  assert.ok((await lstat((await f.descriptor()).database.path)).isFile());
  await f.setup(); assert.match(await f.setup(['status']), /local capture: on/);
  assert.deepEqual(await readFile(join(f.root, 'capture/claude/identity.key')), key);
  const restored = await mcp(f, t); await searchCaptured(restored); await restored.close();
  assert.doesNotMatch(await f.setup(), /Conversation text from this tool/);
});

test('packed real Claude hook reaches MCP Raw search; forget by save time hides source', { timeout: 150000 }, async t => {
  if (!needCache(t)) return;
  const f = await fixture(t, { codex: false }); await f.setup();
  const transcript = join(f.home, '.claude/projects/synthetic.jsonl'); await writeFile(transcript, '', { mode: 0o600 });
  await f.hook('SessionStart', transcript); await f.append(transcript, 'copper telescope synthetic first turn'); await f.hook('Stop', transcript);
  const reader = await mcp(f, t); await searchCaptured(reader);
  const saved = await reader.call('remember_memory', { content: 'Synthetic nearby remembered fact', kind: 'fact' });
  await reader.call('forget_memory', { memoryId: saved.memory.id, expectedRevision: saved.memory.revision });
  const hidden = await reader.search(); assert.doesNotMatch(JSON.stringify(hidden), /copper telescope synthetic first turn/);
  await reader.close();
});

test('packed Claude transcript created after SessionStart captures its first turn', { timeout: 150000 }, async t => {
  if (!needCache(t)) return;
  const f = await fixture(t, { codex: false }); await f.setup();
  const transcript = join(f.home, '.claude/projects/created-later.jsonl');
  await assert.rejects(lstat(transcript), { code: 'ENOENT' });
  await f.hook('SessionStart', transcript); await f.append(transcript, 'copper telescope first turn created after SessionStart'); await f.hook('Stop', transcript);
  const reader = await mcp(f, t); await searchCaptured(reader); await reader.close();
});

test('packed cloud client refuses local setup without local capture', async t => {
  const f = await fixture(t, { cloud: true, codex: false });
  await f.setup(['setup', '--local'], { expected: 2 });
  await assert.rejects(lstat(join(f.root, 'capture')), { code: 'ENOENT' });
  await assert.rejects(f.native('claude'), { code: 'ENOENT' });
});

test('packed 0.6.5 → 0.6.6 upgrade, downgrade search and reinstall round trip', { timeout: 150000 }, async t => {
  if (!needCache(t)) return;
  const f = await fixture(t, { codex: false });
  let old = process.env.CAIRN_SETUP_065_PACKAGE;
  if (!old) {
    const archive = join(f.ws, 'old.tar');
    const result = await run('git', ['archive', '--format=tar', '--output=' + archive, '77bc049e', 'packages/setup'], { cwd: fileURLToPath(new URL('../../../', import.meta.url)) });
    assert.equal(result.code, 0, result.stderr);
    const unpack = await run('tar', ['-xf', archive, '-C', f.ws]); assert.equal(unpack.code, 0, unpack.stderr);
    old = join(f.ws, 'packages/setup');
  }
  await f.setup(['setup', '--local'], { packagePath: old });
  await assert.rejects(lstat(join(f.root, 'capture')), { code: 'ENOENT' });
  const owner = (await f.descriptor()).ownerId;
  await f.setup(); assert.equal((await f.descriptor()).ownerId, owner);
  const transcript = join(f.home, '.claude/projects/upgrade.jsonl'); await writeFile(transcript, '', { mode: 0o600 });
  await f.hook('SessionStart', transcript); await f.append(transcript, 'copper telescope retained through downgrade'); await f.hook('Stop', transcript);
  await f.setup(['setup', '--local'], { packagePath: old });
  // The descriptor now points MCP at the actual older engine, not a renamed new binary.
  const reader = await mcp(f, t); await searchCaptured(reader); await reader.close();
  assert.ok((await f.native('claude')).hooks.Stop, 'old setup leaves newer hooks registered');
  await f.setup(); assert.match(await f.setup(['status']), /local capture: on/);
});
