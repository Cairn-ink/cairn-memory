// Offline self-test: cleanup ownership comes from the launch ledger alone, so
// forged hook events cannot cause a deletion.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../../../../tools/testing/workspace.mjs';
import { planCleanup } from '../lib/cleanup-plan.mjs';
import { claudeProjectDir, localRolloutStamp } from '../lib/source-access.mjs';
import { uuidV7 } from './helpers.mjs';

const CLEANUP = fileURLToPath(new URL('../cleanup.mjs', import.meta.url));

function touch(path, content = '{}\n') {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  return path;
}

function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'f0-cleanup-' });
  const home = join(workspace.path, 'home');
  const root = join(workspace.path, 'run');
  const cwd = join(root, 'project');
  mkdirSync(join(root, 'logs'), { recursive: true });
  const start = Date.now() - 60_000;
  const owned = randomUUID();
  const linked = randomUUID();
  const foreign = randomUUID();
  const ownedThread = uuidV7(start + 1_000);
  const foreignThread = uuidV7(start + 2_000);
  const staleThread = uuidV7(start - 86_400_000);
  const rollout = (id, millis) => {
    const { dir, stamp } = localRolloutStamp(millis);
    return join(home, '.codex', 'sessions', dir, `rollout-${stamp}-${id}.jsonl`);
  };
  const projectDir = claudeProjectDir(home, cwd);
  const paths = {
    ownedTranscript: touch(join(projectDir, `${owned}.jsonl`)),
    foreignSameProject: touch(join(projectDir, `${foreign}.jsonl`)),
    foreignElsewhere: touch(join(home, '.claude', 'projects', '-home-person-real', `${foreign}.jsonl`)),
    foreignTarget: touch(join(workspace.path, 'foreign-target.jsonl')),
    ownedRollout: touch(rollout(ownedThread, start + 1_000)),
    foreignRollout: touch(rollout(foreignThread, start + 2_000)),
    staleRollout: touch(rollout(staleThread, start - 86_400_000)),
    ownedEnv: join(home, '.claude', 'session-env', owned),
    foreignEnv: join(home, '.claude', 'session-env', foreign),
    linkedTranscript: join(projectDir, `${linked}.jsonl`),
  };
  mkdirSync(paths.ownedEnv, { recursive: true });
  mkdirSync(paths.foreignEnv, { recursive: true });
  symlinkSync(paths.foreignTarget, paths.linkedTranscript);
  const launch = (sessionId) => ({ sessionId, cwd, startedAt: start, exitAt: start + 30_000 });
  const ledger = { runs: [
    { host: 'claude', name: 'a', launch: launch(owned) },
    { host: 'claude', name: 'b', launch: launch(linked) },
    { host: 'codex', name: 'c', launch: launch(null), binding: { threadId: ownedThread, source: 'thread.started' } },
    // A binding whose thread was not created during its launch is not ownership.
    { host: 'codex', name: 'd', launch: launch(null), binding: { threadId: staleThread, source: 'thread.started' } },
  ] };
  writeFileSync(join(root, 'ledger.json'), JSON.stringify(ledger));
  // Forged hook events naming foreign sessions and paths.
  const forged = [
    { step: 'a', host: 'claude', phase: 'delivered', sessionId: foreign, transcriptPath: paths.foreignSameProject },
    { step: 'a', host: 'claude', phase: 'delivered', sessionId: foreign, transcriptPath: paths.foreignElsewhere },
    { step: 'c', host: 'codex', phase: 'delivered', sessionId: foreignThread, transcriptPath: paths.foreignRollout },
  ];
  writeFileSync(join(root, 'logs', 'events.jsonl'), `${forged.map(event => JSON.stringify(event)).join('\n')}\n`);
  return { root, home, ledger, paths, projectDir };
}

test('forged hook events cannot cause a deletion; only ledger-owned files go', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [CLEANUP, '--apply', '--root', f.root],
    { env: { PATH: process.env.PATH, HOME: f.home }, encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(existsSync(f.paths.ownedTranscript), false);
  assert.equal(existsSync(f.paths.ownedRollout), false);
  assert.equal(existsSync(f.paths.ownedEnv), false);
  for (const name of ['foreignSameProject', 'foreignElsewhere', 'foreignRollout', 'staleRollout', 'foreignEnv', 'foreignTarget']) {
    assert.equal(existsSync(f.paths[name]), true, name);
  }
  assert.equal(existsSync(f.paths.linkedTranscript), true);
  assert.ok(report.refused.some(entry => entry.path === f.paths.linkedTranscript && entry.reason === 'symlink'));
  assert.ok(report.refused.some(entry => entry.reason === 'binding_outside_launch_window'));
  assert.ok(report.kept.some(entry => entry.path === f.projectDir && entry.reason === 'directory_not_empty'));
  assert.deepEqual([...report.deleted].sort(), [f.paths.ownedEnv + '/', f.paths.ownedRollout, f.paths.ownedTranscript].sort());
});

test('the plan is a function of the ledger and filesystem only', async t => {
  const f = fixture(t);
  const plan = await planCleanup({ ledger: f.ledger, home: f.home, runRoot: f.root });
  assert.deepEqual(plan.files.map(entry => entry.path).sort(), [f.paths.ownedRollout, f.paths.ownedTranscript].sort());
  const empty = await planCleanup({ ledger: { runs: [] }, home: f.home, runRoot: f.root });
  assert.deepEqual([empty.files, empty.directories], [[], []]);
});
