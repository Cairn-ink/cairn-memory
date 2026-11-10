import { deferred } from '../../../../tools/testing/deferred.mjs';
// Separate processes share real pause files and locks; only their clocks and
// rendezvous are synthetic. No durable write or fsync is replaced.
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { observeHostedPause, withHostedPauseGate } from '../../hosted-pause.mjs';
import { hostedTargetId } from '../../transport-hosted.mjs';
import { startIfActive, runIfActive } from '../../control-state.mjs';
import { withWriteObserver } from '../../private-state.mjs';
const [role, root, sink] = process.argv.slice(2);
const a = { root, endpoint: 'http://127.0.0.1:1' }, b = { root, endpoint: 'http://127.0.0.1:2' };
let clock = role === 'publisher' ? 0 : 200;
Object.defineProperty(performance, 'now', { value: () => clock });
const commands = new Map();
process.on('message', ({ kind, time }) => {
  if (time !== undefined) clock = time;
  commands.get(kind)?.resolve();
});
function wait(kind) {
  const deferred = deferred(); commands.set(kind, deferred); return deferred.promise;
}
const notify = (kind, details = {}) => process.send({ kind, ...details });
try {
  if (role === 'publisher') {
    globalThis.fetch = async () => Response.json({ paused: true, generation: 1, enforced: true });
    const nativeLink = fs.link;
    let hits = 0, durableNotified = false;
    fs.link = async function (source, destination) {
      try { return await nativeLink.call(this, source, destination); }
      catch (error) {
        if (destination === join(root, 'hosted-pause.gate') && error.code === 'EEXIST' && hits++ === 0) {
          const release = wait('release-waiter'); notify('waiter'); await release;
        }
        throw error;
      }
    };
    syncBuiltinESMExports();
    await withWriteObserver(async ({ path, kind }) => {
      if (!durableNotified && kind === 'write' && (path.endsWith('/1.true.json') || path.includes('/hosted-pause-pending/'))) {
        durableNotified = true;
        const release = wait('continue-publisher'); notify('durable'); await release;
      }
    }, () => observeHostedPause(a, 'synthetic-token'));
    notify('done');
  } else {
    const nativeOpen = fs.open;
    let held = false, starts = 0;
    fs.open = async function (path, ...args) {
      const handle = await nativeOpen.call(this, path, ...args);
      if (!held && String(path) === join(root, 'hosted-pause', hostedTargetId(b) + '.json') &&
          await fs.stat(join(root, 'control.lock')).then(() => true, () => false)) {
        held = true;
        const release = wait('release-final'); notify('selected'); await release;
      }
      return handle;
    };
    syncBuiltinESMExports();
    const result = await withHostedPauseGate(b, 0, guard => sink === 'request'
      ? startIfActive(root, 'initial', () => { starts++; }, { guard })
      : runIfActive(root, 'initial', () => { starts++; }, { guard }))
      .then(() => ({}), error => ({ error: error.message }));
    notify('done', { starts, ...result });
  }
} catch (error) { notify('failed', { error: error.message }); process.exitCode = 1; }
process.disconnect();
