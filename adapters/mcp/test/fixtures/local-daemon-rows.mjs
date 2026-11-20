// A separate process owns the SQLite inspections after the daemon has exited.
import { DatabaseSync } from 'node:sqlite';
const [path] = process.argv.slice(2), db = new DatabaseSync(path);
const output = {};
try {
  output.integrity = db.prepare('PRAGMA integrity_check').all();
  output.foreign_keys = db.prepare('PRAGMA foreign_key_check').all();
  output.journal_mode = db.prepare('PRAGMA journal_mode').get().journal_mode;
  output.memories = db.prepare('SELECT id,content,revision,deleted FROM memories ORDER BY id').all();
  output.receipts = db.prepare('SELECT id,memory_id,excerpt FROM receipts ORDER BY id').all();
  output.epochs = db.prepare('SELECT * FROM namespace_epochs ORDER BY owner_id,scope,project_id').all();
  output.index_memories = db.prepare('SELECT * FROM index_read_memories ORDER BY id').all();
} finally { db.close(); }
const side = new DatabaseSync(path + '.context-read-v1.sqlite', { readOnly: true });
try {
  output.context_documents = side.prepare('SELECT DISTINCT d.id,d.revision,d.eligible FROM documents d JOIN generations g ON g.id=d.generation WHERE g.published=1 AND d.stream=0 ORDER BY d.id').all();
  output.context_cursors = side.prepare('SELECT id,sequence,phase,last_key,checkpoint,published FROM generations ORDER BY id').all();
} finally { side.close(); }
console.log(JSON.stringify(output));
