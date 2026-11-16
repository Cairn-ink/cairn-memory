import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs, { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import promises from 'node:fs/promises';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName, runtimeFiles } from '../../build.mjs';
import { installedImportClosure } from './installed-import-closure.mjs';
import { installedDaemonRuntime } from './installed-daemon-runtime.mjs';
import { binaryIdentity, canonical, KNOWN_FORMATS } from '../../../integrations/codex/qualification.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const preload = fileURLToPath(new URL('./local-oneshot.mjs', import.meta.url));
const driver = fileURLToPath(new URL('./local-host.mjs', import.meta.url));
const childPreload = fileURLToPath(new URL('./local-host-child.mjs', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const rows = path => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
const walk = (path, prefix = '') => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? walk(join(path, entry.name), prefix + entry.name + '/') : [prefix + entry.name]).sort();
export const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const until = async (predicate, reason, ms = 15000) => {
  const deadline = performance.now() + ms;
  while (performance.now() < deadline) { const value = await predicate(); if (value) return value; await delay(25); }
  assert.fail(reason);
};
// A role policy only marks optional in-process dynamic edges lazy. The default
// closure policy used by per-session IL is unchanged.
const policy = (from, to) => from === 'adapters/mcp/local-daemon.mjs' &&
  ['adapters/openai/index.mjs', 'adapters/mcp/context-read-provider.mjs'].includes(to);
const daemonEntries = ['adapters/mcp/local-daemon.mjs', 'adapters/mcp/local-forwarder.mjs', 'adapters/mcp/local-shared-runtime.mjs'];
export function productionBoundary(paths, read) {
  for (const path of paths.filter(path => path.endsWith('.mjs'))) {
    const source = read(path);
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|new\s+URL\(\s*)['"]([^'"]+)['"]/g)) {
      const target = match[1].startsWith('.') ? resolve('/', dirname(path), match[1]).slice(1) : match[1];
      assert.ok(!target.includes('packaging/test/fixtures/') && !target.includes('raw-installed-daemon-lifecycle'), 'production must not import test instrumentation: ' + path);
    }
  }
}

