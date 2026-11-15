import './capture-metadata.test.mjs';
import './raw-wrapper.test.mjs';
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
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.on('error', reject);
    const timer = setTimeout(() => child.kill('SIGKILL'), 150000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    child.stdin.end(input);
  });
}
async function fixture(t, { codex = true, failedQualification = false, cloud = false, interactive = false, platform = process.platform } = {}) {
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
    process.exitCode=await main(process.argv.slice(2),{interactive:${interactive},platform:${JSON.stringify(platform)},prompt:async()=> 'yes'});`);
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
  const append = async (path, text, timestamp = new Date().toISOString()) => appendFile(path, JSON.stringify({ type: 'user', uuid: 'synthetic-' + Date.now(),
    timestamp, promptSource: 'typed', message: { content: [{ type: 'text', text }] } }) + '\n', { mode: 0o600 });
  return { ws: ws.path, home, bin, root, env, pkg, setup, descriptor, native, hook, append, paths, calls };
}
async function mcp(f, t) {
  assertFixtureClients(f.env, f.ws);
  const d = await f.descriptor(), receipt = d.clients.claude.vector;
  const executable = join(f.root, 'engine', receipt.engineId, 'app/node_modules/cairn-memory-local-preview/bin/cairn-memory.mjs');
  const child = spawn(receipt.node, [executable, '--db', d.database.path, '--owner', d.ownerId,
    ...(d.projectId ? ['--project', d.projectId] : [])], { cwd: f.ws, env: f.env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8');
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

async function engineScript(f, source) {
  assertFixtureClients(f.env, f.ws);
  const d = await f.descriptor(), vector = Object.values(d.clients).find(Boolean).vector;
  const engine = join(f.root, 'engine', vector.engineId, 'app/node_modules/cairn-memory-local-preview');
  const result = await run(vector.node, ['--input-type=module', '-e',
    `const path=${JSON.stringify(d.database.path)},engine=${JSON.stringify(pathToFileURL(engine + '/').href)};${source}`],
  { env: f.env, cwd: f.ws });
  assert.equal(result.code, 0, result.stderr); assert.equal(result.signal, null);
  return JSON.parse(result.stdout);
}
// All SQLite access is through node:sqlite, in a dedicated closed child. Never
// read database files through ordinary fs APIs or mix SQLite libraries.
const snapshotDatabase = (f, localOnly = false) => engineScript(f, `
  const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(path,{readOnly:true});
  try {
    const schema=db.prepare("SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name").all()
      .filter(row=>${localOnly ? "row.name.startsWith('local_raw_') || row.name === 'raw_session_fences'" : 'true'});
    const tables=schema.filter(row=>row.type==='table').map(({name})=>[name,
      db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().map(row=>JSON.stringify(row)).sort()]);
    console.log(JSON.stringify({schema,tables}));
  } finally {db.close();}`);

async function oldPackage(f) {
  if (process.env.CAIRN_SETUP_065_PACKAGE) return process.env.CAIRN_SETUP_065_PACKAGE;
  const archive = join(f.ws, 'old.tar');
  const result = await run('git', ['archive', '--format=tar', '--output=' + archive, '77bc049e', 'packages/setup'],
    { cwd: fileURLToPath(new URL('../../../', import.meta.url)) });
  assert.equal(result.code, 0, result.stderr);
  const unpack = await run('tar', ['-xf', archive, '-C', f.ws]); assert.equal(unpack.code, 0, unpack.stderr);
  return join(f.ws, 'packages/setup');
}

async function attestedStore(f, lineage) {
  const { database } = await f.descriptor();
  if (lineage === 1) {
    // Reuse the engine's inherited, frozen base-33 package and offline lineage
    // migration fixture, exactly as existing-safety-startup.test.mjs does.
    const created = await run(process.execPath, [fileURLToPath(new URL(
      '../../../core/testing/create-existing-safety-store.mjs', import.meta.url)), database.path],
    { env: f.env, cwd: f.ws });
    assert.equal(created.code, 0, created.stderr); assert.equal(created.signal, null);
  }
  const attested = await engineScript(f, `const {openMemoryCore}=await import(engine+'core/index.mjs');
    const core=openMemoryCore({path,${lineage === 0 ? "contentSafety:'s2h-v1'," : ''}raw:true,rawSearch:false});await core.close();
    const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(path,{readOnly:true});
    try {console.log(JSON.stringify({physical:db.prepare('PRAGMA user_version').get().user_version,
      control:db.prepare('SELECT base_layout,suppression_revision,card_lineage_revision FROM content_safety_control').get(),
      guard:!!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='local_raw_uuid_delete_guard'").get()}));} finally {db.close();}`);
  assert.deepEqual(attested, { physical: lineage === 1 ? 53 : 48, control: {
    base_layout: 33, suppression_revision: 1, card_lineage_revision: lineage }, guard: true });
}

async function hiddenAndVisibleCapture(f, t) {
  for (const [name, id, timestamp] of [
    ['hidden', session, new Date().toISOString()],
    ['visible', '33333333-3333-4333-8333-333333333333', '2001-01-01T00:00:00.000Z'],
  ]) {
    const transcript = join(f.home, '.claude/projects/' + name + '.jsonl');
    await writeFile(transcript, '', { mode: 0o600 });
    await f.hook('SessionStart', transcript, id);
    await f.append(transcript, 'copper telescope ' + name + ' downgrade sentinel', timestamp);
    await f.hook('Stop', transcript, id);
  }
  const reader = await mcp(f, t);
  // Establish that both sessions were searchable before the real forget hides
  // the near-save-time session; the old-dated control falls outside its window.
  for (const name of ['hidden', 'visible']) {
    let found;
    for (let attempt = 0; attempt < 50; attempt++) {
      found = JSON.stringify(await reader.search());
      if (found.includes(name + ' downgrade sentinel')) break;
      await delay(100);
    }
    assert.ok(found.includes(name + ' downgrade sentinel'), found);
  }
  const { memory } = await reader.call('remember_memory', { content: 'Synthetic downgrade hiding anchor.' });
  await reader.call('forget_memory', { memoryId: memory.id, expectedRevision: memory.revision });
  await reader.close();
  const listed = (await f.setup(['raw', 'list'])).trim().split('\n').map(JSON.parse);
  assert.equal(listed.length, 2);
  assert.equal(listed.filter(row => row.hidden).length, 1);
  const fences = await engineScript(f, `const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(path,{readOnly:true});
    try {console.log(JSON.stringify({fences:db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,
      windows:db.prepare('SELECT count(*) n FROM local_raw_hide_windows').get().n}));} finally {db.close();}`);
  assert.equal(fences.fences, 1); assert.equal(fences.windows, 1);
}

async function assertDowngradeSearch(f, t) {
  const reader = await mcp(f, t);
  await searchCaptured(reader);
  for (const intent of ['current', 'history']) {
    const found = JSON.stringify(await reader.call('read_memory_context', {
      query: 'copper telescope', types: ['memory'], intent, semantic: false, deadlineMs: 5000 }));
    assert.match(found, /visible downgrade sentinel/);
    assert.doesNotMatch(found, /hidden downgrade sentinel/);
  }
  await reader.close();
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
  const clients = process.platform === 'darwin' ? ['claude'] : ['claude', 'codex'];
  const f = await fixture(t, { interactive, codex:clients.includes('codex') });
  const output = await f.setup();
  assert.equal(output.match(/Conversation text from this tool/g)?.length, clients.length);
  if (clients.includes('codex')) assert.match(output, /Codex: approve.*\/hooks/);
  else t.diagnostic('Codex default-on assertions require Linux host qualification; Claude capture runs on macOS.');
  for (const client of clients) {
    const settings = await f.native(client);
    assert.ok(settings.hooks.SessionStart); assert.ok(settings.hooks.Stop); assert.ok(settings.hooks.PreCompact);
    if (client === 'codex') assert.ok(settings.hooks.UserPromptSubmit);
    const capture = await json(join(f.root, 'capture', client, 'capture.json'));
    const d = await f.descriptor(); assert.equal(capture.databasePath, d.database.path);
    assert.equal(capture.authority.namespace.ownerId, d.ownerId);
    assert.equal(capture.interpretation, 'raw-only'); assert.equal(capture.raw.capBytes, 200000000);
    assert.equal(capture.usage.root, join(f.root, 'capture-usage'));
  }
  const before = await Promise.all(clients.map(client => f.native(client)));
  const keys = await Promise.all(clients.map(client => readFile(join(f.root, 'capture', client, 'identity.key'))));
  assert.doesNotMatch(await f.setup(), /Conversation text from this tool/);
  assert.deepEqual(await Promise.all(clients.map(client => f.native(client))), before);
  assert.deepEqual(await Promise.all(clients.map(client => readFile(join(f.root, 'capture', client, 'identity.key')))), keys);
  const probeCount = clients.includes('codex') ? (await readFile(f.calls.codex, 'utf8')).split('\n').filter(line => line.includes('generate-json-schema')).length : 0;
  const status = await f.setup(['status']);
  assert.match(status, /Claude Code local capture: on/); if (clients.includes('codex')) assert.match(status, /Codex local capture: on/);
  assert.match(status, /200,000,000/);
  if (clients.includes('codex')) assert.equal((await readFile(f.calls.codex, 'utf8')).split('\n').filter(line => line.includes('generate-json-schema')).length, probeCount);
});

test('packed Codex zero-history off/on and engine qualification status never probes', { timeout: 150000, skip: process.platform === 'darwin' && 'Codex automatic saving requires Linux /proc host qualification.' }, async t => {
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

test('packed failed Codex qualification keeps setup usable, reports waiting, status never probes', { timeout: 150000, skip: process.platform === 'darwin' && 'Codex automatic saving requires Linux /proc host qualification.' }, async t => {
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

for (const mode of [
  { name: 'native', codex: process.platform !== 'darwin', platform: process.platform },
  { name: 'linux Claude-only, Codex absent', codex: false, platform: 'linux', claudeOnly: true },
  { name: 'darwin Claude-only, Codex absent', codex: false, platform: 'darwin', claudeOnly: true },
  { name: 'darwin Claude-only, Codex present', codex: true, platform: 'darwin', claudeOnly: true },
  { name: 'darwin both registered, Codex capture blocked', codex: true, platform: 'darwin', setupCode: 2 },
]) test(`packed hook → raw list → preview → delete → MCP empty → re-sent copies fenced (${mode.name})`, { timeout: 150000 }, async t => {
  if (!needCache(t)) return;
  const f = await fixture(t, mode); await f.setup(['setup', '--local', '--owner', 'synthetic-raw-owner', '--project', 'synthetic-raw-project',
    ...(mode.claudeOnly ? ['--client', 'claude'] : [])], { expected: mode.setupCode ?? 0 });
  const d = await f.descriptor(), vector = d.clients.claude.vector;
  const executable = join(f.root, 'engine', vector.engineId, 'app/node_modules/cairn-memory-local-preview/bin/cairn-memory.mjs');
  const help = await run(vector.node, [executable, 'raw', '--help'], { env: f.env, cwd: f.ws });
  assert.equal(help.code, 0, help.stderr); assert.equal(help.signal, null);
  assert.match(help.stdout, /raw list/); assert.match(help.stdout, /raw delete/);
  const transcript = join(f.home, '.claude/projects/delete.jsonl'); await writeFile(transcript, '', { mode: 0o600 });
  await f.hook('SessionStart', transcript); await f.append(transcript, 'copper telescope private delete sentinel'); await f.hook('Stop', transcript);
  const reader = await mcp(f, t); await searchCaptured(reader); await reader.close();
  const listed = await f.setup(['raw', 'list']);
  assert.doesNotMatch(listed, /copper|telescope|private delete sentinel/);
  const rows = listed.trim().split('\n').map(JSON.parse); assert.equal(rows.length, 1);
  const row = rows[0], id = row.id;
  assert.deepEqual(Object.keys(row).sort(), ['id','client','firstEventAt','lastEventAt','messageCount','byteCount','fenced','hidden'].sort());
  assert.equal(row.client, 'claude-code'); assert.equal(row.messageCount, 1); assert.ok(row.byteCount > 0);
  assert.ok(Date.parse(row.firstEventAt)); assert.ok(Date.parse(row.lastEventAt));
  assert.equal(await f.setup(['raw', 'list', '--client', 'claude']), listed);
  if (d.clients.codex) assert.equal(await f.setup(['raw', 'list', '--client', 'codex']), '');
  else await f.setup(['raw', 'list', '--client', 'codex'], { expected: 2 });
  const before = await snapshotDatabase(f);
  const preview = await f.setup(['raw', 'delete', id]);
  assert.doesNotMatch(preview, /copper|telescope|private delete sentinel/);
  const dry = JSON.parse(preview); assert.equal(dry.dryRun, true);
  for (const key of ['client','firstEventAt','lastEventAt','messageCount','byteCount']) assert.equal(dry[key], row[key]);
  assert.deepEqual(await snapshotDatabase(f), before);
  assert.match(await f.setup(['raw', 'delete', 'unknown-conversation', '--yes'], { expected: 1 }), /conversation_not_found/);
  assert.deepEqual(await snapshotDatabase(f), before);
  for (const args of [['raw','delete'], ['raw','delete','*','--yes'], ['raw','delete',id,id,'--yes'],
    ['raw','delete',id,'--all'], ['raw','list','--yes'], ['raw','delete',id,'--db','/synthetic-override']])
    await f.setup(args, { expected: 2 });
  assert.deepEqual(await snapshotDatabase(f), before);
  const deleted = await f.setup(['raw', 'delete', id, '--yes']);
  assert.equal(JSON.parse(deleted).dryRun, false); assert.doesNotMatch(deleted, /copper|telescope|private delete sentinel/);
  const fences = () => engineScript(f, `const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(path,{readOnly:true});
    try {console.log(JSON.stringify({sessions:db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,
      uuids:db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n}));} finally {db.close();}`);
  const deletedFences = await fences(); assert.equal(deletedFences.sessions, 1); assert.ok(deletedFences.uuids > 0);
  const checkEmpty = async () => {
    const current = await mcp(f, t);
    for (const intent of ['current','history']) {
      const found = await current.call('read_memory_context', { query: 'copper telescope', types: ['memory'], intent, semantic: false, deadlineMs: 5000 });
      assert.doesNotMatch(JSON.stringify(found), /private delete sentinel/);
    }
    await current.close();
    const remaining = (await f.setup(['raw','list'])).trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.ok(remaining.every(value => value.messageCount === 0));
  };
  await checkEmpty();
  // Resume the same wire session, then a fork with exactly the same message
  // uuid. Invoke the real generated commands rather than the capture API.
  const resent = await readFile(transcript, 'utf8');
  await f.hook('SessionStart', transcript); await appendFile(transcript, resent); await f.hook('Stop', transcript); await checkEmpty();
  const fork = join(f.home, '.claude/projects/delete-fork.jsonl'); await writeFile(fork, '', { mode: 0o600 });
  await f.hook('SessionStart', fork, '22222222-2222-4222-8222-222222222222');
  await appendFile(fork, resent);
  await f.hook('Stop', fork, '22222222-2222-4222-8222-222222222222'); await checkEmpty();
  assert.equal((await fences()).sessions, 2, 'UUID-fenced copy terminally fences its fork session');
});

test('packed installer forwards multi-pass deletion progress for 320 Claude UUID messages', { timeout: 150000 }, async t => {
  if (!needCache(t)) return;
  const f = await fixture(t, { codex: false }); await f.setup();
  const transcript = join(f.home, '.claude/projects/large-delete.jsonl');
  await writeFile(transcript, '', { mode: 0o600 }); await f.hook('SessionStart', transcript);
  await f.append(transcript, 'synthetic large deletion message'); await f.hook('Stop', transcript);
  // Match the engine's largeConversation fixture: one real capture supplies the
  // schema-valid row; synthetic UUID rows exercise bounded deletion preparation
  // without timing ten separate native hook runs on a loaded machine.
  await engineScript(f, `const {DatabaseSync}=await import('node:sqlite'),{randomUUID}=await import('node:crypto');
    const db=new DatabaseSync(path);
    try {
      const row=db.prepare('SELECT * FROM raw_messages').get(),keys=Object.keys(row);
      const insert=db.prepare('INSERT INTO raw_messages('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')');
      db.exec('BEGIN');
      try {
        for(let n=2;n<=320;n++)insert.run(...keys.map(key=>key==='message_id'?randomUUID():key==='ordinal'?n*2:row[key]));
        db.exec('COMMIT');
      } catch(error){db.exec('ROLLBACK');throw error;}
      console.log(JSON.stringify({seeded:320}));
    } finally {db.close();}`);
  const row = JSON.parse((await f.setup(['raw', 'list'])).trim());
  assert.equal(row.messageCount, 320, 'all UUID messages present before deletion');
  const result = await run(process.execPath, [join(f.ws, 'setup.mjs'), 'raw', 'delete', row.id, '--yes'], { env: f.env, cwd: f.ws });
  assert.equal(result.code, 0, result.stdout + result.stderr); assert.equal(result.signal, null);
  assert.equal(JSON.parse(result.stdout).dryRun, false);
  const progress = result.stderr.trimEnd().split('\n');
  assert.ok(progress.length >= 2, 'more than one bounded preparation pass');
  assert.ok(progress.every(line => /^(?:0|[1-9]\d{0,2}(?:,\d{3})*)\/320 prepared$/.test(line)), result.stderr);
  assert.equal((await f.setup(['raw', 'list'])).trim(), '');
});

test('packed cloud client refuses local setup without local capture', async t => {
  const f = await fixture(t, { cloud: true, codex: false });
  await f.setup(['setup', '--local'], { expected: 2 });
  for (const args of [['raw','list'], ['raw','list','--client','claude'], ['raw','delete','unknown','--yes']])
    assert.match(await f.setup(args, { expected: 2 }), /unavailable\s+in\s+cloud\s+mode/);
  await assert.rejects(lstat(join(f.root, 'capture')), { code: 'ENOENT' });
  await assert.rejects(f.native('claude'), { code: 'ENOENT' });
});

test('packed raw management refuses an absent local installation', async t => {
  const f = await fixture(t, { codex: false });
  for (const args of [['raw','list'], ['raw','delete','unknown','--yes']])
    assert.match(await f.setup(args, { expected: 2 }), /requires\s+an\s+installed\s+local\s+client/);
  await assert.rejects(lstat(join(f.root, 'data')), { code: 'ENOENT' });
});

for (const store of ['ordinary', 'attested lineage 0']) test(`packed ${store}: 0.6.5 reads captured Raw, keeps hidden search fenced, and reinstalls`, { timeout: 150000 }, async t => {
  if (!needCache(t)) return;
  const f = await fixture(t, { codex: false });
  const old = await oldPackage(f);
  await f.setup(['setup', '--local'], { packagePath: old });
  await assert.rejects(lstat(join(f.root, 'capture')), { code: 'ENOENT' });
  const initial = await f.native('claude').catch(error => { if (error.code === 'ENOENT') return {}; throw error; });
  assert.equal(initial.hooks?.Stop, undefined, '0.6.5 itself installs no automatic capture hook');
  const owner = (await f.descriptor()).ownerId;
  await f.setup(['setup', '--local', '--no-capture']); assert.equal((await f.descriptor()).ownerId, owner);
  if (store === 'attested lineage 0') await attestedStore(f, 0);
  await f.setup(['config', '--local-capture', 'on']);
  await hiddenAndVisibleCapture(f, t);
  // Stop the newer hooks before going back, so all downgraded reads below are
  // solely the old engine, with no retained newer capture process in play.
  await f.setup(['config', '--local-capture', 'off']);
  const localTables = await snapshotDatabase(f, true);
  assert.ok(localTables.tables.length > 0);
  await f.setup(['setup', '--local'], { packagePath: old });
  // The descriptor now points MCP at the actual older engine, not a renamed new binary.
  assert.match((await f.descriptor()).clients.claude.vector.engineId, /^0\.6\.5-/);
  await assertDowngradeSearch(f, t);
  assert.deepEqual(await snapshotDatabase(f, true), localTables, '0.6.5 preserves the new local tables and existing session fences');
  assert.equal((await f.native('claude')).hooks?.Stop, undefined, '0.6.5 does not enable capture');
  await f.setup();
  await f.setup(['config', '--local-capture', 'on']);
  assert.match(await f.setup(['status']), /local capture:\s+on/);
  await assertDowngradeSearch(f, t);
});

test('packed attested base-33 lineage-1 store refuses 0.6.5 after Raw open; reinstall restores access', { timeout: 150000 }, async t => {
  if (!needCache(t)) return;
  const f = await fixture(t, { codex: false });
  await f.setup(['setup','--local','--no-capture']);
  await attestedStore(f, 1);
  await f.setup(['config','--local-capture','on']);
  const transcript = join(f.home, '.claude/projects/attested.jsonl'); await writeFile(transcript, '', { mode: 0o600 });
  await f.hook('SessionStart', transcript); await f.append(transcript, 'copper telescope attested downgrade sentinel'); await f.hook('Stop', transcript);
  const current = await mcp(f, t); await searchCaptured(current); await current.close();
  const before = await snapshotDatabase(f);
  const hooksBefore = (await f.native('claude')).hooks;
  const old = await oldPackage(f); await f.setup(['setup','--local'], { packagePath: old });
  assert.match((await f.descriptor()).clients.claude.vector.engineId, /^0\.6\.5-/);
  assert.deepEqual((await f.native('claude')).hooks, hooksBefore, '0.6.5 setup leaves newer capture hooks registered');
  const refusal = await engineScript(f, `const {openMemoryCore}=await import(engine+'core/index.mjs');
    try {const core=openMemoryCore({path,raw:true,rawSearch:false});await core.close();console.log(JSON.stringify({opened:true}));}
    catch(error){console.log(JSON.stringify({code:error.code}));}`);
  assert.deepEqual(refusal, { code: 'unsupported_database' });
  assert.deepEqual(await snapshotDatabase(f), before, 'refused old open changes nothing');
  await f.setup();
  const restored = await mcp(f, t); await searchCaptured(restored); await restored.close();
});

for (const action of ['setup-opt-out', 'config-off']) test(`packed ${action} prints only off capture status and retains it in status`, { timeout:150000 }, async t => {
  if (!needCache(t)) return;
  const f = await fixture(t);
  const initial = await f.setup(['setup', '--local', '--no-capture']);
  if (action === 'config-off') assert.match(await f.setup(['config', '--local-capture', 'on', '--client', 'claude']), /Claude Code local capture: on/);
  const output = action === 'setup-opt-out' ? initial : await f.setup(['config', '--local-capture', 'off']);
  assert.doesNotMatch(output, /on by default|approve the new entries|format qualification/);
  for (const client of ['Claude Code', 'Codex']) assert.ok(output.includes(`${client} local capture: off (off)`));
  // Simulate an unavailable retained runtime: stored off must not become blocked.
  const settingsPath = join(f.root, 'capture-settings.json'), settings = await json(settingsPath);
  for (const receipt of Object.values(settings.clients)) receipt.node = join(f.ws, 'missing-node');
  await writeFile(settingsPath, JSON.stringify(settings), { mode:0o600 });
  const status = await f.setup(['status']);
  for (const client of ['Claude Code', 'Codex']) assert.ok(status.includes(`${client} local capture: off (off)`));
  assert.doesNotMatch(status, /local capture: blocked|approve the new entries/);
});

for (const lang of ['en', 'zh']) test(`packed macOS Codex stays unavailable with the Claude setup hint (${lang})`, {
  timeout:150000, skip:process.platform !== 'darwin' && 'Requires the real macOS installer and engine.'
}, async t => {
  if (!needCache(t)) return;
  const f = await fixture(t);
  const output = await f.setup(['setup', '--local', '--lang', lang], { expected:2 });
  assert.match(output, /npx @cairn-ink\/memory setup --local --client\s+claude/);
  assert.match(output.trimEnd().split('\n').at(-1), /qualification_required/);
  const status = await f.setup(['status', '--lang', lang]);
  assert.match(status, /qualification_required/);
});
