import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withFileLock } from '../client/file-lock.mjs';
import { privateWrite } from '../client/private-state.mjs';
import { readControlState } from '../client/control-state.mjs';
import { sessionStartedAt } from './parser.mjs';

// When the active control generation took effect: an optional control.json field
// that only the Codex installer writes. Every shared pause, resume and rotation
// rewrites control.json without it, so it never outlives the generation it was
// stamped for. A control without it keeps the pause boundary for unseen sessions.
const controlPath = root => join(root, 'control.json');

async function stamped(root, control) {
  if (control.paused || !control.valid || control.generation === 'initial') return null;
  try {
    const value = JSON.parse(await readFile(controlPath(root), 'utf8'));
    return value?.version === 1 && value.paused === false && value.generation === control.generation &&
      Number.isSafeInteger(value.activeSince) && value.activeSince > 0 ? value.activeSince : null;
  } catch { return null; }
}

// A later stamp only skips more; an earlier one could admit text written while
// paused. So stamp an active generation once, at or after the moment it took effect.
export async function markActive(root, { now = Date.now } = {}) {
  let since = null;
  const acquired = await withFileLock(join(root, 'control.lock'), async () => {
    const control = await readControlState(root);
    since = await stamped(root, control);
    if (since !== null || control.paused || !control.valid || control.generation === 'initial') return;
    since = now();
    await privateWrite(controlPath(root), JSON.stringify({ version: 1, paused: false,
      generation: control.generation, activeSince: since }));
  }, { timeoutMs: 2_000, pollMs: 25 });
  if (!acquired) throw new Error('control_busy');
  return since;
}

// An unseen session is new to the active generation only when its rollout began
// after the generation took effect. Unknown on either side keeps the boundary.
export async function startedWhileActive(root, control, header, sessionId) {
  const since = await stamped(root, control);
  const started = sessionStartedAt(header, sessionId);
  return since !== null && started !== null && started > since;
}