export async function daemonLifecycleFixture(t, { client, denyAll = false, candidateInstrument = true, dropDependency = false } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'installed-raw-daemon-' });
  const runtime = await installedDaemonRuntime({ diagnostic: text => t.diagnostic(text) });
  // Registered before client closers; the workspace is LIFO.
  workspace.defer(runtime.finish);
  const home = join(workspace.path, 'home'), usage = join(workspace.path, 'usage');
  mkdirSync(home, { mode: 0o700 }); mkdirSync(usage, { mode: 0o700 });
  const artifact = buildArtifact({ ownDirectory: path => workspace.defer(() => promises.rm(path, { recursive: true, force: true })) });
  writeFileSync(join(workspace.path, 'package.json'), JSON.stringify({ name: 'synthetic-daemon-lifecycle', version: '0.0.0', private: true }));
  command('npm', ['install', '--prefix', workspace.path, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], workspace.path, artifact.userconfig);
  const installed = join(workspace.path, 'node_modules', packageName), executable = join(workspace.path, 'node_modules/.bin/cairn-memory');
  const archived = command('tar', ['-tzf', artifact.artifactPath], workspace.path, artifact.userconfig).trim().split('\n').map(path => path.slice(8)).sort();
  assert.deepEqual(archived, [...JSON.parse(readFileSync(join(installed, 'package.json'))).files].sort());
  assert.deepEqual(walk(installed), archived);
  assert.equal(command('tar', ['-xOzf', artifact.artifactPath, 'package/bin/cairn-memory.mjs'], workspace.path, artifact.userconfig), readFileSync(join(installed, 'bin/cairn-memory.mjs'), 'utf8'));
  assert.equal(JSON.parse(readFileSync(join(installed, 'package.json'))).bin['cairn-memory'], 'bin/cairn-memory.mjs');
  for (const [path, hash] of Object.entries(artifact.sourceHashes)) assert.equal(sha(readFileSync(join(installed, path))), hash, path);
  productionBoundary(runtimeFiles, path => readFileSync(join(root, path), 'utf8'));
  productionBoundary(archived, path => readFileSync(join(installed, path), 'utf8'));
  const graph = installedImportClosure(root, [...daemonEntries, 'adapters/local/cli.mjs', 'integrations/client/raw/local-host-cli.mjs'], { lazyEdge: policy });
  for (const path of graph.required) assert.ok(archived.includes(path), 'closure module archived: ' + path);
  const database = join(workspace.path,'memory.sqlite'),configPath = join(workspace.path,'capture.json'),profilePath = join(workspace.path,'host.json');
  const stateRoot = join(workspace.path,'state'),identityKeyPath = join(workspace.path,'identity-key'),retainedPath = join(workspace.path,'retained.json');
  const trace = join(workspace.path,'http.jsonl'),namespace = { ownerId:'synthetic-installed-local',scope:'personal',projectId:null };
  const scaffold = { NODE_TEST_CONTEXT:'child-v8',CAIRN_SYNTHETIC_FIXTURE_ROOT:workspace.path,PATH:dirname(process.execPath),HOME:home,TMPDIR:workspace.path,TMP:workspace.path,TEMP:workspace.path,
    NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1',SYNTHETIC_INSTALLED:installed,SYNTHETIC_CLIENT:client,
    SYNTHETIC_DATABASE:database,SYNTHETIC_CONFIG:configPath,SYNTHETIC_USAGE:usage,SYNTHETIC_TRACE:trace,SYNTHETIC_CORE:join(installed,'core/index.mjs') };
  const environment = { NODE_TEST_CONTEXT:'child-v8',CAIRN_SYNTHETIC_FIXTURE_ROOT:workspace.path,PATH:dirname(process.execPath),HOME:home,LOGNAME:'synthetic',USER:'synthetic',SHELL:'/bin/sh',TERM:'dumb',
    TMPDIR:workspace.path,TMP:workspace.path,TEMP:workspace.path,NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1' };
  let phase = 0; const processes = [],captures = [],mcpSessions = [];
  function direct(args) {
    const imports = join(workspace.path,'direct-'+phase+++'.jsonl');
    const instrumentation = imports + '.bootstrap.mjs';
    writeFileSync(instrumentation, instrumentationSource({ installed, role: 'bootstrap', directory: runtime.directory.path, trace: imports + '.bootstrap-trace.jsonl',
      scaffolds: [preload, fileURLToPath(new URL('../../../adapters/local/test/fixtures/http.mjs', import.meta.url))] }));
    const result = spawnSync(process.execPath,['--import',instrumentation,...args],{ cwd:workspace.path,encoding:'utf8',timeout:20000,maxBuffer:524288,
      env:{ ...scaffold,SYNTHETIC_IMPORT_TRACE:imports,SYNTHETIC_MODE:'empty' } });
    assert.equal(result.error,undefined); assert.equal(result.signal,null); assert.equal(result.status,0,result.stderr);
    processes.push({ phase:'core/bootstrap',code:result.status,signal:result.signal }); return result.stdout;
  }
  direct([preload,'prepare']);
  const configuration = JSON.parse(readFileSync(configPath)); configuration.provider.apiKeyEnv = 'CAIRN_SYNTHETIC_API_KEY';
  writeFileSync(configPath,JSON.stringify(configuration));
  const pluginRoot = join(workspace.path,'plugin'),qroot = join(workspace.path,'codex-install'),qdir = join(qroot,'qualification');
  mkdirSync(pluginRoot,{ mode:0o700 }); mkdirSync(qroot,{ mode:0o700 }); mkdirSync(qdir,{ mode:0o700 });
  const qualificationConfigPath = join(qroot,'installation.json'),binary = join(workspace.path,'codex');
  writeFileSync(qualificationConfigPath,'{}',{ mode:0o600 }); writeFileSync(binary,'synthetic native binary',{ mode:0o700 });
  const identity = await binaryIdentity(binary);
  writeFileSync(join(qdir,identity+'.json'),JSON.stringify({ policy:sha(canonical(KNOWN_FORMATS)),identity,version:'0.162.0',status:'qualified',fingerprint:KNOWN_FORMATS[1] }),{ mode:0o600 });
  writeFileSync(profilePath,JSON.stringify({ version:'local-raw-host-profile-v1',configPath,configDigest:sha(readFileSync(configPath)),stateRoot,identityKeyPath,home,
    installation:client === 'claude-code' ? { client,pluginRoot }:{ client,qualificationConfigPath } }),{ mode:0o600 });
  writeFileSync(retainedPath,JSON.stringify({ version:'local-raw-retained-profile-v1',path:database,storeId:configuration.authority.storeId,namespace }),{ mode:0o600 });
  const sessions = [0,1].map(index=>{
    const sessionId = index === 0 ? '11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222';
    const sourcePath = join(workspace.path,'source-'+index+'.jsonl');
    const header = client === 'codex' ? JSON.stringify({ type:'session_meta',payload:{ id:sessionId,cli_version:'0.162.0',history_mode:'paginated',source:'cli',originator:'codex-tui' } })+'\n':'';
    writeFileSync(sourcePath,header,{ mode:0o600 }); return { sessionId,sourcePath,initialized:false };
  });
  function append(index,text) {
    // Codex observes the header EOF before the first synthetic user record.
    if (client === 'codex' && !sessions[index].initialized) initialize(index);
    const { sessionId,sourcePath } = sessions[index],id = randomUUID();
    const row = client === 'claude-code' ? { type:'user',uuid:id,timestamp:index === 0 ? '2020-01-01T00:00:00.000Z' : '2021-01-01T00:00:00.000Z',promptSource:'typed',message:{ content:[{ type:'text',text }] } }
      : { type:'event_msg',timestamp:index === 0 ? '2020-01-01T00:00:00.000Z' : '2021-01-01T00:00:00.000Z',payload:{ type:'item_completed',thread_id:sessionId,turn_id:'synthetic-turn-'+id,item:{ type:'UserMessage',id,content:[{ type:'text',text }] } } };
    appendFileSync(sourcePath,JSON.stringify(row)+'\n'); return id;
  }
  function host(args,{ mode = 'memory',key = false,expected = 0 } = {}) {
    const imports = join(workspace.path,'host-'+phase+++'.jsonl'),settings = imports+'.settings.json';
    const childInstrumentation = imports + '.worker.mjs';
    writeFileSync(childInstrumentation, `await import(${JSON.stringify(pathToFileURL(childPreload).href)});\n` + instrumentationSource({ installed, role: 'capture-worker', directory: runtime.directory.path, trace: imports + '.worker-trace.jsonl', preserveFetch: true }));
    const hostEntry = imports + '.host.mjs';
    writeFileSync(hostEntry, instrumentationSource({ installed, role: 'capture-host', directory: runtime.directory.path, trace: imports + '.host-trace.jsonl', scaffold: driver }) + `\nawait import(${JSON.stringify(pathToFileURL(driver).href)});`);
    writeFileSync(settings,JSON.stringify({ installed,profilePath,args,trace:imports,scaffold,mode,syntheticBinary:binary,preload:childInstrumentation }),{ mode:0o600 });
    const result = spawnSync(process.execPath,[hostEntry,settings],{ cwd:workspace.path,encoding:'utf8',timeout:25000,maxBuffer:262144,
      env:{ ...environment,...(key ? { CAIRN_SYNTHETIC_API_KEY:'synthetic_key_secret' }:{}) } });
    assert.equal(result.error,undefined); assert.equal(result.status,expected,result.stderr+result.stdout); assert.equal(result.signal,null);
    assert.doesNotMatch(result.stdout+result.stderr,/synthetic_key_secret/);
    const events = rows(imports),spawned = events.filter(row=>row.kind === 'spawn'),closed = events.filter(row=>row.kind === 'close');
    assert.deepEqual(spawned.map(row=>row.pid).sort(),closed.map(row=>row.pid).sort());
    for (const row of closed) { assert.equal(row.code,0); assert.equal(row.signal,null); }
    processes.push({ phase:args[0],code:result.status,signal:result.signal,children:closed.map(({ code,signal })=>({ code,signal })) });
    return JSON.parse(result.stdout);
  }
  const selected = (action,index = 0) => [action,'--session',sessions[index].sessionId,'--source',sessions[index].sourcePath];
  function initialize(index) {
    assert.equal(host([...selected('initialize',index),'--start',client === 'codex' ? 'eof':'beginning']).reason,'initialized');
    sessions[index].initialized = true;
  }
  function capture(index = 0,mode = 'memory') {
    if (!sessions[index].initialized) initialize(index);
    const result = host(selected('run',index),{ mode,key:true }); assert.equal(result.worker.completedParts,1); assert.equal(result.worker.hasPending,false);
    captures.push({ session:index,mode,completedParts:result.worker.completedParts }); return result;
  }
  function probe(action = 'inspect',input = {}) {
    const script = `const fs=await import('node:fs'),{openMemoryCore}=await import(process.env.SYNTHETIC_CORE),c=JSON.parse(fs.readFileSync(process.env.SYNTHETIC_CONFIG));
const core=openMemoryCore({path:process.env.SYNTHETIC_DATABASE,existingStore:{version:'schema29-existing-v1',storeId:c.authority.storeId},rawConversations:{mode:'off',configureCap:false,readPolicy(){throw Error('retained capture forbidden')}}});
const ok=r=>{if(!r.ok)throw Error('synthetic trusted operation refused:'+r.error.code);return r.value};const{namespace,client}=c.authority;let result;
try{const action=${JSON.stringify(action)},input=${JSON.stringify(input)};
if(action==='pause'||action==='resume'){const current=ok(core.getLocalCaptureControl({namespace,client}));result=ok(core.setLocalCaptureControl({namespace,client,targetId:current.targetId,expectedStoreId:current.storeId,expectedRevision:current.revision,automaticCaptureEnabled:action==='resume',rawNoticeVersion:current.rawNoticeVersion}));}
else if(action==='delete')result=ok(core.deleteConversation({namespace,...input}));
else if(action==='inspect'){const memories=ok(core.list({namespace})).memories.map(m=>ok(core.get({namespace,memoryId:m.id,includeQualification:true})));const{DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(process.env.SYNTHETIC_DATABASE,{readOnly:true});try{
const all=sql=>db.prepare(sql).all();result={memories,conversations:all('SELECT id,client,session_key,revision FROM raw_conversations ORDER BY id'),messages:all('SELECT conversation_id,message_id,ordinal,occurred_at,total_units,total_bytes,assembly_state,reserved_bytes FROM raw_messages ORDER BY conversation_id,ordinal'),parts:all('SELECT conversation_id,message_id,part_index,saved,reason,sealed FROM raw_parts ORDER BY conversation_id,message_id,part_index').map(({sealed,...part})=>({...part,text:sealed===null?null:Buffer.from(sealed).toString('utf8')})),lineage:all('SELECT r.id AS receiptId,r.memory_id AS memoryId,r.client,r.session_id,r.event_id,r.role,r.excerpt,l.conversation_id,l.message_id,l.start,l.end,l.precision,o.kind FROM receipts r JOIN raw_receipt_lineage l ON l.receipt_id=r.id JOIN raw_receipt_origins o ON o.receipt_id=r.id ORDER BY r.id'),admissions:all('SELECT state FROM admission_claims'),cards:all('SELECT id,state,title,body,revision FROM private_cards'),notes:all('SELECT id,state,text FROM card_notes'),bindings:all('SELECT card_id FROM card_raw_bindings'),exclusions:all('SELECT conversation_id,message_id,start,end FROM raw_source_exclusions')};}finally{db.close()}}
else throw Error('synthetic probe action invalid');console.log(JSON.stringify(result));}finally{core.close()}`;
    return JSON.parse(direct(['--import',preload,'--input-type=module','-e',script]));
  }
  const args = ['--db', database, '--owner', namespace.ownerId];
  const savedSession = { command: process.execPath, args: [executable, ...args], cwd: workspace.path, env: environment };
  const accounting = runtime.register(savedSession, { expected: 2 });
  const candidates = [], sessionsOpen = [], candidateTraces = [];
  let nextRequest = 0, current;
  async function descriptor(pid) {
    for (const name of readdirSync(runtime.directory.path).filter(name => /^d-[a-f0-9]{32}\.json$/.test(name))) {
      let value; try { value = JSON.parse(readFileSync(join(runtime.directory.path, name), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (value.owner.pid === pid && value.identity.store.path === database && value.identity.package.path === installed) return { name, ...value };
    }
  }
  async function candidate() {
    const trace = join(workspace.path, 'daemon-' + phase++ + '.jsonl'), entry = trace + '.mjs';
    writeFileSync(trace, '', { mode: 0o600 });
    writeFileSync(entry, bootstrap({ installed, executable, args, role: 'daemon', directory: runtime.directory.path, trace, instrument: candidateInstrument }));
    const child = spawn(process.execPath, [entry], { cwd: workspace.path, env: environment, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', value => { stderr += value; });
    const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    const item = { child, done, trace }; candidates.push(item); candidateTraces.push(trace);
    // Emergency supervision remains independent of serving-lifetime accounting.
    // Normal teardown closes clients then stops through the installed command.
    workspace.defer(async () => {
      if (child.exitCode === null && child.signalCode === null) await accounting.stop();
      const result = await done; assert.equal(result.code, 0, stderr); assert.equal(result.signal, null);
    });
    current = await until(async () => { assert.equal(child.exitCode, null, stderr); return descriptor(child.pid); }, 'supervised candidate publishes');
    assert.equal(current.owner.pid, child.pid, 'descriptor owner is supervised candidate');
    await accounting.observe();
    return current;
  }
  async function mcp({ exact = false } = {}) {
    const trace = join(workspace.path, 'session-' + phase++ + '.jsonl'), entry = trace + '.mjs';
    const socket = join(runtime.directory.path, current.name.replace(/\.json$/, '.sock'));
    if (!exact) {
      writeFileSync(trace, '', { mode: 0o600 });
      writeFileSync(entry, bootstrap({ installed, executable, args, socket, role: 'session', directory: runtime.directory.path, trace, denyAll }));
    }
    const child = spawn(process.execPath, exact ? [executable, ...args] : [entry], { cwd: workspace.path, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '', buffer = '', closed = false; const messages = [];
    child.stdin.on('error', () => {});
    child.stderr.on('data', value => { stderr += value; });
    child.stdout.on('data', value => { buffer += value; let end; while ((end = buffer.indexOf('\n')) >= 0) {
      messages.push(JSON.parse(buffer.slice(0, end))); buffer = buffer.slice(end + 1);
    } });
    const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    async function request(method, params = {}) {
      const id = ++nextRequest; child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      const response = await until(() => { assert.equal(child.exitCode, null, stderr); return messages.find(message => message.id === id); }, 'MCP response');
      assert.ok(!response.error, JSON.stringify(response.error)); return response.result;
    }
    async function close() {
      if (closed) return; closed = true; child.stdin.end();
      const result = await done; assert.equal(result.code, 0, stderr); assert.equal(result.signal, null);
      assert.doesNotMatch(stderr, /cairn_daemon_fallback:/, 'daemon attachment never falls back');
    }
    workspace.defer(close); sessionsOpen.push({ close });
    const initialized = await request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-daemon-lifecycle', version: '1' } });
    assert.ok(initialized.serverInfo); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    assert.doesNotMatch(stderr, /cairn_daemon_fallback:/, 'daemon attachment never falls back');
    assert.equal((await request('tools/list')).tools.length, 8);
    await accounting.observe();
    return { close, tool: async (name, input = {}) => {
      const offset = rows(candidateTraces.at(-1)).length;
      const result = await request('tools/call', { name, arguments: input }), value = ok(JSON.parse(result.content[0].text));
      if (['read_memory_context', 'inspect_memory'].includes(name))
        assert.ok(rows(candidateTraces.at(-1)).slice(offset).some(event => event.role === 'daemon' &&
          event.kind === 'sqlite' && event.category === 'read' && event.success), 'actual MCP read executes in the daemon role');
      return value;
    } };
  }
  async function attached(count) {
    await until(() => { const status = accounting.status(); return status.length === 1 && status[0].running && status[0].attached_sessions === count; }, 'one daemon with expected attached sessions');
    t.diagnostic(JSON.stringify({ client, candidateOwner: true, running: 1, attached: count }));
  }
  function assertWriteSince(offset, label) {
    const events = rows(candidateTraces.at(-1)).slice(offset);
    assert.ok(events.some(event => event.role === 'daemon' && event.kind === 'sqlite' && event.category === 'write' && event.success), label + ' successful daemon SQLite write');
    t.diagnostic(label + ': daemon SQLite write positive control observed');
  }
  function traceLength() { return rows(candidateTraces.at(-1)).length; }
  async function coldBoundary() {
    for (const session of sessionsOpen.splice(0)) await session.close();
    await accounting.stop();
    const result = await candidates.at(-1).done; assert.equal(result.code, 0); assert.equal(result.signal, null);
  }
  function checkTraces() {
    const daemonGraph = installedImportClosure(root, ['adapters/mcp/local-daemon.mjs'], { lazyEdge: policy });
    // Identity is imported before runCandidate to compute its real bootstrap.
    const eager = new Set(daemonGraph.eager.filter(path => path.endsWith('.mjs')));
    const required = new Set(graph.required);
    if (dropDependency) required.delete('core/database.mjs');
    for (const trace of candidateTraces) {
      const events = rows(trace), observed = new Set(events.filter(event => event.role === 'daemon' && event.kind === 'module' && event.path.startsWith(installed + '/')).map(event => relative(installed, event.path)));
      assert.ok(observed.size > 0, 'daemon-role imports must be recorded independently');
      for (const path of observed) assert.ok(required.has(path), 'observed module outside daemon closure: ' + path);
      for (const path of eager) assert.ok(observed.has(path), 'selected daemon eager module observed: ' + path);
      assert.ok(events.some(event => event.role === 'daemon' && event.kind === 'sqlite' && event.category === 'read' && event.success), 'daemon role executed reads');
      assert.ok(events.some(event => event.role === 'daemon' && event.kind === 'sqlite' && event.category === 'write' && event.success), 'daemon role executed writes');
      assert.ok(events.some(event => event.role === 'daemon' && event.kind === 'fs' && event.success), 'daemon filesystem mutations recorded');
      t.diagnostic(JSON.stringify({ client, role: 'daemon', modules: observed.size, selectedEager: eager.size,
        sqliteReads: events.filter(event => event.kind === 'sqlite' && event.category === 'read' && event.success).length,
        sqliteWrites: events.filter(event => event.kind === 'sqlite' && event.category === 'write' && event.success).length,
        filesystemMutations: events.filter(event => event.kind === 'fs' && event.success).length }));
    }
    // Capture workers/hosts remain separate contexts; don't credit their work
    // to the candidate, and validate asset inventory separately from imports.
    const hostObserved = new Set();
    for (const name of readdirSync(workspace.path).filter(name => /^(direct-|host-|child-|session-|daemon-).*\.jsonl$/.test(name))) {
      const records = rows(join(workspace.path, name));
      for (const event of records.filter(event => event.kind === 'child-close' || event.kind === 'worker-close')) {
        assert.equal(event.code, 0, 'isolated helper completion');
        if (event.kind === 'child-close') assert.equal(event.signal, null);
      }
      for (const event of records.filter(event => event.kind === 'child-start'))
        assert.ok(records.some(value => value.kind === 'child-close' && value.pid === event.pid), 'activated helper child reaped separately');
      for (const event of records.filter(event => event.kind === 'worker-start'))
        assert.ok(records.some(value => value.kind === 'worker-close' && value.thread === event.thread), 'activated helper worker joined separately');
      for (const event of records) if (event.path?.startsWith(installed + '/')) {
        const path = relative(installed, event.path);
        if (event.kind === 'asset') assert.ok(archived.includes(path), 'observed asset is archived: ' + path);
        if (event.kind === 'module') {
          assert.ok(path === 'bin/cairn-memory.mjs' || required.has(path), 'observed module inside full installed closure: ' + path);
          if (/^(host-|child-)/.test(name)) hostObserved.add(path);
        }
      }
    }
    for (const role of ['bootstrap', 'capture-host', 'capture-worker']) {
      const records = readdirSync(workspace.path).filter(name => name.endsWith('-trace.jsonl')).flatMap(name => rows(join(workspace.path, name))).filter(row => row.role === role);
      assert.ok(records.some(row => row.kind === 'module'), role + ' installed imports recorded');
      assert.ok(records.some(row => row.kind === 'fs' && row.success), role + ' filesystem mutations recorded');
      t.diagnostic(JSON.stringify({ client, role, processes: new Set(records.map(row => row.pid)).size, filesystemMutations: records.filter(row => row.kind === 'fs' && row.success).length }));
    }
    for (const path of ['adapters/local/cli.mjs', 'integrations/client/raw/local-host-cli.mjs']) assert.ok(hostObserved.has(path), 'installed capture entry observed: ' + path);
  }
  assert.equal(host(['prepare']).reason, 'prepared');
  return { workspace, installed, append, capture, probe, candidate, mcp, attached, coldBoundary, checkTraces, traceLength, assertWriteSince,
    async finish() { checkTraces(); await workspace.cleanup(); assert.equal(existsSync(workspace.path), false); } };
}
// Serialized into plain Node bootstraps. The SQLite wrap is installed ONLY by
// the supervised candidate, before importing the installed daemon.
export function instrument(settings) {
  const originalWrite = fs.writeSync, originalClose = fs.closeSync, traceFd = fs.openSync(settings.trace, 'a', 0o600);
  process.once('exit', () => originalClose(traceFd));
  const note = row => originalWrite(traceFd, JSON.stringify({ pid: process.pid, role: settings.role, ...row }) + '\n');
  // Product helpers keep their own execution context. Observe their real
  // completion without inheriting or crediting their activity to this role.
  const spawnSync = cp.spawnSync, spawn = cp.spawn, Worker = threads.Worker;
  cp.spawnSync = function(...args) {
    const result = spawnSync.apply(this, args);
    note({ pid: result.pid, role: 'isolated-child', parentRole: settings.role, kind: 'child-close', code: result.status, signal: result.signal });
    return result;
  };
  cp.spawn = function(...args) {
    const child = spawn.apply(this, args);
    note({ pid: child.pid, role: 'isolated-child', parentRole: settings.role, kind: 'child-start' });
    child.once('close', (code, signal) => note({ pid: child.pid, role: 'isolated-child', parentRole: settings.role, kind: 'child-close', code, signal }));
    return child;
  };
  threads.Worker = class extends Worker {
    constructor(...args) {
      super(...args); const thread = this.threadId;
      note({ role: 'isolated-worker', parentRole: settings.role, kind: 'worker-start', thread });
      this.once('exit', code => note({ role: 'isolated-worker', parentRole: settings.role, kind: 'worker-close', thread, code }));
    }
  };
  const deny = () => { throw Error('installed_daemon_network_forbidden'); };
  const socketState = { path: settings.socket };
  function normalized(args) {
    // Node passes its internal normalized [options, callback] tuple recursively.
    if (Array.isArray(args[0])) return normalized(args[0]);
    const value = args[0];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (Reflect.ownKeys(value).some(key => key !== 'path')) return null;
    if (typeof value.path !== 'string') return null;
    const path = value.path;
    if (!isAbsolute(path) || path.includes('\0') || path.split('/').some(part => part === '.' || part === '..') || resolve(path) !== path) return null;
    if (dirname(path) !== settings.directory || path !== socketState.path) return null;
    return value;
  }
  for (const [api, key] of [[net, 'connect'], [net, 'createConnection'], [net.Socket.prototype, 'connect']]) {
    const original = api[key];
    api[key] = function(...args) { if (settings.denyAll || !normalized(args)) return deny(); return original.apply(this, args); };
  }
  if (!settings.preserveFetch) globalThis.fetch = deny;
  for (const api of [http, https]) for (const key of ['request', 'get']) api[key] = deny;
  for (const api of [dns, dnsPromises]) for (const key of Object.keys(api))
    if (/^(?:lookup|resolve|reverse)/.test(key) && typeof api[key] === 'function') api[key] = deny;
  // Resolver instances have their own callback and promise entry points.
  for (const Resolver of [dns.Resolver, dnsPromises.Resolver]) for (const key of Object.getOwnPropertyNames(Resolver.prototype))
    if (/^(?:lookup|resolve|reverse)/.test(key)) Resolver.prototype[key] = deny;
  const pathName = value => value instanceof URL ? fileURLToPath(value) : typeof value === 'string' ? value : null;
  const recordAsset = value => { const path = pathName(value); if (path?.startsWith(settings.installed + '/')) note({ kind: 'asset', path }); };
  const mutations = ['writeFile', 'appendFile', 'write', 'writev', 'truncate', 'ftruncate', 'rename', 'link', 'unlink', 'rm', 'mkdir', 'rmdir', 'chmod', 'fchmod', 'chown', 'fchown', 'symlink', 'copyFile', 'cp', 'utimes', 'futimes'];
  for (const api of [fs, promises]) {
    for (const key of ['readFile', 'readFileSync']) if (typeof api[key] === 'function') {
      const original = api[key]; api[key] = function(path, ...args) { recordAsset(path); return original.call(this, path, ...args); };
    }
    for (const key of mutations.flatMap(key => [key, key + 'Sync'])) if (typeof api[key] === 'function') {
      const original = api[key];
      api[key] = function(...args) {
        if (api === fs && !key.endsWith('Sync') && typeof args.at(-1) === 'function') {
          const callback = args.at(-1); args[args.length - 1] = function(error, ...values) { note({ kind: 'fs', operation: key, success: !error }); return callback.call(this, error, ...values); };
          return original.apply(this, args);
        }
        const result = original.apply(this, args);
        if (result?.then) return result.then(value => { note({ kind: 'fs', operation: key, success: true }); return value; });
        note({ kind: 'fs', operation: key, success: true }); return result;
      };
    }
  }
  const open = promises.open;
  promises.open = async function(...args) {
    const file = await open.apply(this, args);
    // Merely wrap the handle returned by the application's own open. Never
    // open a store, WAL or SHM to trace it, or add a separate fd/connection.
    for (const key of ['write', 'writev', 'writeFile', 'appendFile', 'truncate', 'chmod', 'chown', 'utimes']) {
      const original = file[key];
      file[key] = function(...values) { return original.apply(this, values).then(value => {
        note({ kind: 'fs', operation: 'FileHandle.' + key, success: true }); return value;
      }); };
    }
    return file;
  };
  syncBuiltinESMExports();
  register('data:text/javascript,' + encodeURIComponent(`
    import {appendFileSync} from 'node:fs'; import {fileURLToPath} from 'node:url';
    let data; export function initialize(value) { data=value; }
    export async function resolve(specifier,context,next) {
      const result=await next(specifier,context);
      if(result.url.startsWith('file:')) {
        const path=fileURLToPath(result.url);
        if(!path.startsWith(data.allowed+'/') && path!==data.scaffold && !data.scaffolds?.includes(path)) throw Error('installed_daemon_source_fallback');
        appendFileSync(data.trace,JSON.stringify({pid:data.pid,role:data.role,kind:'module',path})+'\\n');
      }
      return result;
    }`), { parentURL: settings.parentURL, data: { allowed: dirname(settings.installed), trace: settings.trace, pid: process.pid, role: settings.role, scaffold: settings.scaffold, scaffolds: settings.scaffolds } });
  return { note, socketState, deny, normalized };
}
export function wrapSqlite({ DatabaseSync }, note) {
  const category = sql => {
    const verb = String(sql).replace(/^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/, '').match(/^[A-Za-z]+/)?.[0]?.toUpperCase();
    return ['SELECT', 'EXPLAIN'].includes(verb) ? 'read' : ['BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'END'].includes(verb) ? 'transaction' : verb === 'PRAGMA' ? 'pragma' : ['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'CREATE', 'DROP', 'ALTER', 'VACUUM', 'REINDEX', 'ATTACH', 'DETACH'].includes(verb) ? 'write' : 'other';
  };
  const execute = (original, receiver, args, operation, kind) => {
    try { const value = original.apply(receiver, args); note({ kind: 'sqlite', operation, category: kind, success: true }); return value; }
    catch (error) { note({ kind: 'sqlite', operation, category: kind, success: false }); throw error; }
  };
  const exec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function(sql, ...args) { return execute(exec, this, [sql, ...args], 'exec', category(sql)); };
  const prepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function(sql, ...args) {
    const statement = prepare.call(this, sql, ...args), kind = category(sql);
    for (const key of ['run', 'get', 'all', 'iterate']) {
      const original = statement[key];
      statement[key] = function(...values) {
        const result = execute(original, this, values, key, kind);
        if (key !== 'iterate') return result;
        const next = result.next;
        result.next = function(...values) { return execute(next, this, values, 'iterate.next', kind); };
        return result;
      };
    }
    return statement;
  };
}
function instrumentationSource(settings) {
  return `import fs from 'node:fs'; import promises from 'node:fs/promises'; import net from 'node:net';
import http from 'node:http'; import https from 'node:https'; import dns from 'node:dns'; import dnsPromises from 'node:dns/promises';
import cp from 'node:child_process'; import threads from 'node:worker_threads';
import {register,syncBuiltinESMExports} from 'node:module'; import {dirname,resolve,isAbsolute,join} from 'node:path'; import {fileURLToPath,pathToFileURL} from 'node:url';
const settings=${JSON.stringify(settings)}; settings.parentURL=import.meta.url;
if(['daemon','session'].includes(settings.role)&&process.execArgv.length)throw Error('instrumented_bootstrap_execargv');
const instrumentation=settings.instrument===false?null:(${instrument.toString()})(settings);
`;
}
function bootstrap(settings) {
  return instrumentationSource(settings) + `
${settings.role === 'daemon' ? `
if(instrumentation)(${wrapSqlite.toString()})(await import('node:sqlite'),instrumentation.note);
const state=await import(pathToFileURL(join(settings.installed,'adapters/mcp/local-daemon-state.mjs')));
const engine=await import(pathToFileURL(join(settings.installed,'adapters/mcp/local-daemon-identity.mjs')));
const directory=await state.runtimeDirectory(); await directory.validate();
if(directory.path!==settings.directory)throw Error('candidate_runtime_directory');
const identity=await engine.createIdentity(settings.args,{key:await state.identityKey(directory),environment:engine.selectedEnvironment()});
if(instrumentation)instrumentation.socketState.path=state.endpointPaths(directory,identity.digest).socket;
const {runCandidate}=await import(pathToFileURL(join(settings.installed,'adapters/mcp/local-daemon.mjs')));
await runCandidate({args:settings.args,identity:identity.record,environment:engine.selectedEnvironment()});
` : `
await (await import(pathToFileURL(join(settings.installed,'adapters/mcp/local-daemon-state.mjs')))).runtimeDirectory().then(directory=>directory.validate());
process.argv=[process.execPath,settings.executable,...settings.args];
await import(pathToFileURL(settings.executable));
`}`;
}

export function guardControlSource(settings, expression) {
  return bootstrap({ ...settings, role: 'session' }).split('\nawait (await import')[0] + `
let rejected=false;try{${expression}}catch(error){if(error.message!=='installed_daemon_network_forbidden')throw error;rejected=true}
if(!rejected)throw Error('guard_control_did_not_reject');
`;
}
