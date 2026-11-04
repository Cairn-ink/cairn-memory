// Generate the reference with an external git archive/worktree of a6ec0e0e:
// node receipt-event-time-main-worker.mjs <source-root> <scratch> <report> [old|safety|event]
// Freeze main references in old and safety modes; event mode checks the candidate.
// The source root is supplied at runtime; no machine-specific paths are retained.
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
let sequence = 0;
crypto.randomUUID = () => '00000000-0000-4000-8000-' + String(++sequence).padStart(12,'0');
crypto.randomBytes = size => Buffer.alloc(size,7);
syncBuiltinESMExports();
const RealDate = Date, clock = Date.parse('2026-11-04T00:00:00.000Z');
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
};
Object.defineProperty(performance,'now',{configurable:true,value:()=>0});
const [root, scratch, report, mode] = process.argv.slice(2);
mkdirSync(scratch,{recursive:true});
const load = file => import(pathToFileURL(join(root,file)).href);
const { openMemoryCore, openMemoryStore } = await load('core/index.mjs');
const { openDatabase } = await load('core/database.mjs');
const { model } = await load('core/testing/episode-capture-helpers.mjs');
const { rationaleModel } = await load('core/testing/rationale-model.mjs');
const { options } = await load('core/testing/episode-helpers.mjs');
const { DatabaseSync } = await import('node:sqlite');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const values = {
  valid:'2001-02-03T04:05:06.789Z', noMilliseconds:'2001-02-03T04:05:06Z',
  offset:'2001-02-03T04:05:06.789+00:00', dateOnly:'2001-02-03', garbage:'garbage',
  number:7, future:'2099-01-01T00:00:00.000Z', pre1970:'1901-02-03T04:05:06.789Z', empty:'', null:null,
};
const variants = {ordinary:{},qualified:{captureQualification:'source-bound-v2'},
  indexed:{captureQualification:'source-bound-v2',captureSourcePolicy:'indexed-windows-v1'},
  staged:{captureQualification:'source-bound-v2',captureEvidence:'staged-v1'},
  indexedEvidence:{captureSourcePolicy:'indexed-evidence-v1'},ordered:{},episode:options};
const ns = {ownerId:'synthetic',scope:'personal',projectId:null};
const receipt = {client:'synthetic',sessionId:'session',eventId:'message',role:'user',excerpt:'Synthetic source'};
const memory = {content:'Synthetic source',kind:'fact'};
let caseNumber = 0;
async function run(base, variant, action) {
  sequence = 0;
  const path = join(scratch, String(++caseNumber)+'.sqlite');
  openDatabase(path,base===18?{}:base===23?{privateCards:true}:{currentDependencies:true}).close();
  if (mode === 'event' || mode === 'safety') {
    const { migrateReceiptEventTime, migrateContentSafety } = await load('core/content-safety-migration.mjs');
    const { copySqliteFixture, quiescence } = await load('core/testing/content-safety-s2h-fixture.mjs');
    const db = new DatabaseSync(path), storeId = db.prepare('SELECT store_id FROM store_metadata').get().store_id; db.close();
    const backupPath = path+'.backup'; copySqliteFixture(path,backupPath);
    await (mode === 'event' ? migrateReceiptEventTime : migrateContentSafety)({path,backupPath,expected:{storeId,base},quiescence});
  }
  const core = openMemoryCore({path,...variant,model:model(rationaleModel())});
  const store = openMemoryStore({path});
  let result;
  try { result = await action(core,store.scope({ownerId:ns.ownerId})); }
  catch(error) { result = {ok:false,error:{code:error.code}}; }
  core.close(); store.close();
  const db = new DatabaseSync(path);
  const receipts = db.prepare('SELECT * FROM receipts ORDER BY receipt_key').all();
  db.close();
  // Read database bytes only in a separate child that never imports SQLite.
  const child = spawnSync(process.execPath,['--input-type=module','-e',
    "import {readFileSync} from 'node:fs'; import {createHash} from 'node:crypto'; process.stdout.write(createHash('sha256').update(readFileSync(process.argv[1])).digest('hex'));",path],{encoding:'utf8'});
  if (child.status !== 0) throw Error('database_hash_failed');
  return {ok:result.ok !== false,...(result.ok===false?{code:result.error.code}:{}),
    resultHash:hash(JSON.stringify(result)),receiptHash:hash(JSON.stringify(receipts)),
    receiptTimes:receipts.map(row=>row.occurred_at??null),databaseHash:child.stdout};
}
const result = {base:'a6ec0e0e',clock:'2026-11-04T00:00:00.000Z',matrix:{},writes:{},newFields:{}};
for (const [variant,config] of Object.entries(variants)) {
  result.matrix[variant] = {};
  for (const [name,occurredAt] of Object.entries(values)) result.matrix[variant][name] = await run(18,config,core => core.capture({
    namespace:ns,client:'synthetic',eventId:'event',sessionId:'session',
    ...(variant==='ordered'?{causal:{streamId:'stream',sequence:1}}:{}),
    ...(variant==='episode'?{episodeContext:{clientLabel:'Synthetic',generation:'initial',origin:'ordinary'}}:{}),
    messages:[{id:'message',role:'user',content:memory.content,occurredAt}],
  }));
}
// New fields are compared with main's corresponding untimed writes. Main's
// exact unknown-field outcomes are recorded separately, without relaxing them.
for (const base of [18,23,33]) for (const timed of [false,true]) {
  const r = {...receipt,...(timed?{occurredAt:values.valid}:{})};
  const actions = {
    remember:(_core,scope)=>scope.remember({...memory,receipt:r}),
    legacyCorrect:(_core,scope)=>{const first=scope.remember({...memory,receipt});return scope.correct(first.id,{...memory,content:'Synthetic correction',receipt:r},first.revision);},
    admit:core=>core.admit({namespace:ns,memory,receipts:[r]}),
    correct:core=>{const first=core.admit({namespace:ns,memory,receipts:[receipt]}).value.memory;return core.correct({namespace:ns,memoryId:first.id,expectedRevision:first.revision,content:'Synthetic correction',kind:'fact',receipt:r});},
    supersede:core=>{const first=core.admit({namespace:ns,memory,receipts:[receipt]}).value.memory;return core.supersede({namespace:ns,memoryId:first.id,expectedRevision:first.revision,replacement:{content:'Synthetic replacement',kind:'fact'},receipts:[r]});},
    finish:core=>{const key={namespace:ns,client:'synthetic',eventId:'finish',payloadDigest:'a'.repeat(64)};const token=core.claimAdmission({...key,leaseMs:125000}).value.token;return core.finishAdmission({...key,token,items:[{...memory,confidence:.8,receipts:[r]}]});},
  };
  for (const [name,action] of Object.entries(actions)) (timed?result.newFields:result.writes)[base+':'+name] = await run(base,{},action);
}
writeFileSync(report,JSON.stringify(result,null,2)+'\n');
