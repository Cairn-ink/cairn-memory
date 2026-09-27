// Maintainer-only: freeze synthetic observations from base 93e52b7, not v0.1.0.
// Usage: node integrations/client/testing/generate-base-93e52b7-fixture.mjs --write
// Importing this module never reads Git, runs hooks or writes a fixture.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { observeHosted, observeMechanisms } from '../test/observe-legacy.mjs';

const base = '93e52b7afb298d728cb4831c34bbda6dcf750704';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const prefix = 'plugins/cairn-memory/';

export async function generateBaseFixture(output) {
  if (!output) throw new Error('fixture_output_required');
  const directory = await mkdtemp(join(tmpdir(), 'cairn-frozen-source-test-'));
  const git = args => execFileSync('git', args, { cwd: root });
  try {
    const files = git(['ls-tree', '-r', '--name-only', base, `${prefix}lib/`, `${prefix}scripts/`])
      .toString().trim().split('\n');
    const sourceHashes = {};
    for (const file of files) {
      const bytes = git(['show', `${base}:${file}`]);
      sourceHashes[file] = createHash('sha256').update(bytes).digest('hex');
      const destination = join(directory, file.slice(prefix.length));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }
    const fixture = { base, sourceHashes, mechanisms: await observeMechanisms(join(directory, 'lib')),
      hosted: await observeHosted(directory) };
    await writeFile(output, JSON.stringify(fixture, null, 2) + '\n');
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    console.error('Usage: node integrations/client/testing/generate-base-93e52b7-fixture.mjs --write');
    process.exitCode = 1;
  } else {
    await generateBaseFixture(new URL('../test/fixtures/claude-hosted-93e52b7.json', import.meta.url));
  }
}
