import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { createTopicTokens } from '../topic-snapshot.mjs';
import { createTopicMemberReader } from '../topic-members-reader.mjs';
import { createTopicMembersStorage } from '../topic-members-storage.mjs';
import { createTopicOverviewStorage } from '../topic-overview-storage.mjs';
import { membersInput } from '../topic-members-input.mjs';
import { fail } from '../validation.mjs';
import { memberFixture, collectMembers, namespace, ok } from '../testing/topic-members-fixture.mjs';

const base = { namespace, selection: { type: 'unfiled' }, accessRevision: 'g' };
function controlled(f, options = {}) {
  let time = 100, units = [], active = false, transactions = 0;
  const tokens = createTopicTokens({ now: () => time });
  const meta = createTopicOverviewStorage(f.db), storage = createTopicMembersStorage(f.db);
  const transaction = work => {
    assert.equal(active, false); active = true; transactions++; f.db.exec('BEGIN');
    try { const result = work(); f.db.exec('COMMIT'); return result; }
    catch (e) { f.db.exec('ROLLBACK'); throw e; } finally { active = false; }
  };
  const originBinding = (ns, captured) => ({ ns, captured, configuration: 'test' });
  const engine = createTopicMemberReader({ storage, snapshot: ns => meta.snapshot(ns), transaction, tokens, originBinding,
    now: () => time, observe: value => units.push(value), yieldQuantum: async () => {
      assert.equal(active, false); await options.onYield?.();
    }, ...options.overrides });
  return { tokens, storage, engine, originBinding, captured: () => meta.snapshot({ ...namespace, projectId: '' }),
    setTime: value => { time = value; }, get time() { return time; }, get units() { return units; },
    reset() { units = []; }, read: (input = {}, deadline) => engine.read(membersInput({ ...base, ...input }, namespace.ownerId), deadline) };
}

test('E1M-06 minimum work checkpoints, charged lookahead, UTF-8 bytes and exact finite concatenation', async t => {
  const f = memberFixture(t); for (let i = 0; i < 20; i++) f.admit('work-' + i);
  const h = controlled(f), want = (await collectMembers(f.reader(), base)).items;
  const items = []; let cursor, checkpoints = 0;
  do {
    h.reset(); const page = ok(await h.read({ workLimit: 16, ...(cursor ? { cursor } : {}) }));
    assert.ok(h.units.at(-1).used <= 16, JSON.stringify(h.units));
    assert.ok(h.units.some(entry => entry.units === 1), 'work-only pages must perform a physical/token/checkpoint unit');
    assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, value: page })) <= 65536);
    items.push(...page.items); cursor = page.nextCursor; checkpoints++;
    if (cursor) assert.equal(page.status, 'partial');
  } while (cursor);
  assert.deepEqual(items, want); assert.ok(checkpoints > 20);
  const limited = ok(await h.read({ limit: 1 }));
  assert.equal(limited.coverage.reason, 'limit'); assert.equal(limited.items.length, 1);
  const byteItems = []; cursor = undefined;
  do {
    const page = ok(await h.read({ maxBytes: 4096, ...(cursor ? { cursor } : {}) }));
    assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, value: page })) <= 4096);
    byteItems.push(...page.items); cursor = page.nextCursor;
    if (cursor) assert.equal(page.coverage.reason, 'byte_limit');
  } while (cursor);
  assert.deepEqual(byteItems, want);
  // Inspect all member query literals; no body, aggregate or offset fallback.
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../topic-members-storage.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /SELECT\s+\*|\bCOUNT\s*\(|\bDISTINCT\b|\bOFFSET\b|\bcontent\b/i);
});

