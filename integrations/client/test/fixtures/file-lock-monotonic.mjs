// Owned child only; production clocks and lock ownership have no test injection.
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { withFileLock } from '../../file-lock.mjs';
const [path,mode] = process.argv.slice(2), now = Date.now();
writeFileSync(path,JSON.stringify({ pid:process.pid,token:randomUUID() }),{ flag:'wx',mode:0o600 });
let reads = 0;
if (mode === 'frozen') Date.now = () => now;
if (mode === 'rollback') Date.now = () => ++reads === 1 ? now : now-3600000;
process.stdout.write('entered\n');
const start = performance.now();
const acquired = await withFileLock(path,() => { throw Error('must_not_acquire_live_owner'); },{ timeoutMs:50,pollMs:5 });
process.stdout.write(JSON.stringify({ acquired,elapsed:performance.now()-start })+'\n');
