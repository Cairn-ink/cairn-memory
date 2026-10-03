import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
globalThis.fetch = () => { throw new Error('cold_network_forbidden'); };
await assert.rejects(import('node:sqlite'), /cold_import_forbidden/u);
const requests = JSON.parse(readFileSync(join(root, 'requests.json'), 'utf8'));
await assert.rejects(import(pathToFileURL(requests.outsideModule).href), /cold_import_forbidden/u);
const { inspectMixedResultJournal } = await import('./mixed-result-journal.mjs');
let accepted = 0, rejected = 0;
for (const item of requests.items) {
  const inspect = () => inspectMixedResultJournal({ directory: join(root, item.directory) });
  if (item.reject) { assert.throws(inspect, { code: 'invalid_mixed_result_journal' }); rejected++; }
  else { assert.equal(JSON.stringify(inspect()), item.inspectionJson); accepted++; }
}
assert.equal(accepted, requests.expectedAccepted); assert.equal(rejected, requests.expectedRejected);
console.log(JSON.stringify({ kind: 'SJ_COLD_MINIMAL_TREE', accepted, rejected,
  deniedSqlite: true, deniedOutside: true }));
