import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir, chmod, symlink, unlink, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { resolveClient, clientProjectId, initializePairing, completePairing, stateLocations, detectClients, localLiveness, parsePairingRecord, resetIdentity } from '../pairing.mjs';
import { projectKey } from '../identity.mjs';
import { privateWrite } from '../private-state.mjs';
import { captureCursorPath, writeCaptureCursor } from '../capture-cursor.mjs';
import { readControlState, setPaused, startIfActive, runIfActive } from '../control-state.mjs';

const moduleURL = new URL('../pairing.mjs', import.meta.url).href;
const key = '12345678-1234-4234-8234-123456789abc';
async function fixture(t, extra = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cx2-pairing-' });
  const home = join(workspace.path, 'home');
  await mkdir(home, { mode: 0o700 });
  return { home, temporary: workspace.path, env: { HOME: home }, standardClaudeOrigin: true, ...extra };
}
async function seed(root) { await mkdir(root, { recursive: true, mode: 0o700 }); await writeFile(join(root, 'project-key'), `${key}\n`, { mode: 0o600 }); }
async function paired(t, extra = {}) {
  const options = await fixture(t, { hostsStopped: true, consent: { claude: true, codex: true }, ...extra });
  const pending = await initializePairing(options);
  const result = await completePairing({ ...options, configured: { claude: true, codex: true } });
  assert.equal(pending.status, 'binding_pending'); assert.equal(result.status, 'paired');
  return { ...options, pairingRecord: result.pairingRecord };
}
async function child(options, { client = 'claude', code, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--input-type=module', '-e', code ??
      `import {clientProjectId} from ${JSON.stringify(moduleURL)}; console.log(await clientProjectId(${JSON.stringify({ ...options, client })}, '/synthetic/project'));`],
    { env: { PATH: process.env.PATH, HOME: options.home, TMPDIR: process.env.TMPDIR,
      NODE_OPTIONS: process.env.NODE_OPTIONS, CAIRN_TEST_REAL_HOME: process.env.CAIRN_TEST_REAL_HOME,
      CLAUDE_PLUGIN_DATA: options.env.CLAUDE_PLUGIN_DATA ?? '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', b => stdout += b); proc.stderr.on('data', b => stderr += b);
    proc.on('error', reject); proc.on('close', code => resolve({ code, stdout: stdout.trim(), stderr }));
  });
}

test('fresh single clients, same-client contenders, restart, deletion and exact HMAC scope', async t => {
  for (const client of ['claude', 'codex']) {
    const options = await fixture(t, { client });
    const results = await Promise.all(Array.from({ length: 18 }, () => child(options, { client })));
    assert.ok(results.every(result => result.code === 0), JSON.stringify(results));
    assert.equal(new Set(results.map(result => result.stdout)).size, 1);
    const id = results[0].stdout;
    assert.equal(await clientProjectId(options, '/synthetic/project'), id);
    assert.notEqual(await clientProjectId(options, '/synthetic/Project'), id);
    const root = (await resolveClient(options)).root;
    await unlink(join(root, 'project-key'));
    assert.notEqual(await clientProjectId(options, '/synthetic/project'), id);
  }
});

test('concurrent separate clients elect one initializer and disable the newcomer', async t => {
  const options = await fixture(t);
  const results = await Promise.all(['claude', 'codex'].map(client => child(options, { client })));
  assert.equal(results.filter(result => result.code === 0).length, 1);
  assert.match(results.find(result => result.code !== 0).stderr, /pairing_needed/);
  const metadata = JSON.parse(await readFile(stateLocations(options).install));
  assert.equal(Object.keys(metadata.clients).length, 1);
});

test('known released plugin path and legacy default key need adoption for Codex', async t => {
  for (const known of ['knownClaudeRoot', 'defaultRoot']) {
    const options = await fixture(t);
    const root = stateLocations(options)[known];
    await seed(root);
    assert.equal((await resolveClient({ ...options, client: 'codex', initialize: true })).enabled, false);
    assert.equal(await readFile(join(root, 'project-key'), 'utf8'), `${key}\n`);
    const claude = { ...options, env: { HOME: options.home, CLAUDE_PLUGIN_DATA: root } };
    assert.equal((await resolveClient(claude)).enabled, true);
    assert.ok(await clientProjectId(claude, '/synthetic/project'));
  }
});

