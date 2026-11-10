import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
const send = (kind, data = {}) => process.send?.({ kind, ms: performance.now(), ...data });
const originalRead = fs.readFile;
let prepared = false, fetched = false;
fs.readFile = async function(path, ...args) {
  const result = await originalRead.call(this, path, ...args);
  if (!prepared && String(path).endsWith('/project-key')) {
    prepared = true;
    await delay(Math.max(0, 500 - performance.now()));
    send('preparation');
  }
  return result;
};
const originalLink = fs.link;
fs.link = async function(source, target) {
  if (fetched && (String(target).endsWith('.gate') || String(target).endsWith('/control.lock'))) {
    send('output-admission');
    if (process.env.CAIRN_TEST_OUTPUT_CONTENDED === 'true') {
      // Actual lock acquisition keeps retrying against a live holder, represented
      // by the parent. This flag only records admission; it does not delay it.
      send('output-contended-attempt');
    }
  }
  return originalLink.call(this, source, target);
};
syncBuiltinESMExports();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const route = new URL(url).pathname.split('/').at(-1);
  if (new URL(url).hostname !== '127.0.0.1') throw new Error('loopback_only');
  send(route);
  if (route === 'recall') {
    fetched = true;
    // A synthetic response clock starts at fetch entry, avoiding loopback
    // request/header latency consuming the one-millisecond HTTP boundary case.
    const response = Response.json({ memories: [JSON.parse(process.env.CAIRN_TEST_TAIL_MEMORY)] });
    await delay(Number(process.env.CAIRN_TEST_TAIL_RESPONSE_MS), undefined, { signal: options.signal });
    send('recall-response');
    return response;
  }
  return originalFetch(url, options);
};
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...args) => {
  send('write-start', { bytes: Buffer.byteLength(chunk) });
  const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined;
  return originalWrite(chunk, ...args, error => {
    send('write-complete', { failed: Boolean(error) }); callback?.(error);
  });
};
send('origin', { wallOrigin: Number(process.hrtime.bigint()) / 1e6 - performance.now() });
process.channel?.unref();
