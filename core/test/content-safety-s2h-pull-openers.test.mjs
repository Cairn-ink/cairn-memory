import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../database.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { validateContextProductLayout } from '../context-product-schema.mjs';
import { openContentSuppressionReader } from '../index.mjs';
import { suppressionFixture, ns, ok } from '../testing/content-suppression-fixture.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';

const schema = db => JSON.stringify(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all());
test('S2h pull opener requires the attested bootstrap pair and installed capability, with no DDL', async t => {
  const f = await suppressionFixture(t), a = f.descriptor(f.memory()), before = schema(f.db), { options } = await f.reader();
  await assert.rejects(() => openContentSuppressionReader({ ...options,path:'relative.sqlite' }),{ code:'invalid_path' });
  for (const base of [18,23,33]) {
    const legacy = safetyFixture(t,base), db = legacy.connect(), digest = schema(db); db.close();
    await assert.rejects(() => openContentSuppressionReader({ ...options,path:legacy.path }),{ code:'unsupported_database' });
    const after = legacy.connect(); assert.equal(schema(after),digest); after.close();
  }
  const { handle } = await f.reader();
  ok(await handle.isSuppressed(ns.ownerId,[a],{ expected:f.checkpoint(0) },f.credential));
  assert.equal(schema(f.db),before);
  f.db.exec('DROP TRIGGER safety_suppression_insert');
  await assert.rejects(() => openContentSuppressionReader(options),{ code:'unsupported_database' });
});

test('S2h follow-on retains frozen creation schemas and current-main v18/v34 read-open budgets', async t => {
  const f = safetyFixture(t), root = join(f.workspace.path,'baseline'); mkdirSync(root);
  const archive = fileURLToPath(new URL('./fixtures/content-safety-openers.tgz',import.meta.url));
  const unpacked = spawnSync('tar',['-xf',archive,'-C',root,'baseline'],{ encoding:'utf8' }); assert.equal(unpacked.status,0,unpacked.stderr);
  const load = path => import(pathToFileURL(join(root,'baseline','core',path)).href);
  const oldDatabase = await load('database.mjs');
  for (const [base,options] of [[18,{}],[23,{ privateCards:true }],[33,{ currentDependencies:true }]]) {
    const before = oldDatabase.openDatabase(join(f.workspace.path,'old-'+base+'.sqlite'),options), after = openDatabase(join(f.workspace.path,'new-'+base+'.sqlite'),options);
    assert.equal(before.prepare('PRAGMA user_version').get().user_version,base);
    assert.equal(after.prepare('PRAGMA user_version').get().user_version,base);
    assert.equal(schema(after),schema(before)); before.close(); after.close();
  }
  const count = operation => {
    const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec; let count = 0;
    DatabaseSync.prototype.exec = function(sql) { count += sql.split(';').filter(value => value.trim()).length; return exec.call(this,sql); };
    DatabaseSync.prototype.prepare = function(sql) {
      const statement = prepare.call(this,sql);
      return new Proxy(statement,{ get(target,key) { const value = Reflect.get(target,key,target);
        return typeof value !== 'function' ? value : (...args) => { if (['get','all','run','iterate'].includes(key)) count++; return value.apply(target,args); }; } });
    };
    try { const handle = operation(); handle.db.close(); return count; }
    finally { DatabaseSync.prototype.prepare = prepare; DatabaseSync.prototype.exec = exec; }
  };
  for (const migrated of [false,true]) {
    if (migrated) await f.migrate();
    for (const product of [false,true]) {
      const after = count(() => openReadDatabase(f.path,product ? { contextRead:true,validateProduct:validateContextProductLayout } : {}));
      // Main's final metadata fence supersedes the older archive's 44-statement
      // opener. S2h-1 independently pins these same current-main budgets.
      const expected = product ? 194 : 45;
      assert.equal(after,expected);
      t.diagnostic(`fresh base18 ${migrated ? 'physical34' : 'physical18'} ${product ? 'product' : 'ordinary'} read: main=${expected}, after=${after}, extra=${after-expected}`);
    }
  }
});
