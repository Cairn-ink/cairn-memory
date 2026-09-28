// Offline self-test for source ownership. Run with
// `node tools/testing/run.mjs integrations/client/test/feasibility/selftest/*.selftest.mjs`.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../../../../tools/testing/workspace.mjs';
import { authorizeSource, claudeProjectDir, expectedSourcePaths, localRolloutStamp, openAuthorizedSource,
  ownerLaunch } from '../lib/source-access.mjs';
import { uuidV7 } from './helpers.mjs';

const HOME = '/home/synthetic';
const CWD = '/tmp/f0-tmp/f0-run/project-F0CWDSYNTHETIC';
const START = Date.UTC(2026, 8, 28, 15, 0, 0);

const claudeId = randomUUID();
const threadId = uuidV7(START + 2_000);
const ledger = { runs: [
  { host: 'claude', launch: { sessionId: claudeId, cwd: CWD, startedAt: START, exitAt: START + 60_000 } },
  { host: 'codex', launch: { sessionId: null, cwd: CWD, startedAt: START, exitAt: START + 60_000 },
    binding: { threadId, source: 'thread.started', observedAt: START + 2_100 } },
] };
const claudePath = join(claudeProjectDir(HOME, CWD), `${claudeId}.jsonl`);

/** In-memory filesystem that records every call; a test fails if the source is touched. */
function memoryFs(entries) {
  const calls = [];
  const statOf = entry => ({ isFile: () => entry.kind === 'file', isDirectory: () => entry.kind === 'dir',
    isSymbolicLink: () => entry.kind === 'symlink', uid: entry.uid ?? 1000, size: entry.size ?? 10, dev: 1, ino: entry.ino ?? 7 });
  return { calls, fs: {
    realpath: async path => { calls.push(['realpath', path]); return entries.realpath?.[path] ?? path; },
    lstat: async path => {
      calls.push(['lstat', path]);
      const entry = entries.files?.[path];
      if (!entry) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return statOf(entry);
    },
    open: async path => {
      calls.push(['open', path]);
      const entry = entries.files?.[path];
      let closed = false;
      return { stat: async () => statOf(entry), close: async () => { closed = true; },
        get closed() { return closed; } };
    },
  } };
}

const authorize = (overrides, fsHarness, paused = false) => {
  let pauseChecks = 0;
  const run = authorizeSource({ host: 'claude', sessionId: claudeId, suppliedPath: claudePath, suppliedCwd: CWD, ledger,
    home: HOME, uid: 1000, fs: fsHarness.fs, isPaused: async () => { pauseChecks++; return paused; }, ...overrides });
  return run.then(result => ({ result, pauseChecks }));
};

test('a foreign session is refused before any filesystem or pause access', async () => {
  const harness = memoryFs({ files: { [claudePath]: { kind: 'file' } } });
  const foreign = randomUUID();
  const { result, pauseChecks } = await authorize({ sessionId: foreign,
    suppliedPath: join(claudeProjectDir(HOME, CWD), `${foreign}.jsonl`) }, harness);
  assert.deepEqual(result, { ok: false, reason: 'not_a_harness_session' });
  assert.deepEqual(harness.calls, []);
  assert.equal(pauseChecks, 0);
});

test('an owned session with a forged path or working directory is refused without filesystem access', async () => {
  const harness = memoryFs({});
  const otherFile = join(claudeProjectDir(HOME, CWD), `${randomUUID()}.jsonl`);
  assert.equal((await authorize({ suppliedPath: otherFile }, harness)).result.reason, 'unexpected_location');
  assert.equal((await authorize({ suppliedPath: '/home/synthetic/.claude/projects/other/../x.jsonl' }, harness)).result.reason,
    'unexpected_location');
  assert.equal((await authorize({ suppliedCwd: '/home/synthetic/real-project' }, harness)).result.reason, 'cwd_mismatch');
  assert.deepEqual(harness.calls, []);
});

test('a paused state is refused before any source access', async () => {
  const harness = memoryFs({ files: { [claudePath]: { kind: 'file' } } });
  const { result, pauseChecks } = await authorize({}, harness, true);
  assert.deepEqual(result, { ok: false, reason: 'paused' });
  assert.equal(pauseChecks, 1);
  assert.deepEqual(harness.calls, []);
});

test('a symlink at the expected path is refused and never opened', async () => {
  const harness = memoryFs({ files: { [claudePath]: { kind: 'symlink' } } });
  const { result } = await authorize({}, harness);
  assert.deepEqual(result, { ok: false, reason: 'symlink' });
  assert.equal(harness.calls.some(([call]) => call === 'open'), false);
});

