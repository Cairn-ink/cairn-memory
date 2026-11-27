import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { command } from '../../build.mjs';

export const golden = JSON.parse(readFileSync(new URL('./installed-local-0.6.11-wire.json', import.meta.url)));
export const diagnosticsKey = 'ink.cairn/context-read-diagnostics';
export const snapshotKey = 'ink.cairn/context-read-snapshot';
export const scopeArgs = ['--owner', 'synthetic-owner', '--project', 'synthetic-project'];

export function isolatedEnv(directory) {
  return { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, XDG_CONFIG_HOME: directory,
    LANG: 'C.UTF-8', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
}

export function installCandidate(directory, archive, name) {
  mkdirSync(directory);
  const npmrc = join(directory, 'empty.npmrc');
  writeFileSync(npmrc, '');
  command('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock',
    '--cache', join(directory, 'cache'), archive], directory, npmrc);
  return { root: join(directory, 'node_modules', name),
    bin: join(directory, 'node_modules', '.bin', 'cairn-memory-core-local') };
}

const envelope = response => JSON.parse(response.result.content[0].text);
const value = result => result && envelope(result).value;

function replayParams(label, original, replies) {
  if (original?.arguments === undefined) return original;
  const args = structuredClone(original.arguments);
  if (args.memoryId === '<uuid-1>') args.memoryId = value(replies.get('remember'))?.memory.id;
  if (args.memoryId === '<uuid-6>') args.memoryId = value(replies.get('remember procedural'))?.memory.id;
  if (args.refs) {
    const ref = value(replies.get('find populated'))?.items[0]?.ref;
    const expected = args.refs[0];
    if (ref) args.refs = [{ type: ref.type, namespace: expected.namespace.ownerId === 'other-synthetic-owner'
      ? { ...ref.namespace, ownerId: expected.namespace.ownerId } : ref.namespace,
      memoryId: ref.memoryId, revision: ref.revision }];
    else args.refs = [];
  }
  if (args.snapshot === '<snapshot-2>') args.snapshot = replies.get('read context populated')?.result._meta?.[snapshotKey];
  if (args.expectedRevision !== undefined) {
    const changed = label === 'forget' || label === 'forget repeated';
    const revision = value(replies.get(changed ? 'correct' : 'remember duplicate'))?.memory.revision;
    args.expectedRevision = revision === undefined ? undefined : revision + (label === 'correct stale' ? 10 : 0);
  }
  return { ...original, arguments: args };
}

const bound = /^[A-Za-z0-9_-]{43}$/u;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d\d:\d\d:\d\d\.\d{3}Z$/u;
const uuidKeys = ['id', 'memoryId', 'receiptId', 'eventId'];
const reservedPlaceholder = /^<(?:(?:uuid|snapshot|content-identity|ref-fence)-\d+|timestamp|work-metrics|owner-index-revision|tokens-in-wire-text)>$/u;

function normalizer({ legacy = false, allowPlaceholders = false } = {}) {
  const identities = new Map();
  function handle(kind, value) {
    if (!identities.has(kind)) identities.set(kind, new Map());
    const seen = identities.get(kind);
    if (!seen.has(value)) seen.set(value, '<' + kind + '-' + (seen.size + 1) + '>');
    return seen.get(value);
  }

  function visit(value, key, path = []) {
    if (key === 'maintenance' && path.at(-1) === 'trace') {
      assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'invalid trace.maintenance object');
      for (const [name, measure] of Object.entries(value)) {
        // Reproduce the capture's timing normalization for the installed
        // oracle. Candidate metrics must satisfy the integer rule as sent.
        if (legacy && name.endsWith('Ms')) {
          assert.ok(Number.isFinite(measure) && measure >= 0, 'invalid installed maintenance timing');
        } else {
          assert.ok(Number.isSafeInteger(measure) && measure >= 0, 'invalid trace.maintenance metric');
        }
      }
      return '<work-metrics>';
    }
    if (Array.isArray(value)) return value.map(item => visit(item, '', [...path, key]));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, visit(item, name, [...path, key])]));
    }
    if (path.at(-1) === 'timings' && path.at(-2) === 'trace' && typeof value === 'number') {
      assert.ok(Number.isFinite(value), 'invalid timing');
      return 0;
    }
    if (key === 'indexRevision' && path.at(-1) === 'value') {
      assert.ok(Number.isSafeInteger(value) && value >= 0, 'invalid indexRevision');
      return '<owner-index-revision>';
    }
    if (typeof value !== 'string') return value;
    if (key === 'text' && path.at(-2) === 'content' && value.startsWith('{')) {
      return JSON.stringify(visit(JSON.parse(value), key, path));
    }
    const uuidField = uuidKeys.includes(key);
    const timestampField = key === 'createdAt' || key === 'updatedAt';
    const snapshotField = key === 'snapshot' || key === snapshotKey;
    const contentIdentityField = key === 'contentIdentity';
    const refFenceField = key === 'f' && path.at(-1) === 'ref';
    if (!allowPlaceholders && (uuidField || timestampField || snapshotField || contentIdentityField || refFenceField)) {
      assert.ok(!reservedPlaceholder.test(value), 'reserved normalization placeholder in ' + key);
    }
    if (uuidField) {
      if (uuid.test(value)) return handle('uuid', value);
      // Reserve the ordinal for a non-UUID SQLite memory ID without masking
      // it. Otherwise a memory ID difference renumbers every later receipt.
      if (['id', 'memoryId'].includes(key) && /^[0-9a-f]{32}$/u.test(value)) handle('uuid', value);
    }
    if (timestampField && timestamp.test(value)) return '<timestamp>';
    if (snapshotField && bound.test(value)) return handle('snapshot', value);
    if (contentIdentityField && bound.test(value)) return handle('content-identity', value);
    if (refFenceField && /^[A-Za-z0-9_-]{8}$/u.test(value)) return handle('ref-fence', value);
    return value;
  }
  return visit;
}

