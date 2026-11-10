import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../contract.mjs';

// Scripted semantic decisions test orchestration and source authority, not model quality.
const namespace = { ownerId: 'ordered-synthetic', scope: 'personal', projectId: null };
const friday = 'Project Alpha deadline is Friday.';
const monday = 'Project Alpha deadline is Monday.';
const source = (id, content, role = 'user') => ({ id, content, role });
const capture = (sequence, content = monday, patch = {}) => ({ namespace, client: 'synthetic',
  sessionId: 'session', eventId: `event-${sequence}`, causal: { streamId: 'source-stream', sequence },
  messages: [source(`message-${sequence}`, content)], ...patch });
const item = (content, sourceIndices = [0]) => ({ content, kind: 'fact', confidence: 0.8, sourceIndices });
const noChange = { status: 'complete_no_change', reason: null, retiredCount: 0 };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => assert.deepEqual(r, { ok: false, error: { code, retryable: false } });
const detail = (core, id, ns = namespace) => ok(core.get({ namespace: ns, memoryId: id }));
const list = (core, ns = namespace) => ok(core.list({ namespace: ns })).memories;
const receipt = (eventId, excerpt = eventId) => ({ client: 'synthetic', sessionId: 'session', eventId, role: 'user', excerpt });
const workspaces = new WeakMap();
function fixture(t, options = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-ordered-' });
  workspaces.set(t, workspace);
  const path = join(workspace.path, 'memory.sqlite');
  const calls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: ({ input }) => ({ items: [item(input.messages[0].content)] }),
    relateMemories: typedOutput, ...options };
  for (const method of ['extract', 'relateMemories', 'classify']) {
    const fn = model[method];
    if (typeof fn === 'function') model[method] = async (request) => {
      calls.push({ method, input: structuredClone(request.input), system: request.system });
      return fn(request);
    };
  }
  const core = openMemoryCore({ path, model });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path);
  workspace.defer(() => db.close());
  return { core, db, path, model, calls };
}
const material = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('admission_claims','capture_events') ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
const first = async (core) => ok(await core.capture(capture(1, friday))).admission.memories[0].id;

// Causal streams retain ordering and source provenance. Relation decisions use
// the same optional batch port as ordinary capture and never retire either end.
function typedOutput({input}){
  return {facts:input.facts.map(fact=>({factIndex:fact.factIndex,eventTime:null,
    edges:input.candidates[fact.factIndex].slice(0,5).map(candidate=>({candidateId:candidate.id,relation:'supersedes',confidence:.95}))}))};
}
function blockedPort(entered,release){
  return request=>request.input.candidates.every(rows=>!rows.length)?{facts:[]}:new Promise(resolve=>{release(resolve,request);entered();});
}