test('E1M-06 overlarge single ref preserves input; terminal state cap never becomes zero completion', async t => {
  const f = memberFixture(t); for (let i = 0; i < 4; i++) f.admit('oversize-' + i);
  const h = controlled(f), first = ok(await h.read({ workLimit: 16 }));
  const input = { workLimit: 16, cursor: first.nextCursor };
  const original = h.storage.step; let oversized = true;
  h.storage.step = (state, ...args) => {
    original(state, ...args);
    if (oversized && state.pending) state.pending.id = '界'.repeat(30000);
  };
  let cursor = first.nextCursor, refusedInput;
  for (let i = 0; i < 100; i++) {
    try { const page = ok(await h.read({ workLimit: 16, cursor })); cursor = page.nextCursor; }
    catch (error) { assert.equal(error.code, 'context_item_too_large'); refusedInput = cursor; break; }
  }
  assert.ok(refusedInput); oversized = false;
  assert.equal(ok(await h.read({ workLimit: 16, cursor: refusedInput })).items.length, 1);
  h.storage.step = () => fail('state_limit');
  const terminal = ok(await h.read());
  assert.deepEqual(terminal.coverage, { complete: false, reason: 'state_limit' });
  assert.deepEqual(terminal.items, []); assert.equal(terminal.nextCursor, null);
});

test('E1M-05 E1M-07 origin lifetime is absolute, canonical and bounded across JSON and replay', async t => {
  const f = memberFixture(t); f.admit('a'); f.admit('b');
  const h = controlled(f), first = ok(await h.read({ limit: 1 }));
  const snapshot = (({ indexRevision, generation, originToken }) => ({ indexRevision, generation, originToken }))(first.snapshot);
  h.setTime(60099);
  const second = await h.read({ limit: 1, cursor: first.nextCursor }); assert.equal(second.ok, true);
  assert.deepEqual(await h.read({ limit: 1, cursor: first.nextCursor }), second);
  h.setTime(60100);
  await assert.rejects(h.read({ limit: 1, cursor: first.nextCursor }), { code: 'cursor_stale' });
  await assert.rejects(h.read({ expectedSnapshot: JSON.parse(JSON.stringify(snapshot)) }), { code: 'cursor_stale' });
  const fresh = ok(await h.read()); assert.notEqual(fresh.snapshot.originToken, snapshot.originToken);
  for (let i = 0; i < 1000; i++) {
    const token = h.tokens.issueOrigin(h.originBinding({ ...namespace, projectId: '' }, h.captured()));
    assert.match(token, /^[\x20-\x7e]{1,256}$/); h.tokens.verifyOrigin(token, h.originBinding({ ...namespace, projectId: '' }, h.captured()));
  }
  assert.equal(Object.keys(h.tokens).length, 4, 'signer retains no token registry');
});

test('E1M-04 E1M-07 deterministic between-quantum mutation, final fence busy and retry checkpoint', async t => {
  const f = memberFixture(t); for (let i = 0; i < 30; i++) f.admit('race-' + i);
  let mutate = false;
  const h = controlled(f, { onYield() { if (mutate) { mutate = false; f.admit('mutation'); } } });
  const first = ok(await h.read({ workLimit: 16 }));
  mutate = true;
  await assert.rejects(h.read({ workLimit: 16, cursor: first.nextCursor }), { code: 'cursor_stale' });
  const stable = ok(await h.read({ limit: 1 })), input = { limit: 1, cursor: stable.nextCursor };
  let count = 0, busy = true, busyAt = 4;
  const c = controlled(f, { overrides: { snapshot(ns) {
    count++; if (busy && count === busyAt) { const error = Error(); error.code = 'ERR_SQLITE_ERROR'; error.errcode = 5; throw error; }
    return createTopicOverviewStorage(f.db).snapshot(ns);
  } } });
  await assert.rejects(c.read({ limit: 1 }), { code: 'ERR_SQLITE_ERROR' });
  busy = false;
  const p = ok(await c.read({ limit: 1 })); assert.equal(p.items[0].id, (await collectMembers(f.reader(), base)).items[0].id);
  // Busy after a retained checkpoint must not consume its input.
  count = 0; busy = true; busyAt = 3;
  await assert.rejects(c.read({ limit: 1, cursor: p.nextCursor }), { code: 'ERR_SQLITE_ERROR' });
  busy = false;
  const retry = await c.read({ limit: 1, cursor: p.nextCursor });
  assert.equal(retry.ok, true); assert.deepEqual(await c.read({ limit: 1, cursor: p.nextCursor }), retry);
});

