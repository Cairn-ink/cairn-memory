// A real candidate, gated until a different candidate has published and owns
// the lifetime lock. The forwarder still supplies the unchanged fd-3 bootstrap.
import { access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { runCandidate, readBootstrap } from '../../local-daemon.mjs';
const bootstrap = await readBootstrap();
const deadline = performance.now() + 10000;
while (true) {
  try { await access(process.argv[2]); break; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (performance.now() >= deadline) throw Error('synthetic_candidate_gate_timeout');
  await delay(5);
}
const acquired = await runCandidate(bootstrap);
if (acquired !== false) throw Error('synthetic_candidate_must_lose');
process.stderr.write('synthetic_candidate_lost_lock\n');