test('ordered capture retains both endpoints, binds the new receipt, and never invokes the retired port',async t=>{
  let legacyCalls=0;
  const {core,db,calls}=fixture(t,{reconcile:()=>{legacyCalls++;throw Error('legacy port');}});
  const previous=await first(core),result=ok(await core.capture(capture(2))),replacement=result.admission.memories[0].id;
  assert.equal(detail(core,previous).memory.state,'active');assert.equal(detail(core,replacement).memory.state,'active');
  assert.deepEqual(result.reconciliation,noChange);assert.equal(legacyCalls,0);
  assert.deepEqual(calls.map(call=>call.method),['extract','relateMemories','extract','relateMemories']);
  const edge=db.prepare('SELECT * FROM memory_relations').get();
  assert.equal(edge.from_memory_id,replacement);assert.equal(edge.to_memory_id,previous);assert.equal(edge.relation,'supersedes');assert.equal(edge.decided_by,'llm');
  assert.equal(db.prepare('SELECT memory_id FROM receipts WHERE id=?').get(edge.receipt_id).memory_id,replacement);
  assert.equal(db.prepare('SELECT count(*) n FROM memory_supersessions').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM receipt_causality').get().n,2);
});

test('ordered capture without a relation port uses neutral links',async t=>{
  const {core,db}=fixture(t,{relateMemories:undefined});
  const previous=ok(await core.capture(capture(1,'My breakfast is oats.'))).admission.memories[0].id;
  ok(await core.capture(capture(2,'My breakfast is eggs.')));
  assert.equal(detail(core,previous).memory.state,'active');
  const edge=db.prepare('SELECT * FROM memory_relations').get();assert.equal(edge.relation,'same_thread');assert.equal(edge.decided_by,'rule');
});

test('O1/O2 cold completed replay precedes highwater and returns immutable content-free reconciliation', async (t) => {
  const { core, db, path } = fixture(t); const old = await first(core);
  const result = ok(await core.capture(capture(2))); const replacement = result.admission.memories[0].id;
  const before = material(db); core.close();
  const reopened = openMemoryCore({ path }); workspaces.get(t).defer(() => reopened.close());
  assert.deepEqual(ok(await reopened.capture(capture(1, friday))), { duplicate: true, memoryIds: [old], suppressedCount: 0, reconciliation: noChange });
  assert.deepEqual(ok(await reopened.capture(capture(2))), { duplicate: true, memoryIds: [replacement], suppressedCount: 0, reconciliation: noChange });
  assert.deepEqual(material(db), before);
  ok(reopened.forget({ namespace, memoryId: replacement, expectedRevision: detail(reopened, replacement).memory.revision }));
  assert.deepEqual(ok(await reopened.capture(capture(2))), { duplicate: true, memoryIds: [replacement], suppressedCount: 0, reconciliation: noChange });
  for (const table of ['capture_streams', 'capture_events', 'receipt_causality']) {
    const stored = JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
    assert.ok(!stored.includes(friday)); assert.ok(!stored.includes(monday));
  }
});

test('O1 causal validation, digest binding and sequence conflicts reject before model calls or partial claims', async (t) => {
  const { core, db, calls } = fixture(t);
  for (const causal of [null, {}, { streamId: ' stream', sequence: 1 }, { streamId: 's', sequence: 0 },
    { streamId: 's', sequence: 1.5 }, { streamId: 's', sequence: Number.MAX_SAFE_INTEGER + 1 },
    { streamId: 's', sequence: 1, fabricated: true }]) error(await core.capture(capture(1, friday, { causal })), 'invalid_input');
  assert.equal(calls.length, 0); assert.equal(db.prepare('SELECT count(*) n FROM admission_claims').get().n, 0);
  await first(core); const beforeCalls = calls.length; const beforeClaims = db.prepare('SELECT * FROM admission_claims').all();
  for (const patch of [{ messages: [source('message-1', 'Changed payload')] },
    { causal: { streamId: 'other-stream', sequence: 1 } }, { causal: { streamId: 'source-stream', sequence: 2 } }]) {
    error(await core.capture(capture(1, friday, patch)), 'event_payload_conflict');
  }
  error(await core.capture(capture(1, friday, { eventId: 'other-event' })), 'capture_order_conflict');
  assert.equal(calls.length, beforeCalls); assert.deepEqual(db.prepare('SELECT * FROM admission_claims').all(), beforeClaims);
});

test('O2 empty extraction advances highwater and unseen older windows reject without extraction', async (t) => {
  const { core, db, calls } = fixture(t, { extract: () => ({ items: [] }) });
  const result = ok(await core.capture(capture(10))); assert.deepEqual(result.reconciliation, noChange);
  assert.deepEqual(result.admission.memories, []);
  const before = material(db);
  error(await core.capture(capture(9)), 'capture_order_conflict');
  assert.equal(calls.length, 1); assert.deepEqual(material(db), before);
  assert.deepEqual(ok(await core.capture(capture(10))), { duplicate: true, memoryIds: [], suppressedCount: 0, reconciliation: noChange });
});

for(const failure of ['missing','provider','malformed','oversized'])test(`ordered relation ${failure} degrades to neutral admission`,async t=>{
  const {core,db,path}=fixture(t,{relateMemories:undefined});
  ok(await core.capture(capture(1,'My breakfast is oats.')));
  const variants={provider:()=>{throw Error('private provider text');},malformed:()=>({facts:'bad'}),oversized:()=>({facts:Array.from({length:6},()=>({factIndex:0,edges:[]}))})};
  const model=variants[failure];
  // Reopen so the configured port is the one this capture actually uses.
  const next=openMemoryCore({path,model:{contextWindow:8192,countTokens:()=>1,
    extract:({input})=>({items:[item(input.messages[0].content)]}),...(model?{relateMemories:model}:{})}});
  workspaces.get(t).defer(()=>next.close());
  const result=ok(await next.capture(capture(2,'My breakfast is eggs.')));assert.deepEqual(result.reconciliation,noChange);
  assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n,2);
  assert.equal(db.prepare('SELECT relation FROM memory_relations').get().relation,'same_thread');
});

