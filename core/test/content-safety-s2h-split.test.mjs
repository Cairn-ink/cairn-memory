import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertSplitGraph, assertSplitInventory, splitFixture, splitSources } from '../testing/content-safety-split-audit.mjs';
import { additionalSplitFacades, composedSplitFacades } from '../testing/content-safety-split-facades.mjs';
import { mutatedSplitSources, splitMutations, splitRevisionMutations } from '../testing/content-safety-split-mutations.mjs';
import { protectedInsertionTargets, protectedSplitTables } from '../testing/content-safety-split-sql.mjs';
import { DatabaseSync } from 'node:sqlite';
import * as api from '../index.mjs';
import * as storage from '../content-suppression-storage.mjs';
import { transaction } from '../database.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { createPrivateCardFacade } from '../private-card-facade.mjs';
import { createMethodPackageFacade } from '../method-package-facade.mjs';
import { createAssetFacade } from '../asset-facade.mjs';
import { createRoleProfileFacade } from '../role-profile-facade.mjs';
import { configured } from '../testing/context-product-owner-fixture.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

const methods = value => Reflect.ownKeys(value).filter(key => typeof value[key] === 'function').sort();
const options = path => {
  const authority = { authorize(request) { const { input, ...binding } = request; return { ...binding, accessGeneration: 1 }; }, isCurrent: grant => grant };
  return { path,
    privateCards: { version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority,currentDependencies:{version:'card-current-dependencies-v1'} },
    methodPackages: { version:'method-packages-local-v1',storage:'local-plain-v1',authority },
    assets: { version:'assets-local-v1',storage:'sqlite-blob-v1',authority },
    roleProfiles: { version:'role-profiles-local-v1',storage:'local-plain-v1',authority,attribution:{actorId:'synthetic',agentId:'synthetic'} } };
};

