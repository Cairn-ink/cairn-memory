import { pathToFileURL } from 'node:url';

export async function truncateWal(database, { wait = false } = {}) {
  const { DatabaseSync } = await import('node:sqlite');
  const uri = pathToFileURL(database);
  uri.searchParams.set('mode', 'rw');
  const db = new DatabaseSync(uri.href);
  try {
    if (wait) db.exec('PRAGMA busy_timeout = 5000');
    if (db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()?.busy !== 0)
      throw Object.assign(new Error(), { code: 'storage_busy', retryable: true });
  } finally { db.close(); }
}
