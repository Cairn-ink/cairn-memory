// Cold installed process: no application imports before the read/loader guards.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { register, syncBuiltinESMExports } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const [installed, source, database, trace, mode] = process.argv.slice(2);
const sourceRoot = resolve(source), dataRoot = dirname(database);
assert.ok(['unconfigured', 'configured'].includes(mode));
for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'NODE_OPTIONS', 'npm_config_userconfig'])
  assert.equal(process.env[key], undefined);
let networkCalls = 0, sourceReads = 0, modelCalls = 0;
const denyNetwork = () => { networkCalls++; assert.fail('installed engine Cards forbid network'); };
globalThis.fetch = denyNetwork;
http.request = http.get = https.request = https.get = net.connect = net.createConnection = net.Socket.prototype.connect = denyNetwork;
fs.writeFileSync(trace, '', { flag: 'wx', mode: 0o600 });
const note = row => fs.appendFileSync(trace, JSON.stringify(row) + '\n');
for (const api of [fs, promises]) for (const method of ['readFileSync', 'readFile', 'openSync', 'open']) {
  if (typeof api[method] !== 'function') continue;
  const original = api[method];
  api[method] = function(value, ...args) {
    const path = value instanceof URL ? fileURLToPath(value) : typeof value === 'string' ? resolve(value) : null;
    if (path && (path === sourceRoot || path.startsWith(sourceRoot + '/') ||
        path !== dataRoot && !path.startsWith(dataRoot + '/'))) {
      sourceReads++; assert.fail('installed engine Cards source fallback');
    }
    if (path?.startsWith(installed + '/')) note({ kind: 'asset', path: relative(installed, path) });
    return original.call(this, value, ...args);
  };
}
syncBuiltinESMExports();
const loader = `import {appendFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {relative} from 'node:path';
let data;export function initialize(value){data=value}
function check(url,kind){if(!url.startsWith('file:'))return;const path=fileURLToPath(url);
if(!path.startsWith(data.allowed+'/'))throw Error('installed_engine_source_fallback');
if(path.startsWith(data.installed+'/'))appendFileSync(data.trace,JSON.stringify({kind,path:relative(data.installed,path)})+'\\n');}
export async function resolve(specifier,context,next){const result=await next(specifier,context);check(result.url,'resolve');return result}
export async function load(url,context,next){check(url,'load');return next(url,context)}`;
register('data:text/javascript,' + encodeURIComponent(loader), {
  parentURL: import.meta.url, data: { allowed: dirname(installed), installed, trace },
});
const { openMemoryCore } = await import(pathToFileURL(installed + '/core/index.mjs'));
const namespace = { ownerId: 'synthetic-owner', scope: 'project', projectId: 'synthetic-project' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const model = { contextWindow: 32768, countTokens: text => Math.ceil(text.length / 4),
  consolidate({ input }) {
    modelCalls++; assert.equal(input.memories.length, 5);
    return { currentState: [{ text: 'Synthetic Orion is ready.', memoryIds: [input.memories[0].id] }],
      timeline: [], contradictions: [] };
  } };
const core = openMemoryCore({ path: database, ...(mode === 'configured' ? { model,
  cardRelations: { read: ({ memoryIds }) => memoryIds.slice(0, 3).map((from, i) =>
    ({ from, to: memoryIds[i + 1], kind: 'supersedes', slot: 'synthetic-status' })) } } : {}) });
try {
  for (let i = 0; i < 5; i++) ok(core.admit({ namespace, memory: { content: `Orion synthetic milestone ${i}.`, kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'synthetic-conversation-' + i,
      eventId: 'synthetic-event-' + i, role: 'user', excerpt: `Orion synthetic milestone ${i}.` }] }));
  const loadedBeforeMaintenance = fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    .filter(row => row.kind === 'load').map(row => row.path);
  assert.equal(modelCalls, 0, 'opening and admission never consolidate');
  if (mode === 'configured') {
    const pass = ok(await core.maintainCards({ namespace, budget: { maxMs: 5000 } }));
    assert.equal(pass.state, 'ready'); assert.equal(pass.built.length, 1, JSON.stringify(pass));
    assert.equal(pass.modelCalls, 1); assert.equal(pass.built[0].origin, 'engine');
    assert.equal(pass.built[0].sourceRevisions.length, 5);
    assert.equal(ok(await core.maintainCards({ namespace, budget: { maxMs: 5000 } })).built.length, 0);
    assert.equal(modelCalls, 1, 'unchanged installed source does not dispatch twice');
  } else assert.equal(Object.hasOwn(core, 'maintainCards'), false);
  process.stdout.write(JSON.stringify({ loadedBeforeMaintenance, modelCalls, networkCalls, sourceReads }));
} finally { core.close(); }
