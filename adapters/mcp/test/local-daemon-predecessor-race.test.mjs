import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { workspace, until, ok } from './local-daemon-support.mjs';

test('a contender reaps the unpublished owner displaced after its absent-lock observation', { timeout: 18000 }, async t => {
  const w = await workspace(t), bootstrap = await w.bootstrap();
  const contender = w.child({ role: 'candidate', bootstrap, beforeLifetimeAcquisition: true });
  contender.release();
  await until(() => contender.messages.some(m => m.kind === 'lifetime-acquisition-pending'), 'contender observed no lock before first acquisition attempt');
  assert.equal((await readdir(join(w.root, 'run', 'cairn-memory'))).filter(n => /^d-.*\.lock$/.test(n)).length, 0);
  const predecessor = w.child({ role: 'candidate', bootstrap, unpublishedSocket: 'pause' });
  predecessor.release();
  await until(() => predecessor.messages.some(m => m.kind === 'socket-bound-unpublished'), 'intervening owner binds without publishing');
  assert.equal(await w.descriptor(), undefined);
  predecessor.process.kill('SIGKILL'); await until(() => predecessor.exit, 'intervening candidate actual death');
  assert.equal(predecessor.exit.signal, 'SIGKILL');
  contender.process.send({ kind: 'release-lifetime-acquisition' });
  const result = await until(async () => await w.descriptor() || contender.exit, 'contender publishes or records its refusal');
  assert.equal(result.owner?.pid, contender.process.pid, JSON.stringify(result));
  const session = w.forward(); session.release();
  assert.equal((await w.connect(session)).owner.pid, contender.process.pid);
  assert.equal(session.messages.filter(m => m.kind === 'candidate').length, 0);
  ok(await session.tool('remember_memory', { content: 'synthetic displaced predecessor recovery', kind: 'fact' }));
});