test('undetermined origins ask before any writes; yes requires adoption; no allows fresh', async t => {
  for (const origin of ['inline', 'synced', 'relocated']) {
    const options = await fixture(t, { standardClaudeOrigin: false, origin, hostsStopped: true, consent: { claude: true, codex: true } });
    assert.equal((await initializePairing(options)).status, 'claude_confirmation_needed');
    assert.deepEqual(await readdir(options.home), []);
    assert.equal((await initializePairing({ ...options, usesClaude: true })).status, 'pairing_needed');
    assert.deepEqual(await readdir(options.home), []);
    assert.equal((await initializePairing({ ...options, usesClaude: false })).status, 'binding_pending');
  }
});

test('two established keys retain separate IDs and both expose conflict', async t => {
  const options = await fixture(t, { client: 'codex' });
  const codexId = await clientProjectId(options, '/synthetic/project');
  const root = stateLocations(options).knownClaudeRoot;
  await seed(root);
  const claude = { ...options, client: 'claude', env: { HOME: options.home, CLAUDE_PLUGIN_DATA: root } };
  const claudeId = await clientProjectId(claude, '/synthetic/project');
  assert.notEqual(claudeId, codexId);
  for (const input of [options, claude]) {
    const binding = await resolveClient(input);
    assert.equal(binding.status, 'pairing_needed'); assert.equal(binding.enabled, true);
  }
  const consent = { claude: true, codex: true };
  await initializePairing({ ...options, root, adopt: true, consent, hostsStopped: true });
  const ready = await completePairing({ ...options, configured: consent, hostsStopped: true });
  assert.equal(await clientProjectId({ ...options, pairingRecord: ready.pairingRecord }, '/synthetic/project'), claudeId);
  assert.equal(await readFile(join(stateLocations(options).defaultRoot, 'project-key'), 'utf8').then(s => s.trim()).then(s => s.length), 36);
});

test('legacy gap: only Claude cursors count, preserve root despite new plugin data, confirmation adopts', async t => {
  for (const evidence of [false, true]) {
    const options = await fixture(t, { client: 'codex' });
    const id = await clientProjectId(options, '/synthetic/project');
    const root = stateLocations(options).defaultRoot;
    // Shared writes must not establish Claude.
    await setPaused(root, true); await setPaused(root, false);
    await privateWrite(join(root, 'install-id'), `${key}\n`);
    if (evidence) await writeCaptureCursor(captureCursorPath(root, 'synthetic-claude'), { offset: 0 });
    const newRoot = join(options.home, 'new-plugin-data');
    const claude = { ...options, client: 'claude', env: { HOME: options.home, CLAUDE_PLUGIN_DATA: newRoot } };
    const result = await resolveClient({ ...claude, initialize: true });
    assert.equal(result.status, 'pairing_needed'); assert.equal(result.enabled, evidence);
    if (evidence) {
      assert.equal(result.root, root); assert.equal(await clientProjectId(claude, '/synthetic/project'), id);
      assert.equal((await resolveClient(options)).status, 'pairing_needed');
    }
    await assert.rejects(stat(newRoot), { code: 'ENOENT' });
    const consent = { claude: true, codex: true };
    await initializePairing({ ...options, adopt: true, hostsStopped: true, consent });
    const ready = await completePairing({ ...options, hostsStopped: true, configured: consent });
    assert.equal(await clientProjectId({ ...claude, pairingRecord: ready.pairingRecord }, '/synthetic/project'), id);
  }
});

test('joint pending guard, >16 mixed processes, restart, loss and original-key restore', async t => {
  const options = await paired(t);
  const runs = async () => Promise.all(Array.from({ length: 20 }, (_, i) => child(options, { client: i % 2 ? 'claude' : 'codex' })));
  const first = await runs(); const restarted = await runs();
  assert.ok([...first, ...restarted].every(result => result.code === 0), JSON.stringify([...first, ...restarted]));
  assert.equal(new Set([...first, ...restarted].map(result => result.stdout)).size, 1);
  const root = stateLocations(options).defaultRoot;
  const bytes = await readFile(join(root, 'project-key'));
  await unlink(join(root, 'project-key'));
  for (const client of ['claude', 'codex']) assert.equal((await resolveClient({ ...options, client })).status, 'paired_key_missing');
  await writeFile(join(root, 'project-key'), bytes, { mode: 0o600 });
  assert.equal(await clientProjectId(options, '/synthetic/project'), first[0].stdout);
});

