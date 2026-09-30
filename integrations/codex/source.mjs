import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';

// The caller supplies the one authorized source on every invocation. No enumeration.
// Linux fd-relative traversal prevents a swapped parent from redirecting the read.
export async function openSource(path) {
  if (process.platform !== 'linux') throw new Error('source_platform_unverified');
  if (typeof path !== 'string' || !isAbsolute(path) || normalize(path) !== path ||
      path.length > 8192 || path.includes('\0')) throw new Error('invalid_source_path');
  let parent = await open('/', constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    const components = path.slice(1).split('/');
    for (let i=0; i<components.length; i++) {
      const last = i === components.length-1;
      const child = await open(`/proc/self/fd/${parent.fd}/${components[i]}`,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK |
        (last ? 0 : constants.O_DIRECTORY));
      await parent.close(); parent = child;
    }
    const stat = await parent.stat();
    if (!stat.isFile() || (typeof process.getuid === 'function' && stat.uid !== process.getuid()) ||
        !Number.isSafeInteger(stat.size)) throw new Error('invalid_source_file');
    return parent;
  } catch (error) { await parent.close(); throw error; }
}

export async function readBytes(file,start,end) {
  const buffer = Buffer.alloc(end-start);
  let read = 0;
  while (read < buffer.length) {
    const result = await file.read(buffer,read,buffer.length-read,start+read);
    if (!result.bytesRead) throw new Error('source_changed');
    read += result.bytesRead;
  }
  return buffer;
}
