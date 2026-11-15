import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

// Patch the builtin binding, including the imports at the actual comparison
// points. Regular-file stats are returned untouched. No production test hook.
export function apfs(t) {
  const original = fs.lstatSync;
  const samples = [];
  fs.lstatSync = (path, options) => {
    const stat = original(path, options);
    if (stat.isDirectory()) {
      const count = 2 + fs.readdirSync(path).length;
      stat.nlink = typeof stat.nlink === 'bigint' ? BigInt(count) : count;
      samples.push({ path: String(path), nlink: Number(stat.nlink) });
    }
    return stat;
  };
  syncBuiltinESMExports();
  t.after(() => { fs.lstatSync = original; syncBuiltinESMExports(); });
  return samples;
}