test('successful unrelated decisions add no neutral edge',async t=>{
  const {core,db}=fixture(t,{relateMemories:()=>({facts:[]})});
  ok(await core.capture(capture(1,'My breakfast is oats.')));ok(await core.capture(capture(2,'My breakfast is eggs.')));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,18);assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='memory_relations'").get().n,0);
});

test('O3 namespace and stream scopes are exact; foreign memories are never candidates', async (t) => {
  for (const foreign of [{ ...namespace, ownerId: 'other-owner' }, { ...namespace, scope: 'project', projectId: 'other-project' }]) {
    const { core, calls } = fixture(t);
    const old = ok(await core.capture(capture(1, friday, { namespace: foreign }))).admission.memories[0].id;
    const result = ok(await core.capture(capture(1)));
    assert.deepEqual(result.reconciliation, noChange);
    assert.equal(detail(core, old, foreign).memory.state, 'active');
    assert.deepEqual(calls.filter(call=>call.method==='relateMemories').at(-1).input.candidates,[[]]);
  }
});

test('O1 client scopes share neither ordering positions while namespace relations can cross streams', async (t) => {
  const { core, calls } = fixture(t);
  const old = ok(await core.capture(capture(1, friday, { client: 'other-client' }))).admission.memories[0].id;
  const result = ok(await core.capture(capture(1)));
  assert.deepEqual(result.reconciliation, noChange);
  assert.equal(detail(core, old).memory.state, 'active');
  assert.equal(calls.filter(call=>call.method==='relateMemories').at(-1).input.candidates[0].length,1);
});

test('relation discovery is capped at eight and admission at five outgoing edges',async t=>{
  const {core,db,calls}=fixture(t);
  for(let i=0;i<12;i++)ok(core.admit({namespace,memory:{content:'Project Alpha deadline variant '+i,kind:'fact'},receipts:[receipt('candidate-'+i)]}));
  const result=ok(await core.capture(capture(1))),id=result.admission.memories[0].id;
  const request=calls.find(call=>call.method==='relateMemories').input;
  assert.equal(request.candidates[0].length,8);assert.equal(db.prepare('SELECT count(*) n FROM memory_relations WHERE from_memory_id=?').get(id).n,5);
  assert.equal(db.prepare("SELECT count(*) n FROM memories WHERE currentness='current'").get().n,13);
});

for(const action of ['correct','forget'])test(`candidate ${action} during a relation call cannot bind a stale edge or block admission`,async t=>{
  let entered,release;const ready=new Promise(resolve=>{entered=resolve;});
  const {core,db,path}=fixture(t,{relateMemories:blockedPort(entered,(resolve,request)=>{release=()=>resolve(typedOutput(request));})});
  const previous=await first(core),pending=core.capture(capture(2));await ready;
  const other=openMemoryCore({path});workspaces.get(t).defer(()=>other.close());const revision=detail(other,previous).memory.revision;
  if(action==='forget')ok(other.forget({namespace,memoryId:previous,expectedRevision:revision}));
  else ok(other.correct({namespace,memoryId:previous,expectedRevision:revision,content:'Project Alpha deadline is Wednesday.',kind:'fact',receipt:receipt('corrected')}));
  release();ok(await pending);assert.equal(db.prepare('PRAGMA user_version').get().user_version,18);assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='memory_relations'").get().n,0);
  assert.equal(db.prepare('SELECT high_water FROM capture_streams').get().high_water,2);
});

