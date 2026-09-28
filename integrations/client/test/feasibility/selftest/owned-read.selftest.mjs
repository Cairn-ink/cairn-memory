// Offline self-test for the interactive driver's transcript reads: every poll is
// authorized from the ledger and read through a verified O_NOFOLLOW handle, so a
// transcript (or its parent) swapped for a symlink while polling is refused and
// the symlink's target is never read.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { appendFileSync, mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../../../../tools/testing/workspace.mjs';
import { createWaiter } from '../lib/private-tmux.mjs';
import { claudeProjectDir, readOwnedSource } from '../lib/source-access.mjs';
import { createInterruptGuard } from '../lib/supervise.mjs';

/** The real filesystem, recording every call; `afterLstat` can swap entries at the worst moment. */
function recordingFs({ afterLstat } = {}) {
  const calls = [];
  return { calls, fs: {
    realpath: async path => { calls.push(['realpath', path]); return realpath(path); },
    lstat: async path => {
      calls.push(['lstat', path]);
      const stat = await lstat(path);
      afterLstat?.(path);
      return stat;
    },
    open: async (path, flags) => {
      calls.push(['open', path]);
      const handle = await open(path, flags);
      return { stat: () => handle.stat(), close: () => handle.close(),
        read: (...args) => { calls.push(['read', path]); return handle.read(...args); } };
    },
  } };
}

function setup(t) {
  const workspace = createTestWorkspace(t, { prefix: 'f0-owned-read-' });
  const home = join(workspace.path, 'home');
  const cwd = join(workspace.path, 'project');
  const sessionId = randomUUID();
  const ledger = { runs: [{ host: 'claude', launch: { sessionId, cwd, startedAt: Date.now(), exitAt: null } }] };
  const dir = claudeProjectDir(home, cwd);
  const path = join(dir, `${sessionId}.jsonl`);
  // Foreign content with the same file name, standing in for someone else's transcript.
  const foreignDir = join(workspace.path, 'foreign');
  mkdirSync(foreignDir);
  const foreign = join(foreignDir, `${sessionId}.jsonl`);
  writeFileSync(foreign, '{"FOREIGN":true}\n');
  const read = fs => readOwnedSource({ host: 'claude', sessionId, path, cwd, ledger, home, fs });
  return { dir, path, foreign, foreignDir, read };
}

const touched = (calls, path) => calls.filter(([call, target]) => (call === 'open' || call === 'read') && target === path);

test('an absent transcript reads as empty and a regular one is read in full on each poll', async t => {
  const run = setup(t);
  const recording = recordingFs();
  assert.equal(await run.read(recording.fs), '');
  mkdirSync(run.dir, { recursive: true });
  assert.equal(await run.read(recording.fs), '');
  assert.equal(recording.calls.some(([call]) => call === 'open'), false);
  writeFileSync(run.path, '{"n":1}\n');
  assert.equal(await run.read(recording.fs), '{"n":1}\n');
  appendFileSync(run.path, '{"n":2}\n');
  assert.equal(await run.read(recording.fs), '{"n":1}\n{"n":2}\n');
});

test('a transcript swapped for a symlink during polling stops the poll without reading the target', async t => {
  const run = setup(t);
  mkdirSync(run.dir, { recursive: true });
  writeFileSync(run.path, '{"owned":1}\n');
  const recording = recordingFs();
  const waitFor = createWaiter({ guard: createInterruptGuard({ signals: new EventEmitter() }), deadline: Date.now() + 5_000,
    intervalMs: 20 });
  let polls = 0;
  const poll = waitFor(async () => {
    if (++polls === 3) { renameSync(run.path, `${run.path}.moved`); symlinkSync(run.foreign, run.path); }
    return (await run.read(recording.fs)).includes('FOREIGN');
  }, 5_000, 'reply');
  await assert.rejects(poll, /source_refused:symlink$/);
  assert.equal(polls, 3);
  assert.equal(touched(recording.calls, run.path).filter(([call]) => call === 'read').length, 2, 'only the two owned polls read');
  const afterSwap = recording.calls.slice(recording.calls.findLastIndex(([call]) => call === 'realpath'));
  assert.deepEqual(afterSwap.map(([call]) => call), ['realpath', 'lstat']);
  assert.deepEqual(touched(recording.calls, run.foreign), []);
});

test('a parent swapped for a symlink during polling stops the poll without reading the target', async t => {
  const run = setup(t);
  mkdirSync(run.dir, { recursive: true });
  writeFileSync(run.path, '{"owned":1}\n');
  const recording = recordingFs();
  assert.equal(await run.read(recording.fs), '{"owned":1}\n');
  renameSync(run.dir, `${run.dir}.moved`);
  symlinkSync(run.foreignDir, run.dir);
  const before = recording.calls.length;
  await assert.rejects(run.read(recording.fs), /source_refused:symlinked_parent$/);
  assert.deepEqual(recording.calls.slice(before), [['realpath', run.dir]]);
  assert.deepEqual(touched(recording.calls, run.foreign), []);
});

test('a swap between the check and the open is refused on the handle, before any read', async t => {
  // The transcript itself: O_NOFOLLOW refuses the final symlink, so the target is never opened.
  const file = setup(t);
  mkdirSync(file.dir, { recursive: true });
  writeFileSync(file.path, '{"owned":1}\n');
  const swapFile = recordingFs({ afterLstat: path => {
    if (path !== file.path) return;
    renameSync(file.path, `${file.path}.moved`);
    symlinkSync(file.foreign, file.path);
  } });
  await assert.rejects(file.read(swapFile.fs), error => error.code === 'ELOOP');
  assert.equal(swapFile.calls.some(([call]) => call === 'read'), false);

  // Its parent: the open follows the new parent, and the inode check closes that handle unread.
  const parent = setup(t);
  mkdirSync(parent.dir, { recursive: true });
  writeFileSync(parent.path, '{"owned":1}\n');
  const swapParent = recordingFs({ afterLstat: path => {
    if (path !== parent.path) return;
    renameSync(parent.dir, `${parent.dir}.moved`);
    symlinkSync(parent.foreignDir, parent.dir);
  } });
  await assert.rejects(parent.read(swapParent.fs), /source_changed/);
  assert.equal(swapParent.calls.some(([call]) => call === 'read'), false);
});
