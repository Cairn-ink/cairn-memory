// Maintainer-only offline layout generation; never invoked by tests.
import { writeFileSync } from 'node:fs';
import { openDatabase } from '../database.mjs';
if (process.argv.slice(2).join() !== '--write') throw new Error('Pass --write');
const db=openDatabase(':memory:');
try {
  const indexes=db.prepare("SELECT name,sql FROM sqlite_master WHERE name IN ('episode_event_read','episode_receipt_read','episode_open_step_read','receipt_time_read') ORDER BY name").all();
  writeFileSync(new URL('./episode-v17-indexes.json',import.meta.url),JSON.stringify(indexes,null,2)+'\n');
} finally { db.close(); }