test('crash checkpoints keep joint clients pending and retry reuses the published winner', async t => {
  for (const checkpoint of ['binding-written', 'temporary-written', 'published', 'initialized']) {
    const options = await fixture(t, { hostsStopped: true, consent: { claude: true, codex: true } });
    const result = await child(options, { code: `import {initializePairing} from ${JSON.stringify(moduleURL)};
      await initializePairing({...${JSON.stringify(options)}, checkpoint: async stage => {if(stage === ${JSON.stringify(checkpoint)}) process.exit(73);}});` });
    assert.equal(result.code, 73, result.stderr);
    let published;
    try { published = await readFile(join(stateLocations(options).defaultRoot, 'project-key'), 'utf8'); } catch (error) { assert.equal(error.code, 'ENOENT'); }
    for (const client of ['claude', 'codex']) assert.equal((await resolveClient({ ...options, client })).enabled, false);
    const pending = await initializePairing(options);
    if (published) assert.equal(await readFile(join(pending.root, 'project-key'), 'utf8'), published);
    await completePairing({ ...options, configured: options.consent });
    assert.ok(await clientProjectId({ ...options, pairingRecord: pending.pairingRecord }, '/synthetic/project'));
  }
});

test('exclusive key publication reads winner, syncs, and cleans only owned temporary files', async t => {
  const options = await fixture(t); const root = stateLocations(options).defaultRoot;
  await mkdir(root, { mode: 0o700 }); await writeFile(join(root, '.foreign.tmp'), 'retained', { mode: 0o600 });
  const winner = await projectKey(root, { checkpoint: async stage => {
    if (stage === 'temporary-written') await writeFile(join(root, 'project-key'), `${key}\n`, { mode: 0o600, flag: 'wx' });
  } });
  assert.equal(winner, key); assert.deepEqual((await readdir(root)).sort(), ['.foreign.tmp', 'project-key']);
});

test('coordination paths, missing home refusal, temporary standalone fallback', async t => {
  const options = await fixture(t);
  const paths = stateLocations(options);
  assert.equal(paths.install, join(options.home, '.cairn-memory-clients/install.json'));
  assert.equal(paths.pairing, join(options.home, '.cairn-memory-clients/pairing.json'));
  assert.equal(paths.lock, join(options.home, '.cairn-memory-clients/setup.lock'));
  assert.equal(stateLocations({ ...options, env: { CLAUDE_PLUGIN_DATA: join(options.home, 'plugin') } }).install, paths.install);
  const fallback = { ...options, home: '', env: {} };
  assert.ok(await clientProjectId(fallback, '/synthetic/project'));
  assert.equal(stateLocations(fallback).coordination, join(options.temporary, '.cairn-memory-clients'));
  for (const home of ['', 'relative']) await assert.rejects(initializePairing({ ...options, home }), /Cannot determine an absolute home/);
  assert.deepEqual(await readdir(options.home), []);
});

test('option parsing, delivery and worker environment cannot override the binding', async t => {
  const options = await paired(t);
  assert.deepEqual(parsePairingRecord(['--pairing-record', options.pairingRecord]), { pairingRecord: options.pairingRecord, rest: [] });
  for (const args of [['--pairing-record'], ['--pairing-record', 'relative'], ['--pairing-record', options.pairingRecord, '--pairing-record', options.pairingRecord]]) assert.throws(() => parsePairingRecord(args));
  const delivered = { ...options, pairingRecord: undefined, env: { HOME: options.home, CLAUDE_PLUGIN_OPTION_PAIRING_RECORD: options.pairingRecord } };
  const binding = await resolveClient(delivered);
  assert.equal(binding.workerEnv.CAIRN_MEMORY_STATE_DIR, binding.root);
  await assert.rejects(resolveClient({ ...options, env: { ...options.env, CAIRN_MEMORY_STATE_DIR: join(options.home, 'other') } }), /state_dir_mismatch/);
  await assert.rejects(resolveClient({ ...options, pairingRecord: join(options.home, 'other.json') }), /pairing_record_mismatch/);
  assert.equal((await resolveClient({ ...options, pairingRecord: undefined })).enabled, false);
});

