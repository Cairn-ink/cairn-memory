import { join } from 'node:path';
import { privateRead, privateWrite } from './private-state.mjs';
import { stateLock } from './state-lock.mjs';
import { rotateAutomaticBoundary } from './automatic-policy.mjs';
import { conforms } from './hosted-contract.mjs';
import { hostedTargetId } from './transport-hosted.mjs';

// H5 source evidence: cairn-wiki origin/main app/api/memory/pause-state/route.ts.
// A missing, unenforced or regressing state never authorizes capture/injection.
export async function observeHostedPause(config, token, signal) {
  signal?.throwIfAborted();
  const response = await fetch(config.endpoint + '/api/memory/pause-state', {
    headers: { authorization: `Bearer ${token}`, 'cache-control': 'no-store' },
    redirect: 'error', signal,
  });
  if (response.status !== 200) throw new Error('pause_unavailable');
  const reader = response.body.getReader();
  let length = 0; const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) throw new Error('pause_unavailable');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const remote = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!conforms('pause-state', remote) || !remote.enforced) throw new Error('pause_unavailable');
  const file = join(config.root, 'hosted-pause', hostedTargetId(config) + '.json');
  const observed = await stateLock(file + '.lock', async () => {
    signal?.throwIfAborted();
    const bytes = await privateRead(file, { missing: true });
    const previous = bytes === undefined ? null : JSON.parse(bytes);
    if (previous && (!conforms('pause-state', previous) || !previous.enforced ||
        remote.generation < previous.generation ||
        (remote.generation === previous.generation && remote.paused && !previous.paused))) {
      throw new Error('pause_unavailable');
    }
    // Rotate the shared LOCAL barrier once per observed hosted pause. Do not
    // clear a pause the user established locally; hosted state is a separate gate.
    if ((!previous && remote.generation > 0) ||
        (previous && remote.generation !== previous.generation)) {
      await rotateAutomaticBoundary(config.root);
    }
    await privateWrite(file, JSON.stringify(remote));
    return remote;
  });
  if (!observed) throw new Error('pause_unavailable');
  return observed;
}
