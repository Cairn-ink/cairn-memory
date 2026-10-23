import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { openSync, closeSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { openMemoryCore, openContextReader } from '../index.mjs';
import { CONTEXT_METHODS } from '../context-read-input.mjs';
import { fixture, ns, ok, receipt } from './context-read-fixture.mjs';

export { ns, ok, receipt, openContextReader };
export const personal = { ...ns, scope: 'personal', projectId: null };
export const foreign = { ...ns, ownerId: 'foreign-synthetic-owner' };
export const query = (patch = {}) => ({ readSet: [ns], types: ['memory'], intent: 'current', query: 'apple', ...patch });
export const refresh = (patch = {}) => ({ readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 }, ...patch });
export const policy = (patch = {}) => ({ family: 'local', maxRequests: 10000, maxUsd: 1, estimateUsd: () => 0, ...patch });
export const denied = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code, JSON.stringify(result)); };
export async function waitForContextEntry(entry, operation, timeoutMs = 10000) {
  let timer;
  try {
    await Promise.race([entry, operation.then(value => { throw Error('operation_settled_before_entry: ' + JSON.stringify(value)); }),
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('context_entry_timeout')), timeoutMs); })]);
  } finally { clearTimeout(timer); }
}
export function host() {
  const tokens = new WeakMap(), grants = new WeakMap();
  const state = { enabled: true, generation: 1, allowed: [ns, personal], methods: new Set(CONTEXT_METHODS),
    hook: null, requests: [], checks: [], wrongScope: false };
  const authority = {
    authorize(request, token) {
      state.requests.push(request);
      const binding = tokens.get(token);
      if (!state.enabled || !binding || !state.methods.has(request.method) || binding.method !== request.method ||
          !isDeepStrictEqual(binding.input, request.input) || !state.allowed.some(ns => isDeepStrictEqual(ns, request.namespace))) return null;
      const grant = {}, { input, ...selected } = request; grants.set(grant, selected); return grant;
    },
    isCurrent(grant, request) {
      state.checks.push(request); state.hook?.(request, state.checks.length);
      const selected = grants.get(grant);
      return state.enabled && selected ? { ...selected, accessGeneration: state.generation,
        ...(state.wrongScope ? { namespace: foreign } : {}) } : null;
    },
  };
  return { state, authority, token(method, input) { const token = {}; tokens.set(token, { method, input: structuredClone(input) }); return token; },
    call(core, method, input) { return core[method](input, this.token(method, input)); } };
}
export function coreFixture(t, { embedder, selectedPolicy, cards = false, coreOptions = {} } = {}) {
  const f = fixture(t, { cards }), trusted = host();
  const config = { version: 'context-read-v1', authority: trusted.authority,
    ...(embedder ? { embedder } : {}), ...(selectedPolicy ? { policy: selectedPolicy } : {}) };
  const options = { path: f.path, ...(cards ? { privateCards: f.host.options } : {}), ...coreOptions, contextRead: config };
  let core = openMemoryCore(options); f.workspace.defer(() => core.close());
  return { ...f, trusted, config, get context() { return core; },
    call(method, input) { return trusted.call(core, method, input); },
    reopen(patch = {}) { core.close(); core = openMemoryCore({ ...options, contextRead: { ...config, ...patch } }); return core; } };
}
export function mutateProcess(f, job, { sync = false } = {}) {
  const id = randomUUID(), report = join(f.workspace.path, id + '.json'), out = join(f.workspace.path, id + '.out'), err = join(f.workspace.path, id + '.err');
  const stdout = openSync(out, 'wx', 0o600), stderr = openSync(err, 'wx', 0o600);
  const args = [new URL('./context-read-core-worker.mjs', import.meta.url).pathname, f.path, JSON.stringify(job), report];
  const checked = result => {
    assert.equal(result.error, undefined); assert.equal(result.signal, null, readFileSync(err, 'utf8'));
    assert.equal(result.status ?? result.code, 0, readFileSync(err, 'utf8') + readFileSync(out, 'utf8'));
    return JSON.parse(readFileSync(report, 'utf8'));
  };
  if (sync) {
    try { return checked(spawnSync(process.execPath, args, { stdio: ['ignore', stdout, stderr], timeout: 30000 })); }
    finally { closeSync(stdout); closeSync(stderr); }
  }
  const child = spawn(process.execPath, args, { stdio: ['ignore', stdout, stderr] });
  closeSync(stdout); closeSync(stderr);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); try { resolve(checked({ code, signal })); } catch (error) { reject(error); } });
  });
}
