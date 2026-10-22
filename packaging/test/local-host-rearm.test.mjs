import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';
import { binaryIdentity, canonical, KNOWN_FORMATS } from '../../integrations/codex/qualification.mjs';

const root = fileURLToPath(new URL('../../',import.meta.url));
const preload = fileURLToPath(new URL('./fixtures/local-oneshot.mjs',import.meta.url));
const childPreload = fileURLToPath(new URL('./fixtures/local-host-child.mjs',import.meta.url));
const driver = fileURLToPath(new URL('./fixtures/local-host.mjs',import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const rows = path => existsSync(path) ? readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const walk = (path,prefix='') => readdirSync(path,{ withFileTypes:true }).flatMap(entry => entry.isDirectory()
  ? walk(join(path,entry.name),prefix+entry.name+'/'):[prefix+entry.name]).sort();
function sourceClosure() {
  const queue = ['adapters/local/cli.mjs','integrations/client/raw/local-host-cli.mjs'], seen = new Set();
  while (queue.length) {
    const path = queue.pop(); if (seen.has(path)) continue; seen.add(path); if (!path.endsWith('.mjs')) continue;
    const text = readFileSync(join(root,path),'utf8');
    for (const match of [...text.matchAll(/\b(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g),
      ...text.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)]) {
      const next = relative(root,resolve(root,dirname(path),match[1])); assert.equal(next.startsWith('..'),false);
      if (!lstatSync(join(root,next)).isDirectory()) queue.push(next);
    }
  }
  return [...seen].sort();
}
async function fixture(t,client = 'claude-code') {
  const workspace = createTestWorkspace(t,{ prefix:'installed-local-rearm-' }), home = join(workspace.path,'home'), usage = join(workspace.path,'usage');
  mkdirSync(home,{ mode:0o700 }); mkdirSync(usage,{ mode:0o700 });
  const artifact = buildArtifact(), closure = sourceClosure();
  writeFileSync(join(workspace.path,'package.json'),JSON.stringify({ name:'synthetic-local-rearm',version:'0.0.0',private:true }),{ mode:0o600 });
  command('npm',['install','--prefix',workspace.path,'--offline','--ignore-scripts','--no-audit','--no-fund',artifact.artifactPath],workspace.path,artifact.userconfig);
  const installed = join(workspace.path,'node_modules',packageName), configPath = join(workspace.path,'config.json'), database = join(workspace.path,'memory.sqlite');
  const archived = command('tar',['-tzf',artifact.artifactPath],workspace.path,artifact.userconfig).trim().split('\n').map(path=>path.slice('package/'.length)).sort();
  const manifest = [...JSON.parse(readFileSync(join(installed,'package.json'))).files].sort();
  assert.deepEqual(archived,manifest); assert.deepEqual(walk(installed),archived);
  for (const path of closure) { assert.ok(archived.includes(path),path); assert.deepEqual(readFileSync(join(installed,path)),readFileSync(join(root,path))); }
  for (const path of ['integrations/client/raw/local-host-rearm.mjs','integrations/client/raw/local-rearm-state.mjs']) assert.equal(lstatSync(join(installed,path)).mode&0o777,0o644);
  const scaffold = { PATH:dirname(process.execPath),HOME:home,TMPDIR:workspace.path,TMP:workspace.path,TEMP:workspace.path,
    NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1',SYNTHETIC_INSTALLED:installed,SYNTHETIC_CLIENT:client,
    SYNTHETIC_DATABASE:database,SYNTHETIC_CONFIG:configPath,SYNTHETIC_USAGE:usage,SYNTHETIC_TRACE:join(workspace.path,'http.jsonl'),
    SYNTHETIC_CORE:join(installed,'core/index.mjs'),SYNTHETIC_MODE:'memory' };
  let phase = 0; const processReceipts = [];
  function direct(args) {
    const imports = join(workspace.path,'direct-'+phase+++'.jsonl');
    const result = spawnSync(process.execPath,args,{ cwd:workspace.path,encoding:'utf8',timeout:20000,maxBuffer:262144,
      env:{ ...scaffold,SYNTHETIC_IMPORT_TRACE:imports } });
    assert.equal(result.error,undefined); assert.equal(result.status,0,result.stderr); assert.equal(result.signal,null);
    processReceipts.push({ phase:'direct',code:result.status,signal:result.signal }); return result.stdout;
  }
  direct([preload,'prepare']);
  const config = JSON.parse(readFileSync(configPath)); config.provider.apiKeyEnv='CAIRN_SYNTHETIC_API_KEY';
  config.captureQualifiedDuplicates='append-matching-evidence-v1'; writeFileSync(configPath,JSON.stringify(config));
  const pluginRoot = join(workspace.path,'plugin'), qroot = join(workspace.path,'codex-install'), qdir = join(qroot,'qualification');
  mkdirSync(pluginRoot,{ mode:0o700 }); mkdirSync(qroot,{ mode:0o700 }); mkdirSync(qdir,{ mode:0o700 });
  const qualificationConfigPath = join(qroot,'installation.json'); writeFileSync(qualificationConfigPath,'{}',{ mode:0o600 });
  const binary = join(workspace.path,'codex'); writeFileSync(binary,'synthetic native binary',{ mode:0o700 });
  const identity = await binaryIdentity(binary);
  writeFileSync(join(qdir,identity+'.json'),JSON.stringify({ policy:sha(canonical(KNOWN_FORMATS)),identity,version:'0.162.0',status:'qualified',fingerprint:KNOWN_FORMATS[1] }),{ mode:0o600 });
  const profilePath = join(workspace.path,'profile.json'), stateRoot = join(workspace.path,'state'), identityKeyPath = join(workspace.path,'identity-key');
  const profile = { version:'local-raw-host-profile-v1',configPath,configDigest:sha(readFileSync(configPath)),stateRoot,identityKeyPath,home,
    installation:client==='claude-code' ? { client,pluginRoot }:{ client,qualificationConfigPath } };
  writeFileSync(profilePath,JSON.stringify(profile),{ mode:0o600 });
  const sourcePath = join(workspace.path,'source.jsonl'), sessionId = '11111111-1111-4111-8111-111111111111';
  const header = client==='codex' ? JSON.stringify({ type:'session_meta',payload:{ id:sessionId,cli_version:'0.162.0',history_mode:'paginated',source:'cli',originator:'codex-tui' } })+'\n':'';
  writeFileSync(sourcePath,header,{ mode:0o600 });
  function append(text,id = randomUUID()) {
    const row = client==='claude-code' ? { type:'user',uuid:id,timestamp:null,promptSource:'typed',message:{ content:[{ type:'text',text }] } }
      : { type:'event_msg',timestamp:null,payload:{ type:'item_completed',thread_id:sessionId,turn_id:'synthetic-turn',
        item:{ type:'UserMessage',id,content:[{ type:'text',text }] } } };
    appendFileSync(sourcePath,JSON.stringify(row)+'\n');
  }
  function invoke(args,{ expected = 0,key = false } = {}) {
    const trace = join(workspace.path,'host-'+phase+++'.jsonl'), settings = trace+'.settings.json';
    writeFileSync(settings,JSON.stringify({ installed,profilePath,args,trace,scaffold,mode:'memory',syntheticBinary:binary,preload:childPreload }),{ mode:0o600 });
    const result = spawnSync(process.execPath,[driver,settings],{ cwd:workspace.path,encoding:'utf8',timeout:25000,maxBuffer:262144,
      env:{ PATH:dirname(process.execPath),HOME:home,TMPDIR:workspace.path,TMP:workspace.path,TEMP:workspace.path,
        NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1',...(key ? { CAIRN_SYNTHETIC_API_KEY:'synthetic_key_secret' }:{}) } });
    assert.equal(result.error,undefined); assert.equal(result.status,expected,result.stderr+result.stdout); assert.equal(result.signal,null);
    assert.doesNotMatch(result.stdout+result.stderr,/synthetic_key_secret/);
    const events = rows(trace), spawned = events.filter(row=>row.kind==='spawn'), closed = events.filter(row=>row.kind==='close');
    assert.deepEqual(spawned.map(row=>row.pid).sort(),closed.map(row=>row.pid).sort());
    for (const row of closed) { assert.equal(row.code,0); assert.equal(row.signal,null); }
    processReceipts.push({ phase:args[0],code:result.status,signal:result.signal,children:closed.map(({ code,signal })=>({ code,signal })) });
    return JSON.parse(result.stdout);
  }
  const selected = action => [action,'--session',sessionId,'--source',sourcePath];
  const rearmArgs = (revision = 0,id = randomUUID()) => ['rearm','--expected-revision',String(revision),'--action-id',id,'--session',sessionId,'--source',sourcePath];
  function operator(action) {
    const script = `const{openMemoryCore}=await import(process.env.SYNTHETIC_CORE);const c=JSON.parse((await import('node:fs')).readFileSync(process.env.SYNTHETIC_CONFIG));
const core=openMemoryCore({path:process.env.SYNTHETIC_DATABASE,existingStore:{version:'schema29-existing-v1',storeId:c.authority.storeId},rawConversations:{mode:'off',configureCap:false,readPolicy(){throw Error('retained read forbidden')}}});
try{const ok=r=>{if(!r.ok)throw Error('synthetic operator refused');return r.value};const{namespace,client}=c.authority;
${action==='inspect' ? `const list=ok(core.list({namespace}));console.log(JSON.stringify(list.memories.map(m=>ok(core.get({namespace,memoryId:m.id,includeQualification:true})))));`
      : `const current=ok(core.getLocalCaptureControl({namespace,client}));ok(core.setLocalCaptureControl({namespace,client,targetId:current.targetId,expectedStoreId:current.storeId,expectedRevision:current.revision,automaticCaptureEnabled:${action==='resume'},rawNoticeVersion:current.rawNoticeVersion}));`}
}finally{core.close()}`;
    const result = direct(['--import',preload,'--input-type=module','-e',script]); return action==='inspect' ? JSON.parse(result):null;
  }
  function inspectRaw() {
    const script = `const{DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(process.env.SYNTHETIC_DATABASE,{readOnly:true});try{console.log(JSON.stringify({conversations:db.prepare('SELECT id,session_key FROM raw_conversations').all(),messages:db.prepare('SELECT ordinal,message_id FROM raw_messages ORDER BY ordinal').all(),text:Buffer.concat(db.prepare('SELECT sealed FROM raw_parts WHERE saved=1 ORDER BY rowid').all().map(p=>Buffer.from(p.sealed))).toString('utf8')}))}finally{db.close()}`;
    return JSON.parse(direct(['--import',preload,'--input-type=module','-e',script]));
  }
  const cursorPath = () => join(stateRoot,'sessions',readdirSync(join(stateRoot,'sessions')).find(name=>/^[a-f0-9]{64}\.json$/.test(name)));
  const cursor = () => JSON.parse(readFileSync(cursorPath()));
  const durable = () => Object.fromEntries([configPath,profilePath,profilePath+'.prepared.json',profilePath+'.rearm.json',identityKeyPath,
    ...walk(stateRoot).filter(path=>path.endsWith('.json')).map(path=>join(stateRoot,path))].filter(existsSync)
    .map(path=>[path,{ sha:sha(readFileSync(path)),ino:lstatSync(path).ino }]));
  function observedClosure() {
    const seen = new Set(); for (const name of readdirSync(workspace.path).filter(name=>/^(direct-|host-|child-).*\.jsonl$/.test(name)))
      for (const row of rows(join(workspace.path,name))) if (row.path?.startsWith(installed+'/')) seen.add(relative(installed,row.path));
    return [...seen].sort();
  }
  return { workspace,installed,configPath,profilePath,stateRoot,identityKeyPath,sourcePath,sessionId,append,invoke,selected,rearmArgs,
    operator,inspectRaw,cursorPath,cursor,durable,direct,processReceipts,closure,observedClosure,calls:()=>rows(scaffold.SYNTHETIC_TRACE).length,
    ledger:()=>rows(join(usage,'usage',readdirSync(join(usage,'usage')).find(name=>name.endsWith('.json')))),archiveCount:archived.length };
}

for (const client of ['claude-code','codex']) test(`RR02/05/10 installed ${client}: capture, pause, explicit rearm, later capture and immutable replay`,{ timeout:120000 },async t => {
  const f = await fixture(t,client), initial='Synthetic initial source. Ａ🙂', paused='Synthetic paused source must not be saved.', later='Synthetic later source. e\u0301';
  f.append(initial); assert.equal((await f.invoke(['prepare'])).reason,'prepared');
  assert.equal((await f.invoke([...f.selected('initialize'),'--start','beginning'])).reason,'initialized');
  const firstReply = await f.invoke(f.selected('run'),{ key:true }); assert.deepEqual(Object.keys(firstReply),['version','status','reason','worker']);
  const original = f.operator('inspect')[0], first = f.inspectRaw(), old = f.cursor(), key = readFileSync(f.identityKeyPath);
  assert.ok(original.qualification); assert.equal(original.receipts.length,1);
  const configurationBefore = JSON.parse(readFileSync(f.configPath)); delete configurationBefore.authority;
  const rootBefore = readFileSync(join(f.stateRoot,'root.json'));
  assert.equal(first.messages.length,1); assert.equal(first.text,initial); assert.equal(old.issuedOrdinal,1);
  f.operator('pause'); f.append(paused); f.operator('resume');
  assert.equal((await f.invoke(f.selected('run'),{ expected:2 })).reason,'authority_changed');
  const beforeCalls = f.calls(), beforeLedger = f.ledger(), args = f.rearmArgs();
  assert.deepEqual(await f.invoke(['rearm-status']),{ version:'local-raw-rearm-status-v1',status:'ready',reason:null,revision:0,pending:false });
  assert.equal((await f.invoke(args)).reason,'rearmed'); assert.equal(f.calls(),beforeCalls); assert.deepEqual(f.ledger(),beforeLedger);
  assert.deepEqual(readFileSync(f.identityKeyPath),key); assert.equal(f.cursor().wireSessionId,old.wireSessionId); assert.equal(f.cursor().issuedOrdinal,1);
  assert.equal(f.cursor().sessionKey,old.sessionKey); assert.deepEqual(readFileSync(join(f.stateRoot,'root.json')),rootBefore);
  const configurationAfter = JSON.parse(readFileSync(f.configPath)); delete configurationAfter.authority;
  assert.deepEqual(configurationAfter,configurationBefore);
  f.append(later); const captured = await f.invoke(f.selected('run'),{ key:true }); assert.equal(captured.worker.completedRecords,1);
  const after = f.inspectRaw(), memories = f.operator('inspect'); assert.deepEqual(after.conversations,first.conversations);
  assert.deepEqual(after.messages.map(row=>row.ordinal),[1,2]); assert.equal(after.text,initial+later); assert.equal(after.text.includes(paused),false);
  assert.equal(memories.length,1); assert.equal(memories[0].memory.id,original.memory.id); assert.deepEqual(memories[0].qualification,original.qualification);
  assert.equal(memories[0].receipts.length,2);
  const durable = f.durable(), calls = f.calls(), ledger = f.ledger(); f.append('Synthetic append after completed action');
  assert.equal((await f.invoke(args)).reason,'replayed'); assert.deepEqual(f.durable(),durable); assert.equal(f.calls(),calls); assert.deepEqual(f.ledger(),ledger);
  assert.equal((await f.invoke(['rearm-status'])).revision,1); assert.deepEqual(f.observedClosure(),f.closure);
  t.diagnostic(JSON.stringify({ client,archiveFiles:f.archiveCount,closure:f.closure.length,actualProcesses:f.processReceipts,
    sameConversation:true,ordinals:[1,2],pausedSourceSaved:false,replayPublished:false }));
});

test('RR01/08 installed malformed CLI, unchanged authority and partial EOF refuse without publication', { timeout:120000 },async t => {
  const f = await fixture(t); f.append('Synthetic initial skipped source'); await f.invoke(['prepare']); await f.invoke(f.selected('initialize'));
  const before = f.durable(); assert.equal((await f.invoke(f.rearmArgs(),{ expected:2 })).reason,'rearm_refused');
  const invalid = f.rearmArgs(); invalid[2]='00'; assert.equal((await f.invoke(invalid,{ expected:2 })).reason,'invalid_input');
  f.operator('pause'); appendFileSync(f.sourcePath,'{'); f.operator('resume');
  assert.equal((await f.invoke(f.rearmArgs(),{ expected:2 })).reason,'partial_record');
  assert.deepEqual(f.durable(),before); assert.equal(f.calls(),0);
});

test('RR06/10 installed cold recovery retains the first frozen EOF after global-intent publication failure', { timeout:120000 },async t => {
  const f = await fixture(t); f.append('Synthetic initial skipped source'); await f.invoke(['prepare']); await f.invoke(f.selected('initialize'));
  f.operator('pause'); f.append('Synthetic paused append'); f.operator('resume'); const args = f.rearmArgs(), expectedEOF = readFileSync(f.sourcePath).length;
  const script = `const{createLocalRawHost}=await import(${JSON.stringify('file:')}+${JSON.stringify(join(f.installed,'integrations/client/raw/local-host.mjs'))});
const{withWriteObserver}=await import(${JSON.stringify('file:')}+${JSON.stringify(join(f.installed,'integrations/client/private-state.mjs'))});
let fired=false;const result=await withWriteObserver(({path})=>{if(path===${JSON.stringify(f.profilePath+'.rearm.json')}&&!fired){fired=true;throw Error('synthetic publication failure')}},()=>createLocalRawHost({profilePath:${JSON.stringify(f.profilePath)}}).rearm(${JSON.stringify({expectedRevision:0,actionId:args[4],sessionId:f.sessionId,sourcePath:f.sourcePath})}));if(!fired||result.status!=='blocked')throw Error('synthetic interruption missing');`;
  f.direct(['--import',preload,'--input-type=module','-e',script]);
  const pending = await f.invoke(['rearm-status'],{ expected:3 }); assert.equal(pending.revision,0); assert.equal(pending.pending,true);
  f.append('Synthetic append after frozen EOF'); assert.equal((await f.invoke(args)).reason,'replayed');
  assert.equal(f.cursor().offset,expectedEOF); assert.equal(f.cursor().issuedOrdinal,0); assert.equal(f.calls(),0);
  const before = f.durable(); assert.equal((await f.invoke(args)).reason,'replayed'); assert.deepEqual(f.durable(),before);
});

for (const client of ['claude-code','codex']) test(`RR04/06/10 installed ${client}: real conversation deletion blocks cold pending-action recovery`,{ timeout:120000 },async t => {
  const f = await fixture(t,client); f.append('Synthetic captured source before deletion');
  await f.invoke(['prepare']); await f.invoke([...f.selected('initialize'),'--start','beginning']);
  assert.equal((await f.invoke(f.selected('run'),{ key:true })).worker.completedRecords,client === 'codex' ? 2:1);
  assert.equal(f.cursor().issuedOrdinal,1); assert.equal(f.cursor().pending,null);
  f.operator('pause'); f.operator('resume'); const args = f.rearmArgs();
  const interrupt = `const{createLocalRawHost,withLocalHostDependencies}=await import(${JSON.stringify('file:')}+${JSON.stringify(join(f.installed,'integrations/client/raw/local-host.mjs'))});
const{withWriteObserver}=await import(${JSON.stringify('file:')}+${JSON.stringify(join(f.installed,'integrations/client/private-state.mjs'))});
const q=await import(${JSON.stringify('file:')}+${JSON.stringify(join(f.installed,'integrations/codex/qualification.mjs'))}),binary=${JSON.stringify(join(f.workspace.path,'codex'))};
const detectHost=async()=>{const detected=await q.detectRunningHost({pid:42,proc:'/synthetic/proc',link:async()=>binary,identity:()=>q.binaryIdentity(binary),read:async path=>Buffer.from(path.endsWith('cmdline')?'codex\\0':'42 (codex) S 1 0 0')});const{processPath,...host}=detected;return host};
let fired=false;const result=await withLocalHostDependencies({detectHost},()=>withWriteObserver(({path})=>{if(path===${JSON.stringify(f.profilePath+'.rearm.json')}&&!fired){fired=true;throw Error('synthetic pending interruption')}},()=>createLocalRawHost({profilePath:${JSON.stringify(f.profilePath)}}).rearm(${JSON.stringify({expectedRevision:0,actionId:args[4],sessionId:f.sessionId,sourcePath:f.sourcePath})})));if(!fired||result.status!=='blocked')throw Error('synthetic interruption missing');`;
  f.direct(['--import',preload,'--input-type=module','-e',interrupt]);
  const deletion = `const{openMemoryCore}=await import(process.env.SYNTHETIC_CORE);const c=JSON.parse((await import('node:fs')).readFileSync(process.env.SYNTHETIC_CONFIG));
const core=openMemoryCore({path:process.env.SYNTHETIC_DATABASE,existingStore:{version:'schema29-existing-v1',storeId:c.authority.storeId},rawConversations:{mode:'off',configureCap:false,readPolicy(){throw Error('retained read forbidden')}}});
try{const ok=r=>{if(!r.ok)throw Error('synthetic delete refused');return r.value};const{namespace,client}=c.authority;const before=ok(core.getLocalCaptureControl({namespace,client}));const conversation=ok(core.listRawConversations({namespace,client})).conversations[0];if(!conversation)throw Error('synthetic capture missing');ok(core.deleteConversation({namespace,conversationId:conversation.id,expectedRevision:conversation.revision,actionId:'synthetic-delete-before-recovery'}));if(JSON.stringify(ok(core.getLocalCaptureControl({namespace,client})))!==JSON.stringify(before))throw Error('synthetic controls changed');}finally{core.close()}`;
  f.direct(['--import',preload,'--input-type=module','-e',deletion]);
  const before = f.durable(),calls = f.calls(),ledger = f.ledger();
  assert.equal((await f.invoke(args,{ expected:2 })).reason,'rearm_refused');
  assert.deepEqual(f.durable(),before); assert.equal(f.calls(),calls); assert.deepEqual(f.ledger(),ledger);
  assert.deepEqual(await f.invoke(['rearm-status'],{ expected:3 }),{ version:'local-raw-rearm-status-v1',status:'waiting',reason:'rearm_pending',revision:0,pending:true });
  assert.equal(f.inspectRaw().conversations.length,0);
});