test('permissions, owner seam, malformed state and symlinks fail closed', async t => {
  for (const target of ['root', 'key', 'coordination', 'install', 'pairing', 'lock']) {
    const options = await paired(t); const paths = stateLocations(options);
    const path = { root: paths.defaultRoot, key: join(paths.defaultRoot, 'project-key'), coordination: paths.coordination,
      install: paths.install, pairing: paths.pairing, lock: paths.lock }[target];
    if (target === 'lock') await privateWrite(path, JSON.stringify({ pid: process.pid, token: '11111111-1111-4111-8111-111111111111' }));
    await chmod(path, target === 'root' || target === 'coordination' ? 0o755 : 0o644);
    await assert.rejects(resolveClient(options), /state_permissions/);
  }
  for (const target of ['root', 'key', 'coordination', 'install', 'pairing', 'lock']) {
    const options = await fixture(t); const paths = stateLocations(options);
    await mkdir(paths.defaultRoot, { mode: 0o700 }); await mkdir(paths.coordination, { mode: 0o700 });
    const path = { root: paths.defaultRoot, key: join(paths.defaultRoot, 'project-key'), coordination: paths.coordination,
      install: paths.install, pairing: paths.pairing, lock: paths.lock }[target];
    if (['root', 'coordination'].includes(target)) await rm(path, { recursive: true });
    await symlink(join(options.home, 'missing'), path);
    await assert.rejects(resolveClient(options), /state_symlink/);
  }
  const options = await fixture(t); await seed(stateLocations(options).defaultRoot);
  await writeFile(join(stateLocations(options).defaultRoot, 'project-key'), 'invalid');
  await assert.rejects(resolveClient(options), /invalid_identity/);
});

test('foreign PID namespace is rejected before calling kill or reaping', async t => {
  const options = await fixture(t); const paths = stateLocations(options);
  const liveness = await localLiveness();
  await privateWrite(paths.lock, JSON.stringify({ pid: 2147483647, token: '11111111-1111-4111-8111-111111111111', namespace: 'foreign' }));
  let calls = 0;
  await assert.rejects(resolveClient({ ...options, liveness: { namespace: liveness.namespace, isAlive() { calls++; return false; } } }), /pid_namespace_unverified/);
  assert.equal(calls, 0); assert.ok(await stat(paths.lock));
  assert.deepEqual((await readdir(paths.coordination)).filter(name => name.includes('reap')), []);
});

test('paired pause: either client fences waiting dispatch and delayed injection across restart', async t => {
  const options = await paired(t);
  const claude = await resolveClient(options);
  const codex = await resolveClient({ ...options, client: 'codex' });
  assert.equal(claude.root, codex.root);
  const old = await readControlState(claude.root);
  let release;
  const started = await startIfActive(claude.root, old.generation, () => new Promise(resolve => release = resolve));
  await setPaused(codex.root, true);
  release('late recall'); await started.operation;
  assert.equal(await runIfActive(claude.root, old.generation, () => assert.fail('stale injection')), false);
  assert.equal((await startIfActive(claude.root, old.generation, () => assert.fail('stale dispatch'))).started, false);
  const paused = await readControlState(codex.root);
  await setPaused(claude.root, false);
  assert.equal((await readControlState((await resolveClient({ ...options, client: 'codex' })).root)).generation, paused.generation);
  assert.notEqual(paused.generation, old.generation);
});


test('explicit reset retains old root, changes scope, starts paused and requires fresh adoption', async t => {
  const options = await paired(t);
  const oldRoot = stateLocations(options).defaultRoot;
  const oldId = await clientProjectId(options, '/synthetic/project');
  await unlink(join(oldRoot, 'project-key'));
  const root = join(options.home, 'reset-root');
  await assert.rejects(resetIdentity({ ...options, root, primaryClient: 'codex' }), /confirmation_required/);
  const reset = await resetIdentity({ ...options, root, primaryClient: 'codex', confirmIdentityReset: true });
  assert.match(reset.disclosure, /no longer addressable/);
  assert.ok(await stat(oldRoot));
  const single = { ...options, pairingRecord: undefined, client: 'codex' };
  const newId = await clientProjectId(single, '/synthetic/project');
  assert.notEqual(newId, oldId);
  assert.equal((await readControlState(root)).paused, true);
  assert.equal((await resolveClient({ ...single, client: 'claude' })).enabled, false);
  const pending = await initializePairing({ ...single, root, adopt: true });
  await completePairing({ ...single, configured: options.consent });
  assert.equal(await clientProjectId({ ...single, client: 'claude', pairingRecord: pending.pairingRecord }, '/synthetic/project'), newId);
});

