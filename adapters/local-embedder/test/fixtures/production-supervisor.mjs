import { fileURLToPath } from 'node:url';
import { runSupervisor } from '../../supervisor.mjs';
import { spawnNode } from '../../process.mjs';

// Only this test-owned wrapper supplies the child's IPC rendezvous channel.
await runSupervisor({ spawn() {
  const child = spawnNode(fileURLToPath(new URL('./production-child.mjs', import.meta.url)), [process.argv[2]], { stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'ipc'] });
  const forward = message => { if (child.connected) child.send(message, () => {}); };
  process.on('message', forward);
  child.on('message', message => { if (process.connected) process.send(message, () => {}); });
  child.on('close', () => { process.off('message', forward); if (process.connected) process.disconnect(); });
  return child;
} });
