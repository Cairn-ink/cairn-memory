// Run against an archive of main fcd93ae45b1b7c0c49c7beb0a0dd5d8e8868885c.
// Synthetic only; creates and cleans its own databases under the caller's TMPDIR.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { parity } from './background-parity.mjs';
const root = process.argv[2];
if (!root) throw Error('Pass the archived baseline repository root');
const { openMemoryCore } = await import(pathToFileURL(join(root, 'core/index.mjs')));
const ws = createTestWorkspace(null, { prefix: 'cf2-freeze-' });
try {
  const cases = await parity(openMemoryCore, join(ws.path, 'memory.sqlite'));
  process.stdout.write(JSON.stringify({ base: 'fcd93ae45b1b7c0c49c7beb0a0dd5d8e8868885c', cases }, null, 2) + '\n');
} finally { await ws.cleanup(); }