test('S2h-1 split: enumerate public exports and facades; no fact-only writer is reachable', async t => {
  const f = safetyFixture(t, 33); await f.migrate();
  const config = options(f.path), core = api.openMemoryCore({ ...config,
    rawConversations:{mode:'off',readPolicy:()=>({generation:'synthetic',reason:null})} });
  const runtime = createMemoryRuntime(config), legacy = api.openMemoryStore({ path:f.path });
  const contextRead = { version:'context-read-v1',authority:config.privateCards.authority,counter:{id:'synthetic',countTokens:()=>1} };
  const context = api.openContextReader({ path:f.path,contextRead }), topic = api.openMemoryReader({ path:f.path,ownerId:ns.ownerId });
  t.after(() => { topic.close(); context.close(); legacy.close(); runtime.close(); core.close(); });
  const product = await configured(t,f.path,[ns]).open(), maintainer = await configured(t,f.path,[ns],{service:true}).open();
  const supervisor=api.createContextReadSupervisor();t.after(()=>supervisor.close());
  const pool=api.createContextReaderPool();t.after(()=>pool.close());
  const handles = { ...await additionalSplitFacades(t, f, ns), ...composedSplitFacades(f, config, contextRead), core,legacy,supervisor,pool,scope:legacy.scope({ownerId:ns.ownerId,projectId:ns.projectId}),context,topic,product,maintainer,
    cards:createPrivateCardFacade(runtime.privateCards,config.privateCards,runtime.ready),
    methods:createMethodPackageFacade(runtime.methodPackages,config.methodPackages,runtime.ready,config.assets),
    assets:createAssetFacade(runtime.assets,config.assets,runtime.ready),
    roles:createRoleProfileFacade(runtime.roleProfiles,config.roleProfiles,{path:f.path,context:contextRead,assets:config.assets}) };
  const internal = new Set(Object.values(storage).filter(value => typeof value === 'function'));
  const inventory = { exports:Object.keys(api).sort() };
  for (const [name,handle] of Object.entries(handles)) {
    inventory[name] = methods(handle);
    for (const method of inventory[name]) {
      assert.equal(internal.has(handle[method]),false,name+'.'+method);
      assert.doesNotMatch(method,/suppressOwner|writeContentSuppression|suppressReceipts|excludeMemory|removeReceipts/i,name+'.'+method);
    }
  }
  for (const [name,value] of Object.entries(api)) {
    assert.equal(internal.has(value),false,name);
    assert.doesNotMatch(name,/suppression|suppressOwner|migrateContentSafety/i);
  }
  assert.deepEqual(Object.values(splitFixture.facadeFactories).flat().sort(), Object.keys(handles).sort());
  assertSplitInventory(inventory);
  const graph = assertSplitGraph();
  const cli = readFileSync(new URL('../../adapters/mcp/cli.mjs',import.meta.url),'utf8');
  assert.equal([...cli.matchAll(/args\[0\]\s*===?\s*['"]safety['"]/g)].length,1,'one safety dispatch');
  t.diagnostic('SPLIT_INVENTORY '+JSON.stringify(inventory));
  t.diagnostic('split reachability: '+Object.keys(api).length+' exports, '+Object.keys(handles).length+' facades, '+Object.values(inventory).slice(1).reduce((n,list)=>n+list.length,0)+' methods, '+graph.edges+' pinned helper edges');
});

for (const mutation of splitMutations) test('S2h-1 split rejects mutation: ' + mutation.name, () => {
  const inventory = structuredClone(splitFixture.inventory);
  if (mutation.addedExport) inventory.exports = [...inventory.exports, mutation.addedExport].sort();
  if (mutation.addedMethod) inventory.core = [...inventory.core, mutation.addedMethod].sort();
  if (mutation.addedExport || mutation.addedMethod) assert.throws(() => assertSplitInventory(inventory), /public inventory changed/);
  else assert.doesNotThrow(() => assertSplitInventory(inventory));
  // Independently reject the graph even if a reviewer updates the inventory.
  assert.throws(() => assertSplitGraph(mutatedSplitSources(splitSources(), mutation)),
    /unreviewed fact-only reference|unreviewed forwarding|capability alias/);
});

for (const mutation of splitRevisionMutations) test('S2h-1 split rejects mutation: ' + mutation.name, () => {
  const inventory = structuredClone(splitFixture.inventory);
  if (mutation.addedMethod) {
    inventory[mutation.surface] = [...inventory[mutation.surface], mutation.addedMethod].sort();
    assert.throws(() => assertSplitInventory(inventory), /public inventory changed/);
  } else assert.doesNotThrow(() => assertSplitInventory(inventory));
  const sources = mutatedSplitSources(splitSources(), mutation);
  if (mutation.graphUnchanged) assert.doesNotThrow(() => assertSplitGraph(sources));
  else assert.throws(() => assertSplitGraph(sources), /unreviewed direct insertion SQL/);
});

test('S2h-1 split rejects inventory removals and unreviewed writer changes', () => {
  for (const surface of Object.keys(splitFixture.inventory)) {
    const inventory = structuredClone(splitFixture.inventory); inventory[surface].pop();
    assert.throws(() => assertSplitInventory(inventory), /public inventory changed/, surface);
  }
  const sources = splitSources();
  sources.set('core/runtime.mjs', sources.get('core/runtime.mjs').replace('    suppressReceiptsInside(db, ns, id, suppression);', '    void id;'));
  assert.throws(() => assertSplitGraph(sources), /review canonical writer: correct/);
});

test('S2h-1 split closes every insertion capability alias and direct SQL bypass', () => {
  for (const capability of splitFixture.capabilities) {
    const sources = splitSources();
    sources.set('core/unreviewed-split-helper.mjs',
      `import { ${capability.name} as tidy } from './${capability.file.slice(5)}';\nexport { tidy };\n`);
    assert.throws(() => assertSplitGraph(sources), /capability alias requires review/, capability.name);
  }
  for (const table of ['content_suppressions','content_identity_reservations']) {
    const sources = splitSources();
    sources.set('core/unreviewed-split-helper.mjs', `export const tidy = db => db.exec('INSERT INTO ${table} VALUES(1)');`);
    assert.throws(() => assertSplitGraph(sources), /unreviewed direct insertion SQL/, table);
  }
});

test('S2h-1 split normalizes SQLite insertion targets across schemas, quoting and comments', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const quote = (name, mark) => mark === '[' ? '[' + name + ']' : mark + name.replaceAll(mark, mark + mark) + mark;
  const schemas = ['main','temp','attached schema'];
  db.exec(`ATTACH DATABASE ':memory:' AS "attached schema"`);
  for (const schema of schemas) for (const table of protectedSplitTables)
    db.exec(`CREATE TABLE ${quote(schema, '"')}.${quote(table, '"')}(value INTEGER)`);
  let checked = 0;
  for (const table of protectedSplitTables) for (const schema of [null,...schemas])
    for (const mark of ['', '"', '`', '[', "'"]) for (const verb of ['INSERT', ...['ROLLBACK','ABORT','REPLACE','FAIL','IGNORE'].map(mode => 'INSERT OR ' + mode), 'REPLACE']) {
      const name = table.toUpperCase(), target = mark ? quote(name, mark) : name;
      const qualified = schema === null ? target : (mark ? quote(schema, mark) : schema === 'attached schema' ? '"attached schema"' : schema) + ' /* qualifier */ . ' + target;
      const prefix = verb.toLowerCase().split(' ').join('/* gap */');
      const sql = `${prefix} -- before INTO\n INTO /* table */ ${qualified} VALUES(1)`;
      assert.deepEqual(protectedInsertionTargets(sql), [table], sql);
      assert.deepEqual(protectedInsertionTargets('db.exec(' + JSON.stringify(sql) + ')'), [table], sql);
      // SQLite itself validates every accepted spelling; no production table or file is used.
      db.prepare(sql).run(); checked++;
    }
  assert.deepEqual(protectedInsertionTargets('INSERT INTO main.content_suppressions_archive VALUES(1); REPLACE INTO other_table VALUES(1)'), []);
  assert.deepEqual(protectedInsertionTargets('INSERT INTO "attached""schema".`content_suppressions` VALUES(1)'), ['content_suppressions']);
  t.diagnostic('SQLite-validated insertion spellings: ' + checked);
});

test('S2h-1 split: internal fact-only observations do not change S1 reads or public writes', async t => {
  const f = safetyFixture(t); await f.migrate();
  const core = api.openMemoryCore({ path:f.path }), db = f.connect(); t.after(() => { core.close(); db.close(); });
  const memory = ok(core.admit({ namespace:ns,memory:{content:'Synthetic S1-only content',kind:'fact'},receipts:[receipt('S1-only')] })).memory;
  const source = db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(memory.id).id;
  transaction(db,() => {
    storage.writeContentSuppressionInside(db,{namespace:ns,kind:'receipt',key:source,reason:'privacy_erase',actionId:'internal-receipt'});
    storage.suppressOwnerInside(db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'internal-owner'});
    assert.equal(storage.memorySuppressionObservationInside(db,ns,{memoryId:memory.id,revision:memory.revision}).suppressed,true);
  });
  // These deliberately internal facts cannot authorize a public-only rollout
  // of fact-based enforcement. S1 still sees intact canonical contributors.
  assert.match(JSON.stringify(ok(core.get({namespace:ns,memoryId:memory.id}))),/Synthetic S1-only content/);
  const before = db.prepare('SELECT count(*) n FROM content_suppressions').get().n;
  ok(core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision}));
  assert.equal(db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted,1);
  assert.equal(db.prepare('SELECT 1 FROM receipts WHERE id=?').get(source),undefined);
  assert.equal(db.prepare('SELECT count(*) n FROM content_suppressions').get().n,before+2);
  assert.doesNotMatch(JSON.stringify(core.get({namespace:ns,memoryId:memory.id})),/Synthetic S1-only content/);
});
