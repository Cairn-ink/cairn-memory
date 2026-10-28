import runTest from 'node:test';
import assert from 'node:assert/strict';
import fsPromises, { readFile, writeFile, mkdir, readdir, lstat, chmod, chown, symlink, rm, cp, copyFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { engineCacheComplete, skipMissingEngineCache } from './engine-cache.mjs';

runTest('local mode contract', async parent => {
const pending = [];
const test = (...args) => { const promise = parent.test(...args); pending.push(promise); return promise; };
const packageRoot = process.env.CAIRN_SETUP_TEST_PACKAGE || fileURLToPath(new URL('../', import.meta.url));

const fromPackage = name => import(pathToFileURL(join(packageRoot, 'lib', name + '.mjs')));
const { parseStrictJSON, validateDescriptor, newDescriptor, beginOperation, recordClient, publishedReferences,
  withLocalLock, writeDescriptor, readDescriptor, deletionPath, executableFor, canonicalPath } = await fromPackage('local-descriptor');
const { engineIdFor } = await fromPackage('local-engine');
const { claudeSnippet, claudeAddArguments } = await fromPackage('local-claude');
const { codexSnippet, codexAddArguments } = await fromPackage('local-codex');
const { shellArgument, tomlString, argvDisplay, columns } = await fromPackage('output');
const { translator } = await fromPackage('messages');
const { setupCodex, inspectCodexServers, withCodexInspectionEnvironment } = await fromPackage('codex');
const { modeUnion } = await fromPackage('local-mode');
const version = JSON.parse(await readFile(join(packageRoot, 'package.json'))).version;
const manifestBytes = await readFile(join(packageRoot, 'runtime/engine/manifest.json'));
const manifest = JSON.parse(manifestBytes), engineId = engineIdFor(version, manifestBytes);
const engine = { id: engineId, package: manifest.package.name, packageVersion: manifest.package.version, sha256: manifest.sha256 };
const cacheSkip = 'Engine install requires a primed CAIRN_SETUP_NPM_CACHE; no network is used by local-mode tests.';
const needCache = t => { if (!engineCacheComplete(process.env.CAIRN_SETUP_NPM_CACHE)) { return skipMissingEngineCache(t, cacheSkip); } return true; };
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
async function localFixture(t, { claude = true, codex = true, claudeState = {}, codexState = {}, suffix = '', testedPackageRoot = packageRoot,
  nodeExecutable = process.execPath } = {}) {
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
  const moduleURL = pathToFileURL(join(testedPackageRoot, 'lib/setup.mjs')).href;
  const harness = join(ws.path, 'harness.mjs');
  await writeFile(harness, `import{main}from${JSON.stringify(moduleURL)};import{writeSync,readFileSync,chmodSync}from'node:fs';
    import{spawn}from'node:child_process';import fsPromises from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    import{registerClaude}from${JSON.stringify(pathToFileURL(join(testedPackageRoot, 'lib/local-claude.mjs')).href)};
    import{registerCodex}from${JSON.stringify(pathToFileURL(join(testedPackageRoot, 'lib/local-codex.mjs')).href)};
    import{translator}from${JSON.stringify(pathToFileURL(join(testedPackageRoot, 'lib/messages.mjs')).href)};
    import{routeLocalMode,localStatus}from${JSON.stringify(pathToFileURL(join(testedPackageRoot, 'lib/local-mode.mjs')).href)};
    import{parseOptions}from${JSON.stringify(pathToFileURL(join(testedPackageRoot, 'lib/options.mjs')).href)};
    import{parseClient}from${JSON.stringify(pathToFileURL(join(testedPackageRoot, 'lib/codex.mjs')).href)};
    import{SetupError}from${JSON.stringify(pathToFileURL(join(testedPackageRoot, 'lib/errors.mjs')).href)};
    const mkdtemp=fsPromises.mkdtemp;fsPromises.mkdtemp=(path,...args)=>{if(String(path).startsWith('/tmp/cairn-codex-inspect-'))throw Object.assign(new Error('unowned inspection parent'),{code:'EACCES'});return mkdtemp(path,...args);};syncBuiltinESMExports();
    const config=JSON.parse(process.env.LOCAL_TEST_OPTIONS),answers=config.answers??[];
    const output=line=>writeSync(1,String(line)+'\\n');
    output.literal=line=>{for(const part of String(line).split('\\n'))writeSync(1,JSON.stringify({literal:part})+'\\n');};
    const answer=async q=>{output(JSON.stringify({prompt:q}));
      if(config.unsafeCodexOnPrompt)chmodSync(process.env.CODEX_HOME+'/config.toml',0o622);
      return answers.shift()??'';};
    const run=args=>new Promise(resolve=>{const child=spawn('claude',args,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='',error;
        child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',v=>error=v);child.on('close',status=>resolve({status,stdout,stderr,error}));});
    if(config.library){
      const options=parseOptions(process.argv.slice(2)),selection=parseClient(options.argv,SetupError),t=translator(options.lang??'en');
      const context={env:process.env,inspection:config.inspection,write:output,t,interactive:config.interactive??false,
        prompt:answer,runClaude:run,
        installerVersion:${JSON.stringify(version)},nodeVersion:process.versions.node,supportedNode:()=>true,platform:process.platform};
      try{const result=await routeLocalMode(options,selection,context);
        if(result.detection){
          const progress={};
          if(config.hostedStatus)await main(process.argv.slice(2),{disableLocalMode:true,inspection:config.inspection,write:output,progress});
          await localStatus(result.detection,{...context,emittedEnvironmentCauses:progress.codexEnvironmentCauses??new Set(config.emitted??[])});
        }
        if(!result.handled&&!result.detection)output('HOSTED');
        process.exitCode=result.code??result.statusCode??0;
      }catch(error){output(t(error.key??'setup_failed',error.params));process.exitCode=error.code??1;}
    }else if(config.direct){
      const d=JSON.parse(readFileSync(process.env.CAIRN_MEMORY_HOME+'/installation.json'));
      try{const state=await (config.direct==='claude'?registerClaude({root:process.env.CAIRN_MEMORY_HOME,home:process.env.HOME,checkpoint:d.operation.checkpoints.claude,run,write:output,t:translator('en')}):
        registerCodex({root:process.env.CAIRN_MEMORY_HOME,checkpoint:d.operation.checkpoints.codex,env:process.env,inspection:config.inspection,write:output,t:translator('en')}));output(state);}
      catch(error){output(error.key);process.exitCode=error.code??1;}
    }else process.exitCode=await main(process.argv.slice(2),{interactive:config.interactive??false,disableLocalMode:config.disableLocalMode??false,
      inspection:config.inspection,localInstallerVersion:config.installerVersion,platform:config.platform??process.platform,nodeVersion:config.nodeVersion??process.versions.node,
      write:output,prompt:answer,
      authOptions:{request:async()=>{throw new Error('Local mode must not authorize');}}});`);
  const env = { HOME: home, CODEX_HOME: codexHome, CAIRN_MEMORY_HOME: root, LANG: 'en_US.UTF-8',
    PATH: bin, TMPDIR: ws.path,
    CAIRN_SETUP_NPM_CACHE: process.env.CAIRN_SETUP_NPM_CACHE, CAIRN_SETUP_NPM_OFFLINE: '1' };
  const run = async (args = ['setup', '--local'], options = {}) => {
    const child = spawn(nodeExecutable, [harness, ...args], { cwd: ws.path,
      env: { ...env, ...options.env, LOCAL_TEST_OPTIONS: JSON.stringify(options) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    // A surviving npm child can still own these pipes after setup is killed.
    child.on('exit', (_, signal) => { if (signal === 'SIGKILL') { child.stdout.destroy(); child.stderr.destroy(); } });
    options.onSpawn?.(child);
    const timer = setTimeout(() => child.kill('SIGKILL'), 150000);
    const [code, signal] = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve([code, signal])); }); clearTimeout(timer);
    const lines = stdout.trimEnd().split('\n');
    return { code, signal, stdout, stderr,
      prompts: lines.filter(line => line.startsWith('{"prompt":')).map(JSON.parse),
      literals: lines.filter(line => line.startsWith('{"literal":')).map(JSON.parse).map(value => value.literal),
      display: lines.map(line => line.startsWith('{"literal":') ? JSON.parse(line).literal : line.startsWith('{"prompt":') ? JSON.parse(line).prompt : line).join('\n') + '\n' };
  };
  const recordedCalls = async client => (await readFile(calls[client], 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  return { ws: ws.path, home, root, bin, codexHome, env, run, paths, defer: ws.defer,
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
  assert.equal(Object.getPrototypeOf(parseStrictJSON('{"database":{}}')), null);
  assert.equal(Object.getPrototypeOf(parseStrictJSON('{"database":{}}').database), null);
  assert.throws(() => parseStrictJSON('{"a":1,"a":2}'));
  assert.throws(() => parseStrictJSON('{"a":1,"\\u0061":2}'));
  const loaded = await f.descriptor();
  assert.equal(loaded.ownerId, d.ownerId);
  assert.equal(Object.getPrototypeOf(loaded.database), null);
  assert.deepEqual({ ...loaded.database }, d.database);
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
  const neutral = join(f.ws, 'neutral'); await mkdir(neutral, { mode: 0o700 });
  const options = { env: { TMPDIR: neutral } };
  const assertDetectionOnly = async offsets => {
    const calls = Object.fromEntries(await Promise.all(['claude', 'codex'].map(async client =>
      [client, (await f.calls(client)).slice(offsets[client]).map(call => call.args)])));
    assert.deepEqual(calls, { claude: [['plugin', 'list', '--json']], codex: [['mcp', 'list', '--json']] });
  };
  assert.equal((await f.run(['setup', '--local', '--dry-run'], options)).code, 0); assert.deepEqual(await f.inventory(), before);
  await assertDetectionOnly({ claude: 0, codex: 0 });
  await seed(f, { state: 'pending' }); const pending = await f.inventory();
  const offsets = { claude: (await f.calls('claude')).length, codex: (await f.calls('codex')).length };
  const result = await f.run(['setup', '--dry-run'], options); assert.equal(result.code, 0, result.display);
  assert.match(result.display, /continue setup/); assert.deepEqual(await f.inventory(), pending);
  await assertDetectionOnly(offsets);
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
  const f = await localFixture(t); await seed(f); await mkdir(join(f.root, 'engine'), { mode: 0o700 }); await writeFile(join(f.root, 'engine/old'), 'old');
  await mkdir(join(f.root, 'data'), { mode: 0o700 }); await writeFile(join(f.root, 'data/memory.sqlite'), 'keep');
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
  const f = await localFixture(t); await mkdir(f.root, { mode: 0o700 }); await mkdir(join(f.root, 'engine'), { mode: 0o700 });
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
  const emptyCache = join(f.ws, 'empty-cache'); await mkdir(emptyCache, { mode: 0o755 });
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
  assert.deepEqual({ ...installed.database }, { path: db, external: true });
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
  const cache = join(f.ws, 'manual-empty-cache'); await mkdir(cache, { mode: 0o700 });
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

for (const [name, holder, child, expected] of [
  ['both dead', 2147483647, 2147483646, /stopped setup left a lock/],
  ['live setup', process.pid, null, /Wait for it to finish/],
  ['live npm', 2147483647, process.pid, /Wait for it to finish/],
  ['legacy holder', 2147483647, undefined, /Confirm no npm install is running/],
]) test('L20 root lock: ' + name, async t => {
  const f = await localFixture(t); await mkdir(f.root, { mode: 0o700 });
  const lock = { pid: holder, startedAt: new Date().toISOString(), ...(child === undefined ? {} : { child }) };
  await writeFile(join(f.root, '.setup.lock'), JSON.stringify(lock), { mode: 0o600 });
  const before = await f.inventory(), result = await f.run();
  assert.equal(result.code, 2, result.display); assert.match(result.display, expected);
  assert.deepEqual(await f.inventory(), before);
  if (holder !== process.pid && child !== process.pid) assert.ok(result.literals.some(line => line.startsWith('rm -- ')));
});
test('L20 root lock persists and clears child ownership with the exact key set', async t => {
  const f = await localFixture(t); await mkdir(f.root, { mode: 0o700 });
  await withLocalLock(f.root, async updateChild => {
    const path = join(f.root, '.setup.lock');
    assert.deepEqual(Object.keys(await json(path)).sort(), ['child', 'pid', 'startedAt']);
    assert.equal((await json(path)).child, null);
    await updateChild(process.pid); assert.equal((await json(path)).child, process.pid);
    await updateChild(null); assert.equal((await json(path)).child, null);
  });
});
for (const [name, contents, key] of [
  ['dead holder', JSON.stringify({ pid: 2147483647, startedAt: new Date().toISOString() }), 'codex_lock_stale'],
  ['hosted empty holder', '', 'codex_lock'], ['unparseable holder', '{bad', 'codex_lock'],
  ['live holder', JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'codex_lock'],
]) test('L20 Codex lock: ' + name, async t => {
  const f = await localFixture(t); await seed(f);
  await writeFile(join(f.codexHome, '.cairn-setup.lock'), contents, { mode: 0o600 });
  const before = await f.inventory();
  for (const args of [['setup', '--local'], ['uninstall', '--local', '--yes', '--client', 'codex']]) {
    const result = await f.run(args); assert.equal(result.code, 2, result.display);
    assert.match(result.display, key === 'codex_lock_stale' ? /stopped Codex setup/ : /Wait for it to finish/);
    if (key === 'codex_lock_stale') assert.ok(result.literals.some(line => line.startsWith('rm -- ')));
    assert.deepEqual(await f.inventory(), before);
  }
});
async function pendingUninstallFixture(t) {
  const f = await localFixture(t), { d, vector } = await seed(f, { state: 'pending' });
  recordClient(d, 'claude', vector); d.operation.checkpoints.codex.state = 'registering';
  d.operation.checkpoints.codex.previous = { ...vector, node: '/synthetic/previous-node' };
  // Engine can still be null on a partially completed setup.
  d.engine = null; await withLocalLock(f.root, () => writeDescriptor(f.root, d));
  return { f, d };
}
test('L15 pending setup refuses scoped uninstall and requires fresh confirmation', async t => {
  const { f } = await pendingUninstallFixture(t), before = await f.inventory();
  for (const args of [['uninstall', '--local', '--client', 'codex', '--yes'], ['uninstall', '--local']]) {
    const result = await f.run(args); assert.equal(result.code, 2, result.display);
    if (args.includes('--client')) {
      assert.match(result.display, /Local setup is unfinished/);
      assert.ok(result.literals.includes('npx @cairn-ink/memory uninstall --local'));
    }
    assert.deepEqual(await f.inventory(), before);
  }
  const declined = await f.run(['uninstall', '--local'], { interactive: true, answers: ['n'] });
  assert.equal(declined.code, 2); assert.equal(declined.prompts.length, 1); assert.deepEqual(await f.inventory(), before);
});
test('L15 pending conversion retains every vector and destination, then resumes uninstall', async t => {
  const { f, d } = await pendingUninstallFixture(t);
  await f.setState('claude', { fail: 'mcp remove cairn-local' });
  const result = await f.run(['uninstall', '--local'], { interactive: true, answers: ['y'] });
  assert.equal(result.code, 1, result.display); assert.equal(result.prompts.length, 1);
  const converted = await f.descriptor(); assert.equal(converted.state, 'uninstalling');
  assert.deepEqual(converted.operation.clients, ['claude', 'codex']);
  for (const client of ['claude', 'codex']) {
    assert.deepEqual(structuredClone(converted.operation.checkpoints[client]), { ...d.operation.checkpoints[client], state: 'detaching' });
  }
  await f.setState('claude', {});
  const resumed = await f.run(['uninstall', '--local']); assert.equal(resumed.code, 0, resumed.display);
  assert.equal(resumed.prompts.length, 0); assert.equal((await f.descriptor()).state, 'uninstalled');
});
test('L15 pending --yes detaches all checkpoints; alternate home and purge scope write nothing', async t => {
  const { f } = await pendingUninstallFixture(t), before = await f.inventory();
  for (const args of [['uninstall', '--local', '--yes', '--purge-config', '--client', 'codex'], ['uninstall', '--local', '--yes']]) {
    const changed = await f.run(args, { env: { CODEX_HOME: join(f.home, 'alternate') } });
    assert.equal(changed.code, 2, changed.display); assert.deepEqual(await f.inventory(), before);
  }
  const result = await f.run(['uninstall', '--local', '--yes']); assert.equal(result.code, 0, result.display);
  assert.equal((await f.descriptor()).state, 'uninstalled');
});
test('L15 orphan in an alternate Codex home retains engine and the original home', async t => {
  const f = await localFixture(t), { vector } = await seed(f);
  await rm(join(f.root, 'installation.json')); await mkdir(join(f.root, 'engine'), { mode: 0o700 });
  await writeFile(join(f.root, 'engine/retained'), 'keep');
  const alternate = join(f.home, 'alternate'); await mkdir(alternate, { mode: 0o700 });
  await writeFile(join(alternate, 'config.toml'), codexSnippet(f.root, vector), { mode: 0o600 });
  const original = await readFile(join(f.codexHome, 'config.toml'));
  const result = await f.run(['uninstall', '--local', '--client', 'codex', '--yes'], { env: { CODEX_HOME: alternate } });
  assert.equal(result.code, 0, result.display); assert.match(result.display, /engine is retained/);
  assert.deepEqual(await readFile(join(f.codexHome, 'config.toml')), original);
  assert.equal(await readFile(join(f.root, 'engine/retained'), 'utf8'), 'keep');
});
for (const args of [['setup'], ['setup', '--cloud']]) test('L22 unknown plus local precedes cloud conflict: ' + args.join(' '), async t => {
  const f = await localFixture(t); await seed(f); await f.setState('claude', { fail: 'plugin list --json' });
  const before = await f.inventory(), result = await f.run(args);
  assert.equal(result.code, 2, result.display); assert.match(result.display, /Cannot inspect Claude Code/);
  assert.doesNotMatch(result.display, /Detach it before cloud setup/); assert.deepEqual(await f.inventory(), before);
});
test('L17 invalid options and dry-run precede invalid-descriptor recovery', async t => {
  const f = await localFixture(t); await seed(f); await writeFile(join(f.root, 'installation.json'), '{bad');
  const before = await f.inventory();
  const invalid = await f.run(['setup', '--local', '--endpoint', 'https://cairn.ink']);
  assert.equal(invalid.code, 2); assert.match(invalid.display, /This option is not available/);
  assert.doesNotMatch(invalid.display, /cannot be read safely/);
  const dry = await f.run(['setup', '--local', '--dry-run']); assert.equal(dry.code, 0, dry.display);
  assert.deepEqual(await f.inventory(), before);
});
for (const interactive of [false, true]) test('invalid descriptor without entries requires recovery before mode choice: ' + interactive, async t => {
  const f = await localFixture(t); await mkdir(f.root, { mode: 0o700 });
  await writeFile(join(f.root, 'installation.json'), '{bad', { mode: 0o600 });
  const before = await f.inventory(), result = await f.run(['setup'], { interactive });
  assert.equal(result.code, 2, result.display); assert.match(result.display, /record cannot be read safely/);
  assert.equal(result.prompts.length, 0); assert.doesNotMatch(result.display, /Where should memory live|Choose local or cloud/);
  assert.deepEqual(await f.inventory(), before);
  const dry = await f.run(['setup', '--dry-run'], { interactive });
  assert.equal(dry.code, 0, dry.display); assert.match(dry.display, /Preview:/); assert.match(dry.display, /record cannot be read safely/);
  assert.equal(dry.prompts.length, 0); assert.ok(dry.literals.includes(shellArgument(join(f.root, 'installation.json'))));
  assert.deepEqual(await f.inventory(), before);
});
for (const effective of [false, true]) for (const flags of [['--codex-daily-cap', '1'], ['--codex-capture-exec', 'on']])
test('local options precede hosted Claude option checks: ' + effective + ' ' + flags[0], async t => {
  const f = await localFixture(t); if (effective) await seed(f);
  const before = await f.inventory(), result = await f.run(['setup', ...(effective ? [] : ['--local']), '--client', 'claude', ...flags]);
  assert.equal(result.code, 2, result.display); assert.match(result.display, /This option is not available for the current local memory setup/);
  assert.doesNotMatch(result.display, /only for Codex|requires --client codex/);
  assert.equal(result.prompts.length, 0); assert.deepEqual(await f.inventory(), before);
});
for (const mode of [0o500, 0o755]) for (const directory of ['root', 'engine', 'generation', 'app', 'npm-cache', 'data'])
test('L16 exact owned directory mode: ' + directory + ' ' + mode.toString(8), async t => {
  const f = await localFixture(t); await seed(f);
  const generation = join(f.root, 'engine', engineId);
  await mkdir(join(generation, 'app'), { recursive: true, mode: 0o700 });
  await mkdir(join(f.root, 'engine/npm-cache'), { mode: 0o700 }); await mkdir(join(f.root, 'data'), { mode: 0o700 });
  const path = { root: f.root, engine: join(f.root, 'engine'), generation, app: join(generation, 'app'),
    'npm-cache': join(f.root, 'engine/npm-cache'), data: join(f.root, 'data') }[directory];
  await chmod(path, mode); const before = await f.inventory();
  try {
  for (const args of [['setup', '--local'], ['uninstall', '--local', '--yes']]) {
    const result = await f.run(args); assert.equal(result.code, 2, result.display);
    assert.match(result.display, /directory is unsafe/); assert.deepEqual(await f.inventory(), before);
  }
  } finally { await chmod(path, 0o700); }
});
for (const mode of [0o500, 0o755]) test('caller-supplied npm cache does not mask root locks: ' + mode.toString(8), async t => {
  const f = await localFixture(t), cache = join(f.ws, 'external-cache');
  await mkdir(cache, { mode }); await mkdir(f.root, { mode: 0o700 });
  const lock = join(f.root, '.setup.lock');
  await writeFile(lock, JSON.stringify({ pid: 2147483647, startedAt: new Date().toISOString(), child: null }), { mode: 0o600 });
  try {
    const before = await f.inventory();
    const result = await f.run(['setup', '--local'], { env: { CAIRN_SETUP_NPM_CACHE: cache } });
    assert.equal(result.code, 2, result.display); assert.match(result.display, /stopped setup left a lock/);
    assert.ok(result.literals.some(line => line.startsWith('rm -- '))); assert.deepEqual(await f.inventory(), before);
    assert.equal((await lstat(cache)).mode & 0o777, mode); assert.deepEqual(await readdir(cache), []);
  } finally { await chmod(cache, 0o700); }
});
test('L16 symlinked installation root is local_root_invalid without mutation', async t => {
  const f = await localFixture(t), target = join(f.home, 'target'); await mkdir(target, { mode: 0o700 }); await symlink(target, f.root);
  const before = await readFile(f.paths.claude), result = await f.run();
  assert.equal(result.code, 2); assert.match(result.display, /directory is unsafe/);
  assert.deepEqual(await readdir(target), []); assert.deepEqual(await readFile(f.paths.claude), before);
});
test('L12 failed Claude replacement and failed restore produce a typed restore command', async t => {
  const f = await localFixture(t), { d, vector } = await seed(f, { state: 'pending' });
  d.operation.checkpoints.claude.previous = { ...vector };
  d.operation.checkpoints.claude.desired.node = '/synthetic/new-node';
  await withLocalLock(f.root, () => writeDescriptor(f.root, d)); await f.setState('claude', { failAdds: true });
  const result = await f.run([], { direct: 'claude' }); assert.equal(result.code, 1, result.display);
  assert.match(result.display, /claude_mcp_restore_failed/); assert.ok(result.literals.includes(claudeSnippet(f.root, vector)));
});
test('L13 Codex native verification mismatch leaves the written entry and prints TOML', async t => {
  const f = await localFixture(t), { d } = await seed(f, { state: 'pending' });
  d.operation.checkpoints.codex.desired.node = '/synthetic/new-node';
  await withLocalLock(f.root, () => writeDescriptor(f.root, d)); await f.setState('codex', { verificationMismatch: true });
  const result = await f.run([], { direct: 'codex' }); assert.equal(result.code, 1, result.display);
  assert.match(result.display, /codex_mcp_unverified/); assert.ok(result.literals.includes('[mcp_servers."cairn-local"]'));
  assert.match(await readFile(join(f.codexHome, 'config.toml'), 'utf8'), /synthetic\/new-node/);
});
for (const state of ['none', 'cloud', 'local', 'mixed', 'unknown', 'missing-node', 'failed', 'uninstalled', 'uninstalled-drift']) for (const lang of ['zh', 'en'])
test('L14 status snapshot ' + state + ' ' + lang, async t => {
  const f = await localFixture(t);
  if (['uninstalled', 'uninstalled-drift'].includes(state)) {
    const { d, vector } = await seed(f, { state: 'pending', register: false });
    Object.assign(d, { state: 'uninstalled', engine: null, node: null, operation: null });
    await withLocalLock(f.root, () => writeDescriptor(f.root, d));
    if (state === 'uninstalled-drift') {
      const added = spawnSync(join(f.bin, 'claude'), claudeAddArguments(f.root, vector),
        { env: f.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
      assert.equal(added.status, 0, added.stderr);
    }
  } else if (!['none', 'cloud'].includes(state)) {
    const { d } = await seed(f);
    const executable = executableFor(f.root, engineId);
    await mkdir(dirname(executable), { recursive: true, mode: 0o700 });
    await writeFile(executable, '// Synthetic status fixture: this file must never execute.\n');
    if (state === 'missing-node') { d.node = '/synthetic/missing-node'; await withLocalLock(f.root, () => writeDescriptor(f.root, d)); }
    if (state === 'failed') await mkdir(join(f.root, 'engine', engineId + '.failed-123'), { recursive: true, mode: 0o700 });
  }
  if (['cloud', 'mixed'].includes(state)) await f.setState('claude', { installed: true, configured: true, endpoint: 'https://cairn.ink' });
  if (state === 'unknown') await f.setState('claude', { fail: 'plugin list --json' });
  const before = await f.inventory(), counts = Object.fromEntries(await Promise.all(['claude', 'codex'].map(async c => [c, (await f.calls(c)).length])));
  const result = await f.run(['status', '--lang', lang, ...(state === 'failed' ? ['--verbose'] : [])]);
  assert.equal(result.code, state === 'unknown' ? 7 : 0, result.display);
  assert.deepEqual(await f.inventory(), before); await assert.rejects(lstat(join(f.root, 'data/memory.sqlite')), { code: 'ENOENT' });
  for (const client of ['claude', 'codex']) {
    const calls = (await f.calls(client)).slice(counts[client]).map(c => c.args.join(' '));
    const allow = client === 'claude' ? ['--version', 'plugin list --json', 'plugin configure cairn-memory@cairn-memory --json', 'mcp get cairn', 'plugin marketplace add --help', 'plugin install --help', 'plugin list --help', 'plugin marketplace list --help', 'plugin configure --help', 'plugin marketplace list --json'] : ['--version', 'mcp list --json', 'mcp get cairn --json', 'mcp add --help', 'mcp get --help'];
    assert.ok(calls.every(call => allow.includes(call)), JSON.stringify(calls));
  }
  for (const line of result.display.trimEnd().split('\n')) if (!result.literals.includes(line)) assert.ok(columns(line) <= 80, line);
  const screen = result.display.replaceAll(f.home, '<HOME>').replaceAll(process.execPath, '<NODE>').replace(/\d+\.\d+\.\d+(?:-[\w.]+)?-[0-9a-f]{12}(?:-r\d+)?/gu, '<engine-id>')
    .replaceAll(version, '<version>').replace(/local-[a-f0-9]{16}/gu, '<owner>').replace(/[ \t]+$/gmu, '');
  const path = new URL('./snapshots/local-status-' + state + '-' + lang + '.txt', import.meta.url);
  if (process.env.UPDATE_SETUP_SNAPSHOTS === '1') await writeFile(path, screen);
  assert.equal(screen, await readFile(path, 'utf8'));
});
for (const unavailable of [false, true]) test('L14 uninstalled record cannot claim detachment without observed absence: ' + unavailable, async t => {
  const f = await localFixture(t);
  const { d } = await seed(f, { state: 'pending', register: false });
  Object.assign(d, { state: 'uninstalled', engine: null, node: null, operation: null });
  await withLocalLock(f.root, () => writeDescriptor(f.root, d));
  if (unavailable) await rm(join(f.bin, 'codex'));
  else await f.claudeConfig('{bad');
  const before = await f.inventory(), result = await f.run(['status']);
  assert.equal(result.code, 0, result.display);
  assert.match(result.display, /Registration: unknown/u);
  assert.match(result.display, /Local record uninstalled: setup --local re-adopts; uninstall --local detaches\./u);
  assert.doesNotMatch(result.display, /Local memory is detached/u);
  assert.deepEqual(await f.inventory(), before);
});
test('L23 recovery rm command round-trips with shell metacharacters', async t => {
  const f = await localFixture(t, { suffix: ' space $ ` " \' \\' }); await mkdir(f.root, { mode: 0o700 });
  await writeFile(join(f.root, '.setup.lock'), JSON.stringify({ pid: 2147483647, startedAt: new Date().toISOString() }), { mode: 0o600 });
  const result = await f.run(); assert.equal(result.code, 2);
  const command = result.literals.find(line => line.startsWith('rm -- ')); assert.ok(command);
  const removed = spawnSync('/bin/sh', ['-c', command], { env: { ...f.env, PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  assert.equal(removed.status, 0, removed.stderr); await assert.rejects(lstat(join(f.root, '.setup.lock')), { code: 'ENOENT' });
  assert.equal((await f.run(['setup', '--local', '--dry-run'])).code, 0);
});
test('L23 manual TOML parses through the real Codex binary in a private home', async t => {
  const f = await localFixture(t, { suffix: ' space $ ` " \' \\' });
  const { access } = await import('node:fs/promises'); let executable;
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    try { const path = join(directory, 'codex'); await access(path, 1); executable = path; break; } catch { /* Next PATH directory. */ }
  }
  if (!executable) { t.skip('Real codex binary is not on PATH; fake TOML checks remain covered separately.'); return; }
  const { vector } = await seed(f, { register: false }); await f.config(codexSnippet(f.root, vector));
  const result = spawnSync(executable, ['mcp', 'list', '--json'], { env: { ...f.env, PATH: process.env.PATH, TMPDIR: f.ws }, cwd: f.ws,
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
  if (result.error?.code === 'EPERM') { t.skip('Sandbox blocks real Codex child pipes (EPERM).'); return; }
  assert.equal(result.status, 0, result.stderr);
  const entry = JSON.parse(result.stdout).find(entry => entry.name === 'cairn-local');
  assert.equal(entry.transport.command, vector.node); assert.deepEqual(entry.transport.args, codexAddArguments(f.root, vector).slice(5));
});
for (const corruption of ['missing', 'malformed']) test('typed manifest failure: ' + corruption, async t => {
  const scratch = createTestWorkspace(t, { prefix: 'cairn-invalid-bundle-' });
  const copy = join(scratch.path, 'package'); await cp(packageRoot, copy, { recursive: true });
  const path = join(copy, 'runtime/engine/manifest.json');
  if (corruption === 'missing') await rm(path); else await writeFile(path, '{bad');
  const f = await localFixture(t, { testedPackageRoot: copy }), cache = join(f.ws, 'shared-cache');
  await mkdir(cache, { mode: 0o755 });
  const result = await f.run(['setup', '--local'], { env: { CAIRN_SETUP_NPM_CACHE: cache } });
  assert.equal(result.code, 1, result.display); assert.match(result.display, /bundle is invalid/); assert.doesNotMatch(result.display, /Setup failed/);
});
test('filesystem failures contain only typed keys and code parameters', async t => {
  const f = await localFixture(t); await seed(f, { state: 'pending' });
  const { registerCodex } = await fromPackage('local-codex');
  const { translator } = await fromPackage('messages');
  const file = join(f.home, 'not-a-directory'); await writeFile(file, 'private path must not escape');
  await assert.rejects(canonicalPath(join(file, 'child')), error => error.key === 'local_root_invalid' && Object.keys(error.params).join() === 'code');
  await assert.rejects(registerCodex({ root: f.root, checkpoint: (await f.descriptor()).operation.checkpoints.codex,
    env: { ...f.env, CODEX_HOME: join(file, 'child') }, write: () => {}, t: translator('en') }),
    error => error.key === 'codex_mcp_unverified' && Object.keys(error.params).join() === 'code');
});
test('L10 SIGKILL during npm retains child ownership and quarantines a fresh generation', async t => {
  const scratch = createTestWorkspace(t, { prefix: 'cairn-blocking-npm-' }), bin = join(scratch.path, 'bin');
  await mkdir(bin);
  // S1 puts the running Node directory first on PATH. A private Node copy lets
  // this test replace only its sibling npm, without changing the real tools.
  const node = join(bin, 'node'), npm = join(bin, 'npm'), receipt = join(scratch.path, 'npm.json');
  await copyFile(process.execPath, node, constants.COPYFILE_FICLONE); await chmod(node, 0o755);
  await writeFile(npm, `#!${node}\nconst{writeFileSync}=require('node:fs');
    writeFileSync(${JSON.stringify(receipt)},JSON.stringify({pid:process.pid,parent:process.ppid}));
    setInterval(()=>{},1000);`, { mode: 0o755 });
  const f = await localFixture(t, { nodeExecutable: node });
  let setup, npmPid;
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
  const stop = pid => { if (pid && alive(pid)) process.kill(pid, 'SIGKILL'); };
  f.defer(() => { if (setup?.exitCode === null && setup?.signalCode === null) setup.kill('SIGKILL'); stop(npmPid); });
  async function waitFor(check, description) {
    const deadline = Date.now() + 15000;
    while (!await check()) { assert.ok(Date.now() < deadline, description); await delay(20); }
  }
  const running = f.run(['setup', '--local'], { onSpawn: child => { setup = child; } });
  await waitFor(async () => {
    try {
      const child = await json(receipt), lock = await json(join(f.root, '.setup.lock'));
      npmPid = child.pid; return lock.child === npmPid && child.parent === setup.pid;
    } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return false; throw error; }
  }, 'npm started and its pid was durably recorded');
  const lock = await json(join(f.root, '.setup.lock'));
  assert.deepEqual(Object.keys(lock).sort(), ['child', 'pid', 'startedAt']);
  assert.equal(lock.pid, setup.pid); assert.equal(lock.child, npmPid); assert.ok(alive(npmPid));
  const generation = join(f.root, 'engine', engineId), marker = join(generation, 'interrupted-npm');
  await writeFile(marker, 'incomplete generation');
  setup.kill('SIGKILL'); assert.equal((await running).signal, 'SIGKILL'); assert.ok(alive(npmPid));
  const before = await f.inventory(), survivor = await f.run(['setup', '--local']);
  assert.equal(survivor.code, 2, survivor.display); assert.match(survivor.display, /Wait for it to finish/);
  assert.doesNotMatch(survivor.display, /A stopped setup/); assert.deepEqual(await f.inventory(), before);
  stop(npmPid); await waitFor(() => !alive(npmPid), 'orphan npm was reaped after SIGKILL');
  const stale = await f.run(['setup', '--local']);
  assert.equal(stale.code, 2, stale.display); assert.match(stale.display, /A stopped setup/);
  assert.deepEqual(await f.inventory(), before);
  const remove = stale.literals.find(line => line.startsWith('rm -- ')); assert.equal(remove, 'rm -- ' + shellArgument(join(f.root, '.setup.lock')));
  const removed = spawnSync('/bin/sh', ['-c', remove], { env: { ...f.env, PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(removed.status, 0);
  const primed = engineCacheComplete(process.env.CAIRN_SETUP_NPM_CACHE);
  await rm(npm);
  if (primed) await symlink(join(dirname(process.execPath), 'npm'), npm);
  else await writeFile(npm, `#!${node}\nprocess.exit(1);`, { mode: 0o755 });
  const resumed = await f.run(['setup', '--local']);
  assert.equal(resumed.code, primed ? 0 : 1, resumed.display);
  const quarantines = (await readdir(join(f.root, 'engine'))).filter(name => name.startsWith(engineId + '.failed-'));
  assert.ok(quarantines.length > 0);
  assert.equal((await Promise.all(quarantines.map(async name => {
    try { return await readFile(join(f.root, 'engine', name, 'interrupted-npm'), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }))).filter(value => value === 'incomplete generation').length, 1);
  await t.test('completion with the primed real npm cache', async child => {
    if (!needCache(child)) return;
    const current = await f.descriptor(); assert.equal(current.state, 'installed'); assert.equal(current.engine.id, engineId);
    for (const client of ['claude', 'codex']) assert.equal(current.clients[client].vector.engineId, engineId);
  });
});
test('L10 manifest-digest upgrade installs beside the published generation', async t => {
  const scratch = createTestWorkspace(t, { prefix: 'cairn-manifest-upgrade-' }), copy = join(scratch.path, 'package');
  await cp(packageRoot, copy, { recursive: true });
  const changedBytes = Buffer.from(JSON.stringify(manifest, null, 4) + '\n');
  assert.notDeepEqual(changedBytes, manifestBytes); assert.deepEqual(JSON.parse(changedBytes), manifest);
  await writeFile(join(copy, 'runtime/engine/manifest.json'), changedBytes);
  const nextId = engineIdFor(version, changedBytes); assert.notEqual(nextId, engineId);
  const copyVersion = JSON.parse(await readFile(join(copy, 'package.json'))).version; assert.equal(copyVersion, version);
  await t.test('both registrations move to the changed manifest generation', async child => {
    if (!needCache(child)) return;
    // Switch the package bytes while preserving the same fixture and client homes.
    const f = await localFixture(t); const first = await f.run(); assert.equal(first.code, 0, first.display);
    const old = await f.descriptor(), oldTree = await files(join(f.root, 'engine', old.engine.id));
    const harness = join(f.ws, 'harness.mjs'), original = await readFile(harness, 'utf8');
    await writeFile(harness, original.split(pathToFileURL(join(packageRoot, 'lib')).href).join(pathToFileURL(join(copy, 'lib')).href));
    const result = await f.run(['setup']); assert.equal(result.code, 0, result.display);
    const current = await f.descriptor(); assert.equal(current.installerVersion, version); assert.equal(current.engine.id, nextId);
    assert.equal(current.ownerId, old.ownerId); assert.deepEqual(await files(join(f.root, 'engine', old.engine.id)), oldTree);
    const generations = await readdir(join(f.root, 'engine')); assert.ok(generations.includes(old.engine.id)); assert.ok(generations.includes(nextId));
    for (const client of ['claude', 'codex']) assert.equal(current.clients[client].vector.engineId, nextId);
    const { readClaudeServers } = await fromPackage('local-claude'), { inspectCodexServers } = await fromPackage('codex');
    assert.equal((await readClaudeServers(f.home))['cairn-local'].args[0], executableFor(f.root, nextId));
    const entries = await inspectCodexServers({ home: f.codexHome, env: f.env });
    assert.equal(entries.find(entry => entry.name === 'cairn-local').args[0], executableFor(f.root, nextId));
  });
});
test('L10 installer-version upgrade installs beside the published generation', async t => {
  if (!needCache(t)) return;
  const f = await localFixture(t); assert.equal((await f.run()).code, 0);
  const previous = await f.descriptor(), path = executableFor(f.root, previous.engine.id), bytes = await readFile(path);
  const nextVersion = '99.0.1', result = await f.run(['setup'], { installerVersion: nextVersion });
  assert.equal(result.code, 0, result.display); const current = await f.descriptor();
  assert.equal(current.engine.id, engineIdFor(nextVersion, manifestBytes)); assert.notEqual(current.engine.id, previous.engine.id);
  assert.deepEqual(await readFile(path), bytes);
  for (const client of ['claude', 'codex']) assert.equal(current.clients[client].vector.engineId, current.engine.id);
  assert.ok((await readdir(join(f.root, 'engine'))).includes(previous.engine.id));
});
for (const boundary of ['claude-add', 'after-claude-done', 'after-codex-add'])
test('L10/L11/L12 actual SIGKILL, stale-lock recovery and resume: ' + boundary, async t => {
  if (!needCache(t)) return;
  const f = await localFixture(t); assert.equal((await f.run()).code, 0);
  const d = await f.descriptor(), owner = d.ownerId;
  if (boundary === 'claude-add') {
    const desired = { ...d.clients.claude.vector, node: process.execPath };
    d.clients.claude.vector.node = '/synthetic/previous-node';
    const native = await json(join(f.home, '.claude.json')); native.mcpServers['cairn-local'].command = '/synthetic/previous-node'; await f.claudeConfig(native);
    await withLocalLock(f.root, () => writeDescriptor(f.root, d));
    const normalized = claudeAddArguments(f.root, desired).filter((_, i, args) => i !== args.indexOf('--scope') && i !== args.indexOf('--scope') + 1).join(' ');
    await f.setState('claude', { killBefore: normalized });
  } else if (boundary === 'after-claude-done') {
    // Capability probes run before mutation. The native add follows Claude's
    // durable done checkpoint and is intercepted before changing Codex config.
    await f.setState('codex', { killBefore: codexAddArguments(f.root, d.clients.codex.vector).join(' ') });
  } else await f.setState('codex', { killAfterAdd: true });
  const killed = await f.run(['setup']); assert.equal(killed.signal, 'SIGKILL');
  const saved = await f.descriptor(); assert.equal(saved.state, 'pending');
  if (boundary !== 'claude-add') assert.equal(saved.operation.checkpoints.claude.state, 'done');
  assert.equal((await json(join(f.root, '.setup.lock'))).child, null);
  if (boundary === 'after-codex-add') {
    const before = await f.inventory(), moved = await f.run(['setup'], { env: { CODEX_HOME: join(f.home, 'alternate') } });
    assert.equal(moved.code, 2); assert.match(moved.display, /configuration home changed/); assert.deepEqual(await f.inventory(), before);
    assert.match(await readFile(join(f.codexHome, 'config.toml'), 'utf8'), /cairn-local/);
  }
  // Codex recovery can precede the root-lock step because both are preflight.
  for (let step = 0; step < 3; step++) {
    const result = await f.run(['setup']);
    if (result.code === 0) { assert.equal(result.prompts.length, 0); break; }
    assert.equal(result.code, 2, result.display);
    const command = result.literals.find(line => line.startsWith('rm -- ')); assert.ok(command, result.display);
    const removed = spawnSync('/bin/sh', ['-c', command], { env: { ...f.env, PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(removed.status, 0);
  }
  const current = await f.descriptor(); assert.equal(current.state, 'installed'); assert.equal(current.ownerId, owner);
});

// Every F1 candidate and simulated managed file lives in the owned fixture.
async function inspectionFixture(f, { blocked = false, managed = false, inside = false, outside = false } = {}) {
  const primary = join(outside ? f.ws : f.home, 'tmp'), fallback = join(inside ? f.home : f.ws, 'fallback');
  await mkdir(primary, { mode: 0o700 }); await mkdir(fallback, { mode: 0o700 });
  const managedPaths = [join(f.ws, 'managed-config'), join(f.ws, 'managed-overlay')];
  if (blocked) {
    await f.config('');
    await mkdir(join(fallback, '.codex'), { mode: 0o700 });
    await writeFile(join(fallback, '.codex/config.toml'), '', { mode: 0o600 });
  }
  if (managed) await writeFile(managedPaths[1], '', { mode: 0o600 });
  return { library: true, env: { TMPDIR: primary }, inspection: { fallbackParent: fallback, managedPaths }, primary, fallback };
}
async function noAttempts(options) {
  for (const path of [options.primary, options.fallback])
    assert.deepEqual((await readdir(path)).filter(name => name.startsWith('cairn-codex-inspect-')), []);
}
for (const cause of ['codex_tmpdir', 'codex_managed']) {
  for (const installed of [false, true]) test(`L27/L28 ${cause}: ${installed ? 'installed' : 'fresh'} refusal matrix`, async t => {
    const f = await localFixture(t);
    if (installed) {
      await seed(f);
      await mkdir(join(f.root, 'engine', engineId), { recursive: true, mode: 0o700 });
      await writeFile(join(f.root, 'engine', engineId, 'retained'), 'retained engine bytes', { mode: 0o600 });
    }
    const options = await inspectionFixture(f, { blocked: cause === 'codex_tmpdir', managed: cause === 'codex_managed' });
    const args = installed ? [['setup'], ['setup', '--dry-run'], ['uninstall', '--local', '--yes'],
      ['uninstall', '--local', '--client', 'codex', '--yes']] : [['setup'], ['setup', '--client', 'claude'],
      ['setup', '--cloud'], ['setup', '--local'], ['setup', '--local', '--dry-run']];
    const before = await f.inventory();
    for (const lang of ['en', 'zh']) for (const argv of args) {
      const calls = (await f.calls('codex')).length, claudeCalls = (await f.calls('claude')).length;
      const result = await f.run([...argv, '--lang', lang], options);
      assert.equal(result.code, 2, result.display);
      const t = translator(lang), lines = result.display.trimEnd().split('\n');
      const pair = [t('mode_unknown', { client: 'Codex', probe: cause === 'codex_tmpdir' ? 'TMPDIR' : '/etc/codex' }), t(cause)];
      for (const line of pair) assert.equal(lines.filter(value => value === line).length, 1, result.display);
      const start = lines.indexOf(pair[0]);
      assert.deepEqual(lines.slice(start, start + 2), pair, result.display);
      assert.deepEqual(await f.inventory(), before);
      assert.equal((await f.calls('codex')).slice(calls).some(call => ['add', 'remove'].includes(call.args[1]) && !call.args.includes('--help')), false);
      assert.equal((await f.calls('claude')).slice(claudeCalls).some(call => call.args[0] === 'mcp'), false);
      await noAttempts(options);
    }
    if (installed) {
      for (const argv of [['status'], ['status', '--client', 'claude']]) {
        const result = await f.run(argv, options); assert.equal(result.code, 0, result.display);
        assert.match(result.display, /Registration: unknown/);
        const diagnostic = result.display.split('\n').filter(line => /TMPDIR|System-managed Codex|system-managed Codex/u.test(line));
        assert.equal(diagnostic.length, 1, result.display);
        const deduplicated = await f.run(argv, { ...options, emitted: [cause] });
        assert.equal(deduplicated.display.split('\n').filter(line => /TMPDIR|System-managed Codex|system-managed Codex/u.test(line)).length, 0, deduplicated.display);
      }
      const scoped = await f.run(['uninstall', '--local', '--client', 'claude', '--yes'], options);
      assert.equal(scoped.code, 0, scoped.display);
      const d = await f.descriptor(); assert.equal(d.state, 'installed'); assert.equal(d.clients.claude, null); assert.ok(d.clients.codex);
    }
  });
  test(`L27/L28 ${cause}: detached Codex resume retains engine after final detection`, async t => {
    const f = await localFixture(t), { d } = await seed(f);
    await mkdir(join(f.root, 'engine', engineId), { recursive: true, mode: 0o700 });
    const retained = join(f.root, 'engine', engineId, 'retained');
    await writeFile(retained, 'retained engine bytes', { mode: 0o600 });
    const options = await inspectionFixture(f, { blocked: cause === 'codex_tmpdir', managed: cause === 'codex_managed' });
    beginOperation(d, 'uninstall', ['claude', 'codex'], { claude: f.home, codex: join(f.codexHome, 'config.toml') });
    recordClient(d, 'codex', null);
    await withLocalLock(f.root, () => writeDescriptor(f.root, d));
    const codexCalls = (await f.calls('codex')).length;
    const result = await f.run(['uninstall', '--local', '--yes'], options);
    assert.equal(result.code, 2, result.display);
    assert.ok(result.display.includes(translator('en')('local_uninstall_retained')), result.display);
    assert.equal((await f.descriptor()).state, 'uninstalling');
    assert.equal((await f.descriptor()).clients.claude, null);
    assert.equal(await readFile(retained, 'utf8'), 'retained engine bytes');
    assert.equal((await f.calls('codex')).length, codexCalls);
    await noAttempts(options);
  });
}
for (const present of [false, true]) test(`L25 fresh fallback lifecycle (config present: ${present})`, async t => {
  if (!needCache(t)) return;
  const f = await localFixture(t), options = await inspectionFixture(f);
  if (present) await f.config('model = "fixture"\n');
  const result = await f.run(['setup', '--local'], options);
  assert.equal(result.code, 0, result.display); assert.equal((await f.descriptor()).state, 'installed');
  const status = await f.run(['status'], options); assert.equal(status.code, 0, status.display);
  assert.equal(status.display.match(/Registration: registered/gu)?.length, 2);
  const removed = await f.run(['uninstall', '--local', '--yes'], options);
  assert.equal(removed.code, 0, removed.display); assert.equal((await f.descriptor()).state, 'uninstalled');
  await noAttempts(options);
});
test('L26 hidden Codex ownership remains orphan with fallback', async t => {
  const f = await localFixture(t); await seed(f, { selected: ['codex'] });
  const options = await inspectionFixture(f); options.env.CAIRN_MEMORY_HOME = join(f.home, 'hidden-root');
  const before = await f.inventory();
  for (const args of [['setup'], ['setup', '--client', 'claude']]) {
    const result = await f.run(args, options); assert.equal(result.code, 2, result.display);
    assert.match(result.display, /installation record/u); assert.doesNotMatch(result.display, /HOSTED/u);
    assert.deepEqual(await f.inventory(), before);
  }
  await noAttempts(options);
});
for (const cloud of [false, true]) for (const args of [['status'], ['status', '--client', 'codex']])
test(`L35 local${cloud ? ' and cloud' : '-only'} status fallback matches neutral parent: ${args.join(' ')}`, async t => {
  const f = await localFixture(t); await seed(f);
  if (cloud) await f.config(await readFile(join(f.codexHome, 'config.toml'), 'utf8') +
    '[mcp_servers.cairn]\nurl = "https://cairn.ink/api/mcp"\n');
  const options = await inspectionFixture(f);
  // Supply an executable receipt without installing or starting an engine.
  const executable = executableFor(f.root, engineId);
  await mkdir(dirname(executable), { recursive: true }); await writeFile(executable, '// status fixture\n');
  const before = await f.inventory();
  const control = await f.run(args, { ...options, library: false, env: { TMPDIR: options.fallback } });
  const result = await f.run(args, { ...options, library: false });
  assert.equal(control.code, 0, control.display);
  assert.equal(result.code, 0, result.display);
  assert.equal(result.stdout, control.stdout);
  assert.doesNotMatch(result.display, /TMPDIR has ancestor/u);
  assert.match(result.display, /Registration: registered/u);
  assert.deepEqual(await f.inventory(), before); await noAttempts(options);
});

// Exercise the hosted boundary directly so dispatch's generic failure wrapper
// cannot hide whether a body error was wrongly remapped by the selector.
test('L36 selector refusals retain SetupError code/params; hosted body errors keep identity', async t => {
  const { SetupError } = await fromPackage('errors');
  const f = await localFixture(t);
  const options = await inspectionFixture(f, { blocked: true });
  const originalEnv = process.env;
  const context = { action: 'status', flags: [], SetupError, write: () => {}, t: key => key, inspection: options.inspection };
  try {
    process.env = { ...originalEnv, ...f.env, TMPDIR: options.primary };
    for (const key of ['codex_tmpdir', 'codex_managed']) {
      if (key === 'codex_managed') {
        await rm(join(options.fallback, '.codex'), { recursive: true });
        await writeFile(options.inspection.managedPaths[1], '');
      }
      await assert.rejects(setupCodex(context), error => {
        assert.ok(error instanceof SetupError); assert.equal(error.key, key);
        assert.equal(error.code, 1); assert.deepEqual(error.params, {}); return true;
      });
    }
    let nestedSelectorError;
    await assert.rejects(withCodexInspectionEnvironment({ env: process.env, ...options.inspection }), error => { nestedSelectorError = error; return true; });
    await rm(options.inspection.managedPaths[1]);
    await assert.rejects(setupCodex({ ...context, write: () => { throw nestedSelectorError; } }), error => error === nestedSelectorError);
    const bodyError = Object.assign(new Error('body refusal'), { key: 'codex_managed' });
    await assert.rejects(setupCodex({ ...context, write: () => { throw bodyError; } }), error => error === bodyError);
    const bodySetupError = new SetupError('codex_tmpdir', 7, { body: true });
    await assert.rejects(setupCodex({ ...context, write: () => { throw bodySetupError; } }), error => error === bodySetupError);
    await noAttempts(options);
  } finally { process.env = originalEnv; }
});

for (const cause of ['codex_tmpdir', 'codex_managed', 'both']) for (const argv of [
  ['status'], ['status', '--client', 'claude'], ['--client', 'claude', 'status'],
  ['status', '--client', 'codex'], ['--client', 'codex', 'status'],
]) test(`L38 status emission bookkeeping: ${cause}; ${argv.join(' ')}`, async t => {
  const f = await localFixture(t); await seed(f);
  const options = await inspectionFixture(f, { blocked: cause === 'codex_tmpdir', managed: cause !== 'codex_tmpdir' });
  if (cause === 'both') await f.config('');
  if (cause === 'codex_managed') options.env.TMPDIR = options.fallback;
  const before = await f.inventory();
  const result = await f.run(argv, { ...options, hostedStatus: true });
  const tmpdirLines = result.display.split('\n').filter(line => line.includes('TMPDIR has ancestor'));
  const managedLines = result.display.split('\n').filter(line => line.includes('system-managed Codex'));
  assert.equal(tmpdirLines.length, cause === 'codex_tmpdir' ? 1 : 0, result.display);
  assert.equal(managedLines.length, cause !== 'codex_tmpdir' ? 1 : 0, result.display);
  assert.deepEqual(await f.inventory(), before);
  await noAttempts(options);
});
for (const action of ['setup', 'uninstall']) test(`Codex pre-check maps unsafe config to local recovery: ${action}`, async t => {
  const f = await localFixture(t), options = await inspectionFixture(f, { outside: true });
  if (action === 'uninstall') await seed(f, { selected: ['codex'] });
  else await f.config('model = "fixture"\n');
  const configPath = join(f.codexHome, 'config.toml');
  if (action === 'uninstall') await chmod(configPath, 0o622);
  const before = await f.inventory(), codexCalls = (await f.calls('codex')).length;
  // Setup must pass detection first. The consent callback then makes the real
  // file unsafe before capability probes and the new pre-check inspect it.
  if (action === 'setup') before['.codex/config.toml'].mode = 0o622;
  const argv = [action, '--local', '--client', 'codex', ...(action === 'uninstall' ? ['--yes'] : [])];
  const result = await f.run(argv, { ...options, library: false, interactive: action === 'setup',
    answers: ['yes'], unsafeCodexOnPrompt: action === 'setup' });
  const translate = translator('en');
  assert.equal(result.code, 2, result.display);
  assert.ok(result.display.includes(translate('codex_mcp_unverified')), result.display);
  assert.ok(!result.display.includes(translate('setup_failed')), result.display);
  if (action === 'setup') {
    assert.ok(result.display.includes(translate('recovery_local_setup')), result.display);
    assert.ok(result.literals.includes('npx @cairn-ink/memory setup --local'), result.display);
    assert.deepEqual((await f.calls('codex')).slice(codexCalls).map(call => call.args), [
      ['mcp', 'list', '--json'], ['mcp', 'add', '--help'], ['mcp', 'remove', '--help'], ['mcp', 'list', '--help'],
    ]);
  } else {
    assert.ok(result.display.includes(translate('local_data_kept')), result.display);
    assert.ok(result.literals.includes('npx @cairn-ink/memory uninstall --local --yes --client codex'), result.display);
    assert.ok(!result.literals.includes('npx @cairn-ink/memory setup --local'), result.display);
    assert.deepEqual((await f.calls('codex')).slice(codexCalls), []);
  }
  assert.deepEqual(await f.inventory(), before);
  await noAttempts(options);
});
test('L29 other unknown precedence and changed destination survive environment refusal', async t => {
  const f = await localFixture(t); await seed(f);
  const options = await inspectionFixture(f, { blocked: true });
  await f.claudeConfig('{invalid');
  for (const args of [['setup', '--local'], ['setup', '--local', '--dry-run']]) {
    const before = await f.inventory(), result = await f.run(args, options);
    assert.equal(result.code, 2, result.display); assert.match(result.display, /Cannot inspect Claude Code/);
    assert.doesNotMatch(result.display, /TMPDIR/u); assert.deepEqual(await f.inventory(), before);
  }
  await rm(join(f.home, '.claude.json'));
  const changed = join(f.ws, 'changed-codex'); await mkdir(changed);
  const result = await f.run(['setup', '--local'], { ...options, env: { ...options.env, CODEX_HOME: changed } });
  assert.equal(result.code, 2, result.display); assert.match(result.display, /destination|home|HOME/u);
  assert.doesNotMatch(result.display, /Cannot inspect Codex|TMPDIR/u);
  const before = await f.inventory();
  const dry = await f.run(['setup', '--local', '--dry-run'], { ...options, env: { ...options.env, CODEX_HOME: changed } });
  assert.equal(dry.code, 0, dry.display); assert.doesNotMatch(dry.display, /TMPDIR/u);
  assert.deepEqual(await f.inventory(), before);
});
test('L29 manual dry-run exemption probes help only after synthetic add pre-check fails', async t => {
  const f = await localFixture(t, { codexState: { noMcpAdd: true } });
  const options = await inspectionFixture(f, { inside: true }), before = await f.inventory();
  const result = await f.run(['setup', '--local', '--dry-run'], options);
  assert.equal(result.code, 0, result.display); assert.match(result.display, /manual|manually/u);
  assert.deepEqual(await f.inventory(), before);
  assert.deepEqual((await f.calls('codex')).map(call => call.args.join(' ')), ['mcp list --json', 'mcp add --help']);
  await noAttempts(options);
});
test('L29 native add plan refuses before creating a fresh root, including pending dry-run', async t => {
  const f = await localFixture(t), options = await inspectionFixture(f, { inside: true });
  for (const args of [['setup', '--local'], ['setup', '--local', '--dry-run']]) {
    const before = await f.inventory(), result = await f.run(args, options);
    assert.equal(result.code, 2, result.display); assert.match(result.display, /TMPDIR/u);
    assert.deepEqual(await f.inventory(), before);
  }
  await seed(f, { state: 'pending', register: false });
  const before = await f.inventory(), result = await f.run(['setup', '--local', '--dry-run'], options);
  assert.equal(result.code, 2, result.display); assert.deepEqual(await f.inventory(), before);
  await noAttempts(options);
});
test('L29 manual setup exemption completes with a manual receipt', async t => {
  if (!needCache(t)) return;
  const f = await localFixture(t, { codexState: { noMcpAdd: true } }), options = await inspectionFixture(f, { inside: true });
  const result = await f.run(['setup', '--local'], options);
  assert.equal(result.code, 1, result.display); assert.equal((await f.descriptor()).state, 'installed');
  assert.match(result.display, /manually/u); assert.doesNotMatch(result.display, /Cannot inspect Codex/u);
});
for (const both of [false, true]) test(`L30 add race re-evaluates candidates (both blocked: ${both})`, async t => {
  const f = await localFixture(t); await seed(f, { state: 'pending', selected: ['codex'], register: false });
  const options = await inspectionFixture(f, { outside: true });
  await withCodexInspectionEnvironment({ ...options.inspection, env: { ...f.env, ...options.env }, plannedConfigPath: join(f.codexHome, 'config.toml') });
  await f.setState('codex', { blockInspectionParents: [options.primary, ...(both ? [options.fallback] : [])] });
  const result = await f.run(['setup', '--local'], { ...options, library: false, direct: 'codex' });
  assert.equal(result.code, both ? 1 : 0, result.display);
  if (both) { assert.match(result.display, /codex_mcp_unverified/u); assert.match(result.display, /TMPDIR/u); }
  else assert.match(result.display, /done/u);
  await noAttempts(options);
});
for (const both of [false, true]) test(`L30 complete setup race (both blocked: ${both})`, async t => {
  if (!needCache(t)) return;
  const f = await localFixture(t), options = await inspectionFixture(f, { outside: true });
  await f.setState('codex', { blockInspectionParents: [options.primary, ...(both ? [options.fallback] : [])] });
  const result = await f.run(['setup', '--local'], options);
  assert.equal(result.code, both ? 1 : 0, result.display);
  if (both) { assert.match(result.display, /verified|verification/u); assert.match(result.display, /TMPDIR/u); }
  else assert.equal((await f.descriptor()).state, 'installed');
  await noAttempts(options);
});
test('L32 candidate selection, canonical paths, private copy and cleanup', async t => {
  const f = await localFixture(t), options = await inspectionFixture(f), primary = options.primary, fallback = options.fallback;
  const base = { env: { ...f.env, TMPDIR: primary }, ...options.inspection };
  const seen = [];
  await withCodexInspectionEnvironment(base, async neutral => { seen.push(neutral); assert.equal((await lstat(neutral)).mode & 0o777, 0o700); });
  assert.equal(dirname(seen[0]), await realpath(primary));
  const alias = join(f.ws, 'alias'); await symlink(primary, alias);
  // Canonical aliases are tried once, including when the candidate is blocked.
  await mkdir(join(primary, '.codex')); await writeFile(join(primary, '.codex/config.toml'), '');
  const originalMkdtemp = fsPromises.mkdtemp, attempts = [];
  const create = t.mock.method(fsPromises, 'mkdtemp', async (...args) => {
    const directory = await originalMkdtemp(...args); attempts.push(directory); return directory;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(withCodexInspectionEnvironment({ ...base, fallbackParent: alias }), { key: 'codex_tmpdir' });
  } finally { create.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(attempts.length, 1, 'Canonical aliases must create exactly one attempt directory');
  assert.equal(dirname(attempts[0]), await realpath(primary));
  await assert.rejects(withCodexInspectionEnvironment({ ...base, platform: 'win32' }), { key: 'codex_tmpdir' });
  const selected = await withCodexInspectionEnvironment(base, async neutral => dirname(neutral));
  assert.equal(selected, await realpath(fallback));
  // A non-directory candidate forces mkdtemp failure after realpath succeeds.
  const notDirectory = join(f.ws, 'file-parent'); await writeFile(notDirectory, '');
  assert.equal(await withCodexInspectionEnvironment({ ...base, env: { TMPDIR: notDirectory } }, async n => dirname(n)), await realpath(fallback));
  await mkdir(join(fallback, '.codex')); await writeFile(join(fallback, '.codex/config.toml'), '');
  await assert.rejects(withCodexInspectionEnvironment(base), { key: 'codex_tmpdir' });
  await rm(join(fallback, '.codex'), { recursive: true });
  await f.config('model = "private-copy"\n');
  await f.setState('codex', { recordInspectionModes: true });
  await inspectCodexServers({ ...base, home: f.codexHome });
  const call = (await f.calls('codex')).at(-1);
  assert.equal(dirname(call.cwd), await realpath(fallback)); assert.equal(call.home, join(call.cwd, 'user-file'));
  assert.deepEqual(call.modes, { cwd: 0o700, home: 0o700, config: 0o600 });
  const cleanAlias = join(f.ws, 'clean-alias'); await symlink(fallback, cleanAlias);
  await inspectCodexServers({ ...base, env: { ...f.env, TMPDIR: cleanAlias }, home: f.codexHome });
  assert.equal(dirname((await f.calls('codex')).at(-1).cwd), await realpath(fallback));
  await noAttempts(options);
});

await Promise.all(pending);
});