function normaliseResponse(normalise, response, count, label) {
  const text = response.result?.content?.[0]?.text;
  const budget = response.result?._meta?.[diagnosticsKey]?.budget;
  const result = normalise(response, '');
  if (budget) {
    assert.equal(budget.used, count(text), label + ' counted the exact wire block');
    if (text !== result.result.content[0].text) {
      result.result._meta[diagnosticsKey].budget.used = '<tokens-in-wire-text>';
    }
  }
  return result;
}

function diff(expected, actual, path = 'reply') {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) return [path + '.length expected ' + expected.length + ', got ' + actual.length];
    return expected.flatMap((value, index) => diff(value, actual[index], path + '[' + index + ']'));
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object' &&
      !Array.isArray(expected) && !Array.isArray(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    const fields = [...keys].flatMap(key => diff(expected[key], actual[key], path + '.' + key));
    if (!fields.length && path.includes('.content[')) return [path + ' property order differs'];
    return fields;
  }
  if (path.endsWith('.text') && typeof expected === 'string' && typeof actual === 'string' &&
      expected.startsWith('{') && actual.startsWith('{')) return diff(JSON.parse(expected), JSON.parse(actual), path);
  return [path + ' expected ' + String(JSON.stringify(expected)).slice(0, 240) +
    ', got ' + String(JSON.stringify(actual)).slice(0, 240)];
}

export async function withStdio(entry, args, directory, work) {
  const child = spawn(process.execPath, [entry, ...args], { cwd: directory, env: isolatedEnv(directory),
    stdio: ['pipe', 'pipe', 'inherit'] });
  const closed = once(child, 'close');
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let sequence = 0;
  const send = frame => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\n');
  const request = async (method, params) => {
    const id = ++sequence;
    const alarm = setTimeout(() => child.kill('SIGKILL'), 20_000);
    try {
      send({ id, method, params });
      for (;;) {
        const line = await lines.next();
        assert.equal(line.done, false, method + ' closed without a response');
        const { jsonrpc, id: responseId, ...reply } = JSON.parse(line.value);
        if (responseId === undefined) continue;
        assert.equal(jsonrpc, '2.0');
        assert.equal(responseId, id);
        return reply;
      }
    } finally {
      clearTimeout(alarm);
    }
  };
  try {
    return await work(request, method => send({ method }));
  } finally {
    child.stdin.end();
    const alarm = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      const [exit, signal] = await closed;
      assert.equal(exit, 0, 'stdio exit ' + exit + ', signal ' + signal);
    } finally {
      clearTimeout(alarm);
    }
  }
}

// Installed 0.6.11 has Document Cards disabled, so its card maintenance
// reports phase 4. The golden records the candidate's phase 1 (cards on).
// Only these two legacy replies expect the 0.6.11 value.
const legacyCardPhase = 4;
function legacyResponse(label, response) {
  if (label === 'find cards disabled') {
    const reply = structuredClone(response);
    const content = reply.result.content[0];
    const text = JSON.parse(content.text);
    assert.equal(text.value.coverage.maintenance.progress.phase, 1, 'golden card phase');
    text.value.coverage.maintenance.progress.phase = legacyCardPhase;
    content.text = JSON.stringify(text);
    return reply;
  }
  if (label === 'read context cards disabled') {
    const reply = structuredClone(response);
    const progress = reply.result._meta['ink.cairn/context-read-diagnostics'].candidates.coverage.maintenance.progress;
    assert.equal(progress.phase, 1, 'golden card phase');
    progress.phase = legacyCardPhase;
    return reply;
  }
  return response;
}

export async function compareWire(request, notify, count, { legacy = false } = {}) {
  const cases = Object.entries(golden.exchanges);
  cases.splice(2, 0, ['tools/list', { method: 'tools/list', response: { result: { tools: golden.toolsList } } }]);
  const actual = normalizer({ legacy }), expected = normalizer({ allowPlaceholders: true });
  const replies = new Map(), differences = [];
  let matched = 0, lastIndex;
  for (const [label, item] of cases) {
    try {
      const params = replayParams(label, item.params, replies);
      const reply = await request(item.method, params, label);
      replies.set(label, reply);
      if (label === 'initialize') notify('notifications/initialized');
      const expectedIndex = item.response.result?.content?.[0]?.text?.startsWith('{') ?
        value(item.response)?.indexRevision : undefined;
      if (expectedIndex !== undefined) {
        const index = value(reply)?.indexRevision;
        assert.ok(Number.isSafeInteger(index) && index > 0, 'missing committed index revision');
        // Legacy advances once for the memory and again for its procedural tag.
        // The candidate saves the memory and its procedural tag in one revision advance.
        const advance = label === 'forget repeated' ? 0 : (legacy && label === 'remember procedural' ? 2 : 1);
        if (lastIndex !== undefined) assert.equal(index, lastIndex + advance, 'per-run index revision');
        lastIndex = index;
      }
      const normalizedReply = normaliseResponse(actual, reply, count, label);
      const errors = [...diff(expected(item.params, ''), actual(params, ''), 'request'),
        ...diff(expected(legacy ? legacyResponse(label, item.response) : item.response, ''), normalizedReply)];
      if (errors.length) differences.push(...errors.map(error => label + ' ' + error));
      else matched++;
    } catch (error) {
      differences.push(label + ' ' + error.message);
    }
  }
  return { matched, total: cases.length, differences };
}
