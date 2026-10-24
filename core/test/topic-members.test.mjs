import assert from 'node:assert/strict';
import test from 'node:test';
import { openMemoryReader } from '../index.mjs';
import { memberFixture, collectMembers, overview, namespace, expected, ok, kinds, sorted } from '../testing/topic-members-fixture.mjs';

const base = { namespace, selection: { type: 'unfiled' }, accessRevision: 'grant-1' };
const error = (code) => ({ ok: false, error: { code } });
test('E1M-01 own-data validation, defaults, exact DTO and opt-in overview isolation', async t => {
  const f = memberFixture(t), a = f.admit('a'), reader = f.reader();
  let calls = 0;
  const bad = [{}, null, [], new Proxy({}, { get() { calls++; } }),
    { ...base, get kind() { calls++; } }, { ...base, [Symbol('x')]: 1 },
    { ...base, namespace: { ...namespace, ownerId: 'foreign' } },
    { ...base, selection: { type: 'unfiled', mocId: undefined } },
    { ...base, namespace: new Proxy(namespace, {}) },
    { ...base, selection: { type: 'moc', mocId: 'x', revision: 0, level: 'L1' } },
    { ...base, accessRevision: '\ud800' }, { ...base, kind: ['fact'] }, { ...base, order: null }];
  for (const [key, min, max] of [['limit', 1, 100], ['workLimit', 16, 50000], ['maxBytes', 4096, 262144], ['deadlineMs', 50, 5000]]) {
    for (const value of [min - 1, max + 1, 1.5, null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) bad.push({ ...base, [key]: value });
  }
  for (const input of bad) assert.deepEqual(await reader.readTopicMembers(input), error('invalid_input'));
  assert.equal(calls, 0);
  for (const value of ['', null, 'x'.repeat(257), 'a\n']) assert.deepEqual(await reader.readTopicMembers({ ...base, cursor: value }), error('invalid_cursor'));
  const page = ok(await reader.readTopicMembers(base));
  const originToken = page.snapshot.originToken;
  assert.match(originToken, /^[\x20-\x7e]{1,256}$/);
  assert.deepEqual(page, {
    version: 'topic-members-v1', status: 'page', namespace, selection: base.selection,
    snapshot: { indexRevision: a.indexRevision ?? f.epoch(namespace), generation: null, originToken, accessRevision: 'grant-1', configuration: 'topic-members-v1' },
    kind: null, order: 'id_asc', items: [{ type: 'memory', namespace, id: a.id, revision: a.revision,
      kind: 'fact', label: { text: a.id, source: 'identifier' }, reportedUnder: null }],
    coverage: { complete: true, reason: null }, nextCursor: null,
  });
  for (const snapshotVersion of [undefined, 'topic-snapshot-v1']) {
    const result = ok(await reader.readTopicOverview({ namespace, snapshotVersion }));
    assert.deepEqual(Object.keys(result.snapshot), snapshotVersion ? ['indexRevision', 'generation', 'originToken'] : ['indexRevision', 'generation']);
  }
  for (const version of [null, '', 'v2']) assert.deepEqual(await reader.readTopicOverview({ namespace, snapshotVersion: version }), error('invalid_input'));
  for (const kind of [...kinds, null, undefined]) {
    const result = ok(await reader.readTopicMembers({ ...base, kind }));
    assert.equal(result.items.length, kind === undefined || kind === null || kind === 'fact' ? 1 : 0);
  }
  const project = { ...namespace, scope: 'project', projectId: 'p' }; f.admit('p', 'context', project);
  assert.equal(ok(await reader.readTopicMembers({ ...base, namespace: project })).items[0].kind, 'context');
});

test('E1M-05 JSON provenance, canonical binding, tamper, replay, interleaving and handle loss', async t => {
  const f = memberFixture(t); for (let i = 0; i < 5; i++) f.admit('item-' + i);
  const reader = f.reader(), issued = await overview(reader), snapshot = JSON.parse(JSON.stringify(issued.snapshot));
  const input = { ...base, limit: 1, expectedSnapshot: snapshot };
  const first = ok(await reader.readTopicMembers(input)); assert.equal(first.coverage.reason, 'limit');
  assert.deepEqual(first.snapshot, { ...snapshot, accessRevision: 'grant-1', configuration: 'topic-members-v1' });
  const continuation = { ...input, cursor: first.nextCursor };
  const second = await reader.readTopicMembers(JSON.parse(JSON.stringify(continuation)));
  assert.equal(second.ok, true);
  assert.equal(JSON.stringify(await reader.readTopicMembers(structuredClone(continuation))), JSON.stringify(second));
  await overview(reader); // fresh overview must preserve the member traversal and existing origin.
  assert.deepEqual(await reader.readTopicMembers(continuation), second);
  const { cursor, ...rest } = continuation;
  const ordered = Object.fromEntries(Object.entries(rest).reverse());
  assert.deepEqual(await reader.readTopicMembers({ ...ordered, cursor, kind: null, order: 'id_asc', deadlineMs: 1000 }), second);
  for (const bad of ['e1.' + 'a'.repeat(43), cursor.slice(0, -1), cursor + 'x', cursor.replace(/.$/, cursor.endsWith('A') ? 'B' : 'A'),
    cursor.slice(0,-43)+(cursor.at(-43)==='A'?'B':'A')+cursor.slice(-42)]) {
    assert.deepEqual(await reader.readTopicMembers({ ...rest, cursor: bad }), error('invalid_cursor'));
  }
  assert.deepEqual(await reader.readTopicMembers(continuation), second, 'invalid cursors do not advance or discard live state');
  for (const [key, value] of [['accessRevision', 'grant-2'], ['limit', 7], ['kind', 'fact'],
    ['workLimit',16],['maxBytes',4096],['deadlineMs',5000],
    ['selection',{type:'moc',mocId:'missing',revision:Number.MAX_SAFE_INTEGER,level:'L2'}],
    ['namespace',{...namespace,scope:'project',projectId:'another'}]]) {
    assert.deepEqual(await reader.readTopicMembers({ ...continuation, [key]: value }), error('cursor_stale'));
    // Restore a current traversal for the next binding test.
    const fresh = ok(await reader.readTopicMembers(input)); continuation.cursor = fresh.nextCursor;
  }
  const fresh = ok(await reader.readTopicMembers(input));
  let next = ok(await reader.readTopicMembers({ ...input, cursor: fresh.nextCursor }));
  const old = fresh.nextCursor, lastInput = next.nextCursor;
  next = ok(await reader.readTopicMembers({ ...input, cursor: lastInput }));
  assert.deepEqual(await reader.readTopicMembers({ ...input, cursor: old }), error('cursor_stale'));
  for (const originToken of [undefined, null, '', 'x', snapshot.originToken + 'a', snapshot.originToken.slice(0,-1), snapshot.originToken.replace('ts1.','ts2.'), 'x'.repeat(257)]) {
    assert.deepEqual(await reader.readTopicMembers({ ...input, expectedSnapshot: { ...snapshot, originToken } }), error('cursor_stale'));
  }
  assert.deepEqual(await f.reader().readTopicMembers(input), error('cursor_stale'));
  const other = memberFixture(t); for (let i = 0; i < 5; i++) other.admit('different-' + i);
  assert.equal((await overview(other.reader())).snapshot.indexRevision, snapshot.indexRevision);
  const equalFields = ok(await other.reader().readTopicOverview({ namespace, snapshotVersion: 'topic-snapshot-v1' })).snapshot;
  assert.deepEqual(await other.reader().readTopicMembers({ ...base, expectedSnapshot: { ...equalFields, originToken: snapshot.originToken } }), error('cursor_stale'));
  const active = ok(await reader.readTopicMembers({ ...base, limit: 1 }));
  assert.deepEqual(await f.reader().readTopicMembers({ ...base, limit: 1, cursor: active.nextCursor }), error('cursor_stale'));
  await reader.close(); assert.deepEqual(await reader.readTopicMembers(base), error('store_closed'));
  assert.deepEqual(await f.reader().readTopicMembers({ ...base, limit: 1, cursor: active.nextCursor }), error('cursor_stale'));
});

test('E1M-01 E1M-03 L1/L2 attribution, unfiled, MOC errors and opt-in overview continuation version', async t => {
  const f = memberFixture(t), a = f.admit('a'), b = f.admit('b'), c = f.admit('c');
  const made = f.place(namespace, [{ memoryId: a.id, parentIds: [], newL1: { title: 'a', parentL2Ids: [], newL2Title: 'root' } }]);
  const root = made.createdMocs.find(n => n.level === 'L2'), l1 = made.createdMocs.find(n => n.level === 'L1');
  const l2 = f.place(namespace, [{ memoryId: b.id, parentIds: [], newL1: { title: 'b', parentL2Ids: [root.id] } }]).createdMocs[0];
  f.place(namespace, [{ memoryId: c.id, parentIds: [l1.id, l2.id] }]);
  f.admit('unfiled', 'preference');
  const reader = f.reader(), issued = await overview(reader);
  for (const node of issued.items) {
    const result = await collectMembers(reader, { ...base, selection: expected(node), expectedSnapshot: issued.snapshot, limit: 1 });
    assert.equal(result.items.length, node.descendantCounts.total);
    for (const row of result.items) assert.equal(row.reportedUnder.mocId, node.level === 'L1' ? node.id :
      row.id === c.id ? [l1.id, l2.id].sort()[0] : row.id === a.id ? l1.id : l2.id);
  }
  const current = issued.items.find(n => n.level === 'L1');
  for (const [selection, code] of [[{ ...expected(current), mocId: 'missing' }, 'moc_not_found'],
    [{ ...expected(current), revision: current.revision + 1 }, 'revision_conflict'], [{ ...expected(current), level: 'L2' }, 'invalid_ref']]) {
    assert.deepEqual(await reader.readTopicMembers({ ...base, selection }), error(code));
  }
  const first = ok(await reader.readTopicOverview({ namespace, snapshotVersion: 'topic-snapshot-v1', nodeLimit: 1 }));
  assert.ok(first.nextCursor);
  assert.deepEqual(await reader.readTopicOverview({ namespace, nodeLimit: 1, cursor: first.nextCursor }), error('invalid_cursor'));
  const fresh = ok(await reader.readTopicOverview({ namespace, snapshotVersion: 'topic-snapshot-v1', nodeLimit: 1 }));
  const second = ok(await reader.readTopicOverview({ namespace, snapshotVersion: 'topic-snapshot-v1', nodeLimit: 1, cursor: fresh.nextCursor }));
  assert.deepEqual(second.snapshot, fresh.snapshot);
  assert.equal((await collectMembers(reader, base)).items.length, 1);
});

test('E1M-05 E1M-07 public opt-in origin expiry at 60000ms overrides overview/member replay without renewal', async t => {
  const threads = await import('node:worker_threads'), { syncBuiltinESMExports } = await import('node:module');
  const NativeWorker = threads.default.Worker, clock = new SharedArrayBuffer(8), time = new BigInt64Array(clock);
  Atomics.store(time, 0, 100n);
  threads.default.Worker = class extends NativeWorker {
    constructor(url, options) { super(url, { ...options, workerData: { ...options.workerData, e1mTestClock: clock },
      execArgv: ['--import', new URL('../testing/topic-members-clock.mjs', import.meta.url).href] }); }
    postMessage(message) {
      if (message.method === 'members') message = { ...message, deadlineAt: Number(Atomics.load(time, 0)) + message.request.deadlineMs };
      return super.postMessage(message);
    }
  };
  syncBuiltinESMExports();
  t.after(() => { threads.default.Worker = NativeWorker; syncBuiltinESMExports(); });
  const f = memberFixture(t); const { smallHierarchy } = await import('../testing/topic-members-fixture.mjs'); smallHierarchy(f);
  const reader = f.reader(), overviewInput = { namespace, snapshotVersion: 'topic-snapshot-v1', nodeLimit: 1 };
  const issued = ok(await reader.readTopicOverview(overviewInput));
  const continuation = { ...overviewInput, cursor: issued.nextCursor };
  const overviewSecond = await reader.readTopicOverview(continuation);
  const input = { ...base, expectedSnapshot: issued.snapshot, workLimit: 16 };
  const first = ok(await reader.readTopicMembers(input)), memberContinuation = { ...input, cursor: first.nextCursor };
  const second = await reader.readTopicMembers(memberContinuation);
  Atomics.store(time, 0, 60099n);
  assert.deepEqual(await reader.readTopicMembers(JSON.parse(JSON.stringify(memberContinuation))), second);
  assert.deepEqual(await reader.readTopicOverview(continuation), overviewSecond);
  Atomics.store(time, 0, 60100n);
  assert.deepEqual(await reader.readTopicMembers(memberContinuation), error('cursor_stale'));
  assert.deepEqual(await reader.readTopicOverview(continuation), error('cursor_stale'));
  const fresh = ok(await reader.readTopicOverview(overviewInput));
  assert.notEqual(fresh.snapshot.originToken, issued.snapshot.originToken);
  assert.equal((await reader.readTopicMembers({ ...base, expectedSnapshot: fresh.snapshot })).ok, true);
});

test('E1M-01 E1M-06 multibyte maximum IDs and bounds preserve full envelopes and pending refs', async t => {
  const f = memberFixture(t);
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(f.admit('unicode-' + i));
  f.db.exec('PRAGMA foreign_keys=OFF');
  const ids = rows.map((r,i) => String(i) + '界'.repeat(199));
  for (let i=0;i<rows.length;i++) f.db.prepare('UPDATE memories SET id=? WHERE id=?').run(ids[i],rows[i].id);
  const reader = f.reader(), result = await collectMembers(reader,{...base,maxBytes:4096,limit:100});
  assert.deepEqual(result.items.map(row=>row.id),ids);
  assert.ok(result.pages.some(page=>page.coverage.reason==='byte_limit'));
  for (const page of result.pages) {
    assert.ok(Buffer.byteLength(JSON.stringify({ok:true,value:page}))<=4096);
    for(const row of page.items) assert.equal(row.label.text,row.id);
  }
  for (const extra of [{limit:100,workLimit:50000,maxBytes:262144,deadlineMs:5000},
    {limit:1,workLimit:16,maxBytes:4096,deadlineMs:50}]) {
    // Warm Worker: the 50ms boundary checks its input, without a cold-start throughput gate.
    const result = await reader.readTopicMembers({...base,...extra});
    assert.ok(result.ok || result.error.code==='read_timeout');
  }
});

test('E1M-05 divergent file replacement loses provenance and fresh opt-in issuance restores pairing',async t=>{
  const {copyFileSync,renameSync}=await import('node:fs');
  const f=memberFixture(t),other=memberFixture(t);f.admit('original-a');f.admit('original-b');other.admit('replacement-a');other.admit('replacement-b');
  const reader=f.reader(),issued=await overview(reader),input={...base,limit:1,expectedSnapshot:issued.snapshot};
  const first=ok(await reader.readTopicMembers(input));
  const replacement=f.path+'.replacement';copyFileSync(other.path,replacement);renameSync(replacement,f.path);
  assert.deepEqual(await reader.readTopicMembers({...input,cursor:first.nextCursor}),error('cursor_stale'));
  assert.deepEqual(await reader.readTopicMembers(input),error('cursor_stale'));
  const fresh=await overview(reader);
  const result=await collectMembers(reader,{...base,expectedSnapshot:fresh.snapshot});
  assert.deepEqual(result.items.map(row=>row.id),other.ledger.map(row=>row.id).sort());
});

test('E1M-06 a real maximum-identifier ref too large for 4096 bytes refuses without consuming its input cursor',async t=>{
  const f=memberFixture(t),longNamespace={ownerId:'主'.repeat(200),scope:'personal',projectId:null};
  const row=f.admit('large-ref','fact',longNamespace);
  const node=f.place(longNamespace,[{memoryId:row.id,parentIds:[],newL1:{title:'large',parentL2Ids:[]}}]).createdMocs[0];
  const memoryId='憶'.repeat(200),mocId='題'.repeat(200);
  f.db.exec('PRAGMA foreign_keys=OFF');
  f.db.prepare('UPDATE memories SET id=? WHERE id=?').run(memoryId,row.id);
  f.db.prepare('UPDATE mocs SET id=? WHERE id=?').run(mocId,node.id);
  f.db.prepare('UPDATE moc_memory_refs SET moc_id=?,memory_id=? WHERE memory_id=?').run(mocId,memoryId,row.id);
  const reader=f.reader(longNamespace),input={namespace:longNamespace,selection:{type:'moc',mocId,revision:node.revision,level:'L1'},accessRevision:'權'.repeat(200),maxBytes:4096,workLimit:16};
  let cursor,refused;
  for(let i=0;i<30;i++){
    const request={...input,...(cursor?{cursor}:{})},result=await reader.readTopicMembers(request);
    if(!result.ok){assert.deepEqual(result,error('context_item_too_large'));assert.ok(cursor);refused=request;break;}
    cursor=result.value.nextCursor;
  }
  assert.ok(refused);assert.deepEqual(await reader.readTopicMembers(refused),error('context_item_too_large'));
  const page=ok(await reader.readTopicMembers({...input,maxBytes:262144,workLimit:5000}));
  assert.equal(page.items.length,1);assert.equal(page.items[0].id,memoryId);
});

test('E1M-06 final ref that fits only without a cursor proves EOF and returns the fitting complete envelope',async t=>{
  const f=memberFixture(t),ns={ownerId:'主'.repeat(200),scope:'project',projectId:'案'.repeat(100)};
  const row=f.admit('final-byte','fact',ns),id='憶'.repeat(200);
  f.db.exec('PRAGMA foreign_keys=OFF');f.db.prepare('UPDATE memories SET id=? WHERE id=?').run(id,row.id);
  const reader=f.reader(ns),baseInput={namespace:ns,selection:{type:'unfiled'},accessRevision:'權',maxBytes:262144};
  const first=await reader.readTopicMembers(baseInput);ok(first);
  const bytes=Buffer.byteLength(JSON.stringify(first)),length=Math.floor((4020-bytes)/3)+1;
  assert.ok(length>0&&length<=200,JSON.stringify({bytes,length}));
  const input={...baseInput,accessRevision:'權'.repeat(length),maxBytes:4096};
  const page=await reader.readTopicMembers(input);assert.equal(ok(page).coverage.complete,true);
  assert.equal(page.value.items[0].id,id);assert.equal(page.value.nextCursor,null);
  assert.ok(Buffer.byteLength(JSON.stringify(page))<=4096);
});

test('E1M-01 E1M-05 invalid origin outcome precedes fresh MOC existence/revision/level outcomes',async t=>{
  const f=memberFixture(t);f.admit('origin-precedence');const reader=f.reader(),issued=await overview(reader);
  assert.deepEqual(await reader.readTopicMembers({...base,selection:{type:'moc',mocId:'absent',revision:1,level:'L1'},
    expectedSnapshot:{...issued.snapshot,originToken:'unusable'}}),error('cursor_stale'));
});

test('E1M-05 schema configuration changes invalidate cursors and origins without changing user_version',async t=>{
  const f=memberFixture(t);f.admit('schema-a');f.admit('schema-b');const reader=f.reader(),issued=await overview(reader);
  const input={...base,limit:1,expectedSnapshot:issued.snapshot},first=ok(await reader.readTopicMembers(input));
  f.db.exec('CREATE INDEX member_schema_test ON memories(kind)');
  assert.deepEqual(await reader.readTopicMembers({...input,cursor:first.nextCursor}),error('cursor_stale'));
  assert.deepEqual(await reader.readTopicMembers(input),error('cursor_stale'));
  const fresh=await overview(reader);assert.equal((await reader.readTopicMembers({...base,expectedSnapshot:fresh.snapshot})).ok,true);
});
