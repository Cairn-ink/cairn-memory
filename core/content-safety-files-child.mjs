// Run only in a SQLite-free child. Never return file bytes, paths or error text.
import { constants, openSync, closeSync, fstatSync, lstatSync, readSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Refuse imports before stdin or any database file can be opened.
if (!process.argv[1] || pathToFileURL(process.argv[1]).href !== import.meta.url) throw Error('child_entry_required');

const identity = stat => Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']
  .map(key => [key, String(stat[key])]));
let output;
try {
  const { path, maxBytes } = JSON.parse(readFileSync(0, 'utf8'));
  if (typeof path !== 'string' || !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw Error();
  let remaining = maxBytes;
  output = ['', '-wal', '-journal', '-shm'].map(suffix => {
    let initial;
    try { initial = lstatSync(path + suffix, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT') return { present: false }; throw error; }
    if (!initial.isFile() || initial.isSymbolicLink() || initial.size > BigInt(remaining)) throw Error();
    const before = identity(initial), hash = createHash('sha256');
    const fd = openSync(path + suffix, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (JSON.stringify(identity(fstatSync(fd, { bigint: true }))) !== JSON.stringify(before)) throw Error();
      const buffer = Buffer.alloc(65536); let total = 0, count;
      while ((count = readSync(fd, buffer, 0, buffer.length, null))) {
        total += count;
        if (total > remaining) throw Error();
        hash.update(buffer.subarray(0, count));
      }
      if (BigInt(total) !== initial.size || JSON.stringify(identity(fstatSync(fd, { bigint: true }))) !== JSON.stringify(before) ||
          JSON.stringify(identity(lstatSync(path + suffix, { bigint: true }))) !== JSON.stringify(before)) throw Error();
      remaining -= total;
      return { present: true, ...before, sha256: hash.digest('hex') };
    } finally { closeSync(fd); }
  });
} catch { output = null; }
process.stdout.write(JSON.stringify(output));
