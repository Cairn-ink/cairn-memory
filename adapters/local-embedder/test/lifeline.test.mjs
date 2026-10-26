import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { spawnNode } from '../process.mjs';

test('L08 child can exit with code 7 while the supervisor lifeline writer stays open', { timeout: 30000 }, async t => {
  const child = spawnNode(fileURLToPath(new URL('./fixtures/lifeline-exit.mjs', import.meta.url)), [], { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
  let closed = false;
  const exited = once(child, 'close').then(value => { closed = true; return value; });
  const lines = createInterface({ input: child.stdout });
  t.after(async () => {
    // Only this test's child is targeted; there is no supervisor or descendant.
    if (!closed) child.kill('SIGKILL');
    await exited;
    lines.close();
  });
  child.stderr.resume();
  assert.deepEqual(await once(lines, 'line'), ['lifeline-ready']);
  assert.equal(child.stdio[3].writableEnded, false);
  child.stdin.write('exit\n');
  assert.deepEqual(await exited, [7, null], 'exit must finish without closing the lifeline or sending a termination signal');
});
