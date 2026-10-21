import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { classifyRawAcknowledgement } from '../../../integrations/client/raw/protocol.mjs';
import { fixture, ok } from './fixtures/workspace.mjs';

for (const client of ['claude-code', 'codex']) test(`B3 ${client}: exact source, replay and multipart continuation survive fresh processes`, async t => {
  const f = fixture(t, { client }), text = 'synthetic_source_secret\n Ａ🙂 e\u0301 '.repeat(130);
  const firstEnd = /[\uD800-\uDBFF]/.test(text[2999]) ? 2999 : 3000, input = f.request('long', text.slice(0, firstEnd));
  input.messages[0].part.totalUnits = text.length; input.messages[0].part.totalBytes = Buffer.byteLength(text);
  const first = f.reply(await f.run(input)); assert.equal(first.status, 200);
  assert.equal(classifyRawAcknowledgement(first.status, first.body, input).disposition, 'complete');
  const replay = f.reply(await f.run(input, { key: false })); assert.equal(replay.body.duplicate, true);
  let index = 1, start = firstEnd;
  while (start < text.length) {
    let end = Math.min(start + 3000, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    const suffix = { ...input, event_id: 'suffix-' + index, messages: [{ ...input.messages[0], content: text.slice(start, end), part: { ...input.messages[0].part, index, start } }] };
    assert.equal(f.reply(await f.run(suffix, { key: false })).status, 200); start = end; index++;
  }
  const db = new DatabaseSync(f.databasePath, { readOnly: true });
  try {
    const parts = db.prepare('SELECT sealed FROM raw_parts WHERE conversation_id=? ORDER BY part_index').all(first.body.raw.conversationId);
    assert.ok(parts.length > 1); assert.equal(Buffer.concat(parts.map(part => Buffer.from(part.sealed))).toString('utf8'), text);
  } finally { db.close(); }
});

test('B3 whitespace-only projection and pure continuation never need a credential or ledger', async t => {
  const f = fixture(t), result = f.reply(await f.run(f.request('spaces', ' \t\n'), { key: false }));
  assert.equal(result.status, 200); assert.equal(result.body.memoryCount, 0);
  assert.equal(f.calls().length, 0); assert.equal(f.ledger(), null);
});

for (const mode of ['provider-error', 'qualification-error']) test(`B3 ${mode}: retained Raw does not become a successful or retryable interpretation`, async t => {
  const f = fixture(t), request = f.request(), first = f.reply(await f.run(request, { mode }));
  assert.equal(first.body.error, 'interpretation_incomplete'); assert.ok(first.status >= 400);
  const calls = f.calls().length, usage = f.ledger().used;
  const replay = f.reply(await f.run(request, { key: false })); assert.equal(replay.body.error, 'interpretation_incomplete');
  assert.equal(f.calls().length, calls); assert.equal(f.ledger().used, usage); assert.deepEqual(f.ledger().reservations, []);
  assert.equal(ok(f.core.list({ namespace: f.namespace })).memories.length, 0);
});

test('B3 optional filing failure retains completed qualified admission and counts ports once', async t => {
  const f = fixture(t), response = f.reply(await f.run(f.request(), { mode: 'filing-error' }));
  assert.equal(response.status, 200); assert.equal(response.body.memoryCount, 1);
  assert.equal(f.calls().length, 5); assert.equal(f.ledger().used, 3); assert.deepEqual(f.ledger().reservations, []);
  assert.equal(ok(f.core.list({ namespace: f.namespace })).memories.length, 1);
});

for (const mode of ['revoke', 'notice', 'raw-off']) test(`B3 ${mode}: per-HTTP checks distinguish consent from Raw retention`, async t => {
  const f = fixture(t), response = f.reply(await f.run(f.request(), { mode }));
  assert.equal(response.status, mode === 'revoke' ? 503 : 200);
  assert.equal(f.calls().length, mode === 'revoke' ? 1 : 6);
  assert.equal(ok(f.core.list({ namespace: f.namespace })).memories.length, mode === 'revoke' ? 0 : 1);
});

test('B3 daily port cap preserves incomplete evidence without a hidden retry', async t => {
  const f = fixture(t); f.config.usage.dailyCap = 1; f.save();
  const request = f.request(), response = f.reply(await f.run(request, { mode: 'memory' }));
  assert.equal(response.status, 503); assert.equal(response.body.error, 'interpretation_incomplete');
  assert.equal(f.calls().length, 2); assert.equal(f.ledger().used, 1);
  assert.equal(f.reply(await f.run(request, { key: false })).status, 503); assert.equal(f.calls().length, 2);
});

test('B3 malformed routing, bytes, CLI and unsafe config refuse without capture or usage mutation', async t => {
  const f = fixture(t), before = ok(f.core.getRawUsage({ ownerId: f.namespace.ownerId }));
  for (const options of [{ bytes: Buffer.from([0xc0, 0xaf]) }, { bytes: '{} {}' }, { bytes: Buffer.alloc(65537, 32) }, { args: ['--api-key', 'synthetic_key_secret'] }]) {
    const result = await f.run(f.request(), options); assert.equal(result.code, 1); assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /synthetic_source_secret|synthetic_key_secret/);
  }
  assert.equal((await f.run({ ...f.request(), project_id: 'foreign-project-0000' })).code, 1);
  chmodSync(f.configPath, 0o644); assert.equal((await f.run(f.request())).code, 1);
  assert.equal(f.calls().length, 0); assert.equal(f.ledger(), null);
  assert.deepEqual(ok(f.core.getRawUsage({ ownerId: f.namespace.ownerId })), before);
});

