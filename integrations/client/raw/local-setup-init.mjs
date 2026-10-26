import { open,lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { syncDirectory } from '../private-state.mjs';
import { directory } from './local-setup-files.mjs';
import { exact,absolute,runtime,fail,failure } from './local-setup-input.mjs';

// Only a brand-new, exclusively created empty store. Setup remains existing-only;
// no owner, consent, synthetic event or durable owner cap is manufactured here.
export async function initLocalRawStore(value) {
  try {
    runtime(); const { databasePath } = exact(value,['databasePath']); if (!absolute(databasePath)) fail('invalid_input');
    await directory(dirname(databasePath),true);
    let file,identity;
    try {
      file = await open(databasePath,'wx',0o600); identity = await file.stat(); await file.sync();
    } catch (error) { if (error.code === 'EEXIST') fail('store_invalid'); throw error; }
    finally { await file?.close(); }
    await syncDirectory(dirname(databasePath));
    const before = await lstat(databasePath);
    if (before.dev !== identity.dev || before.ino !== identity.ino || before.size !== 0 || !before.isFile() || before.isSymbolicLink()) fail('store_invalid');
    const { openMemoryCore } = await import('../../../core/index.mjs');
    const core = openMemoryCore({ path:databasePath,rawConversations:{ mode:'off',configureCap:false,
      readPolicy:() => ({ generation:'local-setup-init-v1',reason:'tool_off' }) } });
    try {
      const after = await lstat(databasePath);
      if (after.dev !== identity.dev || after.ino !== identity.ino) fail('store_invalid');
    } finally { await core.close(); }
    return Object.freeze({ version:'local-raw-init-v1',status:'initialized',reason:null });
  } catch (error) {
    const result = failure(error); return Object.freeze({ version:'local-raw-init-v1',status:'blocked',reason:result.reason });
  }
}
