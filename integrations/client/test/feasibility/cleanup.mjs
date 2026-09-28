#!/usr/bin/env node
// Remove only host files of this run's own synthetic sessions.
//   node cleanup.mjs [--root <run-root>]           dry run: print the exact plan
//   node cleanup.mjs --apply [--root <run-root>]   unlink planned files, then rmdir now-empty planned directories
// Ownership comes from the launch ledger alone (harness-generated Claude IDs and
// Codex bindings the orchestrator observed); hook events are never read. Shared
// host files are reported as residue, never touched.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyCleanup, planCleanup } from './lib/cleanup-plan.mjs';
import { readLedger } from './lib/ledger.mjs';

const args = process.argv.slice(2);
const rootAt = args.indexOf('--root');
const root = rootAt >= 0 ? args[rootAt + 1] : '/tmp/f0-tmp/f0-run';
const home = process.env.HOME;
if (!root?.startsWith('/') || !home?.startsWith('/') || args.some((arg, i) => !['--apply', '--root'].includes(arg) && args[i - 1] !== '--root')) {
  console.error('usage: cleanup.mjs [--apply] [--root <absolute run root>] (HOME must be absolute)');
  process.exit(1);
}

const plan = await planCleanup({ ledger: readLedger(root), home, runRoot: root });
const result = args.includes('--apply') ? await applyCleanup(plan) : { deleted: [], kept: [] };
// Shared paths the traces saw are reported for review only.
const resultsPath = join(root, 'results.json');
const residue = existsSync(resultsPath)
  ? [...new Set(JSON.parse(readFileSync(resultsPath, 'utf8')).runs.flatMap(run => run.trace?.externalPaths ?? [])
    .filter(path => !plan.files.some(file => file.path === path) && !plan.directories.some(dir => dir.path === path)))].sort()
  : [];
console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'dry-run', ...plan, ...result, residue }, null, 2));
