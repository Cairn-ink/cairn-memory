// Synthetic host. Dynamic engine imports must stay inside the installation.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const [phase, installed, path, statePath, client] = process.argv.slice(2);
assert.ok(['create', 'barrier', 'resume'].includes(phase));
assert.ok(['claude-code', 'codex'].includes(client));
for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'NODE_OPTIONS', 'npm_config_userconfig']) assert.equal(process.env[key], undefined);
let modelCalls = 0, networkCalls = 0, core;
const forbidden = () => { networkCalls++; assert.fail('Synthetic installed barrier forbids network'); };
globalThis.fetch = forbidden;
http.request = http.get = https.request = https.get = net.connect = net.createConnection = net.Socket.prototype.connect = forbidden;
const loader = `import {fileURLToPath} from 'node:url';let allowed;
export function initialize(value){allowed=value}
export async function resolve(specifier,context,next){const result=await next(specifier,context);
if(result.url.startsWith('file:')&&!fileURLToPath(result.url).startsWith(allowed+'/'))throw Error('installed_fixture_source_fallback');return result}`;
register('data:text/javascript,' + encodeURIComponent(loader), { parentURL: import.meta.url, data: dirname(installed) });
const importedCore = join(installed, 'core/index.mjs');
const { openMemoryCore } = await import(pathToFileURL(importedCore).href);
const namespace = { ownerId: 'synthetic-barrier-owner', scope: 'project', projectId: 'synthetic-project' };
const reasons = ['quota_reached', 'notice_required', 'raw_disabled'];
const text = 'Synthetic skipped tail. '.repeat(400);
function part(reason, index) {
  const start = index * 3000;
  return { id: 'old-' + reason, role: 'user', occurredAt: null, messageOrdinal: 1, content: text.slice(start, start + 3000),
    part: { index, start, totalUnits: text.length, totalBytes: Buffer.byteLength(text) } };
}
const request = (reason, message) => ({ namespace, client, sessionId: 'session-' + reason, eventId: message.id + '-' + message.part.index, messages: [message] });
const fresh = reason => ({ id: 'fresh-' + reason, role: 'user', occurredAt: null, messageOrdinal: 2, content: 'fresh',
  part: { index: 0, start: 0, totalUnits: 5, totalBytes: 5 } });
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const denied = (result, code) => { assert.equal(result.ok, false); assert.equal(result.error.code, code); };
const port = { version: 'raw-seal-v1', sealRaw: ({ text }) => ({ format: 'local-plain-v1', keyVersion: null, sealed: Buffer.from(text) }),
  openRaw: ({ sealed }) => ({ text: Buffer.from(sealed).toString('utf8') }) };
function reopen(reason) {
  core?.close();
  core = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1, extract: () => { modelCalls++; return { items: [] }; } },
    rawConversations: { mode: reason === 'raw_disabled' ? 'off' : 'raw-v1', port, capBytes: reason === 'quota_reached' ? 1 : 100000,
      readPolicy: () => ({ generation: 'synthetic-notice', reason: reason === 'notice_required' ? reason : null }) } });
}
const receiptKeys = { raw_parts: ['conversation_id', 'message_id', 'part_index'], raw_events: ['owner_id', 'scope', 'project_id', 'client', 'event_id'] };
const snapshot = db => Object.fromEntries(Object.entries(receiptKeys).map(([table, keys]) =>
  [table, db.prepare(`SELECT * FROM ${table} ORDER BY ${keys.join(',')}`).all().map(row => ({ ...row }))]));
try {
  if (phase === 'create') {
    const first = {};
    for (const reason of reasons) {
      reopen(reason);
      first[reason] = ok(await core.captureRaw(request(reason, part(reason, 0))));
      assert.equal(first[reason].raw.parts[0].reason, reason);
    }
    const db = new DatabaseSync(path, { readOnly: true });
    try { writeFileSync(statePath, JSON.stringify({ first, receipts: snapshot(db) }), { flag: 'wx', mode: 0o600 }); }
    finally { db.close(); }
  } else if (phase === 'barrier') {
    core = openMemoryCore({ path });
    assert.equal(core.captureRaw, undefined);
    const paused = ok(core.setProjectCapture({ namespace, expectedGeneration: 'initial', enabled: false }));
    ok(core.setProjectCapture({ namespace, expectedGeneration: paused.generation, enabled: true }));
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      assert.deepEqual(snapshot(db), state.receipts);
      assert.deepEqual(db.prepare('SELECT reason FROM raw_messages').all().map(row => row.reason), reasons.map(() => 'capture_barrier'));
      assert.equal(db.prepare('SELECT reserved_bytes FROM raw_owner_usage').get().reserved_bytes, 0);
    } finally { db.close(); }
  } else {
    reopen();
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    for (const reason of reasons) {
      denied(await core.captureRaw(request(reason, part(reason, 0))), 'capture_evidence_closed');
      assert.equal(ok(await core.captureRaw(request(reason, fresh(reason)))).raw.parts[0].saved, true);
      const before = modelCalls;
      for (let index = 1; index * 3000 < text.length; index++) {
        const result = ok(await core.captureRaw(request(reason, part(reason, index))));
        assert.equal(result.raw.parts[0].saved, false); assert.equal(result.raw.parts[0].reason, 'capture_barrier');
        assert.equal(modelCalls, before);
      }
      const view = ok(await core.getConversation({ namespace, conversationId: state.first[reason].raw.conversationId }));
      assert.equal(view.messages[0].parts[0].reason, reason);
      assert.ok(view.messages[0].parts.every(part => part.text === null));
      assert.equal(view.messages[1].parts[0].text, 'fresh');
    }
    const usage = ok(core.getRawUsage({ ownerId: namespace.ownerId }));
    assert.equal(usage.savedBytes, 15); assert.equal(usage.reservedBytes, 0);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const current = snapshot(db);
      for (const [table, rows] of Object.entries(state.receipts)) {
        for (const row of rows) assert.deepEqual(current[table].find(value => receiptKeys[table].every(key => value[key] === row[key])), row);
      }
    } finally { db.close(); }
  }
} finally { core?.close(); }
assert.equal(networkCalls, 0); assert.equal(modelCalls, phase === 'barrier' ? 0 : 3);
console.log(JSON.stringify({ phase, client, pid: process.pid, importedCore, networkCalls, modelCalls, skipReasons: reasons.length }));
