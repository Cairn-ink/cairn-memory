import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync, unlinkSync, readdirSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalRawWorker } from '../raw/local-worker.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hostFixture } from './fixtures/local-host-workspace.mjs';
import { claude } from './fixtures/raw-fixtures.mjs';
import { claudeHeadlessSource } from '../raw/local-claude-entrypoint.mjs';
import { withSourceReadObserver } from '../../codex/source.mjs';

const preamble = ['session-owner','queue-operation','mode','permission-mode','file-history-snapshot'].map(type => JSON.stringify({type})+'\n').join('');
const entry = value => JSON.stringify({type:'user',entrypoint:value})+'\n';
const shapes = {
  cli:preamble+entry('cli'),
  'sdk-cli':preamble+entry('sdk-cli'),
  'sdk-ts':preamble+entry('sdk-ts'),
  'sdk-py':preamble+entry('sdk-py'),
  'sdk-future':preamble+entry('sdk-future'),
  missing:preamble,
  ide:preamble+entry('claude-vscode'),
  late:JSON.stringify({type:'session-owner',padding:'x'.repeat(65536)})+'\n'+entry('sdk-cli'),
  malformed:preamble+'{bad json}\n'+JSON.stringify({entrypoint:42})+'\n',
  partial:preamble+'{"entrypoint":"sdk-cli"',
  'interactive-then-headless-continue':preamble+entry('cli')+entry('sdk-cli'),
};
function rows(f) {
  const db = new DatabaseSync(f.databasePath,{readOnly:true});
  try { return db.prepare('SELECT count(*) n FROM raw_parts').get().n; } finally { db.close(); }
}
async function prepared(t) {
  const f = await hostFixture(t);
  f.config.interpretation='raw-only'; f.save();
  f.profile.configDigest=createHash('sha256').update(readFileSync(f.configPath)).digest('hex'); f.saveProfile();
  assert.equal((await f.call('prepare')).status,'ready'); return f;
}
for (const [name,text] of Object.entries(shapes)) test(`Claude first entrypoint ${name}: ${name.startsWith('sdk-') ? 'skip' : 'capture'}`, async t => {
  const f = await prepared(t); writeFileSync(f.sourcePath,text,{mode:0o600});
  const before = f.snapshot(), skipped = name.startsWith('sdk-');
  const initialized = await f.call('initialize');
  if (skipped) {
    assert.equal(initialized.reason,'source_unqualified');
    assert.deepEqual(f.snapshot(),before,'skip creates no session cursor or marker');
    assert.equal(rows(f),0); assert.deepEqual(readdirSync(join(f.stateRoot,'sessions')),[]);
    assert.equal((await f.call('run')).reason,'source_unqualified'); assert.equal(rows(f),0);
  } else {
    if(name==='partial'){
      assert.equal(initialized.reason,'partial_record','existing worker waits for a complete source boundary');
      appendFileSync(f.sourcePath,'\n');
      assert.equal((await f.call('initialize')).status,'ready');
    } else assert.equal(initialized.status,'ready',JSON.stringify(initialized));
    appendFileSync(f.sourcePath,JSON.stringify({...claude('Synthetic captured after entrypoint inspection'),uuid:randomUUID()})+'\n');
    const captured = await f.call('run'); assert.equal(captured.status,'progress',JSON.stringify(captured)); assert.ok(rows(f)>0);
  }
});
test('Claude missing transcript at SessionStart can mark start and capture its first later turn',async t => {
  const f=await prepared(t); unlinkSync(f.sourcePath);
  assert.equal((await f.call('markStart',{...f.selection,start:'eof'})).status,'ready');
  writeFileSync(f.sourcePath,preamble+entry('cli')+JSON.stringify(claude('Synthetic first later turn'))+'\n',{mode:0o600});
  const captured=await f.call('run'); assert.equal(captured.status,'progress',JSON.stringify(captured)); assert.ok(rows(f)>0);
});
test('Claude entrypoint reader uses safe open and reads at most 64 KiB, complete lines only',async t => {
  const f=await prepared(t); writeFileSync(f.sourcePath,shapes.late,{mode:0o600}); const reads=[];
  assert.equal(await withSourceReadObserver(value=>reads.push(value),()=>claudeHeadlessSource(f.sourcePath)),false);
  assert.ok(reads.length>0); assert.ok(reads.every(({start,end})=>start>=0&&end<=65536));
  assert.ok(reads.reduce((sum,{start,end})=>sum+end-start,0)<=65536);
  writeFileSync(f.sourcePath,JSON.stringify({entrypoint:'sdk-cli'}));
  assert.equal(await claudeHeadlessSource(f.sourcePath),false,'a JSON object without a newline is still a partial line');
  const alias=join(f.workspace.path,'alias.jsonl'); writeFileSync(f.sourcePath,entry('sdk-cli')); symlinkSync(f.sourcePath,alias);
  assert.equal(await claudeHeadlessSource(alias),false,'unsafe source is never read');
});
for (const value of ['cli','sdk-cli']) test(`Claude rearm qualifies first entrypoint ${value}`,async t => {
  const f=await prepared(t); writeFileSync(f.sourcePath,preamble+entry(value),{mode:0o600});
  // Seed a valid pre-gate cursor through the trusted worker, so removing the
  // host gate would really rearm this SDK session rather than fail an anchor.
  const worker=createLocalRawWorker({stateRoot:f.stateRoot,identityKeyPath:f.identityKeyPath,nodeExecutable:process.execPath,
    runtimeRoot:resolve(fileURLToPath(new URL('../../../',import.meta.url))),configPath:f.configPath,expectedAuthority:f.config.authority,home:f.profile.home});
  assert.equal((await worker.initialize({...f.selection,start:'eof',pluginRoot:f.pluginRoot,formatAuthority:null})).status,'ready');
  f.disable(); const current=f.core.getLocalCaptureControl({namespace:f.namespace,client:f.client}).value;
  assert.equal(f.core.setLocalCaptureControl({namespace:f.namespace,client:f.client,targetId:current.targetId,expectedStoreId:current.storeId,
    expectedRevision:current.revision,automaticCaptureEnabled:true,rawNoticeVersion:current.rawNoticeVersion}).ok,true);
  const before=f.snapshot(),result=await f.call('rearm',{...f.selection,expectedRevision:0,actionId:randomUUID()});
  assert.equal(result.reason,value==='cli'?'rearmed':'source_unqualified',JSON.stringify(result));
  if(value==='sdk-cli'){assert.deepEqual(f.snapshot(),before);assert.equal(rows(f),0);}
});
