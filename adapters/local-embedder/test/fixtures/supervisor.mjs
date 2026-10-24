import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { runSupervisor } from '../../supervisor.mjs';
globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };
await runSupervisor({ runner: fileURLToPath(new URL('./inference.mjs', import.meta.url)), args: process.argv.slice(2), onSpawn: async pid => {
  if (process.argv[3] === 'registration-race') {
    await writeFile(process.argv[4], JSON.stringify({ pid }));
    while (!process.stdin.destroyed) await delay(20);
  }
} });
