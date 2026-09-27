// Explicit maintenance command: regenerate only from the pinned released source.
// Never imports the working tree plugin or reads a user transcript/credential.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { observeHosted, observeMechanisms } from './observe-legacy.mjs';

const base = '93e52b7afb298d728cb4831c34bbda6dcf750704';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const prefix = 'plugins/cairn-memory/';
const directory = await mkdtemp(join(tmpdir(), 'cx1-frozen-source-'));
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
  await writeFile(new URL('./fixtures/claude-hosted-0.1.0.json', import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
} finally { await rm(directory, { recursive: true, force: true }); }