test('a symlinked ancestor or another owner is refused before the source is opened', async () => {
  const parent = claudeProjectDir(HOME, CWD);
  const linked = memoryFs({ files: { [claudePath]: { kind: 'file' } }, realpath: { [parent]: '/elsewhere' } });
  assert.equal((await authorize({}, linked)).result.reason, 'symlinked_parent');
  assert.deepEqual(linked.calls.map(([call]) => call), ['realpath']);
  const foreignOwner = memoryFs({ files: { [claudePath]: { kind: 'file', uid: 0 } } });
  assert.equal((await authorize({}, foreignOwner)).result.reason, 'foreign_owner');
  assert.equal(foreignOwner.calls.some(([call]) => call === 'open'), false);
});

test('an owned regular file is authorized with its identity, before anything is opened', async () => {
  const harness = memoryFs({ files: { [claudePath]: { kind: 'file', ino: 7 } } });
  const { result } = await authorize({}, harness);
  assert.equal(result.ok, true);
  assert.deepEqual(result.identity, { dev: 1, ino: 7 });
  assert.equal(harness.calls.some(([call]) => call === 'open'), false);
});

test('Codex ownership needs an observed binding inside the launch window and the exact rollout name', async () => {
  const { dir, stamp } = localRolloutStamp(START + 2_000);
  const rollout = join(HOME, '.codex', 'sessions', dir, `rollout-${stamp}-${threadId}.jsonl`);
  assert.ok(expectedSourcePaths('codex', HOME, ledger.runs[1].launch, threadId).includes(rollout));
  const harness = memoryFs({ files: { [rollout]: { kind: 'file' } } });
  const codex = overrides => authorizeSource({ host: 'codex', sessionId: threadId, suppliedPath: rollout, suppliedCwd: CWD,
    ledger, home: HOME, uid: 1000, fs: harness.fs, isPaused: async () => false, ...overrides });
  assert.equal((await codex({})).ok, true);
  const unbound = uuidV7(START + 3_000);
  assert.equal((await codex({ sessionId: unbound })).reason, 'not_a_harness_session');
  const early = { runs: [{ ...ledger.runs[1], binding: { ...ledger.runs[1].binding, threadId: uuidV7(START - 3_600_000) } }] };
  assert.equal(ownerLaunch(early, 'codex', early.runs[0].binding.threadId).reason, 'binding_outside_launch_window');
  const renamed = join(HOME, '.codex', 'sessions', dir, `rollout-${stamp}-${unbound}.jsonl`);
  assert.equal((await codex({ suppliedPath: renamed })).reason, 'unexpected_location');
});

test('on a real filesystem, a symlinked source is refused, and a swap after authorization is refused on the handle', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'f0-source-access-' });
  const home = join(workspace.path, 'home');
  const cwd = join(workspace.path, 'project');
  const sessionId = randomUUID();
  const realLedger = { runs: [{ host: 'claude', launch: { sessionId, cwd, startedAt: Date.now(), exitAt: null } }] };
  const dir = claudeProjectDir(home, cwd);
  mkdirSync(dir, { recursive: true });
  const foreign = join(workspace.path, 'foreign.jsonl');
  writeFileSync(foreign, '{"foreign":true}\n');
  const source = join(dir, `${sessionId}.jsonl`);
  symlinkSync(foreign, source);
  const request = { host: 'claude', sessionId, suppliedPath: source, suppliedCwd: cwd, ledger: realLedger, home,
    isPaused: async () => false };
  assert.equal((await authorizeSource(request)).reason, 'symlink');
  renameSync(source, `${source}.link`);
  writeFileSync(source, '{"owned":true}\n');
  const authorization = await authorizeSource(request);
  assert.equal(authorization.ok, true);
  renameSync(source, `${source}.real`);
  symlinkSync(foreign, source);
  await assert.rejects(openAuthorizedSource(authorization), error => error.code === 'ELOOP');
  // Another regular file renamed into place: opened, but its inode was not authorized.
  renameSync(source, `${source}.link2`);
  writeFileSync(`${source}.other`, '{"other":true}\n');
  renameSync(`${source}.other`, source);
  await assert.rejects(openAuthorizedSource(authorization), /source_changed/);
  // The original file back in place is accepted.
  renameSync(`${source}.real`, source);
  const handle = await openAuthorizedSource(authorization);
  await handle.close();
});
