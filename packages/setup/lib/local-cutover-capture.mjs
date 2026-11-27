import { join } from 'node:path';
import { canonicalPath, ownedDirectory, parseStrictJSON } from './local-descriptor.mjs';
import { cutoverRefusal } from './local-cutover-lease.mjs';
import { cutoverImport } from './local-cutover-runtime.mjs';

const { privateRead, privateWrite } = await cutoverImport('state');
const { stateLock } = await cutoverImport('lock');

const clients = [['claude', 'claude-code'], ['codex', 'codex']];
const disabled = record => JSON.stringify({ ...record, phase: 'disabled' }, null, 2) + '\n';

function captureRecord(text, directory, database, client) {
  const record = parseStrictJSON(text);
  if (record?.version !== 'local-raw-installation-v1' ||
      record.request?.installationDirectory !== directory || record.request.databasePath !== database ||
      record.request.client !== client || !['active', 'disabled', 'rearm_required'].includes(record.phase)) {
    throw cutoverRefusal('cutover_capture_pending');
  }
  return record;
}

// Pinned hooks already refuse a disabled installation record. Save the exact
// original first and keep the native settings, consent and SQL controls intact.
export async function withCutoverCapture(root, maintenance, database, restoring, work) {
  async function guard(index) {
    if (index === clients.length) return work();
    const [name, client] = clients[index];
    const directory = join(root, 'capture', name);
    const saved = join(maintenance, name + '.json');
    const original = await privateRead(saved, { missing: true });
    if (restoring && original === undefined) return guard(index + 1);
    if (!await ownedDirectory(directory, { missing: true })) {
      if (original !== undefined) throw cutoverRefusal('cutover_capture_changed');
      return guard(index + 1);
    }
    if (await canonicalPath(directory) !== directory) throw cutoverRefusal('cutover_capture_changed');
    return stateLock(join(directory, '.setup.lock'), async () => {
      const path = join(directory, 'installation.json');
      const current = await privateRead(path, { missing: true });
      if (original !== undefined) {
        const record = captureRecord(original, directory, database, client);
        const closed = disabled(record);
        if (record.phase !== 'active' || current !== original && current !== closed) {
          throw cutoverRefusal('cutover_capture_changed');
        }
        const desired = restoring ? original : closed;
        if (current !== desired) await privateWrite(path, desired);
      } else if (current !== undefined) {
        const record = captureRecord(current, directory, database, client);
        if (record.phase === 'active') {
          await privateWrite(saved, current, { exclusive: true });
          await privateWrite(path, disabled(record));
        }
      }
      return guard(index + 1);
    });
  }
  return guard(0);
}
