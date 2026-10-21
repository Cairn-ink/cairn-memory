import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';
import { binaryIdentity, canonical, KNOWN_FORMATS } from '../../integrations/codex/qualification.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const preload = fileURLToPath(new URL('./fixtures/local-oneshot.mjs', import.meta.url));
const driver = fileURLToPath(new URL('./fixtures/local-host.mjs', import.meta.url));
const childPreload = fileURLToPath(new URL('./fixtures/local-host-child.mjs', import.meta.url));
const policy = 'append-matching-evidence-v1', sha = bytes => createHash('sha256').update(bytes).digest('hex');
const rows = path => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
function walk(path, prefix = '') {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(join(path, entry.name), prefix + entry.name + '/') : [prefix + entry.name]).sort();
}
function sourceClosure() {
  const queue = ['adapters/local/cli.mjs', 'integrations/client/raw/local-host-cli.mjs'], seen = new Set();
  while (queue.length) {
    const path = queue.pop(); if (seen.has(path)) continue; seen.add(path); if (!path.endsWith('.mjs')) continue;
    const text = readFileSync(join(root, path), 'utf8');
    for (const match of [...text.matchAll(/\b(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g),
      ...text.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)]) {
      const next = relative(root, resolve(root, dirname(path), match[1])); assert.equal(next.startsWith('..'), false);
      if (!lstatSync(join(root, next)).isDirectory()) queue.push(next);
    }
  }
  return [...seen].sort();
}

