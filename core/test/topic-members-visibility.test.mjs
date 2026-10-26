import assert from 'node:assert/strict';
import test from 'node:test';
import { memberFixture, smallHierarchy, namespace, overview, collectMembers, expected, ok } from '../testing/topic-members-fixture.mjs';
import { installOverviewLayout } from '../testing/topic-overview-raw29-fixture.mjs';
const base = { namespace, selection: { type: 'unfiled' }, accessRevision: 'g' };
for (const mode of ['DELETE', 'WAL']) test(`E1M-03 ${mode} isolation, stale/hidden declarations, generation exclusion, orphan filing and Card separation`, async t => {
  const f = memberFixture(t, { mode }), h = smallHierarchy(f), reader = f.reader();
  const foreignNs = { ...namespace, ownerId: 'other-owner' }, project = { ...namespace, scope: 'project', projectId: 'project-1' }, project2 = { ...project, projectId: 'project-2' };
  const foreign = f.admit('foreign', 'fact', foreignNs), foreignProject = f.admit('foreign-project', 'fact', project), secondProject = f.admit('foreign-project2', 'fact', project2);
  const foreignMoc = f.place(foreignNs, [{ memoryId: foreign.id, parentIds: [], newL1: { title: 'Topic a', parentL2Ids: [] } }]).createdMocs[0];
  let current = await overview(reader), l1 = current.items.find(n=>n.id===h.l1.id);
  f.db.prepare('INSERT INTO moc_memory_refs VALUES(?,?,?,?)').run(l1.id, l1.revision, foreign.id, foreign.revision);
  f.db.prepare('INSERT INTO moc_title_sources VALUES(?,?,?)').run(l1.id, foreign.id, foreign.revision);
  f.db.prepare('INSERT INTO moc_memory_refs VALUES(?,?,?,?)').run(foreignMoc.id, foreignMoc.revision, h.u.id, h.u.revision);
  assert.equal((await reader.readTopicMembers({ ...base, selection: expected(foreignMoc) })).error.code, 'moc_not_found');
  const refs = (await collectMembers(reader, { ...base, selection: expected(l1) })).items;
  assert.equal(refs.length, 2); assert.doesNotMatch(JSON.stringify(refs), new RegExp(foreign.id));
  assert.equal((await collectMembers(reader, base)).items[0].id, h.u.id, 'foreign filing cannot hide unfiled');
  // Wrong-level and stale bindings never make a valid placement.
  f.db.prepare('INSERT INTO moc_memory_refs VALUES(?,?,?,?)').run(h.root.id, current.items.find(n=>n.id===h.root.id).revision, h.u.id, h.u.revision);
  f.db.prepare('UPDATE moc_memory_refs SET memory_revision=memory_revision+1 WHERE memory_id=?').run(h.a.id);
  f.db.prepare("UPDATE memories SET review_state='awaiting' WHERE id=?").run(h.b.id);
  f.db.prepare("UPDATE memories SET currentness='historical' WHERE id=?").run(h.c.id);
  const unfiled = (await collectMembers(reader, base)).items;
  assert.deepEqual(unfiled.map(row=>row.id).sort(), [h.a.id,h.u.id].sort());
  assert.ok(unfiled.every(row=>row.reportedUnder===null));
  assert.doesNotMatch(JSON.stringify(unfiled), /BODY_SENTINEL/);
  // A projected L1 without an L2 parent is still filed.
  f.db.prepare("UPDATE memories SET review_state='none' WHERE id=?").run(h.b.id);
  f.db.prepare('DELETE FROM moc_edges WHERE child_id=?').run(h.l2.id);
  assert.equal((await collectMembers(reader, base)).items.some(row=>row.id===h.b.id), false);
  assert.deepEqual((await collectMembers(reader, { ...base, namespace: project })).items.map(row=>row.id), [foreignProject.id]);
  assert.deepEqual((await collectMembers(f.reader(foreignNs), { ...base, namespace: foreignNs })).items, []);
  assert.equal((await collectMembers(reader, { ...base, namespace: project2 })).items[0].id, secondProject.id);
  const empty = await collectMembers(reader, { ...base, namespace: { ...project, projectId: 'empty' } }); assert.deepEqual(empty.items, []);
  // Physical Card-only MOC is deliberately disjoint even with an identical title.
  f.core.close(); installOverviewLayout(f.path,23);
  f.db.prepare("INSERT INTO card_mocs VALUES(?,?,'personal','',1,'Topic a','topic a',1,'now','now')").run('card-only-moc',namespace.ownerId);
  assert.equal((await f.reader().readTopicMembers({ ...base, selection: { type:'moc',mocId:'card-only-moc',revision:1,level:'L1' } })).error.code,'moc_not_found');
});
for (const variant of ['missing','foreign','unpublished', 'null']) test(`E1M-03 declared ${variant} generation refuses instead of fallback`, async t => {
  const f = memberFixture(t); f.admit('a'); const generation = 'g-' + variant;
  if (!['missing','null'].includes(variant)) f.db.prepare(`INSERT INTO index_generations VALUES(?,?,'personal','',1,16,5,'null',1,?)`).run(generation, variant==='foreign'?'foreign':namespace.ownerId, variant==='unpublished'?0:1);
  f.db.prepare("INSERT INTO namespace_index_state VALUES(?,'personal','',?)").run(namespace.ownerId,variant==='null'?null:generation);
  assert.deepEqual(await f.reader().readTopicMembers(base), { ok:false,error:{code:'index_unavailable'} });
});
test('E1M-03 generation-excluded Memory/MOC/ref/edge declarations never leak', async t => {
  const f=memberFixture(t), h=smallHierarchy(f), reader=f.reader(); let epoch=f.epoch(namespace), result=ok(f.core.rebuildIndex({namespace,expectedIndexRevision:epoch,limit:100}));
  while(!result.exhausted) result=ok(f.core.rebuildIndex({namespace,expectedIndexRevision:epoch,limit:100,cursor:result.nextCursor}));
  const issued=await overview(reader), g=issued.snapshot.generation;
  f.db.prepare('DELETE FROM index_memories WHERE generation=? AND id=?').run(g,h.a.id);
  let root=issued.items.find(n=>n.id===h.root.id);
  assert.equal((await collectMembers(reader,{...base,selection:expected(root)})).items.some(row=>row.id===h.a.id),false);
  f.db.prepare('DELETE FROM index_memory_refs WHERE generation=? AND memory_id=?').run(g,h.b.id);
  assert.equal((await collectMembers(reader,base)).items.some(row=>row.id===h.b.id),true);
  f.db.prepare('DELETE FROM index_edges WHERE generation=?').run(g);
  assert.deepEqual((await collectMembers(reader,{...base,selection:expected(root)})).items,[]);
  f.db.prepare('DELETE FROM index_mocs WHERE generation=? AND id=?').run(g,h.root.id);
  assert.equal((await reader.readTopicMembers({...base,selection:expected(root)})).error.code,'moc_not_found');
});
for (const [name,sql] of [['kind',"UPDATE memories SET kind='card'"],['revision','UPDATE memories SET revision=9007199254740992'],['identifier',"UPDATE memories SET id=' bad '"]]) test(`E1M-03 malformed consumed ${name} fails unsupported_database`, async t=>{
  const f=memberFixture(t);f.admit('bad');f.db.exec('PRAGMA foreign_keys=OFF');f.db.exec(sql);
  assert.deepEqual(await f.reader().readTopicMembers(base),{ok:false,error:{code:'unsupported_database'}});
});
