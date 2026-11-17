import runTest from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir, lstat, symlink, utimes } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { assertFixtureClients, fixtureBinaryGuard } from './fixture-clients.mjs';
import { SERDE_MARKERS } from '../../../integrations/codex/schema-evidence.mjs';

runTest('local peer index status contract', async parent => {
const pending = [];
const test = (...args) => { const promise = parent.test(...args); pending.push(promise); return promise; };
const packageRoot = process.env.CAIRN_SETUP_TEST_PACKAGE || fileURLToPath(new URL('../', import.meta.url));

const fromPackage = name => import(pathToFileURL(join(packageRoot, 'lib', name + '.mjs')));
const { newDescriptor, beginOperation, recordClient, withLocalLock, writeDescriptor, readDescriptor, executableFor } = await fromPackage('local-descriptor');
const { engineIdFor } = await fromPackage('local-engine');
const { claudeAddArguments } = await fromPackage('local-claude');
const { codexAddArguments } = await fromPackage('local-codex');
const { terminalWriter } = await fromPackage('output');
const { translator } = await fromPackage('messages');
const version = JSON.parse(await readFile(join(packageRoot, 'package.json'))).version;
const manifestBytes = await readFile(join(packageRoot, 'runtime/engine/manifest.json'));
const manifest = JSON.parse(manifestBytes), engineId = engineIdFor(version, manifestBytes);
const engine = { id: engineId, package: manifest.package.name, packageVersion: manifest.package.version, sha256: manifest.sha256 };
const json = async path => JSON.parse(await readFile(path, 'utf8'));
function databaseSnapshot(path, info) {
  let database;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    const schema = database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name').all();
    const tables = schema.filter(row => row.type === 'table' && !row.name.startsWith('sqlite_'));
    return { schema, userVersion: database.prepare('PRAGMA user_version').get(),
      rows: tables.map(({ name }) => [name, database.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
        .all().map(row => JSON.stringify(row)).sort()]) };
  } catch (error) {
    // A few uninstall fixtures use a non-database sentinel with this suffix.
    // Preserve its metadata without opening a raw descriptor to inspect bytes.
    if (!error.message.includes('file is not a database')) throw error;
    return { sentinelSize: info.size, mtimeMs: info.mtimeMs, ino: info.ino };
  } finally { database?.close(); }
}
async function files(root) {
  const result = {};
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) result[entry.name + '/'] = { directory: true, mode: (await lstat(path)).mode & 0o777 };
      if (entry.isDirectory()) for (const [key, value] of Object.entries(await files(path))) result[entry.name + '/' + key] = value;
      else {
        const info = await lstat(path), sqlite = /\.sqlite(?:-(?:wal|shm|journal))?$/.test(path);
        result[entry.name] = { mode: info.mode & 0o777,
          ...(path.endsWith('.sqlite') ? { database: databaseSnapshot(path, info) } : sqlite ?
            { size: info.size, mtimeMs: info.mtimeMs, ino: info.ino } : { bytes: (await readFile(path)).toString('base64') }) };
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return result;
}
async function localFixture(t, { claude = true, codex = true, claudeState = {}, codexState = {}, suffix = '', testedPackageRoot = packageRoot,
  nodeExecutable = process.execPath } = {}) {
  const ws = createTestWorkspace(t, { prefix: 'cairn-local-status-peer-index-' }), home = join(ws.path, 'home' + suffix), bin = join(ws.path, 'bin');
  await mkdir(home, { mode: 0o700 }); await mkdir(bin);
  const root = join(home, '.cairn-memory'), codexHome = join(home, '.codex');
  const paths = {}, calls = {};
  for (const [client, enabled, initial] of [['claude', claude, claudeState], ['codex', codex, codexState]]) {
    paths[client] = join(ws.path, client + '.json'); calls[client] = join(ws.path, client + '.jsonl');
    await writeFile(paths[client], JSON.stringify(initial)); await writeFile(calls[client], '');
    if (enabled) {
      let source = `#!${process.execPath}\n${fixtureBinaryGuard(ws.path)}process.env.FAKE_STATE=${JSON.stringify(paths[client])};process.env.FAKE_CALLS=${JSON.stringify(calls[client])};\n` +
        await readFile(new URL(`./fake-${client}.mjs`, import.meta.url), 'utf8');
      if (client === 'codex' && initial.formatEvidence) {
        const evidence = await json(new URL('../../../integrations/codex/test/fixtures/binary-0.162.0/format.json', import.meta.url));
        source += '\n/*\n' + Object.values(evidence.hooks).map(value => JSON.stringify(value, null, 2)).join('\n') + '\n' + SERDE_MARKERS.join('\n') + '\n*/\n';
      }
      await writeFile(join(bin, client), source, { mode: 0o755 });
    }
  }
  const moduleURL = pathToFileURL(join(testedPackageRoot, 'lib/setup.mjs')).href;
  // Generic installer orchestration and screen fixtures model Linux. Tests of
  // platform behavior pass an explicit platform; engine children use the real OS.
  const harness = join(ws.path, 'harness.mjs');
  await writeFile(harness, `import{main}from${JSON.stringify(moduleURL)};import{writeSync,readFileSync,writeFileSync,chmodSync}from'node:fs';
    import childProcess,{spawn}from'node:child_process';import fsPromises from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';
    import{registerClaude}from${JSON.stringify(pathToFileURL(join(testedPackageRoot, 'lib/local-claude.mjs')).href)};
    import{registerCodex}from${JSON.stringify(pathToFileURL(join(testedPackageRoot, 'lib/local-codex.mjs')).href)};
    import{translator}from${JSON.stringify(pathToFileURL(join(testedPackageRoot, 'lib/messages.mjs')).href)};
    import{routeLocalMode,localStatus}from${JSON.stringify(pathToFileURL(join(testedPackageRoot, 'lib/local-mode.mjs')).href)};
    import{parseOptions}from${JSON.stringify(pathToFileURL(join(testedPackageRoot, 'lib/options.mjs')).href)};
    import{parseClient}from${JSON.stringify(pathToFileURL(join(testedPackageRoot, 'lib/codex.mjs')).href)};
    import{SetupError}from${JSON.stringify(pathToFileURL(join(testedPackageRoot, 'lib/errors.mjs')).href)};
    const mkdtemp=fsPromises.mkdtemp;fsPromises.mkdtemp=(path,...args)=>{if(String(path).startsWith('/tmp/cairn-codex-inspect-'))throw Object.assign(new Error('unowned inspection parent'),{code:'EACCES'});return mkdtemp(path,...args);};syncBuiltinESMExports();
    const config=JSON.parse(process.env.LOCAL_TEST_OPTIONS),answers=config.answers??[];
    if(config.peerIndexProbe){
      const original=childProcess.spawn;
      childProcess.spawn=(node,args,...rest)=>{
        if(args?.[0]!=='--input-type=module'||!args[2]?.includes('readLocalRawPeerIndexStatus'))return original(node,args,...rest);
        const program={unavailable:"console.log(JSON.stringify({status:'unavailable'}));",
          timeout:'setInterval(()=>{},1000);',error:'process.exitCode=1;',malformed:"console.log('{bad');",
          'bad-present':"console.log(JSON.stringify({status:'ok',present:0,overThreshold:true}));",
          'bad-threshold':"console.log(JSON.stringify({status:'ok',present:false,overThreshold:'true'}));",
          'missing-field':"console.log(JSON.stringify({status:'ok',present:false}));",
          nonzero:"console.log(JSON.stringify({status:'ok',present:false,overThreshold:true}));process.exitCode=1;"}[config.peerIndexProbe];
        const audit=${JSON.stringify(join(ws.path, 'peer-open.json'))};
        const prefix="import{DatabaseSync as Native}from'node:sqlite';import{writeFileSync}from'node:fs';"+
          "globalThis.PeerIndexAuditDatabaseSync=class extends Native{constructor(path,options){"+
          "writeFileSync("+JSON.stringify(audit)+",JSON.stringify({path,options}));super(path,options);}};";
        // Supply the audit class directly: syncing the default export does not update SQLite's named binding.
        let replacements=0;
        const audited=args[2].replaceAll("await import('node:sqlite')",()=>{
          replacements++;return '({DatabaseSync:globalThis.PeerIndexAuditDatabaseSync})';
        });
        if(replacements!==1)throw new Error('Expected exactly one peer-index SQLite import replacement; got '+replacements);
        const started=performance.now(),child=original(node,[args[0],args[1],program??prefix+audited],...rest);
        let text='';child.stdout.on('data',chunk=>text+=chunk);
        child.on('close',code=>writeFileSync(${JSON.stringify(join(ws.path, 'peer-result.json'))},
          JSON.stringify({node,code,text,elapsed:performance.now()-started})));
        return child;
      };syncBuiltinESMExports();
    }
    if(config.peerIndexStat){
      const directory=config.peerIndexDirectory,original=fsPromises.stat;
      fsPromises.stat=(path,...args)=>path===directory?Promise.reject(Object.assign(new Error('unavailable generation metadata'),
        {code:config.peerIndexStat==='missing'?'ENOENT':'EACCES'})):original(path,...args);
      syncBuiltinESMExports();
    }
    if(config.foreignClaudeOwner){const original=fsPromises.lstat;fsPromises.lstat=async(path,...args)=>{
      const stat=await original(path,...args);if(path===process.env.HOME+'/.claude')Object.defineProperty(stat,'uid',{value:process.getuid()+1});return stat;
    };syncBuiltinESMExports();}
    if(config.foreignCodexOwner){const original=fsPromises.lstat;fsPromises.lstat=async(path,...args)=>{
      const stat=await original(path,...args);if(path===process.env.CODEX_HOME)Object.defineProperty(stat,'uid',{value:process.getuid()+1});return stat;
    };syncBuiltinESMExports();}
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
        installerVersion:${JSON.stringify(version)},nodeVersion:process.versions.node,supportedNode:()=>true,platform:config.platform??'linux'};
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
      inspection:config.inspection,localInstallerVersion:config.installerVersion,platform:config.platform??'linux',nodeVersion:config.nodeVersion??process.versions.node,
      write:output,prompt:answer,
      authOptions:{request:async()=>{throw new Error('Local mode must not authorize');}}});`);
  const env = { HOME: home, CODEX_HOME: codexHome, CAIRN_MEMORY_HOME: root, LANG: 'en_US.UTF-8',
    PATH: bin, TMPDIR: ws.path,
    CAIRN_SETUP_NPM_CACHE: process.env.CAIRN_SETUP_NPM_CACHE, CAIRN_SETUP_NPM_OFFLINE: '1' };
  const run = async (args = ['setup', '--local'], options = {}) => {
    assertFixtureClients({ ...env, ...options.env }, ws.path);
    const child = spawn(nodeExecutable, [harness, ...args], { cwd: ws.path,
      env: { ...env, ...options.env, LOCAL_TEST_OPTIONS: JSON.stringify(options) }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
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

async function peerIndexFixture(t, { present = false, rowid = 0, ageDays = 0 } = {}) {
  const f = await localFixture(t), { d } = await seed(f);
  // Retained client vectors deliberately point at the base generation. The
  // footer must read the published repair generation and its selected Node.
  const id = engineId + '-r2', directory = join(f.root, 'engine', id);
  const engineRoot = dirname(dirname(executableFor(f.root, id)));
  await mkdir(engineRoot, { recursive: true, mode: 0o700 });
  const archive = join(packageRoot, 'runtime/engine', `${manifest.package.name}-${manifest.package.version}.tgz`);
  const extracted = spawnSync('tar', ['-xzf', archive, '--strip-components=1', '-C', engineRoot],
    { encoding: 'utf8', timeout: 10000 });
  assert.equal(extracted.error, undefined); assert.equal(extracted.status, 0, extracted.stderr);
  d.engine = { ...engine, id }; d.node = join(f.ws, 'engine-node');
  await symlink(process.execPath, d.node);
  await withLocalLock(f.root, () => writeDescriptor(f.root, d));
  const created = spawnSync(d.node, ['--input-type=module', '-e', `
    const {openDatabase}=await import(${JSON.stringify(pathToFileURL(join(engineRoot, 'core/database.mjs')).href)});
    const {DatabaseSync}=await import('node:sqlite');
    const {LOCAL_RAW_PRIVACY_DDL,LOCAL_RAW_PEER_INDEX_DDL,attestContentSafety}=await import(
      ${JSON.stringify(pathToFileURL(join(engineRoot, 'core/content-safety-schema.mjs')).href)});
    const path=${JSON.stringify(d.database.path)};
    const initial=openDatabase(path,{localControls:true});initial.close();
    const db=new DatabaseSync(path);
    try {
      db.exec('PRAGMA journal_mode=DELETE');
      db.exec(LOCAL_RAW_PRIVACY_DDL.join('\\n'));
      if(${present})db.exec(LOCAL_RAW_PEER_INDEX_DDL.join('\\n'));
      if(${rowid}){
        db.exec("INSERT INTO raw_conversations VALUES('peer-conversation','peer-owner','personal','','codex','peer-session',1,'2026','2026')");
        db.prepare("INSERT INTO raw_messages(rowid,conversation_id,message_id,ordinal,role,total_units,total_bytes,assembly_state,first_event_id) VALUES(?,'peer-conversation','peer-message',1,'user',1,1,'complete','peer-event')").run(${rowid});
      }
      attestContentSafety(db);
    } finally {db.close();}`], { encoding: 'utf8', timeout: 10000 });
  assert.equal(created.error, undefined); assert.equal(created.status, 0, created.stderr);
  const mtime = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  await utimes(directory, mtime, mtime);
  return { ...f, d, directory };
}
async function assertPeerIndexStatus(f, { hint = false, lang = 'en', code = 0, probe = 'observe', statFailure } = {}) {
  const args = ['status', '--lang', lang], before = await f.inventory();
  const baseline = await f.run(args, { peerIndexProbe: 'unavailable' });
  const result = await f.run(args, { peerIndexProbe: probe, peerIndexStat: statFailure, peerIndexDirectory: f.directory });
  assert.equal(baseline.code, code, baseline.display); assert.equal(result.code, code, result.display);
  assert.equal(result.signal, null);
  const wording = {
    en: 'Forgetting something and deleting conversations are slower on this store until its message index is built. To build it, close Claude Code and Codex, then run `npx @cairn-ink/memory raw index` once.',
    zh: '這個資料庫的訊息索引建好之前，忘記內容和刪除對話會比較慢。要建立索引，請先關閉 Claude Code 和 Codex，再執行一次 `npx @cairn-ink/memory raw index`。',
  };
  assert.equal(translator(lang)('local_status_peer_index_hint'), wording[lang]);
  const lines = [];
  terminalWriter(line => lines.push(line))(wording[lang]);
  const sentence = lines.join('\n') + '\n';
  assert.equal(result.stdout.split(sentence).length - 1, hint ? 1 : 0, result.display);
  assert.equal(hint ? result.stdout.replace(sentence, '') : result.stdout, baseline.stdout,
    'every other status/footer line remains byte-identical');
  assert.deepEqual(await f.inventory(), before, 'status retains the read-only file/schema/row inventory');
  const observed = await json(join(f.ws, 'peer-result.json'));
  assert.equal(observed.node, f.d.node, 'the published engine uses its own Node');
  return { result, observed };
}
async function assertPeerIndexReadOnly(f) {
  assert.deepEqual(await json(join(f.ws, 'peer-open.json')),
    { path: f.d.database.path, options: { readOnly: true, timeout: 0 } });
}

for (const lang of ['en', 'zh']) for (const reason of ['threshold', 'age'])
test(`L14 peer index hint appears once for ${reason} (${lang})`, async t => {
  const f = await peerIndexFixture(t, reason === 'threshold' ? { rowid: 2_000_001 } : { ageDays: 7 });
  const { observed } = await assertPeerIndexStatus(f, { hint: true, lang });
  assert.deepEqual(JSON.parse(observed.text), { status: 'ok', present: false, overThreshold: reason === 'threshold' });
  await assertPeerIndexReadOnly(f);
});
for (const [name, settings] of [
  ['present', { present: true, rowid: 2_000_001, ageDays: 8 }],
  ['neither condition', { rowid: 2_000_000, ageDays: 1 }],
  ['future directory mtime', { ageDays: -8 }],
]) test('L14 peer index hint is absent for ' + name, async t => {
  const f = await peerIndexFixture(t, settings);
  const { observed } = await assertPeerIndexStatus(f);
  assert.equal(JSON.parse(observed.text).status, 'ok'); await assertPeerIndexReadOnly(f);
});
for (const statFailure of ['missing', 'unreadable'])
test('L14 peer index age ignores ' + statFailure + ' generation metadata', async t => {
  const f = await peerIndexFixture(t, { ageDays: 8 });
  const { observed } = await assertPeerIndexStatus(f, { statFailure });
  assert.deepEqual(JSON.parse(observed.text), { status: 'ok', present: false, overThreshold: false });
  await assertPeerIndexReadOnly(f);
});
test('L14 peer index threshold still permits a hint when generation metadata is missing', async t => {
  const f = await peerIndexFixture(t, { rowid: 2_000_001 });
  await assertPeerIndexStatus(f, { hint: true, statFailure: 'missing' }); await assertPeerIndexReadOnly(f);
});
test('L14 peer index probe returns unavailable immediately under an EXCLUSIVE lock', async t => {
  const f = await peerIndexFixture(t, { rowid: 2_000_001, ageDays: 8 });
  const baseline = await f.run(['status'], { peerIndexProbe: 'unavailable' }), before = await f.inventory();
  const locker = new DatabaseSync(f.d.database.path, { timeout: 0 });
  let result;
  try {
    locker.exec('BEGIN EXCLUSIVE');
    result = await f.run(['status'], { peerIndexProbe: 'observe' });
  } finally { if (locker.isTransaction) locker.exec('ROLLBACK'); locker.close(); }
  assert.equal(baseline.code, 0, baseline.display); assert.equal(result.code, baseline.code, result.display);
  assert.equal(result.stdout, baseline.stdout); assert.deepEqual(await f.inventory(), before);
  const observed = await json(join(f.ws, 'peer-result.json'));
  assert.deepEqual(JSON.parse(observed.text), { status: 'unavailable' });
  assert.ok(observed.elapsed < 1500, `locked probe took ${observed.elapsed}ms (must not busy-wait)`);
  await assertPeerIndexReadOnly(f);
});
for (const probe of ['timeout', 'error', 'malformed', 'bad-present', 'bad-threshold', 'missing-field', 'nonzero'])
test('L14 peer index hint silently suppresses child ' + probe, async t => {
  const f = await peerIndexFixture(t, { rowid: 2_000_001, ageDays: 8 });
  const { observed } = await assertPeerIndexStatus(f, { probe });
  if (probe === 'timeout') {
    assert.equal(observed.code, null); assert.ok(observed.elapsed >= 2800);
    assert.ok(observed.elapsed < 4500, `probe timeout took ${observed.elapsed}ms`);
  }
});
test('L14 peer index hint silently suppresses a Node spawn error', async t => {
  const f = await peerIndexFixture(t, { rowid: 2_000_001, ageDays: 8 });
  f.d.node = join(f.ws, 'missing-engine-node');
  await withLocalLock(f.root, () => writeDescriptor(f.root, f.d));
  await assertPeerIndexStatus(f);
  await assert.rejects(lstat(join(f.ws, 'peer-open.json')), { code: 'ENOENT' });
});
test('L14 peer index hint preserves an existing nonzero status exit', async t => {
  const f = await peerIndexFixture(t, { rowid: 2_000_001 });
  await f.setState('claude', { fail: 'plugin list --json' });
  await assertPeerIndexStatus(f, { hint: true, code: 7 });
  await assertPeerIndexStatus(f, { probe: 'error', code: 7 });
});

await Promise.all(pending);
});
