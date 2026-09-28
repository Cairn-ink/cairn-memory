// Maintainer-only, offline synthetic fixture generator. Never run by the test suite.
// Usage: node core/testing/generate-episode-v15-fixture.mjs --write /absolute/clean/13e50399-checkout
// Layout only: node core/testing/generate-episode-v15-fixture.mjs --write-layout
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../database.mjs';
import { captureDiagnosticParity } from './episode-diagnostic-parity.mjs';
import { captureEpisodeParity } from './episode-parity.mjs';

function writeLayout(path) {
  const current = openDatabase(path);
  try {
    const names = ['episode_messages', 'episode_events', 'episode_attempts', 'episode_keep_actions'];
    const layout = Object.fromEntries(names.map(name =>
      [name, current.prepare('PRAGMA table_info(' + name + ')').all()]));
    writeFileSync(new URL('./episode-v16-layout.json', import.meta.url),
      JSON.stringify(layout, null, 2) + '\n');
  } finally { current.close(); }
}

const [flag, root, ...extra] = process.argv.slice(2);
// Regenerate only the unmerged v16 expectation, preserving frozen v15 data.
if (flag === '--write-layout' && root === undefined && extra.length === 0) {
  const temporary = mkdtempSync(join(tmpdir(), 'episode-layout-'));
  try { writeLayout(join(temporary, 'v16.sqlite')); }
  finally { rmSync(temporary, { recursive: true, force: true }); }
  process.exit(0);
}
if (flag !== '--write' || !root || !isAbsolute(root) || extra.length) {
  throw new Error('Usage: node core/testing/generate-episode-v15-fixture.mjs --write /absolute/clean/13e50399-checkout');
}
const base = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.ok(base.startsWith('13e50399'), 'Expected the pinned v15 base');
assert.equal(execFileSync('git', ['-C', root, 'diff', '--name-only'], { encoding: 'utf8' }).trim(), '');
const temporary = mkdtempSync(join(tmpdir(), 'episode-fixture-'));
try {
  const { createMemoryRuntime } = await import(pathToFileURL(root + '/core/runtime.mjs'));
  const path = join(temporary, 'v15.sqlite'), runtime = createMemoryRuntime({ path });
  const ns = { ownerId: 'migration', scope: 'personal', projectId: '' };
  const key = { client: 'synthetic', eventId: 'old', payloadDigest: 'a'.repeat(64), leaseMs: 125000 };
  const view = { messages: [{ id: 'message', role: 'user', content: 'Synthetic old evidence' }],
    retainedSourceWindow: { maxUnitsPerMessage: 800, truncatedMessageIndices: [] } };
  const claim = runtime.claimCaptureEvidence(ns, { ...key, view });
  runtime.finishCapturedAdmission(ns, { ...key, token: claim.token, items: [] });
  runtime.close();
  const db = new DatabaseSync(path);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 15);
  const objects = db.prepare(`SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL
    ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`).all();
  const schema = '-- Frozen synthetic v15 schema from ' + base + '\n' +
    objects.map(row => row.sql + ';').join('\n\n') +
    '\nPRAGMA application_id=1128352082;\nPRAGMA user_version=15;\n';
  const tables = Object.fromEntries(objects.filter(row => row.type === 'table').map(row =>
    [row.name, db.prepare('SELECT * FROM ' + row.name).all()]));
  db.close();
  const parity = [];
  for (const [index, config] of [{}, { captureQualification: 'source-bound-v2' },
    { captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' }].entries()) {
    parity.push({ config, expected: await captureEpisodeParity(root, join(temporary, 'parity-' + index + '.sqlite'), config) });
  }
  writeFileSync(new URL('./episode-v15-diagnostics.json', import.meta.url),
    JSON.stringify({ base, cases: await captureDiagnosticParity(root) }, null, 2) + '\n');
  writeLayout(join(temporary, 'v16.sqlite'));
  // Freeze the old opener for the old-binary exclusion gate. Relative imports only;
  // the version constant is frozen to the value shipped by this pinned binary.
  const opener = readFileSync(join(root, 'core/database.mjs'), 'utf8')
    .replaceAll('from "./', 'from "../').replaceAll("from './", "from '../")
    .replace('const VERSION = EPISODE_SCHEMA_VERSION;', 'const VERSION = 15;');
  writeFileSync(new URL('./episode-v15-database.mjs', import.meta.url), opener);
  writeFileSync(new URL('./episode-schema-v15.sql', import.meta.url), schema);
  writeFileSync(new URL('./episode-v15-fixture.json', import.meta.url),
    JSON.stringify({ base, tables, parity }, null, 2) + '\n');
} finally { rmSync(temporary, { recursive: true, force: true }); }
