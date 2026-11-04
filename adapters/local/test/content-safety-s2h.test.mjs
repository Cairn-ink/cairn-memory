import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../../core/database.mjs';
import { openMemoryCore } from '../../../core/index.mjs';
import { copySqliteFixture } from '../../../core/testing/content-safety-s2h-fixture.mjs';

test('creation S2h v48 is accepted by local permission, setup and the retained CLI without new flags',async t=>{
  const [{fixture},{setupFixture},{preflight},{checkHostPermission}]=await Promise.all([
    import('./fixtures/workspace.mjs'),import('../../../integrations/client/test/fixtures/local-setup-workspace.mjs'),
    import('../configuration.mjs'),import('../../../integrations/client/raw/local-host-permission.mjs')]);
  const f=fixture(t),path=join(f.workspace.path,'created.sqlite');f.core.close();
  const db=openDatabase(path,{currentDependencies:true,contentSafety:'s2h-v1'});db.close();
  const core=openMemoryCore({path,rawConversations:{mode:'off',readPolicy:()=>({generation:'synthetic',reason:null})}});t.after(()=>core.close());
  const current=core.getLocalCaptureControl({namespace:f.namespace,client:f.client}).value;
  const granted=core.setLocalCaptureControl({namespace:f.namespace,client:f.client,targetId:'synthetic-oneshot',expectedStoreId:current.storeId,expectedRevision:current.revision,automaticCaptureEnabled:true,rawNoticeVersion:'local-plain-v1'}).value;
  f.config.databasePath=path;f.config.authority={...f.config.authority,storeId:granted.storeId,expectedControlRevision:granted.revision,expectedConsentGeneration:granted.consentGeneration,
    expectedNamespaceGeneration:core.getCaptureControl({namespace:f.namespace}).value.generation,expectedRawRevision:core.getRawCaptureControl({ownerId:f.namespace.ownerId,client:f.client}).value.revision};f.save();
  await preflight(f.config);await checkHostPermission(f.config);assert.equal(f.reply(await f.run(f.request())).status,200);
  const setup=await setupFixture(t),setupPath=join(setup.root,'created.sqlite');setup.core.close();
  const store=openDatabase(setupPath,{currentDependencies:true,contentSafety:'s2h-v1'});store.close();setup.request.databasePath=setupPath;assert.equal((await setup.setup()).status,'prepared');
});

test('S2h local permission, probe, oneshot capture and setup negotiate v48; partial cells refuse', async t => {
  const [{ fixture: localFixture }, { setupFixture }, { preflight }, { checkHostPermission }, { migrateContentSafety }, { quiescence }] = await Promise.all([
    import('./fixtures/workspace.mjs'), import('../../../integrations/client/test/fixtures/local-setup-workspace.mjs'),
    import('../configuration.mjs'), import('../../../integrations/client/raw/local-host-permission.mjs'),
    import('../../../core/content-safety-migration.mjs'), import('../../../core/testing/content-safety-s2h-fixture.mjs'),
  ]);
  async function migrate(path, core, backupPath) {
    core.close(); const db = openDatabase(path, { currentDependencies: true });
    const storeId = db.prepare('SELECT store_id FROM store_metadata').get().store_id; db.close(); copySqliteFixture(path, backupPath);
    await migrateContentSafety({ path, backupPath, expected: { storeId, base: 33 }, quiescence });
  }
  const f = localFixture(t); await migrate(f.databasePath, f.core, join(f.workspace.path, 'backup.sqlite'));
  await preflight(f.config); await checkHostPermission(f.config);
  const capture = f.reply(await f.run(f.request())); assert.equal(capture.status, 200, JSON.stringify(capture));
  const setup = await setupFixture(t); await migrate(setup.request.databasePath, setup.core, join(setup.workspace.path, 'backup.sqlite'));
  assert.equal((await setup.setup()).status, 'prepared');
  const db = new DatabaseSync(f.databasePath); db.exec('PRAGMA busy_timeout=5000; DROP TRIGGER safety_raw_part_identity'); db.close();
  await assert.rejects(() => preflight(f.config)); await assert.rejects(() => checkHostPermission(f.config));
});
