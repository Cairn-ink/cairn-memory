// Maintainer-only, offline synthetic fixture generator. Never run by the test suite.
// Usage: node core/testing/generate-episode-v14-fixture.mjs --write /absolute/clean/93e52b7-checkout
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { captureEpisodeParity } from './episode-parity.mjs';

const [flag, root, ...extra] = process.argv.slice(2);
if (flag !== '--write' || !root || !isAbsolute(root) || extra.length) {
  throw new Error('Usage: node core/testing/generate-episode-v14-fixture.mjs --write /absolute/clean/93e52b7-checkout');
}
const base = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.ok(base.startsWith('93e52b7'), 'Expected the pinned v14 base');
assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
const temporary = mkdtempSync(join(tmpdir(), 'episode-fixture-'));
try {
  const { createMemoryRuntime } = await import(pathToFileURL(root + '/core/runtime.mjs'));
  const path = join(temporary, 'v14.sqlite'), runtime = createMemoryRuntime({ path });
  const ns = { ownerId: 'migration', scope: 'personal', projectId: '' };
  const key = { client: 'synthetic', eventId: 'old', payloadDigest: 'a'.repeat(64), leaseMs: 125000 };
  const view = { messages: [{ id: 'message', role: 'user', content: 'Synthetic old evidence' }],
    retainedSourceWindow: { maxUnitsPerMessage: 800, truncatedMessageIndices: [] } };
  const claim = runtime.claimCaptureEvidence(ns, { ...key, view });
  runtime.finishCapturedAdmission(ns, { ...key, token: claim.token, items: [] });
  runtime.close();
  const db = new DatabaseSync(path);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 14);
  const objects = db.prepare(`SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL
    ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`).all();
  const schema = '-- Frozen synthetic v14 schema from ' + base + '\n' +
    objects.map(row => row.sql + ';').join('\n\n') +
    '\nPRAGMA application_id=1128352082;\nPRAGMA user_version=14;\n';
  const tables = Object.fromEntries(objects.filter(row => row.type === 'table').map(row =>
    [row.name, db.prepare('SELECT * FROM ' + row.name).all()]));
  db.close();
  const parity = [];
  for (const [index, config] of [{}, { captureQualification: 'source-bound-v2' },
    { captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' }].entries()) {
    parity.push({ config, expected: await captureEpisodeParity(root, join(temporary, 'parity-' + index + '.sqlite'), config) });
  }
  writeFileSync(new URL('./episode-schema-v14.sql', import.meta.url), schema);
  writeFileSync(new URL('./episode-v14-fixture.json', import.meta.url),
    JSON.stringify({ base, tables, parity }, null, 2) + '\n');
} finally { rmSync(temporary, { recursive: true, force: true }); }
