import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withFileLock } from '../client/file-lock.mjs';
import { privateWrite } from '../client/private-state.mjs';
import { readControlState } from '../client/control-state.mjs';

// Plugins that predate control.json, or a hand-made marker, pause with only the
// `paused` file and resume by deleting it. Deleting it alone would bring back the
// pre-pause generation as if no pause had happened, and text written meanwhile
// would follow. The first Codex observation keeps such a pause in control.json,
// under the generation it already reads as, so only an explicit resume lifts it
// and its generation barrier holds for every session.
export async function holdMarkerPause(root) {
  const acquired = await withFileLock(join(root, 'control.lock'), async () => {
    const control = await readControlState(root);
    if (!control.paused || !control.valid) return;
    let stored;
    try { stored = JSON.parse(await readFile(join(root, 'control.json'), 'utf8')); }
    catch (error) { if (error?.code !== 'ENOENT') return; }
    if (stored?.paused === true) return;
    await privateWrite(join(root, 'control.json'),
      JSON.stringify({ version: 1, paused: true, generation: control.generation }));
  }, { timeoutMs: 250, pollMs: 10 });
  if (!acquired) throw new Error('control_busy');
}
