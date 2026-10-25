// Qualification guard only; the primary's external queue issues this lease.
import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absolutePath, closed, strictJSON, HASH } from '../../adapters/local-embedder/common.mjs';
export async function assertLocalQualificationAdmission(env, { now = Date.now, read = readFile, inspect = lstat } = {}) {
  const path = absolutePath(env.CAIRN_QUAL_ADMISSION), versions = ['22.16.0', '24.15.0'];
  if (!versions.includes(env.CAIRN_QUAL_EXPECTED_NODE) || process.versions.node !== env.CAIRN_QUAL_EXPECTED_NODE ||
      !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') || !HASH.test(env.CAIRN_QUAL_MANIFEST ?? '') ||
      !['linux:x64', 'darwin:arm64'].includes(process.platform + ':' + process.arch)) throw Error('qualification_not_admitted');
  absolutePath(env.CAIRN_QUAL_PACK);
  const stat = await inspect(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096 || stat.nlink !== 1 ||
      process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)) throw Error('qualification_not_admitted');
  const lease = strictJSON(await read(path));
  closed(lease, ['commit', 'node', 'platform', 'arch', 'expiresAt', 'exclusive']);
  if (Object.keys(lease).length !== 6 || lease.commit !== env.GITHUB_SHA || lease.node !== process.versions.node ||
      lease.platform !== process.platform || lease.arch !== process.arch || lease.exclusive !== true ||
      !Number.isSafeInteger(lease.expiresAt) || lease.expiresAt <= now()) throw Error('qualification_not_admitted');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await assertLocalQualificationAdmission(process.env); }
  catch { console.error('cairn_local_embedder_qualification_not_admitted'); process.exitCode = 1; }
}
