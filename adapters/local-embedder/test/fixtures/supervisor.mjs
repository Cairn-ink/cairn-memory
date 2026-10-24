import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { runSupervisor } from '../../supervisor.mjs';
globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };
let inference;
// Registered before the production handler, this durable observation proves
// the supervisor ran after caller EOF even if cleanup wins the harness's turn.
if (process.argv[4]) process.stdin.once('end', () => writeFileSync(process.argv[4] + '.supervisor-eof', JSON.stringify({ supervisor: process.pid, inference })));
await runSupervisor({ runner: fileURLToPath(new URL('./inference.mjs', import.meta.url)), args: process.argv.slice(2), onSpawn: async pid => {
  inference = pid;
  if (process.argv[3] === 'registration-race') {
    await writeFile(process.argv[4], JSON.stringify({ pid }));
    while (!process.stdin.destroyed) await delay(20);
  }
} });
