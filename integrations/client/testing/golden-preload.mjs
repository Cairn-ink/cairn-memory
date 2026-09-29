// Synthetic deterministic source; never loaded by production.
import crypto from 'node:crypto';
import os from 'node:os';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
crypto.randomUUID = () => '11111111-1111-4111-8111-111111111111';
if (process.env.CAIRN_TEST_FALSY_HOME === 'yes') os.homedir = () => '';
syncBuiltinESMExports();
globalThis.fetch = async (url, options) => {
  appendFileSync(process.env.CAIRN_TEST_REQUESTS, JSON.stringify({ url, method: options.method, headers: options.headers, body: options.body }) + '\n');
  return Response.json(url.endsWith('/recall') ? { memories: [] } : { duplicate: false, memoryCount: 1 });
};
