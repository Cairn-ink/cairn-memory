// Run against an archive of main 3a1c17d9c888b28e878f5e2d8de0180d9b49fa4e.
// Synthetic only; creates and cleans its own databases under the caller's TMPDIR.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { parity } from './recall-budget-parity.mjs';
const root = process.argv[2];
if (!root) throw Error('Pass the archived baseline repository root');
const { openMemoryCore } = await import(pathToFileURL(join(root, 'core/index.mjs')));
const ws = createTestWorkspace(null, { prefix: 'cr1-freeze-' });
try {
  const cases = await parity(openMemoryCore, join(ws.path, 'memory.sqlite'));
  process.stdout.write(JSON.stringify({ base: '3a1c17d9c888b28e878f5e2d8de0180d9b49fa4e', cases }, null, 2) + '\n');
} finally { await ws.cleanup(); }
