/** Relax the original two-client Raw constraint for ordinary capture callers.
 * Runs only inside the normal legacy-store upgrade transaction. Attested
 * content-safety layouts retain their separate migration contract.
 */
export function migrateRawClients(db) {
  const row = db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='raw_conversations'").get();
  const old = "CHECK(client IN ('claude-code','codex'))";
  if (!row?.sql.includes(old)) return;
  const deferred = db.prepare('PRAGMA defer_foreign_keys').get().defer_foreign_keys;
  const legacy = db.prepare('PRAGMA legacy_alter_table').get().legacy_alter_table;
  const objects = db.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='raw_conversations' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
  db.exec('PRAGMA defer_foreign_keys=ON; PRAGMA legacy_alter_table=ON');
  try {
    db.exec(row.sql.replace('CREATE TABLE raw_conversations', 'CREATE TABLE raw_conversations_upgrade')
      .replace(old, 'CHECK(length(client) BETWEEN 1 AND 200)'));
    db.exec('INSERT INTO raw_conversations_upgrade SELECT * FROM raw_conversations');
    db.exec('DROP TABLE raw_conversations');
    db.exec('ALTER TABLE raw_conversations_upgrade RENAME TO raw_conversations');
    for (const object of objects) db.exec(object.sql);
    if (db.prepare('PRAGMA foreign_key_check').get()) throw Error('raw_client_migration_failed');
  } finally {
    db.exec(`PRAGMA defer_foreign_keys=${deferred ? 'ON' : 'OFF'}; PRAGMA legacy_alter_table=${legacy ? 'ON' : 'OFF'}`);
  }
}
