import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { observeHostedPause } from '../../hosted-pause.mjs';
import { hostedTargetId } from '../../transport-hosted.mjs';
import { withFileLock } from '../../file-lock.mjs';
import { stateLock } from '../../state-lock.mjs';
import { withWriteObserver } from '../../private-state.mjs';
import { readControlState } from '../../control-state.mjs';

// Hold both admission and control across their complete acquisition windows.
export async function interruptRotation(t, config, kind) {
  if (kind === 'timeout') {
    const gate = join(config.root, 'hosted-pause.gate');
    await withFileLock(join(config.root, 'control.lock'), async () => {
      const acquired = Promise.withResolvers(), release = Promise.withResolvers();
      const holder = stateLock(gate, async () => { acquired.resolve(); await release.promise; });
      await acquired.promise;
      try {
        await assert.rejects(withWriteObserver(async ({ path, kind }) => {
          if (kind === 'write' && (path.endsWith('/1.true.json') || path.includes('/hosted-pause-pending/'))) {
            release.resolve(); await holder;
          }
        }, () => observeHostedPause(config, 'synthetic-token')), /control_busy/);
      } finally { release.resolve(); await holder; }
    });
  } else {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./pause-intent-crash.mjs', import.meta.url)),
      config.root, config.endpoint], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const done = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
    t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await done; });
    let timer;
    try {
      await Promise.race([new Promise(resolve => child.on('message', event => {
        if (event.kind === 'intent-durable') resolve();
      })), done.then(() => { throw new Error('observer_exited_before_intent'); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('intent_deadline')), 5000); })]);
    } finally { clearTimeout(timer); }
    child.kill('SIGKILL');
    assert.deepEqual(await done, { code: null, signal: 'SIGKILL' });
  }
  assert.equal((await readControlState(config.root)).generation, 'initial', 'rotation_did_not_happen');
}
