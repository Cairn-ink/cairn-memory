import runTest from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir, lstat, chmod, chown, symlink, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { engineCacheComplete } from './engine-cache.mjs';

runTest('local mode contract', async parent => {
const pending = [];
const test = (...args) => { const promise = parent.test(...args); pending.push(promise); return promise; };
const packageRoot = process.env.CAIRN_SETUP_TEST_PACKAGE || fileURLToPath(new URL('../', import.meta.url));
const moduleURL = pathToFileURL(join(packageRoot, 'lib/setup.mjs')).href;
const fromPackage = name => import(pathToFileURL(join(packageRoot, 'lib', name + '.mjs')));
const { parseStrictJSON, validateDescriptor, newDescriptor, beginOperation, recordClient, publishedReferences,
  withLocalLock, writeDescriptor, readDescriptor, deletionPath, executableFor, canonicalPath } = await fromPackage('local-descriptor');
const { engineIdFor } = await fromPackage('local-engine');
const { claudeSnippet, claudeAddArguments } = await fromPackage('local-claude');
const { codexSnippet, codexAddArguments } = await fromPackage('local-codex');
const { shellArgument, tomlString, argvDisplay, columns } = await fromPackage('output');
const { modeUnion } = await fromPackage('local-mode');
const version = JSON.parse(await readFile(join(packageRoot, 'package.json'))).version;
const manifestBytes = await readFile(join(packageRoot, 'runtime/engine/manifest.json'));
const manifest = JSON.parse(manifestBytes), engineId = engineIdFor(version, manifestBytes);
const engine = { id: engineId, package: manifest.package.name, packageVersion: manifest.package.version, sha256: manifest.sha256 };
const cacheSkip = 'Engine install requires a primed CAIRN_SETUP_NPM_CACHE; no network is used by local-mode tests.';
const needCache = t => { if (!engineCacheComplete(process.env.CAIRN_SETUP_NPM_CACHE)) { t.skip(cacheSkip); return false; } return true; };
const json = async path => JSON.parse(await readFile(path, 'utf8'));
async function files(root) {
  const result = {};
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) result[entry.name + '/'] = { directory: true, mode: (await lstat(path)).mode & 0o777 };
      if (entry.isDirectory()) for (const [key, value] of Object.entries(await files(path))) result[entry.name + '/' + key] = value;
      else result[entry.name] = { bytes: (await readFile(path)).toString('base64'), mode: (await lstat(path)).mode & 0o777 };
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return result;
}
async function localFixture(t, { claude = true, codex = true, claudeState = {}, codexState = {}, suffix = '' } = {}) {
  const ws = createTestWorkspace(t, { prefix: 'cairn-local-mode-' }), home = join(ws.path, 'home' + suffix), bin = join(ws.path, 'bin');
  await mkdir(home, { mode: 0o700 }); await mkdir(bin);
  const root = join(home, '.cairn-memory'), codexHome = join(home, '.codex');
  const paths = {}, calls = {};
  for (const [client, enabled, initial] of [['claude', claude, claudeState], ['codex', codex, codexState]]) {
    paths[client] = join(ws.path, client + '.json'); calls[client] = join(ws.path, client + '.jsonl');
    await writeFile(paths[client], JSON.stringify(initial)); await writeFile(calls[client], '');
    if (enabled) await writeFile(join(bin, client), `#!${process.execPath}\nprocess.env.FAKE_STATE=${JSON.stringify(paths[client])};process.env.FAKE_CALLS=${JSON.stringify(calls[client])};\n` +
      await readFile(new URL(`./fake-${client}.mjs`, import.meta.url), 'utf8'), { mode: 0o755 });
  }
  const harness = join(ws.path, 'harness.mjs');
  await writeFile(harness, `import{main}from${JSON.stringify(moduleURL)};import{writeSync,readFileSync}from'node:fs';
    import{spawn}from'node:child_process';
    import{registerClaude}from${JSON.stringify(pathToFileURL(join(packageRoot, 'lib/local-claude.mjs')).href)};
    import{registerCodex}from${JSON.stringify(pathToFileURL(join(packageRoot, 'lib/local-codex.mjs')).href)};
    import{translator}from${JSON.stringify(pathToFileURL(join(packageRoot, 'lib/messages.mjs')).href)};
    const config=JSON.parse(process.env.LOCAL_TEST_OPTIONS),answers=config.answers??[];
    const output=line=>writeSync(1,String(line)+'\\n');
    output.literal=line=>{for(const part of String(line).split('\\n'))writeSync(1,JSON.stringify({literal:part})+'\\n');};
    if(config.direct){
      const run=args=>new Promise(resolve=>{const child=spawn('claude',args,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='',error;
        child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',v=>error=v);child.on('close',status=>resolve({status,stdout,stderr,error}));});
      const d=JSON.parse(readFileSync(process.env.CAIRN_MEMORY_HOME+'/installation.json'));
      try{const state=await (config.direct==='claude'?registerClaude({root:process.env.CAIRN_MEMORY_HOME,home:process.env.HOME,checkpoint:d.operation.checkpoints.claude,run,write:output,t:translator('en')}):
        registerCodex({root:process.env.CAIRN_MEMORY_HOME,checkpoint:d.operation.checkpoints.codex,env:process.env,write:output,t:translator('en')}));output(state);}
      catch(error){output(error.key);process.exitCode=error.code??1;}
    }else process.exitCode=await main(process.argv.slice(2),{interactive:config.interactive??false,disableLocalMode:config.disableLocalMode??false,
      platform:config.platform??process.platform,nodeVersion:config.nodeVersion??process.versions.node,
      write:output,prompt:async q=>{writeSync(1,JSON.stringify({prompt:q})+'\\n');return answers.shift()??'';},
      authOptions:{request:async()=>{throw new Error('Local mode must not authorize');}}});`);
  const env = { HOME: home, CODEX_HOME: codexHome, CAIRN_MEMORY_HOME: root, LANG: 'en_US.UTF-8',
    PATH: bin,
    CAIRN_SETUP_NPM_CACHE: process.env.CAIRN_SETUP_NPM_CACHE, CAIRN_SETUP_NPM_OFFLINE: '1' };
  const run = async (args = ['setup', '--local'], options = {}) => {
    const child = spawn(process.execPath, [harness, ...args], { cwd: ws.path,
      env: { ...env, ...options.env, LOCAL_TEST_OPTIONS: JSON.stringify(options) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 150000);
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); clearTimeout(timer);
    const lines = stdout.trimEnd().split('\n');
    return { code, stdout, stderr,
      prompts: lines.filter(line => line.startsWith('{"prompt":')).map(JSON.parse),
      literals: lines.filter(line => line.startsWith('{"literal":')).map(JSON.parse).map(value => value.literal),
      display: lines.map(line => line.startsWith('{"literal":') ? JSON.parse(line).literal : line.startsWith('{"prompt":') ? JSON.parse(line).prompt : line).join('\n') + '\n' };
  };
  const recordedCalls = async client => (await readFile(calls[client], 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  return { ws: ws.path, home, root, bin, codexHome, env, run, paths,
    calls: recordedCalls, setState: (client, value) => writeFile(paths[client], JSON.stringify(value)),
    inventory: () => files(home), descriptor: () => readDescriptor(root),
    config: async text => { await mkdir(codexHome, { recursive: true, mode: 0o700 }); await writeFile(join(codexHome, 'config.toml'), text, { mode: 0o600 }); },
    claudeConfig: value => writeFile(join(home, '.claude.json'), typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 }) };
}
async function seed(f, { state = 'installed', selected = ['claude', 'codex'], register = true } = {}) {
  await mkdir(f.root, { mode: 0o700 });
  const d = newDescriptor(f.root, version), vector = { engineId, node: process.execPath, databasePath: d.database.path, ownerId: d.ownerId, projectId: null };
  beginOperation(d, 'setup', selected, { claude: f.home, codex: join(f.codexHome, 'config.toml') }, vector);
  d.engine = engine;
  if (state === 'installed') { for (const client of selected) recordClient(d, client, vector); d.state = state; d.operation = null; }
  await withLocalLock(f.root, () => writeDescriptor(f.root, d));
  if (register) for (const client of selected) {
    const result = spawnSync(join(f.bin, client), client === 'claude' ? claudeAddArguments(f.root, vector) : codexAddArguments(f.root, vector),
      { env: f.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
  }
  return { d, vector };
}

test('descriptor strict JSON, exact keys, bounds, vectors and published references', async t => {
  const f = await localFixture(t), { d, vector } = await seed(f, { state: 'pending', register: false });
  assert.throws(() => parseStrictJSON('{"a":1,"a":2}'));
  assert.throws(() => parseStrictJSON('{"a":1,"\\u0061":2}'));
  assert.equal((await f.descriptor()).ownerId, d.ownerId);
  assert.equal(publishedReferences(d).size, 0);
  d.operation.checkpoints.claude.state = 'registering';
  d.operation.checkpoints.claude.previous = { ...vector, engineId: engineId + '-r2' };
  assert.deepEqual([...publishedReferences(d)].sort(), [engineId, engineId + '-r2'].sort());
  const mutations = [value => { value.extra = true; }, value => { value.database.path = '/foreign/database'; },
    value => { value.database.path = join(f.root, 'engine/db'); value.database.external = true; },
    value => { value.operation.checkpoints.claude.desired.engineId = '../bad'; }, value => { value.node = 'relative'; },
    value => { value.clients.codex = {}; }, value => { value.operation.checkpoints.claude.desired.ownerId = 'different-owner'; }, value => { value.operation.checkpoints.claude.extra = 1; }];
  for (const mutate of mutations) { const bad = structuredClone(d); mutate(bad); assert.throws(() => validateDescriptor(bad, f.root), { key: 'local_recovery_required' }); }
  await writeFile(join(f.root, 'installation.json'), ' '.repeat(65537), { mode: 0o600 });
  await assert.rejects(f.descriptor(), { key: 'local_recovery_required' });
});

test('L03/L05 noninteractive mode selection writes nothing; explicit cloud keeps hosted TTY refusal', async t => {
  const f = await localFixture(t), before = await f.inventory();
  const result = await f.run(['setup']);
  assert.equal(result.code, 2, result.display); assert.match(result.display, /setup --local/); assert.match(result.display, /setup --cloud/);
  assert.deepEqual(await f.inventory(), before); assert.equal(result.prompts.length, 0);
  const cloud = await f.run(['setup', '--cloud']); assert.equal(cloud.code, 2, cloud.display); assert.match(cloud.display, /terminal|interactive/iu);
  assert.deepEqual(await f.inventory(), before);
});
for (const value of [{}, { theme: 'dark' }, { mcpServers: null }, { mcpServers: [] }, '{bad']) {
  test('L22 Claude absence/unknown rule: ' + JSON.stringify(value), async t => {
    const f = await localFixture(t, { codex: false }); await f.claudeConfig(value); const before = await f.inventory();
    const result = await f.run(['setup', '--cloud']); assert.equal(result.code, 2, result.display);
    assert.match(result.display, value && typeof value === 'object' && !Object.hasOwn(value, 'mcpServers') ? /terminal|interactive/iu : /Cannot inspect Claude Code/);
    assert.deepEqual(await f.inventory(), before);
  });
}
test('L22 secrets in sibling registrations never enter output or diagnostics; orphan blocks cloud', async t => {
  const f = await localFixture(t); await f.claudeConfig({ mcpServers: { 'cairn-local': {}, sibling: { headers: { Authorization: 'synthetic-private-header' } } } });
  const before = await f.inventory(), result = await f.run(['setup', '--cloud']);
  assert.equal(result.code, 2); assert.match(result.display, /no valid installation record/); assert.doesNotMatch(result.display, /synthetic-private-header/);
  assert.deepEqual(await f.inventory(), before);
});
for (const config of ['[mcp_servers."cairn"]\nurl = "https://cairn.ink/api/mcp"\n',
  'text = """\n[mcp_servers.cairn-local]\ncommand = "wrong"\n"""\n', '']) {
  test('L22 native Codex detection handles quoted headers, multiline strings and empty config', async t => {
    const f = await localFixture(t, { claude: false }); await f.config(config); const before = await f.inventory();
    const result = await f.run(['setup', '--local', '--dry-run']);
    assert.equal(result.code, config.includes('"cairn"') ? 2 : 0, result.display);
    assert.deepEqual(await f.inventory(), before);
  });
}
test('L07 conflicts cover both clients with ordered detach commands despite --client', async t => {
  const f = await localFixture(t, { claudeState: { installed: true, disabled: true } });
  await f.config('[mcp_servers.cairn]\nurl = "https://cairn.ink/api/mcp"\n');
  const before = await f.inventory(), result = await f.run(['setup', '--local', '--client', 'codex']);
  assert.equal(result.code, 2, result.display); assert.deepEqual(result.literals, [
    'npx @cairn-ink/memory uninstall --client codex', 'codex mcp remove cairn',
    'claude plugin uninstall cairn-memory@cairn-memory --scope "user"', 'npx @cairn-ink/memory setup --local']);
  assert.deepEqual(await f.inventory(), before);
});
for (const state of ['installed', 'pending']) test('L08 local ' + state + ' refuses cloud without resume', async t => {
  const f = await localFixture(t); await seed(f, { state }); const before = await f.inventory();
  const result = await f.run(['setup', '--cloud']); assert.equal(result.code, 2, result.display); assert.match(result.display, /Local memory is configured/);
  assert.deepEqual(await f.inventory(), before);
});
for (const args of [['setup', '--local', '--endpoint', 'https://cairn.ink'], ['setup', '--local', '--cloud'],
  ['setup', '--owner', 'test'], ['setup', '--local', '--owner', '-x'], ['status', '--cloud'],
  ['uninstall', '--local', '--purge-config', '--client', 'codex']]) test('L17 invalid options: ' + args.join(' '), async t => {
  const f = await localFixture(t), before = await f.inventory(), result = await f.run(args);
  assert.equal(result.code, 2, result.display); assert.deepEqual(await f.inventory(), before);
});
test('L17 local controls and immutable descriptor identity refuse before writes', async t => {
  const f = await localFixture(t); await seed(f); const before = await f.inventory();
  for (const args of [['pause'], ['setup', '--local', '--db', '/foreign/db'], ['setup', '--local', '--project', 'new']]) {
    const result = await f.run(args); assert.equal(result.code, 2, result.display); assert.deepEqual(await f.inventory(), before);
  }
});
test('L18 injected Windows fails without writes', async t => {
  const f = await localFixture(t), before = await f.inventory();
  const result = await f.run(['setup', '--local'], { platform: 'win32' }); assert.equal(result.code, 2); assert.match(result.display, /native Windows/);
  assert.deepEqual(await f.inventory(), before);
});
test('L20 stale/live lock paths are retained and actionable', async t => {
  const f = await localFixture(t); await mkdir(f.root, { mode: 0o700 });
  for (const pid of [2147483647, process.pid]) {
    await writeFile(join(f.root, '.setup.lock'), JSON.stringify({ pid, startedAt: new Date().toISOString() }), { mode: 0o600 });
    const before = await f.inventory(), result = await f.run(); assert.equal(result.code, 2, result.display);
    assert.match(result.display, pid === process.pid ? /Wait for it to finish/ : /stopped setup left a lock/);
    assert.deepEqual(await f.inventory(), before);
  }
});
test('L21 local dry runs never lock, repair or create a database, including pending journals', async t => {
  const f = await localFixture(t), before = await f.inventory();
  assert.equal((await f.run(['setup', '--local', '--dry-run'])).code, 0); assert.deepEqual(await f.inventory(), before);
  await seed(f, { state: 'pending' }); const pending = await f.inventory();
  const result = await f.run(['setup', '--dry-run']); assert.equal(result.code, 0, result.display);
  assert.match(result.display, /continue setup/); assert.deepEqual(await f.inventory(), pending);
  assert.ok(!(await f.calls('claude')).some(call => call.args[0] === 'mcp' && call.args[1] === 'get'));
});
test('L14 status does not start engines or create the nonexistent database', async t => {
  const f = await localFixture(t); await seed(f); const before = await f.inventory();
  const result = await f.run(['status']); assert.equal(result.code, 0, result.display); assert.match(result.display, /local memory \(cairn-local\)/); assert.ok(result.display.includes('Data: ~/.cairn-memory/data'));
  assert.deepEqual(await f.inventory(), before);
  assert.deepEqual((await f.calls('claude')).filter(c => c.args[1] === 'get').map(c => c.args), [['mcp', 'get', 'cairn']]);
  assert.ok(!(await f.calls('codex')).some(c => c.args[0] === 'app-server'));
  const d = await f.descriptor(); d.node = '/synthetic/missing-node';
  await withLocalLock(f.root, () => writeDescriptor(f.root, d));
  await mkdir(join(f.root, 'engine', engineId + '.failed-123'), { recursive: true, mode: 0o700 });
  const verboseBefore = await f.inventory(), verbose = await f.run(['status', '--verbose']);
  assert.equal(verbose.code, 0, verbose.display); assert.match(verbose.display, /Node: missing/);
  assert.ok(verbose.literals.includes(shellArgument(d.database.path)));
  assert.ok(verbose.literals.includes(shellArgument(d.node)));
  assert.ok(verbose.literals.some(line => line.includes('.failed-123')));
  assert.deepEqual(await f.inventory(), verboseBefore);
});
test('L15 orphan scoped uninstall retains engine/data and leaves Claude untouched', async t => {
  const f = await localFixture(t); await seed(f); await rm(join(f.root, 'installation.json'));
  await mkdir(join(f.root, 'engine'), { mode: 0o700 }); await writeFile(join(f.root, 'engine/retained'), 'keep');
  await mkdir(join(f.root, 'data'), { mode: 0o700 }); await writeFile(join(f.root, 'data/memory.sqlite'), 'keep');
  const claude = await readFile(join(f.home, '.claude.json'));
  const result = await f.run(['uninstall', '--local', '--yes', '--client', 'codex']); assert.equal(result.code, 0, result.display);
  assert.match(result.display, /engine is retained/); assert.deepEqual(await readFile(join(f.home, '.claude.json')), claude);
  assert.equal(await readFile(join(f.root, 'engine/retained'), 'utf8'), 'keep');
  assert.equal(await readFile(join(f.root, 'data/memory.sqlite'), 'utf8'), 'keep');
});
test('L15 descriptor uninstall detaches clients, preserves data and unrelated config', async t => {
  const f = await localFixture(t); await seed(f); await mkdir(join(f.root, 'engine')); await writeFile(join(f.root, 'engine/old'), 'old');
  await mkdir(join(f.root, 'data')); await writeFile(join(f.root, 'data/memory.sqlite'), 'keep');
  const original = await readFile(join(f.codexHome, 'config.toml'), 'utf8'); await f.config('# keep\nmodel = "test"\n' + original);
  const scoped = await f.run(['uninstall', '--local', '--yes', '--client', 'codex']); assert.equal(scoped.code, 0, scoped.display);
  assert.equal((await f.descriptor()).state, 'installed'); assert.ok((await f.descriptor()).clients.claude);
  const result = await f.run(['uninstall', '--local', '--yes']); assert.equal(result.code, 0, result.display);
  assert.equal((await f.descriptor()).state, 'uninstalled'); assert.equal(await readFile(join(f.root, 'data/memory.sqlite'), 'utf8'), 'keep');
  assert.equal(await readFile(join(f.codexHome, 'config.toml'), 'utf8'), '# keep\nmodel = "test"\n');
  const again = await f.run(['uninstall', '--local', '--yes']); assert.equal(again.code, 0, again.display);
  assert.equal(await readFile(join(f.root, 'data/memory.sqlite'), 'utf8'), 'keep');
});
test('L11/L15 changed Codex home refuses registration and detachment, with original path', async t => {
  const f = await localFixture(t); await seed(f, { state: 'pending' }); const before = await f.inventory();
  for (const args of [['setup', '--local'], ['uninstall', '--local', '--yes']]) {
    const result = await f.run(args, { env: { CODEX_HOME: join(f.home, 'other') } });
    assert.equal(result.code, 2, result.display); assert.match(result.display, /configuration home changed/);
    assert.deepEqual(await f.inventory(), before);
  }
});
test('L16 unsafe descriptor is never rewritten; orphan purge removes only allowlisted config', async t => {
  const f = await localFixture(t); await seed(f); await writeFile(join(f.root, 'installation.json'), '{"version":1,"version":2}');
  const before = await f.inventory(), result = await f.run(); assert.equal(result.code, 2, result.display); assert.deepEqual(await f.inventory(), before);
  const status = await f.run(['status']); assert.equal(status.code, 2, status.display); assert.match(status.display, /cannot be read safely/); assert.deepEqual(await f.inventory(), before);
  const purge = await f.run(['uninstall', '--local', '--yes', '--purge-config']); assert.equal(purge.code, 0, purge.display);
  assert.equal((await f.inventory())['.cairn-memory/installation.json'], undefined);
});
test('deletion allowlist rejects symlinks, database aliases and referenced generations', async t => {
  const f = await localFixture(t); await mkdir(f.root, { mode: 0o700 }); await mkdir(join(f.root, 'engine'));
  await assert.rejects(deletionPath(f.root, 'data'), { key: 'local_recovery_required' });
  await symlink(join(f.root, 'engine'), join(f.root, 'alias'));
  await assert.rejects(deletionPath(f.root, 'engine', { databasePath: join(f.root, 'alias/db') }), { key: 'local_recovery_required' });
  await assert.rejects(deletionPath(f.root, 'engine/' + engineId, { renameOnly: true, references: new Set([engineId]) }), { key: 'local_recovery_required' });
  await symlink(join(f.root, 'engine'), join(f.root, 'engine', engineId));
  await assert.rejects(deletionPath(f.root, 'engine/' + engineId, { renameOnly: true }), { key: 'local_recovery_required' });
});
test('mode union gives unknown precedence and includes pending setup', () => {
  assert.equal(modeUnion([{ cloud: true }, { local: true }]), 'mixed');
  assert.equal(modeUnion([{ unknown: true }, { local: true }]), 'unknown');
  assert.equal(modeUnion([], true), 'local'); assert.equal(modeUnion([]), 'none');
});
test('L23 literal shell, TOML and argv serializers preserve unusual characters', async t => {
  const f = await localFixture(t, { suffix: ' space $ ` " \' \\' });
  const value = ' space $ ` " \' \\ end';
  const result = spawnSync('sh', ['-c', 'printf %s ' + shellArgument(value)], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0); assert.equal(result.stdout, value);
  assert.equal(JSON.parse(tomlString(value)), value); assert.deepEqual(JSON.parse(argvDisplay([value])), [value]);
  const { vector } = await seed(f, { register: false }); await f.config(codexSnippet(f.root, vector));
  const shell = spawnSync('/bin/sh', ['-c', claudeSnippet(f.root, vector)], { env: f.env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 10000 });
  assert.equal(shell.status, 0, shell.stderr); assert.deepEqual((await f.calls('claude')).at(-1).args, claudeAddArguments(f.root, vector));
  const status = await f.run(['status']); assert.equal(status.code, 0, status.display); assert.match(status.display, /local memory/);
  assert.ok(claudeSnippet(f.root, vector).includes(shellArgument(vector.node)));
});
for (const lang of ['zh', 'en']) test('L01/L04 fresh local, exact argv, durable descriptor and snapshot (' + lang + ')', async t => {
  if (!needCache(t)) return;
  const f = await localFixture(t); await f.config('# keep\nmodel = "test"\n');
  const result = await f.run(['setup', '--lang', lang], { interactive: true, answers: ['1', '', 'y'] });
  assert.equal(result.code, 0, result.display); const d = await f.descriptor(); assert.equal(d.state, 'installed');
  assert.equal(d.operation, null); assert.equal(d.clients.claude.home, f.home); assert.equal(d.clients.codex.configPath, join(f.codexHome, 'config.toml'));
  assert.deepEqual((await f.calls('claude')).filter(c => c.args[1] === 'add' && !c.args.includes('--help')).map(c => c.args), [claudeAddArguments(f.root, d.clients.claude.vector)]);
  assert.deepEqual((await f.calls('codex')).filter(c => c.args[1] === 'add' && !c.args.includes('--help')).map(c => c.args), [codexAddArguments(f.root, d.clients.codex.vector)]);
  assert.ok((await readFile(join(f.codexHome, 'config.toml'), 'utf8')).startsWith('# keep\nmodel = "test"\n'));
  assert.equal((await lstat(join(f.root, 'installation.json'))).mode & 0o777, 0o600);
  const screen = result.display.replaceAll(version, '<version>').replace(/[ \t]+$/gmu, '');
  for (const line of screen.trimEnd().split('\n')) if (!result.literals.includes(line)) assert.ok(columns(line) <= 80, line);
  const snapshot = new URL(`./snapshots/local-setup-${lang}.txt`, import.meta.url);
  if (process.env.UPDATE_SETUP_SNAPSHOTS === '1') await writeFile(snapshot, screen);
  assert.equal(screen, await readFile(snapshot, 'utf8'));
  const repeat = await f.run(['setup']); assert.equal(repeat.code, 0, repeat.display); assert.equal(repeat.prompts.length, 0);
  const owner = (await f.descriptor()).ownerId; assert.equal(owner, d.ownerId);
});
test('L19 missing Claude capability yields manual receipt and registers Codex', async t => {
  if (!needCache(t)) return; const f = await localFixture(t, { claudeState: { noMcp: true } });
  const result = await f.run(); assert.equal(result.code, 1, result.display); assert.match(result.display, /Add to Claude Code manually/);
  assert.equal((await f.descriptor()).state, 'installed'); assert.ok((await f.descriptor()).clients.codex);
  assert.ok(result.literals.some(line => line.includes('cairn-local')));
});

test('L12 Claude replacement restores previous after add failure, detects drift, and resumes absent entry', async t => {
  const f = await localFixture(t), { d, vector } = await seed(f, { state: 'pending' });
  const cp = d.operation.checkpoints.claude;
  cp.previous = { ...vector }; cp.desired = { ...vector, node: '/synthetic/replacement-node' }; cp.state = 'registering';
  await withLocalLock(f.root, () => writeDescriptor(f.root, d));
  // Fail only the desired add; the fixture leaves the existing bytes untouched
  // until the remove succeeds. The previous add remains available for restore.
  const fail = claudeAddArguments(f.root, cp.desired).filter((_, index, args) => index !== args.indexOf('--scope') && index !== args.indexOf('--scope') + 1).join(' ');
  await f.setState('claude', { fail });
  const failure = await f.run([], { direct: 'claude' }); assert.equal(failure.code, 1, failure.display);
  assert.match(failure.display, /claude_mcp_unverified/);
  assert.equal((await json(join(f.home, '.claude.json'))).mcpServers['cairn-local'].command, vector.node);
  await f.setState('claude', {});
  const native = await json(join(f.home, '.claude.json')); native.mcpServers['cairn-local'].command = '/unrelated/node'; await f.claudeConfig(native);
  const before = await f.inventory(), drift = await f.run([], { direct: 'claude' });
  assert.equal(drift.code, 2, drift.display); assert.match(drift.display, /claude_mcp_drifted/); assert.ok(drift.literals.includes('claude mcp remove --scope user cairn-local')); assert.deepEqual(await f.inventory(), before);
  delete native.mcpServers['cairn-local']; await f.claudeConfig(native);
  const resumed = await f.run([], { direct: 'claude' }); assert.equal(resumed.code, 0, resumed.display);
  assert.equal((await json(join(f.home, '.claude.json'))).mcpServers['cairn-local'].command, cp.desired.node);
});
test('L13 Codex failed add retains every config byte and prints TOML', async t => {
  const f = await localFixture(t), { d, vector } = await seed(f, { state: 'pending' });
  d.operation.checkpoints.codex.previous = { ...vector };
  d.operation.checkpoints.codex.desired.node = '/synthetic/new-node';
  await withLocalLock(f.root, () => writeDescriptor(f.root, d));
  const fail = codexAddArguments(f.root, d.operation.checkpoints.codex.desired).join(' ');
  await f.setState('codex', { fail, token: 'synthetic-private-error' });
  const before = await readFile(join(f.codexHome, 'config.toml')), result = await f.run([], { direct: 'codex' });
  assert.equal(result.code, 1, result.display); assert.match(result.display, /codex_mcp_unverified/);
  assert.doesNotMatch(result.display, /synthetic-private-error/); assert.deepEqual(await readFile(join(f.codexHome, 'config.toml')), before);
  assert.ok(result.literals.some(line => line === '[mcp_servers."cairn-local"]'));
});
test('L09 local no-flag repair rewrites both Node paths and reuses the engine generation', async t => {
  if (!needCache(t)) return;
  const f = await localFixture(t); const first = await f.run(); assert.equal(first.code, 0, first.display);
  const d = await f.descriptor(), oldId = d.engine.id;
  for (const client of ['claude', 'codex']) {
    d.clients[client].vector.node = '/synthetic/old-node';
    const args = client === 'claude' ? ['mcp', 'remove', '--scope', 'user', 'cairn-local'] : null;
    if (args) assert.equal(spawnSync(join(f.bin, client), args, { env: f.env, stdio: 'ignore', timeout: 10000 }).status, 0);
    assert.equal(spawnSync(join(f.bin, client), client === 'claude' ? claudeAddArguments(f.root, d.clients[client].vector) : codexAddArguments(f.root, d.clients[client].vector),
      { env: f.env, stdio: 'ignore', timeout: 10000 }).status, 0);
  }
  await withLocalLock(f.root, () => writeDescriptor(f.root, d));
  const again = await f.run(['setup']); assert.equal(again.code, 0, again.display); assert.equal(again.prompts.length, 0);
  const repaired = await f.descriptor(); assert.equal(repaired.engine.id, oldId);
  assert.equal(repaired.clients.claude.vector.node, process.execPath); assert.equal(repaired.clients.codex.vector.node, process.execPath);
});

test('L10 failed offline npm keeps a pending owner and published engine generations intact', async t => {
  const f = await localFixture(t), { d } = await seed(f);
  const old = join(f.root, 'engine', engineId); await mkdir(old, { recursive: true, mode: 0o700 });
  await writeFile(join(old, 'retained'), 'published generation');
  const emptyCache = join(f.ws, 'empty-cache'); await mkdir(emptyCache);
  const result = await f.run(['setup', '--local'], { env: { CAIRN_SETUP_NPM_CACHE: emptyCache } });
  assert.equal(result.code, 1, result.display); assert.match(result.display, /installation failed|verification failed/);
  const pending = await f.descriptor(); assert.equal(pending.state, 'pending'); assert.equal(pending.engine, null);
  assert.equal(pending.ownerId, d.ownerId); assert.equal(await readFile(join(old, 'retained'), 'utf8'), 'published generation');
  assert.ok((await readdir(join(f.root, 'engine'))).some(name => name.startsWith(engineId + '-r2.failed-')));
  assert.equal(pending.operation.checkpoints.claude.state, 'planned');
});
test('L11 durable Claude done checkpoint resumes only Codex without new consent or identity', async t => {
  if (!needCache(t)) return;
  const f = await localFixture(t); assert.equal((await f.run()).code, 0);
  const d = await f.descriptor(), vector = d.clients.claude.vector;
  beginOperation(d, 'setup', ['claude', 'codex'], { claude: f.home, codex: join(f.codexHome, 'config.toml') }, vector);
  recordClient(d, 'claude', vector);
  await withLocalLock(f.root, () => writeDescriptor(f.root, d));
  const native = spawnSync(join(f.bin, 'codex'), ['mcp', 'remove', 'cairn-local'], { env: f.env, stdio: 'ignore', timeout: 10000 });
  assert.equal(native.status, 0);
  const result = await f.run(['setup']); assert.equal(result.code, 0, result.display); assert.equal(result.prompts.length, 0);
  assert.equal((await f.descriptor()).ownerId, d.ownerId); assert.equal((await f.descriptor()).state, 'installed');
});

test('L16 foreign descriptor uid is refused', async t => {
  if (!process.getuid || process.getuid() !== 0) { t.skip('Changing descriptor ownership requires root.'); return; }
  const f = await localFixture(t); await seed(f, { register: false });
  const path = join(f.root, 'installation.json'); await chown(path, 1, 1);
  await assert.rejects(f.descriptor(), { key: 'local_recovery_required' });
});
test('L15 failed Codex detach retains the engine and rerun resumes its journal', async t => {
  const f = await localFixture(t); await seed(f); await mkdir(join(f.root, 'engine'), { mode: 0o700 });
  await writeFile(join(f.root, 'engine/retained'), 'keep');
  await f.setState('codex', { fail: 'mcp remove cairn-local', token: 'synthetic-hidden-detach-error' });
  const first = await f.run(['uninstall', '--local', '--yes']); assert.equal(first.code, 1, first.display);
  assert.equal((await f.descriptor()).state, 'uninstalling');
  assert.equal((await f.descriptor()).operation.checkpoints.claude.state, 'detached');
  assert.equal(await readFile(join(f.root, 'engine/retained'), 'utf8'), 'keep');
  assert.doesNotMatch(first.display, /synthetic-hidden-detach-error/);
  const beforeScopeChange = await f.inventory();
  const wrongScope = await f.run(['uninstall', '--local', '--yes', '--client', 'claude']);
  assert.equal(wrongScope.code, 2, wrongScope.display); assert.deepEqual(await f.inventory(), beforeScopeChange);
  await f.setState('codex', {}); await rm(join(f.bin, 'claude'));
  const resumed = await f.run(['uninstall', '--local']); assert.equal(resumed.code, 0, resumed.display);
  assert.equal(resumed.prompts.length, 0); assert.equal((await f.descriptor()).state, 'uninstalled');
});

test('L17 explicit default database is valid; other database paths inside the root refuse before writes', async t => {
  const f = await localFixture(t), before = await f.inventory();
  const accepted = await f.run(['setup', '--local', '--db', join(f.root, 'data/memory.sqlite'), '--dry-run']);
  assert.equal(accepted.code, 0, accepted.display); assert.deepEqual(await f.inventory(), before);
  const d = newDescriptor(f.root, version, { db: join(f.root, 'data/memory.sqlite') });
  assert.equal(d.database.external, false);
  const refused = await f.run(['setup', '--local', '--db', join(f.root, 'other.sqlite')]);
  assert.equal(refused.code, 2, refused.display); assert.deepEqual(await f.inventory(), before);
});

test('L04/L17 noninteractive local flags persist identity and allow a new project after uninstall', async t => {
  if (!needCache(t)) return;
  const f = await localFixture(t), db = join(f.ws, 'external.sqlite');
  const first = await f.run(['setup', '--local', '--owner', 'synthetic-local-owner', '--project', 'synthetic-project', '--db', db]);
  assert.equal(first.code, 0, first.display); assert.equal(first.prompts.length, 0);
  const installed = await f.descriptor(); assert.equal(installed.state, 'installed');
  assert.equal(installed.ownerId, 'synthetic-local-owner'); assert.equal(installed.projectId, 'synthetic-project');
  assert.deepEqual(installed.database, { path: db, external: true });
  assert.deepEqual((await f.calls('claude')).filter(c => c.args[1] === 'add' && !c.args.includes('--help')).map(c => c.args), [claudeAddArguments(f.root, installed.clients.claude.vector)]);
  assert.deepEqual((await f.calls('codex')).filter(c => c.args[1] === 'add' && !c.args.includes('--help')).map(c => c.args), [codexAddArguments(f.root, installed.clients.codex.vector)]);
  await assert.rejects(lstat(db), { code: 'ENOENT' });
  assert.equal((await f.run(['uninstall', '--local', '--yes'])).code, 0);
  const reinstalled = await f.run(['setup', '--local', '--project', 'replacement-project']); assert.equal(reinstalled.code, 0, reinstalled.display);
  const current = await f.descriptor(); assert.equal(current.ownerId, installed.ownerId);
  assert.deepEqual(current.database, installed.database); assert.equal(current.projectId, 'replacement-project');
});

test('manual registrations protect their observed generation when a desired receipt differs', async t => {
  const f = await localFixture(t), { d } = await seed(f);
  const otherId = engineIdFor('99.0.0', manifestBytes);
  d.engine.id = otherId;
  for (const client of ['claude', 'codex']) d.clients[client].vector.engineId = otherId;
  await withLocalLock(f.root, () => writeDescriptor(f.root, d));
  const actual = join(f.root, 'engine', engineId); await mkdir(actual, { recursive: true, mode: 0o700 });
  await writeFile(join(actual, 'retained'), 'still published in native config');
  const cache = join(f.ws, 'manual-empty-cache'); await mkdir(cache);
  const result = await f.run(['setup', '--local'], { env: { CAIRN_SETUP_NPM_CACHE: cache } });
  assert.equal(result.code, 1, result.display);
  assert.equal(await readFile(join(actual, 'retained'), 'utf8'), 'still published in native config');
  assert.ok((await readdir(join(f.root, 'engine'))).some(name => name.startsWith(engineId + '-r2.failed-')));
});

test('orphan engine trees cannot be adopted without recorded client destinations', async t => {
  const f = await localFixture(t); await mkdir(join(f.root, 'engine'), { recursive: true, mode: 0o700 });
  await writeFile(join(f.root, 'engine/retained'), 'may be used in another home');
  const before = await f.inventory();
  for (const args of [['setup', '--local'], ['setup', '--cloud'], ['status']]) {
    const result = await f.run(args); assert.equal(result.code, 2, result.display);
    assert.match(result.display, /no valid installation record/); assert.deepEqual(await f.inventory(), before);
  }
});

test('cloud installation metadata still routes cloud when its Codex CLI is unavailable', async t => {
  const f = await localFixture(t, { codex: false });
  await mkdir(join(f.codexHome, 'cairn'), { recursive: true, mode: 0o700 });
  await writeFile(join(f.codexHome, 'cairn/installation.json'), '{}', { mode: 0o600 });
  const before = await f.inventory();
  const conflict = await f.run(); assert.equal(conflict.code, 2, conflict.display);
  assert.match(conflict.display, /Cloud memory is configured/);
  const cloud = await f.run(['setup']); assert.equal(cloud.code, 2, cloud.display);
  assert.match(cloud.display, /terminal|interactive/iu); assert.deepEqual(await f.inventory(), before);
});

test('partial local setup reports the saved engine and Claude registration on a Codex directory failure', async t => {
  if (!needCache(t)) return;
  const f = await localFixture(t); await f.config('# preserve\n'); await chmod(f.codexHome, 0o777);
  const result = await f.run(); assert.equal(result.code, 1, result.display);
  assert.doesNotMatch(result.display, /Nothing was changed/);
  assert.match(result.display, /local engine installed/); assert.match(result.display, /Claude Code connected to local memory/);
  assert.ok(result.literals.includes('npx @cairn-ink/memory setup --local'));
  assert.equal((await f.descriptor()).operation.checkpoints.claude.state, 'done');
  await chmod(f.codexHome, 0o700); assert.equal((await f.run(['setup'])).code, 0);
});

await Promise.all(pending);
});