async function fixture(t, client, selected) {
  const workspace = createTestWorkspace(t, { prefix: 'installed-qualified-duplicates-' });
  const home = join(workspace.path, 'home'), usage = join(workspace.path, 'usage');
  mkdirSync(home, { mode: 0o700 }); mkdirSync(usage, { mode: 0o700 });
  const artifact = buildArtifact(), closure = sourceClosure();
  writeFileSync(join(workspace.path, 'package.json'), JSON.stringify({ name: 'synthetic-qualified-duplicates', version: '0.0.0', private: true }), { mode: 0o600 });
  command('npm', ['install', '--prefix', workspace.path, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], workspace.path, artifact.userconfig);
  const installed = join(workspace.path, 'node_modules', packageName), configPath = join(workspace.path, 'config.json'), database = join(workspace.path, 'memory.sqlite');
  const archived = command('tar', ['-tzf', artifact.artifactPath], workspace.path, artifact.userconfig).trim().split('\n').map(path => path.slice('package/'.length)).sort();
  const manifest = [...JSON.parse(readFileSync(join(installed, 'package.json'))).files].sort();
  assert.deepEqual(archived, manifest); assert.deepEqual(walk(installed), archived);
  for (const path of closure) { assert.ok(archived.includes(path)); assert.deepEqual(readFileSync(join(installed, path)), readFileSync(join(root, path))); }
  for (const [path, expected] of Object.entries(artifact.sourceHashes)) assert.equal(sha(readFileSync(join(installed, path))), expected);
  const scaffold = { PATH: dirname(process.execPath), HOME: home, TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path,
    NODE_DISABLE_COMPILE_CACHE: '1', NODE_NO_WARNINGS: '1', SYNTHETIC_INSTALLED: installed, SYNTHETIC_CLIENT: client,
    SYNTHETIC_DATABASE: database, SYNTHETIC_CONFIG: configPath, SYNTHETIC_USAGE: usage, SYNTHETIC_TRACE: join(workspace.path, 'http.jsonl'),
    SYNTHETIC_CORE: join(installed, 'core/index.mjs'), SYNTHETIC_MODE: 'memory' };
  let phase = 0; const processReceipts = [];
  function direct(args, key = false) {
    const imports = join(workspace.path, 'direct-' + phase++ + '.jsonl');
    const result = spawnSync(process.execPath, args, { cwd: workspace.path, encoding: 'utf8', timeout: 15000,
      maxBuffer: 262144, env: { ...scaffold, SYNTHETIC_IMPORT_TRACE: imports,
        ...(key ? { SYNTHETIC_LOCAL_KEY: 'synthetic_key_secret' } : {}) } });
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr); assert.equal(result.signal, null);
    processReceipts.push({ phase: 'direct', pid: result.pid, code: result.status, signal: result.signal }); return result;
  }
  direct([preload, 'prepare']);
  const config = JSON.parse(readFileSync(configPath)); config.provider.apiKeyEnv = 'CAIRN_SYNTHETIC_API_KEY';
  if (selected) config.captureQualifiedDuplicates = policy;
  writeFileSync(configPath, JSON.stringify(config));
  const pluginRoot = join(workspace.path, 'plugin'), qroot = join(workspace.path, 'codex-install'), qdir = join(qroot, 'qualification');
  mkdirSync(pluginRoot, { mode: 0o700 }); mkdirSync(qroot, { mode: 0o700 }); mkdirSync(qdir, { mode: 0o700 });
  const qualificationConfigPath = join(qroot, 'installation.json'); writeFileSync(qualificationConfigPath, '{}', { mode: 0o600 });
  const binary = join(workspace.path, 'codex'); writeFileSync(binary, 'synthetic native binary', { mode: 0o700 });
  const identity = await binaryIdentity(binary);
  writeFileSync(join(qdir, identity + '.json'), JSON.stringify({ policy: sha(canonical(KNOWN_FORMATS)), identity,
    version: '0.162.0', status: 'qualified', fingerprint: KNOWN_FORMATS[1] }), { mode: 0o600 });
  const stateRoot = join(workspace.path, 'state'), identityKeyPath = join(workspace.path, 'identity-key'), profilePath = join(workspace.path, 'profile.json');
  const profile = { version: 'local-raw-host-profile-v1', configPath, configDigest: sha(readFileSync(configPath)), stateRoot, identityKeyPath, home,
    installation: client === 'claude-code' ? { client, pluginRoot } : { client, qualificationConfigPath } };
  writeFileSync(profilePath, JSON.stringify(profile), { mode: 0o600 });
  const sources = ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'].map((sessionId, index) => {
    const path = join(workspace.path, 'source-' + index + '.jsonl'), text = 'Synthetic distinct retained source ' + index + '. Ａ🙂';
    const header = client === 'codex' ? JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cli_version: '0.162.0',
      history_mode: 'paginated', source: 'cli', originator: 'codex-tui' } }) + '\n' : '';
    const row = client === 'claude-code' ? { type: 'user', uuid: 'synthetic-message-' + index, timestamp: null, promptSource: 'typed', message: { content: [{ type: 'text', text }] } }
      : { type: 'event_msg', timestamp: null, payload: { type: 'item_completed', thread_id: sessionId, turn_id: 'synthetic-turn-' + index,
        item: { type: 'UserMessage', id: 'native-message-' + index, content: [{ type: 'text', text }] } } };
    writeFileSync(path, header + JSON.stringify(row) + '\n', { mode: 0o600 }); return { path, sessionId };
  });
  function invoke(action, index = 0, { key = true, expected = 0 } = {}) {
    const trace = join(workspace.path, 'host-' + phase++ + '.jsonl'), settings = trace + '.settings.json';
    const source = sources[index], args = [action, ...(['initialize','run'].includes(action)
      ? ['--session', source.sessionId, '--source', source.path, ...(action === 'initialize' ? ['--start', 'beginning'] : [])] : [])];
    writeFileSync(settings, JSON.stringify({ installed, profilePath, args, trace, scaffold, mode: 'memory', syntheticBinary: binary, preload: childPreload }), { mode: 0o600 });
    const result = spawnSync(process.execPath, [driver, settings], { cwd: workspace.path, encoding: 'utf8', timeout: 20000, maxBuffer: 262144,
      env: { PATH: dirname(process.execPath), HOME: home, TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path,
        NODE_DISABLE_COMPILE_CACHE: '1', NODE_NO_WARNINGS: '1', ...(key ? { CAIRN_SYNTHETIC_API_KEY: 'synthetic_key_secret' } : {}) } });
    assert.equal(result.error, undefined); assert.equal(result.status, expected, result.stderr + result.stdout); assert.equal(result.signal, null);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic_source_secret|synthetic_key_secret/);
    const events = rows(trace), spawned = events.filter(row => row.kind === 'spawn'), closed = events.filter(row => row.kind === 'close');
    assert.deepEqual(spawned.map(row => row.pid).sort(), closed.map(row => row.pid).sort());
    for (const row of closed) { assert.equal(row.code, 0); assert.equal(row.signal, null); }
    processReceipts.push({ phase: action, pid: result.pid, code: result.status, signal: result.signal, children: closed });
    return JSON.parse(result.stdout);
  }
  function inspect() {
    const script = `const {openMemoryCore}=await import(process.env.SYNTHETIC_CORE);
const core=openMemoryCore({path:process.env.SYNTHETIC_DATABASE,rawConversations:{mode:'off',readPolicy(){throw Error('capture forbidden')}}});
try{const namespace={ownerId:'synthetic-installed-local',scope:'personal',projectId:null};
const list=core.list({namespace});if(!list.ok)throw Error('inspection failed');
const memories=list.value.memories.map(memory=>{const value=core.get({namespace,memoryId:memory.id,includeQualification:true});if(!value.ok)throw Error('inspection failed');return value.value});
const conversations=core.listRawConversations({namespace,client:process.env.SYNTHETIC_CLIENT});if(!conversations.ok)throw Error('discovery failed');
console.log(JSON.stringify({pid:process.pid,memories,conversations:conversations.value.conversations}));}finally{core.close()}`;
    return JSON.parse(direct(['--import', preload, '--input-type=module', '-e', script]).stdout);
  }
  function observedClosure() {
    const seen = new Set();
    for (const name of readdirSync(workspace.path).filter(name => /^(direct-|host-|child-).*\.jsonl$/.test(name))) {
      for (const row of rows(join(workspace.path, name))) if (row.path?.startsWith(installed + '/')) seen.add(relative(installed, row.path));
    }
    return [...seen].sort();
  }
  return { workspace, artifact, config, configPath, profile, profilePath, stateRoot, identityKeyPath, invoke, inspect,
    calls: () => rows(scaffold.SYNTHETIC_TRACE).length, processReceipts, closure, observedClosure,
    inventory: { archive: archived.length, installed: manifest.length } };
}

