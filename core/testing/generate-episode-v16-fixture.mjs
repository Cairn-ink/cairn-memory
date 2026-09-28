// Maintainer-only offline generator. Tests load the committed SQL/JSON; never invoke Git.
// Usage: node core/testing/generate-episode-v16-fixture.mjs --write /absolute/clean/91a3bc3c-checkout
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [flag, root, ...extra] = process.argv.slice(2);
assert.ok(flag === '--write' && isAbsolute(root ?? '') && !extra.length);
const base = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.ok(base.startsWith('91a3bc3c'));
assert.equal(execFileSync('git', ['-C', root, 'diff', '--name-only'], { encoding: 'utf8' }).trim(), '');
const dir = mkdtempSync(join(tmpdir(), 'episode-v16-'));
try {
  const { fixture, register, batch, draft, ns } = await import(pathToFileURL(root + '/core/testing/episode-helpers.mjs'));
  const cleanup = [];
  const f = fixture({ after: fn => cleanup.push(fn) });
  try {
    const input = batch('fixture'), registered = register(f, input), job = draft(f, registered, input);
    f.runtime.commitEpisodeDraft(ns, job.commit);
    f.core.admit({ namespace: ns, memory: { content: 'Synthetic standing instruction', kind: 'instruction' },
      receipts: [{ client: 'fixture', sessionId: 'synthetic', eventId: 'fixture', role: 'user', excerpt: 'Synthetic standing instruction' }] });
    assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 16);
    const objects = f.db.prepare(`SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL
      ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name`).all();
    const tables = Object.fromEntries(objects.filter(row => row.type === 'table').map(row =>
      [row.name, f.db.prepare('SELECT * FROM '+row.name).all()]));
    writeFileSync(new URL('./episode-schema-v16.sql', import.meta.url),
      '-- Frozen synthetic v16 schema from '+base+'\n'+objects.map(row=>row.sql+';').join('\n\n')+
      '\nPRAGMA application_id=1128352082;\nPRAGMA user_version=16;\n');
    writeFileSync(new URL('./episode-v16-fixture.json', import.meta.url), JSON.stringify({base,tables},null,2)+'\n');
  } finally { for (const close of cleanup) close(); }
  const opener = readFileSync(join(root,'core/database.mjs'),'utf8')
    .replaceAll('from "./','from "../').replaceAll("from './","from '../")
    .replace('const VERSION = EPISODE_SCHEMA_VERSION;', 'const VERSION = 16;');
  writeFileSync(new URL('./episode-v16-database.mjs',import.meta.url),opener);
} finally { rmSync(dir,{recursive:true,force:true}); }
