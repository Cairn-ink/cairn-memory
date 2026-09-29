import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { observeHosted } from '../test/observe-legacy.mjs';
export const BASE = '3a1c17d9c888b28e878f5e2d8de0180d9b49fa4e';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const preload = fileURLToPath(new URL('./golden-preload.mjs', import.meta.url));
export async function extractMain(destination) {
  const prefix = 'plugins/cairn-memory/';
  const git = args => execFileSync('git', args, { cwd: repo });
  const hashes = {};
  for (const path of git(['ls-tree', '-r', '--name-only', BASE, `${prefix}lib/`, `${prefix}scripts/`]).toString().trim().split('\n')) {
    const bytes = git(['show', `${BASE}:${path}`]);
    hashes[path] = createHash('sha256').update(bytes).digest('hex');
    const target = join(destination, path.slice(prefix.length));
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
  }
  return hashes;
}
export async function observeStandalone(plugin) {
  const workspace = createTestWorkspace(null, { prefix: 'cx2-golden-' });
  try {
    const variants = [];
    for (const mode of ['plugin-data', 'home', 'falsy-home']) {
      const directory = join(workspace.path, mode);
      const home = join(directory, 'home'); const temporary = join(directory, 'temporary');
      const root = mode === 'plugin-data' ? join(home, 'plugin') : join(mode === 'home' ? home : temporary, '.cairn-memory');
      await mkdir(home, { recursive: true, mode: 0o700 }); await mkdir(temporary, { mode: 0o700 });
      const requestsFile = join(directory, 'requests.jsonl');
      await writeFile(requestsFile, '');
      const transcript = join(directory, 'transcript.jsonl');
      await writeFile(transcript, JSON.stringify({type:'user',uuid:'synthetic-golden',message:{content:'Please remember concise examples.'}}) + '\n');
      const outcomes = [];
      for (const action of ['start', 'recall', 'capture', 'capture']) {
        const proc = spawn(process.execPath, ['--import', preload, join(plugin, 'scripts/hook.mjs'), action], {
          env: { PATH: process.env.PATH, HOME: home, TMPDIR: temporary,
            NODE_OPTIONS: process.env.NODE_OPTIONS, CAIRN_TEST_REAL_HOME: process.env.CAIRN_TEST_REAL_HOME,
            ...(mode === 'plugin-data' ? { CLAUDE_PLUGIN_DATA: root } : {}),
            CAIRN_TEST_FALSY_HOME: mode === 'falsy-home' ? 'yes' : 'no', CAIRN_TEST_REQUESTS: requestsFile,
            CLAUDE_PLUGIN_OPTION_API_ENDPOINT: 'https://synthetic.invalid', CLAUDE_PLUGIN_OPTION_API_TOKEN: 'synthetic-token' },
          stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        proc.stdout.on('data', b => stdout += b); proc.stderr.on('data', b => stderr += b);
        proc.stdin.end(JSON.stringify({cwd:'/synthetic/project',session_id:'synthetic-session',transcript_path:transcript,prompt:'Prefer short examples.'}));
        const code = await new Promise((resolve, reject) => { proc.on('error', reject); proc.on('close', resolve); });
        outcomes.push({ code, stdout, stderr });
      }
      const key = await readFile(join(root, 'project-key'), 'utf8');
      const identity = await readFile(join(root, 'install-id'), 'utf8');
      const requestBytes = await readFile(requestsFile, 'utf8');
      variants.push({ mode, key, identity, requestBytes, outcomes });
    }
    return variants;
  } finally { await workspace.cleanup(); }
}
export async function generateMainGolden(output) {
  const workspace = createTestWorkspace(null, { prefix: 'cx2-base-' });
  try {
    const hashes = await extractMain(workspace.path);
    const result = { base: BASE, hashes, standalone: await observeStandalone(workspace.path), hosted: await observeHosted(workspace.path) };
    await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  } finally { await workspace.cleanup(); }
}


// Explicit maintainer check: ordinary parity tests also work in shallow clones.
export async function verifyMainGolden(fixture) {
  const assert = (await import('node:assert/strict')).default;
  const golden = JSON.parse(await readFile(fixture));
  const workspace = createTestWorkspace(null, { prefix: 'cx2-reproduce-' });
  try {
    assert.equal(golden.base, BASE);
    assert.deepEqual(await extractMain(workspace.path), golden.hashes);
    assert.deepEqual(await observeStandalone(workspace.path), golden.standalone);
    assert.deepEqual(await observeHosted(workspace.path), golden.hosted);
  } finally { await workspace.cleanup(); }
}
