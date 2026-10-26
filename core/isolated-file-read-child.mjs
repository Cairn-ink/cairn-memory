// This script must run only as a child with no SQLite connections.
import { constants, openSync, closeSync, fstatSync, readSync, readFileSync } from 'node:fs';

const keys = ['dev', 'ino', 'mode', 'size', 'nlink', 'mtimeNs', 'ctimeNs'];
const identity = stat => Object.fromEntries(keys.map(key => [key, stat[key].toString()]));
const failure = error => error.message === 'invalid_input' ? { invalid: true } : {
  error: Object.fromEntries(['name', 'message', 'code', 'errno', 'syscall', 'path']
    .filter(key => error[key] !== undefined).map(key => [key, error[key]])),
};
let fd, output;
try {
  const { path, maximum, expected } = JSON.parse(readFileSync(0, 'utf8'));
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 67108864) throw Error('invalid_input');
  fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  const initial = fstatSync(fd, { bigint: true });
  const stat = identity(initial);
  const verify = () => {
    const current = fstatSync(fd, { bigint: true });
    if (!current.isFile() || expected &&
        keys.some(key => current[key].toString() !== stat[key] || stat[key] !== expected[key])) throw Error('invalid_input');
  };
  verify();
  const chunks = []; let total = 0;
  while (total <= maximum) {
    verify();
    const chunk = Buffer.alloc(Math.min(65536, maximum + 1 - total));
    const count = readSync(fd, chunk, 0, chunk.length, null);
    verify();
    if (!count) break;
    total += count; chunks.push(chunk.subarray(0, count));
  }
  if (total > maximum || expected && BigInt(total) !== initial.size) throw Error('invalid_input');
  output = { bytes: Buffer.concat(chunks, total).toString('base64'), stat };
} catch (error) {
  output = failure(error);
} finally {
  if (fd !== undefined) {
    try { closeSync(fd); } catch (error) { output = failure(error); }
  }
}
process.stdout.write(JSON.stringify(output));
