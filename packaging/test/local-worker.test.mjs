import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,writeFileSync } from 'node:fs';
import { dirname,join,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact,command,packageName } from '../build.mjs';
import { redactSecrets } from '../../integrations/client/redact.mjs';
const root = fileURLToPath(new URL('../../',import.meta.url));
const preload = fileURLToPath(new URL('./fixtures/local-oneshot.mjs',import.meta.url));
const driver = fileURLToPath(new URL('./fixtures/local-worker.mjs',import.meta.url));
const runner = join(root,'tools/testing/run.mjs');
function closure() {
  const queue = ['adapters/local/cli.mjs','integrations/client/raw/local-worker.mjs'], seen = new Set();
  while (queue.length) {
    const path = queue.pop(); if (seen.has(path)) continue; seen.add(path); if (!path.endsWith('.mjs')) continue;
    const text = readFileSync(join(root,path),'utf8');
    for (const row of [...text.matchAll(/\b(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g),
      ...text.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)]) {
      const next = relative(root,resolve(root,dirname(path),row[1])); assert.equal(next.startsWith('..'),false);
      // A default plugin-root URL is an identity, not an asset read. Only real
      // regular modules/assets form this independently derived file closure.
      if (lstatSync(join(root,next)).isDirectory()) continue;
      queue.push(next);
    }
  }
  return [...seen].sort();
}
for (const client of ['claude-code','codex']) test(`B4b installed ${client}: durable worker restarts recover only the same event from archive modules`,{ timeout:120000 },async t => {
  const workspace = createTestWorkspace(t,{ prefix:'installed-local-worker-' }), home = join(workspace.path,'home'), usage = join(workspace.path,'usage');
  mkdirSync(home,{ mode:0o755 }); mkdirSync(usage,{ mode:0o700 });
  const artifact = buildArtifact(), expectedClosure = closure();
  writeFileSync(join(workspace.path,'package.json'),JSON.stringify({ name:'synthetic-local-worker',version:'0.0.0',private:true }),{ mode:0o600 });
  command('npm',['install','--prefix',workspace.path,'--offline','--ignore-scripts','--no-audit','--no-fund',artifact.artifactPath],workspace.path,artifact.userconfig);
  const installed = join(workspace.path,'node_modules',packageName), configPath = join(workspace.path,'config.json'), database = join(workspace.path,'memory.sqlite');
  for (const path of expectedClosure) { assert.ok(artifact.files.includes(path),path); assert.deepEqual(readFileSync(join(installed,path)),readFileSync(join(root,path))); }
  const scaffold = { PATH:dirname(process.execPath),HOME:home,TMPDIR:workspace.path,TMP:workspace.path,TEMP:workspace.path,NODE_DISABLE_COMPILE_CACHE:'1',NODE_NO_WARNINGS:'1',
    SYNTHETIC_INSTALLED:installed,SYNTHETIC_CLIENT:client,SYNTHETIC_DATABASE:database,SYNTHETIC_CONFIG:configPath,SYNTHETIC_USAGE:usage,
    SYNTHETIC_TRACE:join(workspace.path,'http.jsonl'),SYNTHETIC_CORE:join(installed,'core/index.mjs'),SYNTHETIC_MODE:'memory' };
  const prepared = spawnSync(process.execPath,[runner,'--script',preload,'prepare'],{ encoding:'utf8',timeout:15000,
    env:{ ...scaffold,SYNTHETIC_IMPORT_TRACE:join(workspace.path,'prepare-imports.jsonl') } });
  assert.equal(prepared.error,undefined); assert.equal(prepared.status,0,prepared.stderr); assert.equal(prepared.signal,null);
  const config = JSON.parse(readFileSync(configPath,'utf8')); config.provider.apiKeyEnv = 'CAIRN_SYNTHETIC_API_KEY'; writeFileSync(configPath,JSON.stringify(config));
  const modePath = join(workspace.path,'mode'), executable = join(workspace.path,'synthetic-worker-node.mjs'); writeFileSync(modePath,'drop-ack');
  writeFileSync(executable,`#!${process.execPath}
import {spawn} from 'node:child_process';import {readFileSync} from 'node:fs';
if(process.argv[2]==='--version')process.stdout.write(process.version+'\\n');
else {
 const mode=readFileSync(${JSON.stringify(modePath)},'utf8');
 const child=spawn(${JSON.stringify(process.execPath)},['--import',${JSON.stringify(preload)},...process.argv.slice(2)],
 {shell:false,stdio:mode==='drop-ack'?['inherit','pipe','inherit']:'inherit',env:{...process.env,...${JSON.stringify(scaffold)},
 SYNTHETIC_MODE:'memory',SYNTHETIC_IMPORT_TRACE:${JSON.stringify(join(workspace.path,'child-imports-'))}+process.pid+'.jsonl'}});
 if(mode==='drop-ack')child.stdout.on('data',()=>{});
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
 child.once('error',()=>{process.exitCode=1});child.once('close',code=>{process.exitCode=mode==='drop-ack'?7:code??1});
}
`,{ flag:'wx',mode:0o700 });
  const environment = { PATH:dirname(process.execPath),HOME:home,TMPDIR:workspace.path,TMP:workspace.path,TEMP:workspace.path,NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1' };
  const syntax = spawnSync(process.execPath,['--check',executable],{ stdio:'ignore',timeout:2000,env:environment });
  assert.equal(syntax.error,undefined); assert.equal(syntax.status,0); assert.equal(syntax.signal,null);
  const stateRoot = join(workspace.path,'state'), identityKeyPath = join(workspace.path,'identity-key'), sourcePath = join(workspace.path,'selected-source.jsonl');
  mkdirSync(stateRoot,{ mode:0o700 }); writeFileSync(identityKeyPath,'31'.repeat(32)+'\n',{ mode:0o600 });
  const sessionId = '11111111-1111-4111-8111-111111111111', text = 'x'.repeat(3995)+' sk-'+'a'.repeat(32)+'\n Ａ🙂 e\u0301 '.repeat(700);
  const row = client === 'claude-code' ? { type:'user',uuid:'synthetic-message',timestamp:null,promptSource:'typed',message:{ content:[{ type:'text',text }] } }
    : { type:'event_msg',timestamp:null,payload:{ type:'item_completed',thread_id:sessionId,turn_id:'synthetic-turn',item:{ type:'UserMessage',id:'native-message',content:[{ type:'text',text }] } } };
  const header = client === 'codex' ? JSON.stringify({ type:'session_meta',payload:{ id:sessionId,cli_version:'0.162.0',history_mode:'paginated',source:'cli',originator:'codex-tui' } })+'\n' : '';
  writeFileSync(sourcePath,header+JSON.stringify(row)+'\n',{ mode:0o600 });
  const context = { sessionId,sourcePath,pluginRoot:client === 'claude-code' ? '/synthetic/cairn-memory/0.3.2' : null,
    formatAuthority:client === 'codex' ? { format:'codex-0.157.1-paginated-v1',sessionId,creatorVersion:'0.162.0',qualifiedCreatorVersion:null } : null };
  const cursor = () => JSON.parse(readFileSync(join(stateRoot,'sessions',readdirSync(join(stateRoot,'sessions')).find(name => name.endsWith('.json') && !name.endsWith('.claim.json'))),'utf8'));
  let invocation = 0;
  const invoke = (action,{ key = true,clock,start } = {}) => {
    const index = invocation++, settings = join(workspace.path,`settings-${index}.json`);
    writeFileSync(settings,JSON.stringify({ installed,trace:join(workspace.path,`host-imports-${index}.jsonl`),action,clock,
      options:{ stateRoot,identityKeyPath,nodeExecutable:executable,runtimeRoot:installed,configPath,expectedAuthority:config.authority,home,
        env:key ? { CAIRN_SYNTHETIC_API_KEY:'synthetic_key_secret' } : {} },context:{ ...context,...(start ? { start } : {}) } }),{ flag:'wx',mode:0o600 });
    const result = spawnSync(process.execPath,[runner,'--script',driver,settings],{ encoding:'utf8',timeout:30000,maxBuffer:262144,env:environment });
    assert.equal(result.error,undefined); assert.equal(result.status,0,result.stderr); assert.equal(result.signal,null);
    assert.doesNotMatch(result.stdout+result.stderr,/synthetic_source_secret|synthetic_key_secret/); return JSON.parse(result.stdout);
  };
  assert.equal(invoke('initialize',{ start:'beginning' }).status,'ready');
  assert.equal(invoke('run').reason,'uncertain'); const pending = cursor().pending; assert.equal(pending.attempts,1);
  assert.equal(invoke('run',{ key:false,clock:pending.nextEligibleAt-1 }).dispatchedParts,0);
  writeFileSync(modePath,'memory'); const recovered = invoke('run',{ key:false,clock:pending.nextEligibleAt+1 });
  assert.equal(recovered.completedParts,1); assert.equal(recovered.dispatchedParts,1); assert.equal(cursor().pending.attempts,0);
  const continued = invoke('run',{ key:false,clock:pending.nextEligibleAt+1 }); assert.equal(continued.hasPending,false);
  assert.equal(invoke('run',{ key:false }).status,'ready'); assert.equal(cursor().issuedOrdinal,1);
  const db = new DatabaseSync(database,{ readOnly:true }); let partCount;
  try {
    const parts = db.prepare('SELECT sealed,saved FROM raw_parts ORDER BY part_index').all(); partCount = parts.length; assert.ok(partCount > 1);
    assert.equal(parts.every(part => part.saved === 1),true); assert.equal(Buffer.concat(parts.map(part => Buffer.from(part.sealed))).toString(),redactSecrets(text));
    assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n,1); assert.equal(db.prepare('SELECT count(*) n FROM raw_events').get().n,partCount);
  } finally { db.close(); }
  const observed = new Set(), traces = readdirSync(workspace.path).filter(name => /^(?:prepare-imports|host-imports-\d+|child-imports-\d+)\.jsonl$/.test(name));
  for (const name of traces) for (const line of readFileSync(join(workspace.path,name),'utf8').trim().split('\n').filter(Boolean)) {
    const row = JSON.parse(line); if (row.path.startsWith(installed+'/')) observed.add(relative(installed,row.path));
  }
  assert.deepEqual([...observed].sort(),expectedClosure); assert.equal(traces.filter(name => name.startsWith('child-imports-')).length,partCount+1);
  const ledgers = readdirSync(join(usage,'usage')).filter(name => name.endsWith('.json')); assert.equal(ledgers.length,1);
  const ledger = JSON.parse(readFileSync(join(usage,'usage',ledgers[0]),'utf8')); assert.equal(ledger.used,3); assert.deepEqual(ledger.reservations,[]);
  assert.equal(readFileSync(scaffold.SYNTHETIC_TRACE,'utf8').trim().split('\n').length,6);
  for (const name of readdirSync(join(stateRoot,'sessions'))) if (name.endsWith('.json')) {
    const stored = readFileSync(join(stateRoot,'sessions',name),'utf8');
    for (const sentinel of [sessionId,sourcePath,context.pluginRoot,'synthetic-message','synthetic_key_secret'].filter(Boolean)) assert.equal(stored.includes(sentinel),false);
  }
  t.diagnostic(JSON.stringify({ client,closureFiles:expectedClosure.length,observedInstalledFiles:observed.size,normalWorkerInvocationExits:invocation,parts:partCount }));
  await workspace.cleanup(); assert.equal(existsSync(workspace.path),false);
});
