// Test-only host: loader fence covers every subsequently imported runtime file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { register, syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const settings = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { installed, configPath, home, trace, executable, modePath, client, usage } = settings;
fs.writeFileSync(trace, '', { flag: 'wx', mode: 0o600 });
for (const api of [fs, promises]) for (const method of ['readFileSync', 'readFile']) {
  if (typeof api[method] !== 'function') continue;
  const original = api[method];
  api[method] = function(value, ...args) {
    const path = value instanceof URL ? fileURLToPath(value) : String(value);
    if (path.startsWith(installed + '/')) fs.appendFileSync(trace, JSON.stringify({ path }) + '\n');
    return original.call(this, value, ...args);
  };
}
syncBuiltinESMExports();
register('data:text/javascript,' + encodeURIComponent(`
import {appendFileSync} from 'node:fs'; import {fileURLToPath} from 'node:url';
let data; export function initialize(value){data=value}
export async function resolve(specifier, context, next) {
 const result=await next(specifier,context);
 if(result.url.startsWith('file:')) {
  const path=fileURLToPath(result.url);
  if(!path.startsWith(data.allowed+'/')) throw Error('installed_transport_source_fallback');
  appendFileSync(data.trace,JSON.stringify({path})+'\\n');
 } return result;
}`), { parentURL: import.meta.url, data: { allowed: dirname(installed), trace } });
const { createLocalCaptureTransport } = await import(pathToFileURL(join(installed, 'integrations/client/raw/local-transport.mjs')));
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const env = { CAIRN_SYNTHETIC_API_KEY: 'synthetic_key_secret', NODE_OPTIONS: '--invalid-sentinel', HTTPS_PROXY: 'synthetic-proxy' };
const transport = createLocalCaptureTransport({ nodeExecutable: executable, runtimeRoot: installed, configPath,
  expectedAuthority: config.authority, home, env, deadlineMs: 12000 });
const text = 'synthetic_source_secret\n Ａ🙂 e\u0301 ';
const request = { version: 2, client, session_id: 'synthetic-session', event_id: 'first', messages: [{
  id: 'message-first', role: 'user', occurred_at: null, message_ordinal: 1, content: text.slice(0, 10),
  part: { index: 0, start: 0, totalUnits: text.length, totalBytes: Buffer.byteLength(text) },
}] };
function readLedger() {
  try {
    const directory = join(usage, 'usage');
    const files = fs.readdirSync(directory).filter(name => name.endsWith('.json'));
    if (files.length === 0) return { used: 0, reservations: 0 };
    if (files.length !== 1) throw Error();
    const ledger = JSON.parse(fs.readFileSync(join(directory, files[0]), 'utf8'));
    if (typeof ledger.used !== 'number' || !Array.isArray(ledger.reservations)) throw Error();
    return { used: ledger.used, reservations: ledger.reservations.length };
  } catch (error) {
    return error.code === 'ENOENT' ? { used: 0, reservations: 0 } : { used: 'unreadable', reservations: 'unreadable' };
  }
}
function captureCode(value, field) {
  if (value == null || !Object.hasOwn(value, field)) return null;
  const code = value[field];
  return typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : 'unrecognized';
}
const steps = [];
async function captureStep(step, value) {
  const before = readLedger();
  let reply, rejection;
  try { reply = await transport.capture(value); return reply; }
  catch (error) { rejection = error; throw error; }
  finally {
    const after = readLedger(), body = reply?.body;
    steps.push({ step, status: reply?.status ?? 'rejected',
      code: reply ? captureCode(body, 'error') : captureCode(rejection, 'code'),
      duplicate: typeof body?.duplicate === 'boolean' ? body.duplicate : null,
      memoryCount: typeof body?.memoryCount === 'number' ? body.memoryCount : null,
      usedBefore: before.used, usedAfter: after.used,
      delta: typeof before.used === 'number' && typeof after.used === 'number' ? after.used - before.used : 'unreadable',
      reservations: after.reservations });
  }
}
try {
  const first = await captureStep('first', request); assert.equal(first.status, 200); assert.equal(first.body.memoryCount, 1);
  delete env.CAIRN_SYNTHETIC_API_KEY;
  const replay = await captureStep('replay', request); assert.equal(replay.status, 200); assert.equal(replay.body.duplicate, true);
  const suffix = { ...request, event_id: 'suffix', messages: [{ ...request.messages[0], content: text.slice(10),
    part: { ...request.messages[0].part, index: 1, start: 10 } }] };
  assert.equal((await captureStep('suffix', suffix)).status, 200);
  env.CAIRN_SYNTHETIC_API_KEY = 'synthetic_key_secret';
  fs.writeFileSync(modePath, 'provider-error');
  const failedRequest = { ...request, event_id: 'failed', messages: [{ ...request.messages[0], id: 'message-failed', message_ordinal: 2 }] };
  assert.equal((await captureStep('failed-key', failedRequest)).status, 503);
  delete env.CAIRN_SYNTHETIC_API_KEY;
  assert.equal((await captureStep('failed-nokey', failedRequest)).status, 503);
  await assert.rejects(captureStep('extra', { ...request, extra: true }), { code: 'local_capture_transport_failed', uncertain: false });
  console.log(JSON.stringify({ conversationId: first.body.raw.conversationId, text, completed: 3, incomplete: 2, steps }));
} catch (error) {
  console.error('capture-ledger-steps ' + JSON.stringify(steps));
  throw error;
}
