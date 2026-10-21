// Owned test process only: the production worker has no clock/test injection.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
const settings = JSON.parse(readFileSync(process.argv[2],'utf8'));
if (settings.clock !== undefined) Date.now = () => settings.clock;
let elapsed = 0;
if (settings.exhaustAt) { const now = performance.now.bind(performance); performance.now = () => now()+elapsed; }
const { createLocalRawWorker } = await import('../../raw/local-worker.mjs');
const worker = createLocalRawWorker(settings.options);
const { withWriteObserver } = await import('../../private-state.mjs');
const result = await withWriteObserver(({ path }) => {
  if ((!settings.crashAt && !settings.exhaustAt) || !path.endsWith('.json') || path.endsWith('.claim.json') || path.endsWith('/root.json')) return;
  const cursor = JSON.parse(readFileSync(path,'utf8'));
  if (settings.exhaustAt === 'prepared' && cursor.pending?.attempts === 0) elapsed = 153001;
  if (settings.crashAt && (settings.crashAt === 'prepared' ? cursor.pending?.attempts === 0 : cursor.pending?.state === 'dispatched')) process.kill(process.pid,'SIGKILL');
},() => worker[settings.action](settings.context));
process.stdout.write(JSON.stringify(result)+'\n');
