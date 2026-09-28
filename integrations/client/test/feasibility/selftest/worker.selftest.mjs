// Offline self-test: the real worker process refuses foreign, symlinked and
// paused sources before reading them, and reads an owned one.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../../../../tools/testing/workspace.mjs';
import { claudeProjectDir } from '../lib/source-access.mjs';

const WORKER = fileURLToPath(new URL('../worker.mjs', import.meta.url));

function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'f0-worker-' });
  const home = join(workspace.path, 'home');
  const root = join(workspace.path, 'run');
  const cwd = join(root, 'project');
  for (const dir of [join(root, 'logs'), join(root, 'state'), cwd]) mkdirSync(dir, { recursive: true });
  const owned = randomUUID();
  writeFileSync(join(root, 'config.json'), JSON.stringify({ step: 'selftest', stateDir: join(root, 'state'),
    coreUrl: 'http://127.0.0.1:1', token: 'f0-synthetic-token' }));
  writeFileSync(join(root, 'ledger.json'), JSON.stringify({ runs: [{ host: 'claude', name: 'selftest',
    launch: { sessionId: owned, cwd, startedAt: Date.now() - 1_000, exitAt: null } }] }));
  const projectDir = claudeProjectDir(home, cwd);
  mkdirSync(projectDir, { recursive: true });
  const foreignFile = join(workspace.path, 'foreign-transcript.jsonl');
  writeFileSync(foreignFile, '{"type":"user","message":{"role":"user","content":"FOREIGN-CANARY"}}\n');
  return { root, home, cwd, owned, projectDir, foreignFile };
}

function runWorker({ root, home }, job) {
  const result = spawnSync(process.execPath, [WORKER, root], { input: JSON.stringify({ host: 'claude', label: 'Stop',
    hostPid: null, launchedAt: Date.now(), delayMs: 0, ...job }), env: { PATH: process.env.PATH, HOME: home },
  encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr);
  const finish = readFileSync(join(root, 'logs', 'workers.jsonl'), 'utf8').trim().split('\n')
    .map(line => JSON.parse(line)).filter(record => record.phase === 'finish').at(-1);
  assert.ok(finish);
  return finish;
}

test('a foreign session is refused and its file is never read', t => {
  const f = fixture(t);
  const foreign = randomUUID();
  const path = join(f.projectDir, `${foreign}.jsonl`);
  writeFileSync(path, readFileSync(f.foreignFile));
  const finish = runWorker(f, { session_id: foreign, transcript_path: path, cwd: f.cwd });
  assert.equal(finish.status, 'refused');
  assert.equal(finish.authorization, 'not_a_harness_session');
  assert.equal(finish.sourceProbe, undefined);
});

test('a symlink at the owned session path is refused', t => {
  const f = fixture(t);
  const path = join(f.projectDir, `${f.owned}.jsonl`);
  symlinkSync(f.foreignFile, path);
  const finish = runWorker(f, { session_id: f.owned, transcript_path: path, cwd: f.cwd });
  assert.equal(finish.status, 'refused');
  assert.equal(finish.authorization, 'symlink');
  assert.equal(finish.sourceProbe, undefined);
});

test('a paused state is refused before the owned source is read', t => {
  const f = fixture(t);
  const path = join(f.projectDir, `${f.owned}.jsonl`);
  writeFileSync(path, '{"type":"system"}\n');
  writeFileSync(join(f.root, 'state', 'control.json'), JSON.stringify({ version: 1, paused: true,
    generation: randomUUID() }));
  const finish = runWorker(f, { session_id: f.owned, transcript_path: path, cwd: f.cwd });
  assert.equal(finish.status, 'paused');
  assert.equal(finish.sourceProbe, undefined);
});

test('an owned regular source is read (positive control)', t => {
  const f = fixture(t);
  const path = join(f.projectDir, `${f.owned}.jsonl`);
  writeFileSync(path, '{"type":"system"}\n');
  const finish = runWorker(f, { session_id: f.owned, transcript_path: path, cwd: f.cwd });
  assert.equal(finish.authorization, 'harness_source');
  assert.equal(finish.sourceProbe.bytes, 18);
  assert.equal(finish.status, 'acknowledged');
  assert.equal(finish.messagesSent, 0);
});
