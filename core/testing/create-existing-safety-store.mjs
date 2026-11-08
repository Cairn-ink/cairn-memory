// Synthetic inherited base-33 package with the original two-client declaration.
// Run in a child so its frozen declaration cannot affect the reopening engine.
import { spawnSync } from 'node:child_process';
import { openDatabase } from '../database.mjs';
import { lineageBaseDeclarations } from '../card-lineage-base-schema.mjs';
import { migrateCardLineage } from '../content-safety-migration.mjs';
const path = process.argv[2], backupPath = path + '.backup';
const frozen = `CREATE TABLE raw_conversations (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, scope TEXT NOT NULL,
      project_id TEXT NOT NULL, client TEXT NOT NULL CHECK(client IN ('claude-code','codex')),
      session_key TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
      first_received_at TEXT NOT NULL, last_received_at TEXT NOT NULL,
      CHECK((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0)),
      UNIQUE(owner_id,scope,project_id,client,session_key)
    ) STRICT`;
const db = openDatabase(path, { currentDependencies: true });
const storeId = db.prepare('SELECT store_id FROM store_metadata').get().store_id;
const objects = db.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='raw_conversations' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
db.exec('PRAGMA foreign_keys=OFF; DROP TABLE raw_conversations');
db.exec(frozen);
for (const { sql } of objects) db.exec(sql);
db.close();
lineageBaseDeclarations['33'].find(row => row.name === 'raw_conversations').sql = frozen;
const child = spawnSync(process.execPath, ['--input-type=module', '-e',
  "import {copyFileSync} from 'node:fs';copyFileSync(process.argv[1],process.argv[2]);", path, backupPath]);
if (child.status !== 0) throw Error('backup_failed');
await migrateCardLineage({ path, backupPath, expected: { storeId, base: 33 },
  quiescence: { admissionsClosed: true, writersStopped: true, readersDrained: true, oldHandlesClosed: true } });
