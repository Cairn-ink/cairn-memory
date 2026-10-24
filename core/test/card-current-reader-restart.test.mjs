import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, openSync, closeSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { scopedFixture, ns, project, scopes, ok } from './card-current-scope-fixture.mjs';
import { child, adopt } from './card-current-fixture.mjs';
function reader(t, f, job) {
  const file = join(f.dir, 'reader-' + (++f.serial) + '.json'), output = file + '.out', error = file + '.err';
  writeFileSync(file, JSON.stringify(job)); const out = openSync(output, 'wx', 0o600), err = openSync(error, 'wx', 0o600);
  let processChild;
  try { processChild = spawn(process.execPath, [new URL('./fixtures/card-current-reader.mjs', import.meta.url).pathname, f.path, file], { stdio: ['ignore', out, err] }); }
  finally { closeSync(out); closeSync(err); }
  let settled = false;
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => processChild.kill('SIGKILL'), 30000);
    processChild.once('error', reject);
    processChild.once('close', (code, signal) => {
      clearTimeout(timer); settled = true;
      try { assert.equal(code, 0, readFileSync(error, 'utf8')); assert.equal(signal, null); console.log(JSON.stringify({ childReader: job.kind, pid: processChild.pid, exit: code })); resolve(JSON.parse(readFileSync(output))); }
      catch (error) { reject(error); }
    });
  }); done.catch(() => {});
  t.after(async () => { if (!settled) processChild.kill('SIGKILL'); await done.catch(() => {}); });
  return { done, release() { writeFileSync(file + '.release', 'go'); }, async ready() {
    const deadline = Date.now() + 20000;
    while (!existsSync(file + '.ready')) {
      if (settled) { await done; throw Error('reader exited before preparation'); }
      assert.ok(Date.now() < deadline, 'reader readiness watchdog'); await new Promise(resolve => setTimeout(resolve, 5));
    }
    return JSON.parse(readFileSync(file + '.ready'));
  } };
}
function stale(result, f) {
  const r = result.results;
  assert.equal(r.oldPage.error.code, 'cursor_stale');
  for (const key of ['aCurrent', 'bCurrent', 'oldSnapshot']) assert.equal(r[key].error.code, 'evidence_unavailable', key);
  assert.equal(r.oldHistory.error.code, 'snapshot_stale');
  assert.ok(ok(r.freshHistory).items.every(item => item.support.currentDependency.status === 'needs-review'));
  if (r.fresh.ok) assert.ok(r.fresh.value.items.every(item => ![f.a.cardId, f.b.cardId].includes(item.ref.cardId)));
  else assert.equal(r.fresh.error.code, 'index_unavailable');
  if (r.organization) {
    assert.ok(ok(r.organization).items.every(item => item.type !== 'topic' || item.topic.title === null));
    assert.equal(r.oldOrganization.error.code, 'cursor_stale');
    assert.equal(ok(r.role).metered.profile.release.fields, null);
    assert.ok(ok(r.then).metered.evidence.every(item => ![f.a.cardId, f.b.cardId].includes(item.ref.id)));
  }
  assert.equal(ok(r.personal).items[0].body, 'personal access remains available');
  assert.equal(result.deniedLookups, 0);
}
for (const enabled of [true, false]) for (const kind of ['ordinary', 'managed', 'read-only']) for (const source of ['relations-one-hop-v1', 'moc-v1'])
  test(`C21 real child-reader restart and rebuild retain adoption/revocation fences; ${kind}, authoring ${enabled}, ${source}`, async t => {
    const f = scopedFixture(t);
    ok(await f.call('findCandidates', f.request));
    ok(await f.call('findCandidates', { ...f.request, readSet: [ns] }));
    const job = { kind, enabled, source, a: f.a, b: f.b, control: f.control, deniedValues: [...f.deniedValues],
      existingStore: { version: 'schema33-existing-v1', storeId: f.db.prepare('SELECT store_id FROM store_metadata').get().store_id } };
    const first = reader(t, f, { ...job, gated: true }), prepared = await first.ready();
    assert.ok(ok(prepared.saved.current).items.every(item => item.support.currentDependency.status === 'current'));
    assert.ok(ok(prepared.saved.candidate).nextCursor);
    const contributed=ok(prepared.saved.contribution).items.find(item=>item.ref.cardId===f.b.cardId);assert.ok(contributed);assert.equal(contributed.channels.lexical,null);
    if(source==='relations-one-hop-v1')assert.ok(contributed.via);else assert.ok(contributed.channels.moc?.rank>0);
    if (prepared.saved.role) { assert.ok(ok(prepared.saved.role).metered.profile.release.fields); assert.ok(ok(prepared.saved.organization).nextCursor); }
    child(f, { method: 'adoptMethodVersion', input: adopt(f.personalV2, 'override-personal', 'finance', project, null, scopes) });
    child(f, { method: 'adoptMethodVersion', input: adopt(f.v2, 'project-v2-adopt', null, project, 1, [project]) });
    first.release(); const firstResult = await first.done; stale(firstResult, f);
    ok(await f.call('findCandidates', f.request));
    const restarted = await reader(t, f, { ...job, saved: prepared.saved }).done; stale(restarted, f);
    assert.notEqual(restarted.pid, prepared.pid);
    unlinkSync(f.path + '.context-read-v1.sqlite');
    ok(await f.call('findCandidates', f.request));
    ok(await f.call('findCandidates', { ...f.request, readSet: [ns] }));
    const rebuilt = await reader(t, f, { ...job, saved: prepared.saved }).done; stale(rebuilt, f);
    assert.notEqual(rebuilt.pid, restarted.pid);
    const revoked = await reader(t, f, { ...job, saved: prepared.saved, revokeProject: true }).done;
    for (const [key, result] of Object.entries(revoked.results)) if (result && key !== 'personal')
      assert.equal(result.error?.code, 'authority_required', key);
    assert.equal(ok(revoked.results.personal).items[0].body, 'personal access remains available');
    assert.equal(revoked.deniedLookups, 0);
  });