test('E1M-07 deterministic partial deadline and watchdog/close/worker/idle lifecycle', async t => {
  const f = memberFixture(t); f.admit('a'); f.admit('b');
  const h = controlled(f, { onYield() { h.setTime(146); } });
  const partial = ok(await h.read({}, 150)); assert.equal(partial.coverage.reason, 'deadline');
  assert.equal(partial.status, 'partial'); assert.ok(partial.nextCursor);
  const reader = f.reader();
  const pending = reader.readTopicMembers(base);
  assert.deepEqual(await reader.readTopicOverview({ namespace }), { ok: false, error: { code: 'read_in_progress' } });
  await reader.close(); assert.equal((await pending).error.code, 'store_closed');
  const timeout = f.reader(); t.mock.timers.enable({ apis: ['setTimeout'] });
  const waiting = timeout.readTopicMembers({ ...base, deadlineMs: 50 }); t.mock.timers.tick(50);
  assert.equal((await waiting).error.code, 'read_timeout');
  const page = ok(await timeout.readTopicMembers({ ...base, limit: 1 }));
  t.mock.timers.tick(60000);
  assert.equal((await timeout.readTopicMembers({ ...base, limit: 1, cursor: page.nextCursor })).error.code, 'cursor_stale');
  t.mock.timers.reset();
  const failed = f.reader(); t.mock.method(Worker.prototype, 'postMessage', function () { void this.terminate(); });
  assert.deepEqual(await failed.readTopicMembers(base), { ok: false, error: { code: 'reader_failed' } });
});

test('E1M-06 physical invalid-ref fanout and EOF visits never bypass the per-step validation bound',async t=>{
  const f=memberFixture(t),row=f.admit('fanout');
  f.db.exec('BEGIN');
  try {
    const moc=f.db.prepare("INSERT INTO mocs VALUES(?,?,'personal','',2,?,?,1,'now','now')");
    const ref=f.db.prepare('INSERT INTO moc_memory_refs VALUES(?,1,?,1)');
    for(let i=0;i<200;i++){const id='wrong-level-'+String(i).padStart(3,'0');moc.run(id,namespace.ownerId,id,id);ref.run(id,row.id);}
    f.db.exec('COMMIT');
  }catch(e){f.db.exec('ROLLBACK');throw e;}
  let visits=0,steps=0;
  const tracked=createTopicMembersStorage({prepare(sql){const statement=f.db.prepare(sql);return{get(...args){visits++;return statement.get(...args);}};}});
  const original=tracked.step;
  tracked.step=(...args)=>{const before=visits;original(...args);assert.ok(visits-before<=4,'one physical visit plus at most three validations');steps++;};
  const h=controlled(f,{overrides:{storage:tracked}});let cursor;const items=[];
  do{h.reset();const page=ok(await h.read({workLimit:16,...(cursor?{cursor}:{})}));assert.ok(h.units.at(-1).used<=16);items.push(...page.items);cursor=page.nextCursor;}while(cursor);
  assert.equal(items.length,1);assert.equal(items[0].id,row.id);assert.ok(steps>=204,'charge each loser, ref EOF, candidate settle and Memory EOF');
});

test('E1M-06 actual 8MiB logical retention accounting produces terminal partial/state_limit',async t=>{
  const f=memberFixture(t);f.admit('retention');const h=controlled(f),step=h.storage.step;
  h.storage.step=(state,...args)=>{step(state,...args);state.retentionProbe='x'.repeat(8*1024*1024);};
  const page=ok(await h.read());assert.deepEqual(page.coverage,{complete:false,reason:'state_limit'});
  assert.deepEqual(page.items,[]);assert.equal(page.nextCursor,null);assert.equal(page.status,'partial');
});