test('B3 process deadline kills unconfirmed provider work without refund, then dead-owner recovery frees its slot', async t => {
  const f = fixture(t), ready = join(f.workspace.path, 'ready'), release = join(f.workspace.path, 'release');
  f.config.timeouts = { captureMs: 5000, processMs: 7000 }; f.save();
  const pending = f.launch(f.request(), { mode: 'hold', environment: { SYNTHETIC_READY: ready, SYNTHETIC_RELEASE: release } });
  const end = Date.now() + 4000;
  while (!existsSync(ready) && pending.child.exitCode === null && pending.child.signalCode === null && Date.now() < end) await delay(10);
  assert.equal(existsSync(ready), true, 'provider dispatch must precede the process-deadline assertion');
  assert.equal(pending.child.exitCode, null); assert.equal(pending.child.signalCode, null);
  assert.deepEqual(f.calls(), [{ method: 'cairn_extract', count: true }, { method: 'cairn_extract', count: false }]);
  assert.equal(f.ledger().used, 1); assert.equal(f.ledger().reservations.length, 1);
  const result = await pending.done;
  assert.equal(result.timedOut, false);
  assert.equal(result.code, 124); assert.equal(result.signal, null); assert.equal(result.stdout, '');
  assert.equal(existsSync(release), false);
  assert.equal(f.ledger().used, 1); assert.equal(f.ledger().reservations.length, 1);
  f.config.timeouts = { captureMs: 5000, processMs: 9000 }; f.save();
  const next = f.reply(await f.run(f.request('fresh', 'fresh', 2))); assert.equal(next.status, 200);
  assert.equal(f.ledger().used, 2); assert.deepEqual(f.ledger().reservations, []);
});

test('B3 pre-dispatch capture timeout completes cooperatively without refund and releases its slot', async t => {
  const f = fixture(t), ready = join(f.workspace.path, 'planning-ready');
  f.config.timeouts = { captureMs: 2000, processMs: 7000 }; f.save();
  const pending = f.launch(f.request(), { mode: 'planning-delay', environment: { SYNTHETIC_READY: ready } });
  const end = Date.now() + 4000;
  while (!existsSync(ready) && pending.child.exitCode === null && pending.child.signalCode === null && Date.now() < end) await delay(10);
  assert.equal(existsSync(ready), true, 'planning must precede the cooperative-timeout assertion');
  const result = await pending.done, response = f.reply(result);
  assert.equal(response.status, 503); assert.equal(response.body.error, 'interpretation_incomplete');
  assert.deepEqual(f.calls(), [{ method: 'cairn_extract', count: true }]);
  assert.equal(f.ledger().used, 1); assert.deepEqual(f.ledger().reservations, []);
});

test('B3 two actual processes share a target concurrency cap and release only after provider settlement', async t => {
  const f = fixture(t), ready = join(f.workspace.path, 'ready'), release = join(f.workspace.path, 'release');
  const first = f.launch(f.request(), { mode: 'hold', environment: { SYNTHETIC_READY: ready, SYNTHETIC_RELEASE: release } });
  const end = Date.now() + 5000;
  while (!existsSync(ready) && Date.now() < end) await delay(10);
  assert.equal(existsSync(ready), true);
  const second = f.reply(await f.run({ ...f.request('parallel'), session_id: 'other-session' }));
  assert.equal(second.status, 503); assert.equal(f.calls().length, 2); assert.equal(f.ledger().used, 1);
  writeFileSync(release, 'release', { flag: 'wx', mode: 0o600 });
  assert.equal(f.reply(await first.done).status, 200); assert.deepEqual(f.ledger().reservations, []);
});