test('wrong owner and unreadable/corrupt coordination metadata are errors, never freshness', async t => {
  const options = await paired(t);
  const getuid = process.getuid;
  try {
    process.getuid = () => getuid() + 1;
    await assert.rejects(resolveClient(options), /state_owner/);
  } finally { process.getuid = getuid; }
  const path = stateLocations(options).install;
  await chmod(path, 0o000);
  await assert.rejects(resolveClient(options), /state_permissions/);
  await chmod(path, 0o600); await writeFile(path, '{');
  await assert.rejects(resolveClient(options), /invalid_pairing_metadata/);
});

test('unknown liveness never reaps a same-namespace owner', async t => {
  const options = await fixture(t);
  const paths = stateLocations(options);
  const { namespace } = await localLiveness();
  const owner = { pid: 2147483647, token: '11111111-1111-4111-8111-111111111111', namespace };
  await privateWrite(paths.lock, JSON.stringify(owner));
  await assert.rejects(resolveClient({ ...options, timeoutMs: 30,
    liveness: { namespace, isAlive: () => undefined } }), /setup_busy/);
  assert.deepEqual(JSON.parse(await readFile(paths.lock)), owner);
});

test('missing initialized key during pending configuration never regenerates', async t => {
  const options = await fixture(t, { hostsStopped: true, consent: { claude: true, codex: true } });
  const pending = await initializePairing(options);
  await unlink(join(pending.root, 'project-key'));
  assert.equal((await initializePairing(options)).status, 'paired_key_missing');
  assert.equal((await completePairing({ ...options, configured: options.consent })).status, 'paired_key_missing');
  await assert.rejects(stat(join(pending.root, 'project-key')), { code: 'ENOENT' });
});

test('temporary legacy adoption copies without clobber under stopped-worker setup lock', async t => {
  const options = await fixture(t, { hostsStopped: true, consent: { claude: true, codex: true } });
  const source = join(options.temporary, 'old-temporary-root'); await seed(source);
  const root = join(options.home, 'durable');
  await assert.rejects(initializePairing({ ...options, root: source, adopt: true }), /temporary_pairing_root/);
  const pending = await initializePairing({ ...options, root, adopt: true, adoptFrom: source });
  assert.equal(await readFile(join(source, 'project-key'), 'utf8'), `${key}\n`);
  assert.equal(await readFile(join(root, 'project-key'), 'utf8'), `${key}\n`);
  await completePairing({ ...options, configured: options.consent });
  assert.equal((await resolveClient({ ...options, pairingRecord: pending.pairingRecord })).root, root);
});

test('surviving pairing record prevents reinitialization after install metadata and key loss', async t => {
  const options = await paired(t);
  const paths = stateLocations(options);
  await unlink(paths.install); await unlink(join(paths.defaultRoot, 'project-key'));
  await assert.rejects(initializePairing(options), /pairing_record_mismatch/);
  assert.equal((await resolveClient(options)).enabled, false);
  await assert.rejects(stat(join(paths.defaultRoot, 'project-key')), { code: 'ENOENT' });
});

test('unsupported hard-link publication never returns a tentative project ID', async t => {
  const options = await fixture(t);
  const root = stateLocations(options).defaultRoot;
  const identity = new URL('../identity.mjs', import.meta.url).href;
  const result = await child(options, { code: `
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    import assert from 'node:assert/strict';
    fs.link = async () => { throw Object.assign(new Error('unsupported'), {code:'ENOTSUP'}); };
    syncBuiltinESMExports();
    const {opaqueProjectId} = await import(${JSON.stringify(identity)});
    await assert.rejects(opaqueProjectId(${JSON.stringify(root)}, '/synthetic/project'), {code:'ENOTSUP'});
  ` });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await readdir(root), []);
});
