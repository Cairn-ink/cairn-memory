// Holds one root's pause gate after its final synchronous checks, then sends.
// The parent resumes it with SIGCONT. Synthetic text and loopback only.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename } from 'node:path';
import { withHostedPauseGate } from '../../hosted-pause.mjs';
import { startIfActive } from '../../control-state.mjs';

const [root, endpoint, ready] = process.argv.slice(2);
const nativeLstat = fs.lstatSync;
let stopped = false;
fs.lstatSync = function(path, ...args) {
  try { return nativeLstat.call(this, path, ...args); }
  catch (error) {
    if (!stopped && error.code === 'ENOENT' && basename(String(path)) === 'hosted-pause-rotation.json') {
      stopped = true;
      // The root rotation probe is the last authority read before start. Model
      // preemption here without adding an await or changing runtime source.
      fs.writeFileSync(ready, 'ready', { mode: 0o600 });
      process.kill(process.pid, 'SIGSTOP');
    }
    throw error;
  }
};
syncBuiltinESMExports();
try {
  const result = await withHostedPauseGate({ root, endpoint }, 0,
    guard => startIfActive(root, 'initial', () =>
      fetch(endpoint + '/capture', { method: 'POST', body: 'synthetic text' }),
    { guard }), { deadlineMs: performance.now() + 15000 });
  await result.operation;
  process.send?.({ kind: 'done', started: result.started });
} catch (error) {
  process.send?.({ kind: 'failed', error: error.message });
  process.exitCode = 1;
}
process.disconnect();
