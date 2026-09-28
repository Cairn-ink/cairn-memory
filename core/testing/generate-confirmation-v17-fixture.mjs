// Run against an archive of main c558593bd7dc4700a09235aeb8ebbd93184a0ea4.
// Synthetic only; creates and cleans its own databases under the caller's TMPDIR.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { captureEpisodeParity } from './episode-parity.mjs';
import { readOutputs } from './confirmation-parity.mjs';
const root = process.argv[2];
if (!root) throw Error('Pass the archived baseline repository root');
const { openMemoryCore } = await import(pathToFileURL(join(root, 'core/index.mjs')));
const fixture = JSON.parse(readFileSync(new URL('./episode-v15-fixture.json', import.meta.url), 'utf8'));
const ws = createTestWorkspace(null, { prefix: 'cf1-freeze-' });
try {
  const cases = [];
  for (const [i, { config }] of fixture.parity.entries()) {
    const path = join(ws.path, `${i}.sqlite`);
    cases.push({ config, capture: await captureEpisodeParity(root, path, config), reads: await readOutputs(openMemoryCore, path) });
  }
  process.stdout.write(JSON.stringify({ base: 'c558593bd7dc4700a09235aeb8ebbd93184a0ea4', cases }, null, 2) + '\n');
} finally { await ws.cleanup(); }
