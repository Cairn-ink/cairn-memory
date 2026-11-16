import { faults } from './fixtures/sqlite-helper-child-faults.mjs';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, lstatSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { createExclusiveSqliteFile } from '../sqlite-journal-probe.mjs';

beforeEach(t => faults.install(t));
const init = { autoVacuum: 'INCREMENTAL', journalMode: 'DELETE',
  sql: 'CREATE TABLE product_metadata(singleton INTEGER PRIMARY KEY,store_id TEXT,profile TEXT,incarnation TEXT,kind TEXT);',
  storeId: 'synthetic', profile: 'synthetic', incarnation: 'synthetic', attestation: { applicationId: 1, userVersion: 1, schema: [] } };
for (const replacing of [false, true])
for (const [window, mode] of [['unpublished', 1], ['linked', 5], ['directory-fsync', 6], ['before-reply', 7]])
test(`PRODUCT_MODE ${replacing ? 'replace-product-cache' : 'initialize-product-cache'} ${window}`, t => {
  const w = createTestWorkspace(t), path = join(w.path, 'canonical.sqlite.context-read-product-v1.1.sqlite');
  if (replacing) createExclusiveSqliteFile(path, undefined, init);
  const replacement = () => { const s = lstatSync(path); return String(s.dev) + ':' + String(s.ino); };
  faults.arm(3, mode);
  const code = !replacing && [1, 5].includes(mode) ? 'storage_busy' : 'storage_error';
  assert.throws(() => createExclusiveSqliteFile(path, replacing ? replacement() : undefined, init), { code, cause: 'ETIMEDOUT' }, 'PRODUCT_MODE_TIMEOUT');
  assert.equal(faults.counts.reached, 1, 'PRODUCT_MODE_REAL_TIMEOUT');
  faults.reset();
  // Explicit derived-cache replacement cleans abandoned stages and publishes
  // a complete successor. Never accept a partial target as an initialized DB.
  let present = true; try { lstatSync(path); } catch (e) { assert.equal(e.code, 'ENOENT'); present = false; }
  createExclusiveSqliteFile(path, present ? replacement() : undefined, init);
  const check = spawnSync(process.execPath, ['--input-type=module', '-e', `import {DatabaseSync} from 'node:sqlite';
    const db=new DatabaseSync(process.argv[1],{readOnly:true});const row=db.prepare('SELECT * FROM product_metadata').get();
    if(row.store_id!=='synthetic'||row.incarnation!=='synthetic')process.exitCode=1;db.close();`, path], { encoding: 'utf8', env: {}, timeout: 5000 });
  assert.equal(check.status, 0, check.stderr);
  assert.deepEqual(readdirSync(w.path).sort(), [basename(path), basename(path) + '.lifecycle-lock.sqlite'].sort(), 'PRODUCT_MODE_NO_ORPHANS');
});
