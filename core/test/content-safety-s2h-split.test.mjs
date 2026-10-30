import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

const root = new URL('../../', import.meta.url).pathname;
function runtimeFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['test','testing','node_modules'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? runtimeFiles(path) : entry.name.endsWith('.mjs') ? [path] : [];
  });
}
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
  const handles = { core,legacy,supervisor,scope:legacy.scope({ownerId:ns.ownerId,projectId:ns.projectId}),context,topic,product,maintainer,
    cards:createPrivateCardFacade(runtime.privateCards,config.privateCards,runtime.ready),
    methods:createMethodPackageFacade(runtime.methodPackages,config.methodPackages,runtime.ready,config.assets),
    assets:createAssetFacade(runtime.assets,config.assets,runtime.ready),
    roles:createRoleProfileFacade(runtime.roleProfiles,config.roleProfiles,{path:f.path,context:contextRead,assets:config.assets}) };
  const internal = new Set(Object.values(storage).filter(value => typeof value === 'function'));
  const inventory = { exports:methods(api) };
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
  // Audit symbol uses, not just method names: the trusted owner writer has no
  // production caller. Every generic insertion seam is imported by a closed
  // set of tombstone writers or the offline canonical-tombstone migration.
  const calls = new Map([['core/runtime.mjs',2],['core/private-card-storage.mjs',2],
    ['core/raw-deletion-storage.mjs',1],['core/raw-lineage-storage.mjs',1],['core/content-safety-migration.mjs',1]]);
  let sites = 0;
  for (const path of [...runtimeFiles(join(root,'core')),...runtimeFiles(join(root,'adapters')),...runtimeFiles(join(root,'integrations/client/raw'))]) {
    const relative = path.slice(root.length), source = readFileSync(path,'utf8');
    if (relative === 'core/content-suppression-storage.mjs') continue;
    if(source.includes('content-suppression-storage.mjs')){
      assert.ok(calls.has(relative)||relative==='core/raw-journal.mjs','unreviewed storage import: '+relative);
      assert.match(source,/import\s*\{[^}]+\}\s*from\s*['"][^'"]*content-suppression-storage\.mjs['"]/);
      assert.doesNotMatch(source,/export[^;]*content-suppression-storage/);
    }
    if(/(?:INSERT(?: OR [A-Z]+)? INTO|REPLACE INTO)\s+content_suppressions\b/i.test(source))
      assert.equal(relative,'core/content-safety-schema.mjs','fact SQL must stay in the guarded storage module');
    assert.doesNotMatch(source,/\b(?:suppressOwnerInside|reserveContentIdentityInside)\b/,relative);
    if (!/\bwriteContentSuppressionInside\b/.test(source)) continue;
    assert.ok(calls.has(relative),'unreviewed generic fact seam: '+relative);
    const uses = [...source.matchAll(/\bwriteContentSuppressionInside\b/g)];
    assert.equal(uses.length,calls.get(relative)+1,relative+' must only import and call; no forwarding or re-export');
    const invocations = [...source.matchAll(/writeContentSuppressionInside\(db,\s*\{/g)];
    assert.equal(invocations.length,calls.get(relative),relative);
    assert.doesNotMatch(source,/kind:\s*['"](?:owner|namespace)['"]|matchMode:\s*['"](?:owner|namespace)['"]/,relative);
    sites += invocations.length;
  }
  assert.equal(sites,7);
  const cli = readFileSync(new URL('../../adapters/mcp/cli.mjs',import.meta.url),'utf8');
  assert.equal([...cli.matchAll(/args\[0\]\s*===?\s*['"]safety['"]/g)].length,1,'one safety dispatch');
  t.diagnostic('SPLIT_INVENTORY '+JSON.stringify(inventory));
  t.diagnostic('split reachability: '+Object.keys(api).length+' exports, '+Object.keys(handles).length+' facades, '+Object.values(inventory).slice(1).reduce((n,list)=>n+list.length,0)+' methods, '+sites+' canonical insertion sites');
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
