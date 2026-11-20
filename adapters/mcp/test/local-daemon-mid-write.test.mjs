import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { workspace, until, ok, query } from './local-daemon-support.mjs';
import { startAwareAlive } from '../local-daemon-liveness.mjs';

function snapshot(w) {
  const child = spawnSync(process.execPath, [new URL('./fixtures/local-daemon-rows.mjs', import.meta.url).pathname, w.path], { env: {}, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout);
}
for (const action of ['remember_memory', 'forget_memory']) for (const afterCommit of [false, true]) {
  test(`SIGKILL ${action} after first statement; full-commit control=${afterCommit}`, { timeout: 35000 }, async t => {
    const w = await workspace(t), candidate = w.child({ role: 'candidate', bootstrap: await w.bootstrap(), midWrite: { afterCommit } }); candidate.release();
    await until(w.descriptor, 'fault candidate publishes');
    const a = w.forward(); a.release(); const original = await w.connect(a);
    const seeds = [];
    for (let i=0;i<3;i++) seeds.push(ok(await a.tool('remember_memory', { content: 'synthetic cobalt telescope durable seed ' + i, kind: 'fact' })).memory);
    const cursor = ok(await a.tool('find_memory_candidates', { ...query, limit: 1 })).nextCursor;
    assert.ok(cursor, 'warm context projection must produce a session cursor');
    candidate.process.send({ kind: 'arm' }); await until(() => candidate.messages.some(m => m.kind === 'armed'), 'fault hook armed after setup');
    const params = action === 'remember_memory' ? { content: 'synthetic cobalt telescope MID_WRITE_NEW_MEMORY', kind: 'fact' }
      : { memoryId: seeds[0].id, expectedRevision: seeds[0].revision };
    const call = a.tool(action, params);
    const barrier = await until(() => candidate.messages.find(m => m.kind === 'mid-write'), 'inside synchronous write transaction after first mutating statement');
    assert.equal(barrier.journal_mode, 'delete', 'canonical store uses rollback-journal recovery');
    if (barrier.in_transaction) assert.ok((await lstat(w.path + '-journal')).size > 512, 'SQLite created a rollback journal before the kill');
    assert.ok(startAwareAlive(original.owner)); candidate.process.kill('SIGKILL'); await until(() => candidate.exit, 'killed candidate wait status');
    assert.equal(candidate.exit.signal, 'SIGKILL');
    const response = await call; assert.equal(response.error.message, 'daemon_transport');
    await until(() => a.messages.some(m => m.kind === 'forwarder-done'), 'in-flight outcome becomes unknown');
    assert.equal(a.messages.find(m => m.kind === 'forwarder-done').code, 'daemon_outcome_unknown');
    const b = w.forward(); b.release(); const fresh = await w.connect(b);
    await assert.rejects(lstat(w.path + '-journal'), { code: 'ENOENT' }, 'SQLite recovery removes the killed transaction journal');
    assert.notEqual(fresh.incarnation, original.incarnation); assert.equal(startAwareAlive(original.owner), false);
    assert.equal((await b.tool('find_memory_candidates', { ...query, limit: 1, cursor })).error.code, 'cursor_stale', 'new session re-derives cursors from recovered canonical state');
    const recovered = ok(await b.tool('find_memory_candidates', { ...query, limit: 24 }));
    assert.ok(recovered, 'fresh daemon rebuilds context lookup');
    b.process.stdin.end(); await until(() => b.messages.some(m => m.kind === 'forwarder-done'), 'recovery session closes');
    assert.ok(startAwareAlive(fresh.owner)); process.kill(fresh.owner.pid, 'SIGTERM');
    await until(() => !startAwareAlive(fresh.owner), 'recovery daemon exits before independent row inspection');
    const rows = snapshot(w); t.diagnostic('independent recovered row counts ' + JSON.stringify({ action, afterCommit, memories: rows.memories.length, receipts: rows.receipts.length, documents: rows.context_documents.length }));
    assert.deepEqual(rows.integrity, [{ integrity_check: 'ok' }]); assert.deepEqual(rows.foreign_keys, []);
    const added = rows.memories.filter(row => row.content?.includes('MID_WRITE_NEW_MEMORY'));
    assert.equal(added.length, action === 'remember_memory' && afterCommit ? 1 : 0);
    const victim = rows.memories.find(row => row.id === seeds[0].id);
    const forgotten = action === 'forget_memory' && afterCommit;
    assert.equal(victim.deleted, Number(forgotten)); assert.equal(victim.revision, seeds[0].revision + Number(forgotten));
    assert.equal(victim.content, forgotten ? null : 'synthetic cobalt telescope durable seed 0');
    for (const memory of rows.memories) {
      const receipts = rows.receipts.filter(row => row.memory_id === memory.id);
      assert.equal(receipts.length, memory.deleted ? 0 : 1, 'whole Memory and its real receipt survive together');
    }
    const live = rows.memories.filter(row => !row.deleted).map(row => ({ id: row.id, revision: row.revision })).sort((a,b) => a.id.localeCompare(b.id));
    const projected = rows.context_documents.filter(row => row.eligible).map(({ id, revision }) => ({ id, revision })).sort((a,b) => a.id.localeCompare(b.id));
    assert.deepEqual(projected, live, 'recovered context projection rows exactly match canonical IDs and revisions');
    assert.equal(barrier.in_transaction, !afterCommit);
    assert.equal(barrier.point, afterCommit ? 'after_commit' : 'first_statement');
    assert.ok(rows.context_cursors.every(row => row.published && row.phase > 0), 'published keyset progress was derived for the recovered projection');
  });
}
