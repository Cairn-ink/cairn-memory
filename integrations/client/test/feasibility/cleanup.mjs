#!/usr/bin/env node
// Remove only host files created for this run's own synthetic sessions.
//   node cleanup.mjs            dry run: print the exact plan
//   node cleanup.mjs --apply    unlink those files, then rmdir now-empty own directories
// Never globs, never recurses and never touches shared host files; those are
// reported as residue instead.
import { existsSync, lstatSync, readdirSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';

const ROOT = '/tmp/f0-tmp/f0-run';
const HOME = process.env.HOME;
const apply = process.argv.includes('--apply');
const ledger = JSON.parse(readFileSync(join(ROOT, 'ledger.json'), 'utf8'));
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
const jsonl = path => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);
const events = jsonl(join(ROOT, 'logs', 'events.jsonl'));
const results = JSON.parse(readFileSync(join(ROOT, 'results.json'), 'utf8'));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ids = new Set([...ledger.runs.map(run => run.sessionId), ...events.map(event => event.sessionId)]
  .filter(id => typeof id === 'string' && UUID.test(id)));
// Claude names its per-project directory after the working directory.
const claudeProject = join(HOME, '.claude', 'projects', config.project.replace(/[^A-Za-z0-9]/g, '-'));
const owned = path => [...ids].some(id => path.includes(id));
const inHostState = path => path.startsWith(join(HOME, '.claude') + '/') || path.startsWith(join(HOME, '.codex') + '/');

const candidates = new Set(events.map(event => event.transcriptPath).filter(path => typeof path === 'string'));
const residue = new Set();
for (const run of results.runs) {
  for (const path of run.trace?.externalPaths ?? []) {
    if (inHostState(path) && owned(path)) candidates.add(path);
    else residue.add(path.replace(/\.tmp\.[0-9]+\.[0-9a-f]+$/, '.tmp.<pid>.<rand>').replace(/\/[0-9]+\.[0-9a-f]{64}\.key.*$/, '/<pid>.<hash>.key*')
      .replace(/\/sessions\/[0-9]+\.json$/, '/sessions/<pid>.json').replace(/backup\.[0-9]+$/, 'backup.<ms>'));
  }
}
// Directories named by an own session ID, plus the Claude project directory for the temp cwd.
for (const id of ids) {
  candidates.add(join(HOME, '.claude', 'session-env', id));
  candidates.add(join(HOME, '.claude', 'file-history', id));
  candidates.add(join(HOME, '.claude', 'todos', `${id}-agent-${id}.json`));
}
candidates.add(claudeProject);

const files = [];
const directories = [];
for (const path of [...candidates].sort()) {
  if (!path.startsWith(HOME + '/') || path.startsWith('/tmp/f0-tmp')) continue;
  if (!existsSync(path)) continue;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) { residue.add(`${path} (symlink, not touched)`); continue; }
  if (stat.isFile() && owned(path) && inHostState(path)) files.push(path);
  else if (stat.isDirectory() && (owned(basename(path)) || path === claudeProject)) directories.push(path);
  else residue.add(`${path} (not owned by an exact run ID, not touched)`);
}

const deleted = [];
if (apply) {
  for (const path of files) { unlinkSync(path); deleted.push(path); }
  // Deepest first; rmdir fails on a non-empty directory, which is then reported, not forced.
  for (const path of directories.sort((a, b) => b.length - a.length)) {
    if (readdirSync(path).length) { residue.add(`${path} (directory not empty, not removed)`); continue; }
    rmdirSync(path);
    deleted.push(`${path}/`);
  }
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ids: [...ids].sort(), files, directories,
  deleted, residue: [...residue].sort() }, null, 2));
