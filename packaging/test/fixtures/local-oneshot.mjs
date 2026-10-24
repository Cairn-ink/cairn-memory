// Synthetic HTTP interception is test scaffolding, loaded before the runtime
// fallback fence. No application module is loaded from the source tree.
import '../../../adapters/local/test/fixtures/http.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { register, syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const installed = process.env.SYNTHETIC_INSTALLED, trace = process.env.SYNTHETIC_IMPORT_TRACE;
for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'NODE_OPTIONS', 'npm_config_userconfig']) assert.equal(process.env[key], undefined);
fs.writeFileSync(trace, '', { flag: 'wx', mode: 0o600 });
const append = row => fs.appendFileSync(trace, JSON.stringify(row) + '\n');
for (const api of [fs, promises]) for (const method of ['readFileSync', 'readFile']) {
  if (typeof api[method] !== 'function') continue;
  const original = api[method];
  api[method] = function(value, ...args) {
    const path = value instanceof URL ? fileURLToPath(value) : String(value);
    if (path.startsWith(installed + '/')) append({ kind: 'asset', path });
    return original.call(this, value, ...args);
  };
}
syncBuiltinESMExports();
const loader = `import {appendFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';
let data;export function initialize(value){data=value}
export async function resolve(specifier,context,next){const result=await next(specifier,context);
if(result.url.startsWith('file:')){const path=fileURLToPath(result.url);
if(!path.startsWith(data.allowed+'/'))throw Error('installed_local_runtime_source_fallback');
appendFileSync(data.trace,JSON.stringify({kind:'module',path})+'\\n');}return result;}`;
register('data:text/javascript,' + encodeURIComponent(loader), { parentURL: import.meta.url,
  data: { allowed: dirname(installed), trace } });

if (process.argv[2] === 'prepare') {
  const { openMemoryCore } = await import(pathToFileURL(join(installed, 'core/index.mjs')));
  const databasePath = process.env.SYNTHETIC_DATABASE, client = process.env.SYNTHETIC_CLIENT;
  const namespace = { ownerId: 'synthetic-installed-local', scope: 'personal', projectId: null };
  const core = openMemoryCore({ path: databasePath, rawConversations: { mode: 'off', readPolicy: () => ({ generation: 'synthetic', reason: null }) } });
  try {
    const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
    const current = ok(core.getLocalCaptureControl({ namespace, client }));
    const granted = ok(core.setLocalCaptureControl({ namespace, client, targetId: 'synthetic-installed-target', expectedStoreId: current.storeId,
      expectedRevision: current.revision, automaticCaptureEnabled: true, rawNoticeVersion: 'local-plain-v1' }));
    const authority = { version: 'local-capture-authority-v1', targetId: granted.targetId, storeId: granted.storeId, namespace, client,
      expectedControlRevision: granted.revision, expectedConsentGeneration: granted.consentGeneration,
      expectedNamespaceGeneration: ok(core.getCaptureControl({ namespace })).generation,
      expectedRawRevision: ok(core.getRawCaptureControl({ ownerId: namespace.ownerId, client })).revision };
    fs.writeFileSync(process.env.SYNTHETIC_CONFIG, JSON.stringify({ version: 'local-capture-config-v1', databasePath, authority,
      raw: { mode: 'local-plain-v1', capBytes: 1000000 }, provider: { profile: 'openai-baseline-v1', apiKeyEnv: 'SYNTHETIC_LOCAL_KEY' },
      usage: { root: process.env.SYNTHETIC_USAGE, dailyCap: 20, concurrency: 1 }, timeouts: { captureMs: 5000, processMs: 9000 } }),
    { flag: 'wx', mode: 0o600 });
  } finally { core.close(); }
}