test('O2 claim expiry and late highwater write failure cannot partially commit replacements', async (t) => {
  let entered; let release; const ready = new Promise((resolve) => { entered = resolve; });
  const { core, db, model } = fixture(t, { relateMemories: blockedPort(entered,(resolve,request)=>{release=()=>resolve(typedOutput(request));}) });
  await first(core); const before = material(db); const pending = core.capture(capture(2)); await ready;
  db.exec("UPDATE admission_claims SET lease_expires_at=0 WHERE event_id='event-2'");
  release(); error(await pending, 'stale_admission'); assert.deepEqual(material(db), before);
  model.relateMemories = typedOutput;
  db.exec("CREATE TRIGGER synthetic_completion_failure BEFORE UPDATE OF high_water ON capture_streams BEGIN SELECT RAISE(ABORT,'late failure'); END");
  error(await core.capture(capture(2)), 'storage_error'); assert.deepEqual(material(db), before);
  db.exec('DROP TRIGGER synthetic_completion_failure'); assert.deepEqual(ok(await core.capture(capture(2))).reconciliation, noChange);
});

test('O2 concurrent later completion invalidates a pending highwater snapshot without stale admission', async (t) => {
  let entered; let release; const ready = new Promise((resolve) => { entered = resolve; });
  const { core, db, path } = fixture(t, { relateMemories: blockedPort(entered,(resolve,request)=>{release=()=>resolve(typedOutput(request));}) });
  await first(core); const pending = core.capture(capture(2)); await ready;
  const other = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1, extract: () => ({ items: [] }) } }); workspaces.get(t).defer(() => other.close());
  ok(await other.capture(capture(3))); const before = material(db);
  release(); error(await pending, 'capture_order_conflict'); assert.deepEqual(material(db), before);
});

test('O2 public manual completion cannot bypass ordered relation call or highwater fencing', async (t) => {
  let entered; let release; const ready = new Promise((resolve) => { entered = resolve; });
  const { core, db } = fixture(t, { relateMemories: blockedPort(entered,(resolve,request)=>{release=()=>resolve(typedOutput(request));}) });
  await first(core); const pending = core.capture(capture(2)); await ready;
  const owned = db.prepare("SELECT token,payload_digest FROM admission_claims WHERE event_id='event-2'").get();
  const before = material(db);
  error(core.finishAdmission({ namespace, client: 'synthetic', eventId: 'event-2', payloadDigest: owned.payload_digest, token: owned.token,
    items: [{ content: 'Bypass attempt', kind: 'fact', confidence: 0.8, receipts: [receipt('bypass')] }] }), 'stale_admission');
  assert.deepEqual(material(db), before);
  release(); assert.deepEqual(ok(await pending).reconciliation, noChange);
});

test('O2 an expired relation call owner cannot overwrite or abandon a completed successor attempt', async (t) => {
  let entered; let release; const ready = new Promise((resolve) => { entered = resolve; });
  const { core, db, path } = fixture(t, { relateMemories: blockedPort(entered,(resolve,request)=>{release=()=>resolve(typedOutput(request));}) });
  await first(core); const pending = core.capture(capture(2)); await ready;
  db.exec("UPDATE admission_claims SET lease_expires_at=0 WHERE event_id='event-2'");
  const other = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1,
    extract: () => ({ items: [item(monday)] }), relateMemories: typedOutput } });
  workspaces.get(t).defer(() => other.close()); const committed = ok(await other.capture(capture(2))); assert.deepEqual(committed.reconciliation, noChange);
  const before = material(db); release(); error(await pending, 'stale_admission');
  assert.deepEqual(material(db), before);
  assert.deepEqual(ok(await core.capture(capture(2))).reconciliation, noChange);
});

