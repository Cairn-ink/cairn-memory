// Test-only loader/IO seam; no production or packaged module imports this file.
import fs from 'node:fs/promises';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';

export async function cleanupSeam() {
  const target = new URL('../../local-daemon.mjs', import.meta.url);
  const hook = registerHooks({ load(url, context, next) {
    const result = next(url, context);
    if (url !== target.href + '?temp-scan-test') return result;
    const source = String(result.source).replace(
      'await cleanupTemps(directory, paths, code => log(code, false));',
      'await cleanupTemps(directory, paths, code => log(code, false)).catch(error => { cleanupError = error; throw error; });');
    return { ...result, source: source + '\nlet cleanupError; export { cleanupTemps, cleanupError };\n' };
  } });
  try { return await import(target.href + '?temp-scan-test'); }
  finally { hook.deregister(); }
}

if (process.argv[2] === 'child') {
  const [configuration] = await once(process, 'message');
  const { bootstrap, mode } = configuration, directoryPath = bootstrap.root + '/cairn-memory';
  const seam = await cleanupSeam();
  const send = event => process.send(event);
  const opendir = fs.opendir, lstat = fs.lstat;
  let changeDirectory = false, injected = false;
  fs.lstat = async (path, ...args) => {
    const info = await lstat(path, ...args);
    if (path === directoryPath && changeDirectory && !injected) {
      injected = true;
      // Model replacement of the pinned directory at the actual validation
      // boundary, without moving lifetime-lock bookkeeping underneath teardown.
      return new Proxy(info, { get(target, name) { return name === 'ino' ? target.ino + 1n : Reflect.get(target, name); } });
    }
    return info;
  };
  fs.opendir = async (...args) => {
    if (mode === 'opendir') { send({ kind: 'scan-error', operation: mode }); throw Object.assign(Error('synthetic'), { code: 'EMFILE' }); }
    const stream = await opendir(...args), read = stream.read.bind(stream), close = stream.close.bind(stream);
    let reads = 0;
    stream.read = async (...args) => {
      if (mode === 'read' && reads === 1) { send({ kind: 'scan-error', operation: mode, reads }); throw Object.assign(Error('synthetic'), { code: 'EIO' }); }
      const entry = await read(...args); reads++;
      if (mode === 'directory' && /\.stamp\.tmp-/.test(entry?.name ?? '')) changeDirectory = true;
      return entry;
    };
    stream.close = async (...args) => {
      send({ kind: 'scan-close-started', reads });
      await new Promise(resolve => setTimeout(resolve, 100));
      await close(...args); send({ kind: 'scan-close-completed', reads });
      if (mode === 'startup-directory') changeDirectory = true;
      if (mode === 'close') { send({ kind: 'scan-error', operation: mode }); throw Object.assign(Error('synthetic'), { code: 'EIO' }); }
    };
    return stream;
  };
  syncBuiltinESMExports();
  try {
    await seam.runCandidate(bootstrap, { afterLock: async () => { if (mode === 'validate') changeDirectory = true; } });
    send({ kind: 'candidate-done' });
  } catch (error) {
    send({ kind: 'startup-refused', code: error.code, sameObject: error === seam.cleanupError, stack: error.stack });
  } finally { process.disconnect(); }
}
