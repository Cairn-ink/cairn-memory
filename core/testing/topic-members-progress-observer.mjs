// Test-only instrumentation of the real public Worker. No runtime hook or DTO
// field is shipped. The loader adds observers to existing dependency seams.
import { registerHooks } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

if (workerData.freezeProgressClock) Object.defineProperty(performance, 'now', { value: () => 100 });
const symbol = Symbol.for('e1m-test-progress');
const readerUrl = new URL('../topic-members-reader.mjs', import.meta.url).href;
const own = (object, name) => Object.hasOwn(object, name);
function position(data) {
  if (!data) return null;
  const s = data.initialization;
  return {
    opening: { phase: s.phase, position: s.position, after: s.after, offset: s.offset ?? 0,
      fragment: own(s, 'fragment') ? s.fragment.length : null, rows: Boolean(s.rows), done: s.done },
    member: { phase: data.phase, started: Boolean(data.started), after: Boolean(data.after),
      refAfter: Boolean(data.refAfter), attribution: Boolean(data.attribution), pending: Boolean(data.pending), done: data.done },
  };
}
let accepted, provisional, previous = null, used = 0, steps = [];
globalThis[symbol] = {
  attach(storage, observe, accept) {
    return {
      storage: { ...storage,
        create() { provisional = storage.create(); return provisional; },
        step(data, ...args) {
          provisional = data;
          const before = position(data), cost = storage.cost(data);
          storage.step(data, ...args);
          steps.push({ cost, before, after: position(data) });
        } },
      observe(event) { used = event.used; observe(event); },
      accept(data) { accept(data); accepted = structuredClone(data); },
    };
  },
};
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== readerUrl) return result;
  const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString();
  if (!source.includes('  let traversal;')) throw Error('member_progress_observer_anchor_missing');
  return { ...result, source: source.replace('  let traversal;', `  let traversal;
  ({ storage, observe, accept } = globalThis[Symbol.for('e1m-test-progress')].attach(storage, observe, accept));`) };
} });
const post = parentPort.postMessage.bind(parentPort);
parentPort.postMessage = result => {
  const current = position(accepted);
  workerData.progressPort.postMessage({ used, before: previous, after: current, tentative: position(provisional), steps });
  previous = current; used = 0; steps = [];
  return post(result);
};