test('a timed-out ordered relation call cancels its signal and preserves admission time',async t=>{
  let signal;
  const workspace=createTestWorkspace(t,{prefix:'ordered-timeout-'}),path=join(workspace.path,'store.sqlite');
  const core=openMemoryCore({path,captureDeadlineMs:2000,model:{contextWindow:8192,countTokens:()=>1,
    extract:({input})=>({items:[item(input.messages[0].content)]}),
    relateMemories:request=>{if(request.input.candidates.every(rows=>!rows.length))return {facts:[]};signal=request.signal;return new Promise(()=>{});}}});
  workspace.defer(()=>core.close());ok(await core.capture(capture(1,'My breakfast is oats.')));
  const result=ok(await core.capture(capture(2,'My breakfast is eggs.')));assert.equal(signal.aborted,true);assert.equal(result.admission.memories.length,1);
  const db=new DatabaseSync(path);workspace.defer(()=>db.close());assert.equal(db.prepare('SELECT relation FROM memory_relations').get().relation,'same_thread');
});

test('relation ports and counters run outside writer transactions',async t=>{
  const {core,db,model}=fixture(t);let probes=0;
  const probe=()=>{db.exec('BEGIN IMMEDIATE');db.exec('ROLLBACK');probes++;};
  model.countTokens=()=>{probe();return 1;};model.relateMemories=request=>{probe();return typedOutput(request);};
  await first(core);ok(await core.capture(capture(2)));assert.ok(probes>0);
});

test('a suppressed replacement never acquires an edge or retires its predecessor',async t=>{
  const {core,db}=fixture(t);const previous=await first(core);
  const hidden=ok(core.admit({namespace,memory:{content:monday,kind:'fact'},receipts:[receipt('hidden')]})).memory;
  ok(core.forget({namespace,memoryId:hidden.id,expectedRevision:hidden.revision}));
  const result=ok(await core.capture(capture(2)));assert.equal(result.admission.suppressedCount,1);assert.deepEqual(result.admission.memories,[]);
  assert.equal(detail(core,previous).memory.state,'active');assert.equal(db.prepare('PRAGMA user_version').get().user_version,18);assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='memory_relations'").get().n,0);
});

test('O2 real process race binds one stream position to one event', { timeout: 15000 }, async (t) => {
  const { core, path, db } = fixture(t);
  const program = `import {openMemoryCore} from ${JSON.stringify(new URL('../contract.mjs', import.meta.url).href)};
    const core=openMemoryCore({path:process.argv[1],model:{contextWindow:8192,countTokens:()=>1,extract:()=>({items:[]})}});
    process.send('ready');process.once('message',async()=>{process.send(await core.capture(JSON.parse(process.argv[2])));core.close();process.disconnect();});`;
  const workers = ['a', 'b'].map((eventId) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, path, JSON.stringify(capture(1, monday, { eventId }))],
      { env: { NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const closed = new Promise(resolve => child.once('close', resolve));
    workspaces.get(t).defer(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
    });
    let isReady = false; let hasResult = false;
    const ready = new Promise((resolve, reject) => { child.on('message', (m) => { if (m === 'ready') { isReady = true; resolve(); } });
      child.once('error', reject); child.once('exit', (code) => { if (!isReady) reject(new Error(`worker exited before ready: ${code}`)); }); });
    const result = new Promise((resolve, reject) => { child.on('message', (m) => { if (m !== 'ready') { hasResult = true; resolve(m); } });
      child.once('error', reject); child.once('exit', (code) => { if (!hasResult) reject(new Error(`worker exited before result: ${code}`)); }); });
    result.catch(() => {}); return { child, ready, result };
  });
  await Promise.all(workers.map((w) => w.ready)); workers.forEach((w) => w.child.send('go'));
  const results = await Promise.all(workers.map((w) => w.result));
  assert.equal(results.filter((r) => r.ok).length, 1); error(results.find((r) => !r.ok), 'capture_order_conflict');
  assert.equal(db.prepare('SELECT count(*) n FROM admission_claims').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM capture_events').get().n, 1); assert.deepEqual(list(core), []);
});
