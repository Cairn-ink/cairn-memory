import { appendFileSync } from 'node:fs';
import { runInferenceChild } from '../../child.mjs';
import { resolutionGuard } from '../../runtime.mjs';

const root = process.argv[2], log = value => appendFileSync(root + '.events', JSON.stringify(value) + '\n');
globalThis.fetch = () => { throw Error('NETWORK_FORBIDDEN'); };
globalThis.fixtureEvent = log;
globalThis.fixtureGate = stage => new Promise(resolve => {
  log({ stage });
  process.once('message', value => { if (value !== stage) throw Error('rendezvous_mismatch'); resolve(); });
  process.send({ stage });
});
const dlopen = process.dlopen;
process.dlopen = function(module, path, ...args) {
  log({ nativeLoad: path }); return dlopen.call(this, module, path, ...args);
};
runInferenceChild(root, { checkpoint: globalThis.fixtureGate,
  makeGuard(pack) {
    log({ guardCreated: true });
    const guard = resolutionGuard(pack, { attempt: (url, binding) => log({ resolution: url, binding }) });
    return { close: () => guard.close(), assert() {
      try { guard.assert(); }
      catch (error) {
        let repeated; try { guard.assert(); } catch (again) { repeated = again.code; }
        log({ latch: error.code, repeated }); throw error;
      }
    } };
  },
  async onStopped() { log({ stopped: true }); if (process.connected) process.disconnect(); }
});