for (const client of ['claude-code','codex']) for (const selected of [false,true]) {
  test(`QD-08 installed ${client} ${selected ? 'selected policy preserves one Memory and both sources' : 'default new source remains incomplete'}`, { timeout: 120000 }, async t => {
    const f = await fixture(t, client, selected);
    assert.equal(f.invoke('prepare').reason, 'prepared'); f.invoke('initialize'); f.invoke('run');
    const first = f.inspect(); assert.equal(first.memories.length, 1); const original = first.memories[0], id = original.memory.id;
    f.invoke('initialize', 1);
    const second = f.invoke('run', 1, { expected: selected ? 0 : 2 });
    if (!selected) assert.equal(second.reason, 'interpretation_incomplete');
    const current = f.inspect(); assert.equal(current.memories.length, 1); assert.equal(current.memories[0].memory.id, id);
    assert.equal(current.memories[0].receipts.length, selected ? 2 : 1); assert.deepEqual(current.memories[0].qualification, original.qualification);
    assert.equal(current.conversations.length, 2);
    const calls = f.calls(); f.invoke('run', 0, { key: false }); f.invoke('run', 1, { key: false, expected: selected ? 0 : 2 });
    assert.equal(f.calls(), calls); assert.deepEqual(f.inspect().memories, current.memories);
    const observed = f.observedClosure(); assert.deepEqual(observed, f.closure);
    t.diagnostic(JSON.stringify({ client, selected, ...f.inventory, closure: f.closure.length, observed: observed.length,
      sourceSessions: 2, originalQualificationPreserved: true, replayProviderCalls: 0, processes: f.processReceipts }));
    await f.workspace.cleanup(); assert.equal(existsSync(f.workspace.path), false);
  });
}

test('QD-08 installed changed config or refreshed profile digest never rearms old preparation', { timeout: 120000 }, async t => {
  const f = await fixture(t, 'codex', false); f.invoke('prepare');
  const markerPath = f.profilePath + '.prepared.json', marker = readFileSync(markerPath), key = readFileSync(f.identityKeyPath);
  const before = f.inspect(), calls = f.calls(); f.config.captureQualifiedDuplicates = policy; writeFileSync(f.configPath, JSON.stringify(f.config));
  assert.equal(f.invoke('status', 0, { key: false, expected: 2 }).reason, 'config_invalid');
  f.profile.configDigest = sha(readFileSync(f.configPath)); writeFileSync(f.profilePath, JSON.stringify(f.profile));
  for (const action of ['status','prepare']) assert.equal(f.invoke(action, 0, { key: false, expected: 2 }).reason, 'preparation_invalid');
  assert.deepEqual(readFileSync(markerPath), marker); assert.deepEqual(readFileSync(f.identityKeyPath), key);
  assert.deepEqual(f.inspect().memories, before.memories); assert.equal(f.calls(), calls);
  t.diagnostic(JSON.stringify({ processes: f.processReceipts, providerCalls: 0, preparationUnchanged: true }));
  await f.workspace.cleanup(); assert.equal(existsSync(f.workspace.path), false);
});
