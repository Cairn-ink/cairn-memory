import { installedImportClosure } from './installed-import-closure.mjs';
// Synthetic orchestration only. Application imports/SQLite mutations execute
// in cold processes inside the inspected installation, never in this module.
import assert from 'node:assert/strict';
import cp, { spawnSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../../build.mjs';
import { binaryIdentity, canonical, KNOWN_FORMATS } from '../../../integrations/codex/qualification.mjs';

const require = createRequire(new URL('../../../adapters/mcp/package.json',import.meta.url));
const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/client')));
const { StdioClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/client/stdio')));
const root = fileURLToPath(new URL('../../../',import.meta.url));
const preload = fileURLToPath(new URL('./local-oneshot.mjs',import.meta.url));
const driver = fileURLToPath(new URL('./local-host.mjs',import.meta.url));
const childPreload = fileURLToPath(new URL('./local-host-child.mjs',import.meta.url));
const pty = fileURLToPath(new URL('../../../adapters/mcp/test/fixtures/card-review-pty.py',import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const rows = path => existsSync(path) ? readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const walk = (path,prefix='') => readdirSync(path,{ withFileTypes:true }).flatMap(entry => entry.isDirectory()
  ? walk(join(path,entry.name),prefix+entry.name+'/'):[prefix+entry.name]).sort();
export const ok = result => { assert.equal(result.ok,true,JSON.stringify(result)); return result.value; };
export async function call(client,name,input = {}) {
  const response = await client.callTool({ name,arguments:input });
  const result = JSON.parse(response.content[0].text); assert.equal(Boolean(response.isError),!result.ok); return result;
}
function closure() {
  const graph = installedImportClosure(root, ["adapters/local/cli.mjs","integrations/client/raw/local-host-cli.mjs","adapters/mcp/cli.mjs"]);
  // The generated bin wrapper keeps its independently checked archive mapping.
  return { ...graph, required: ['bin/cairn-memory.mjs', ...graph.required].sort(),
    eager: ['bin/cairn-memory.mjs', ...graph.eager].sort() };
}
function guard(installed,trace) {
  return 'data:text/javascript,'+encodeURIComponent(`
import fs from'node:fs';import promises from'node:fs/promises';import http from'node:http';import https from'node:https';import net from'node:net';import{register,syncBuiltinESMExports}from'node:module';import{fileURLToPath}from'node:url';
const trace=${JSON.stringify(trace)},installed=${JSON.stringify(installed)},note=row=>fs.appendFileSync(trace,JSON.stringify(row)+'\\n');
const deny=()=>{throw Error('synthetic_lifecycle_network_forbidden')};globalThis.fetch=deny;http.request=http.get=https.request=https.get=net.connect=net.createConnection=net.Socket.prototype.connect=deny;
for(const key of['OPENAI_API_KEY','ANTHROPIC_API_KEY','NODE_OPTIONS'])if(process.env[key]!==undefined)throw Error('synthetic_environment_invalid');
for(const api of[fs,promises])for(const method of['readFileSync','readFile']){if(typeof api[method]!=='function')continue;const original=api[method];api[method]=function(value,...args){const path=value instanceof URL?fileURLToPath(value):String(value);if(path.startsWith(installed+'/'))note({kind:'asset',path});return original.call(this,value,...args)}}syncBuiltinESMExports();
register('data:text/javascript,'+encodeURIComponent("import{appendFileSync}from'node:fs';import{fileURLToPath}from'node:url';let data;export function initialize(value){data=value}export async function resolve(specifier,context,next){const result=await next(specifier,context);if(result.url.startsWith('file:')){const path=fileURLToPath(result.url);if(!path.startsWith(data.allowed+'/'))throw Error('installed_lifecycle_source_fallback');appendFileSync(data.trace,JSON.stringify({kind:'module',path})+String.fromCharCode(10))}return result}"),{parentURL:import.meta.url,data:{allowed:${JSON.stringify(dirname(installed))},trace}});
`);
}

export async function lifecycleFixture(t,{ client,matching = false }) {
  const workspace = createTestWorkspace(t,{ prefix:'installed-raw-lifecycle-' });
  const home = join(workspace.path,'home'),usage = join(workspace.path,'usage');
  mkdirSync(home,{ mode:0o700 }); mkdirSync(usage,{ mode:0o700 });
  const artifact = buildArtifact(),{ required, eager:eagerClosure } = closure();
  writeFileSync(join(workspace.path,'package.json'),JSON.stringify({ name:'synthetic-installed-lifecycle',version:'0.0.0',private:true }),{ mode:0o600 });
  command('npm',['install','--prefix',workspace.path,'--offline','--ignore-scripts','--no-audit','--no-fund',artifact.artifactPath],workspace.path,artifact.userconfig);
  const installed = join(workspace.path,'node_modules',packageName),executable = join(workspace.path,'node_modules/.bin/cairn-memory');
  const archived = command('tar',['-tzf',artifact.artifactPath],workspace.path,artifact.userconfig).trim().split('\n').map(path=>path.slice('package/'.length)).sort();
  assert.deepEqual(archived,[...JSON.parse(readFileSync(join(installed,'package.json'))).files].sort()); assert.deepEqual(walk(installed),archived);
  assert.equal(command('tar',['-xOzf',artifact.artifactPath,'package/bin/cairn-memory.mjs'],workspace.path,artifact.userconfig),readFileSync(join(installed,'bin/cairn-memory.mjs'),'utf8'));
  for (const path of required) assert.ok(archived.includes(path),path);
  for (const [path,hash] of Object.entries(artifact.sourceHashes)) assert.equal(sha(readFileSync(join(installed,path))),hash,path);
  const database = join(workspace.path,'memory.sqlite'),configPath = join(workspace.path,'capture.json'),profilePath = join(workspace.path,'host.json');
  const stateRoot = join(workspace.path,'state'),identityKeyPath = join(workspace.path,'identity-key'),retainedPath = join(workspace.path,'retained.json');
  const trace = join(workspace.path,'http.jsonl'),namespace = { ownerId:'synthetic-installed-local',scope:'personal',projectId:null };
  const scaffold = { PATH:dirname(process.execPath),HOME:home,TMPDIR:workspace.path,TMP:workspace.path,TEMP:workspace.path,
    NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1',SYNTHETIC_INSTALLED:installed,SYNTHETIC_CLIENT:client,
    SYNTHETIC_DATABASE:database,SYNTHETIC_CONFIG:configPath,SYNTHETIC_USAGE:usage,SYNTHETIC_TRACE:trace,SYNTHETIC_CORE:join(installed,'core/index.mjs') };
  const environment = { PATH:dirname(process.execPath),HOME:home,LOGNAME:'synthetic',USER:'synthetic',SHELL:'/bin/sh',TERM:'dumb',
    TMPDIR:workspace.path,TMP:workspace.path,TEMP:workspace.path,NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1' };
  let phase = 0; const processes = [],captures = [],mcpSessions = [];
  function direct(args) {
    const imports = join(workspace.path,'direct-'+phase+++'.jsonl');
    const result = spawnSync(process.execPath,args,{ cwd:workspace.path,encoding:'utf8',timeout:20000,maxBuffer:524288,
      env:{ ...scaffold,SYNTHETIC_IMPORT_TRACE:imports,SYNTHETIC_MODE:'empty' } });
    assert.equal(result.error,undefined); assert.equal(result.signal,null); assert.equal(result.status,0,result.stderr);
    processes.push({ phase:'core/bootstrap',code:result.status,signal:result.signal }); return result.stdout;
  }
  direct([preload,'prepare']);
  const configuration = JSON.parse(readFileSync(configPath)); configuration.provider.apiKeyEnv = 'CAIRN_SYNTHETIC_API_KEY';
  if (matching) configuration.captureQualifiedDuplicates = 'append-matching-evidence-v1';
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
    const { sessionId,sourcePath } = sessions[index],id = randomUUID();
    const row = client === 'claude-code' ? { type:'user',uuid:id,timestamp:null,promptSource:'typed',message:{ content:[{ type:'text',text }] } }
      : { type:'event_msg',timestamp:null,payload:{ type:'item_completed',thread_id:sessionId,turn_id:'synthetic-turn-'+id,item:{ type:'UserMessage',id,content:[{ type:'text',text }] } } };
    appendFileSync(sourcePath,JSON.stringify(row)+'\n'); return id;
  }
  function host(args,{ mode = 'memory',key = false,expected = 0 } = {}) {
    const imports = join(workspace.path,'host-'+phase+++'.jsonl'),settings = imports+'.settings.json';
    writeFileSync(settings,JSON.stringify({ installed,profilePath,args,trace:imports,scaffold,mode,syntheticBinary:binary,preload:childPreload }),{ mode:0o600 });
    const result = spawnSync(process.execPath,[driver,settings],{ cwd:workspace.path,encoding:'utf8',timeout:25000,maxBuffer:262144,
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
  function capture(index = 0,mode = 'memory') {
    if (!sessions[index].initialized) { assert.equal(host([...selected('initialize',index),'--start','beginning']).reason,'initialized'); sessions[index].initialized = true; }
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
const all=sql=>db.prepare(sql).all();result={memories,conversations:all('SELECT id,client,session_key,revision FROM raw_conversations ORDER BY id'),messages:all('SELECT conversation_id,message_id,ordinal,total_units,total_bytes,assembly_state,reserved_bytes FROM raw_messages ORDER BY conversation_id,ordinal'),parts:all('SELECT conversation_id,message_id,part_index,saved,reason,sealed FROM raw_parts ORDER BY conversation_id,message_id,part_index').map(({sealed,...part})=>({...part,text:sealed===null?null:Buffer.from(sealed).toString('utf8')})),lineage:all('SELECT r.id AS receiptId,r.memory_id AS memoryId,r.client,r.session_id,r.event_id,r.role,r.excerpt,l.conversation_id,l.message_id,l.start,l.end,l.precision,o.kind FROM receipts r JOIN raw_receipt_lineage l ON l.receipt_id=r.id JOIN raw_receipt_origins o ON o.receipt_id=r.id ORDER BY r.id'),admissions:all('SELECT state FROM admission_claims'),cards:all('SELECT id,state,title,body,revision FROM private_cards'),notes:all('SELECT id,state,text FROM card_notes'),bindings:all('SELECT card_id FROM card_raw_bindings'),exclusions:all('SELECT conversation_id,message_id,start,end FROM raw_source_exclusions')};}finally{db.close()}}
else throw Error('synthetic probe action invalid');console.log(JSON.stringify(result));}finally{core.close()}`;
    return JSON.parse(direct(['--import',preload,'--input-type=module','-e',script]));
  }
  const calls = () => rows(trace).length;
  const ledger = () => { const directory = join(usage,'usage'); if (!existsSync(directory)) return null;
    const files = readdirSync(directory).filter(name=>name.endsWith('.json')); assert.equal(files.length,1); return JSON.parse(readFileSync(join(directory,files[0]))); };
  const cursor = (index = 0) => {
    const files = readdirSync(join(stateRoot,'sessions')).filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
    const matchingCursor = files.map(name=>JSON.parse(readFileSync(join(stateRoot,'sessions',name)))).find(value=>value.sessionId === sessions[index].sessionId);
    if (matchingCursor) return matchingCursor;
    assert.equal(files.length,1,'single selected session cursor'); return JSON.parse(readFileSync(join(stateRoot,'sessions',files[0])));
  };
  function durable() {
    return Object.fromEntries([configPath,profilePath,profilePath+'.prepared.json',profilePath+'.rearm.json',identityKeyPath,
      ...walk(stateRoot).filter(path=>path.endsWith('.json')).map(path=>join(stateRoot,path))].filter(existsSync)
      .map(path=>[path,{ sha:sha(readFileSync(path)),ino:lstatSync(path).ino }]));
  }
  async function noWork(work) { const before = { calls:calls(),ledger:ledger() }; const result = await work();
    assert.equal(calls(),before.calls); assert.deepEqual(ledger(),before.ledger); return result; }
  async function mcp() {
    const imports = join(workspace.path,'mcp-'+phase+++'.jsonl'); writeFileSync(imports,'',{ mode:0o600 });
    const transport = new StdioClientTransport({ command:process.execPath,args:['--import',guard(installed,imports),executable,'--retained-raw-profile',retainedPath],
      cwd:workspace.path,env:environment,stderr:'pipe' });
    const clientInstance = new Client({ name:'synthetic-installed-lifecycle',version:'1.0.0' }),children = [];
    let stderr = '',closed = false; transport.stderr.on('data',chunk=>{ stderr += chunk; });
    async function close() { if (closed) return; closed = true; await clientInstance.close();
      for (const child of children) { const result = await child.done; processes.push({ phase:'mcp',...result }); assert.equal(result.code,0,stderr); assert.equal(result.signal,null); }
    }
    workspace.defer(close); mcpSessions.push({ close });
    const original = cp.spawn;
    try {
      cp.spawn = function(command,args,options) {
        assert.equal(command,process.execPath); assert.ok(args.includes(executable)); assert.equal(options.shell,false);
        const child = original(command,args,options),done = new Promise((resolve,reject)=>{ child.once('error',reject); child.once('close',(code,signal)=>resolve({ code,signal })); });
        children.push({ child,done }); return child;
      };
      await clientInstance.connect(transport);
    } finally { cp.spawn = original; }
    assert.equal((await clientInstance.listTools()).tools.length,25);
    return { client:clientInstance,close };
  }
  async function confirm(card) {
    const imports = join(workspace.path,'pty-'+phase+++'.jsonl'); writeFileSync(imports,'',{ mode:0o600 });
    const child = spawn('/usr/bin/python3',[pty,process.execPath,'--import',guard(installed,imports),executable,'review-card','--retained-raw-profile',retainedPath,
      '--card',card.id,'--revision',String(card.revision),'--applicability','current'],{ cwd:workspace.path,stdio:'pipe',env:environment });
    let complete,stderr = '',prompted = false;
    const lines = createInterface({ input:child.stdout }),done = new Promise((resolve,reject)=>{
      child.once('error',reject); child.once('close',(code,signal)=>resolve({ code,signal }));
    });
    workspace.defer(async()=>{ if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await done; lines.close(); });
    child.stderr.on('data',chunk=>{ stderr += chunk; });
    lines.on('line',line=>{
      const event = JSON.parse(line);
      if (event.event === 'prompt') { prompted = true; assert.match(event.output,/"type": "raw"/);
        child.stdin.write(JSON.stringify({ answer:`CONFIRM ${card.id} ${card.revision} APPLICABILITY current` })+'\n'); }
      if (event.event === 'done') complete = event;
    });
    const result = await done; lines.close(); assert.equal(result.code,0,stderr); assert.equal(result.signal,null); assert.equal(prompted,true);
    assert.equal(complete?.code,0,complete?.output); processes.push({ phase:'pty-supervisor',...result,reviewCode:complete.code });
  }
  async function read(clientInstance,conversationId) {
    const pages = []; let cursor;
    do { assert.ok(pages.length < 20); const page = ok(await call(clientInstance,'read_raw_conversation',{ conversationId,limit:1,...(cursor ? { cursor }:{}) }));
      pages.push(page); cursor = page.nextCursor;
    } while (cursor);
    return { conversation:pages[0].conversation,messages:pages.flatMap(page=>page.messages) };
  }
  const anchor = (view,messageId) => {
    const message = view.messages.find(value=>value.id === messageId); assert.ok(message);
    return { rawAnchor:{ conversationId:view.conversation.id,messageId,start:0,end:message.totalUnits,precision:'whole-message' },expectedConversationRevision:view.conversation.revision };
  };
  const resolveSources = async (clientInstance,anchors) => ok(await call(clientInstance,'resolve_source_references',{ anchors })).sources.map(({ namespace:ignored,...source })=>source);
  async function draft(clientInstance,sources,actionId = randomUUID()) {
    return ok(await call(clientInstance,'create_private_card_draft',{ actionId,title:'Synthetic lifecycle plan',body:'Synthetic independently authored lifecycle body.',sources }));
  }
  async function finish() {
    for (const session of mcpSessions) await session.close();
    const observed = new Set();
    for (const name of readdirSync(workspace.path).filter(name=>/^(direct-|host-|child-|mcp-|pty-).*\.jsonl$/.test(name)))
      for (const row of rows(join(workspace.path,name))) if (row.path?.startsWith(installed+'/')) observed.add(relative(installed,row.path));
    for (const path of observed) assert.ok(required.includes(path),'observed module outside static closure: '+path);
    assert.deepEqual([...observed].sort(), eagerClosure);
    for (const path of ['core/index.mjs','core/raw-lineage-storage.mjs','adapters/local/cli.mjs','adapters/mcp/cli.mjs','adapters/mcp/review-card.mjs']) assert.ok(observed.has(path),path);
    t.diagnostic(JSON.stringify({ client,matching,archiveFiles:archived.length,staticClosure:required.length,observedClosure:observed.size,
      importsInstalledOnly:true,captures,scriptedHttpCalls:calls(),ledgerUsed:ledger()?.used ?? 0,processes }));
    await workspace.cleanup(); assert.equal(existsSync(workspace.path),false);
  }
  assert.equal(host(['prepare']).reason,'prepared');
  return { workspace,installed,namespace,client,sessions,append,capture,host,selected,probe,calls,ledger,cursor,durable,noWork,mcp,confirm,read,anchor,resolveSources,draft,finish,
    key:()=>readFileSync(identityKeyPath),rearm:(id = randomUUID())=>['rearm','--expected-revision','0','--action-id',id,...selected('run').slice(1)] };
}
