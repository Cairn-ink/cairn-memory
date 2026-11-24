import { createHash } from 'node:crypto';

const prefix = 'core-local-v1';
const digestPattern = /^[0-9a-f]{64}$/u;
const pathPattern = /^(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/u;

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function engineIdForCoreLocal(fileDigests) {
  const entries = Object.entries(fileDigests).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  if (!Object.hasOwn(fileDigests, 'package.json') || entries.some(([path, digest]) =>
    !pathPattern.test(path) || typeof digest !== 'string' || !digestPattern.test(digest))) {
    throw new Error('invalid_core_local_file_digests');
  }
  return `${prefix}-${sha256(JSON.stringify([prefix, entries]))}`;
}
