import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, appendFile } from 'node:fs/promises';
import { parseLine } from '../parser.mjs';
import { runWorker } from '../worker.mjs';
import { fixture, session } from './helpers.mjs';

const fixtures = new URL('./fixtures/', import.meta.url);
const native = JSON.parse(await readFile(new URL('phase-0.162.0-native-read.json', fixtures)));
const context = { sessionId: session, wireSessionId: 'a'.repeat(64), epoch: 0, start: 0, end: 1 };
const contents = f => [...f.receiver.values()].flatMap(body => body.messages.map(row => row.content));
const run = f => runWorker(f.binding, { guard: f.guard, transport: f.transport, now: () => 100000 });

test('native history retains stable completed partial and final as separate items, even across interruption', () => {
  assert.deepEqual(native.exits.map(row => row.code), [0, 0]);
  assert.ok(!native.methods.includes('turn/start'));
  for (const [name, status, expected] of [
    ['partial-final', 'completed', ['First stable section.', 'Second terminal section.']],
    ['interrupted', 'interrupted', ['First stable section.']],
  ]) {
    const observed = native.cases.find(row => row.name === name);
    assert.equal(observed.turns.data[0].status, status);
    assert.deepEqual(observed.items.data.filter(row => row.item.type === 'agentMessage').map(row => row.item.text), expected);
    assert.ok(observed.items.data.every(row => row.completedAtMs !== null));
    assert.equal(new Set(observed.items.data.map(row => row.item.id)).size, observed.items.data.length);
  }
});
for (const [name, expected] of [
  ['partial-final', ['Synthetic question.', 'First stable section.', 'Second terminal section.']],
  ['partial-interrupted', ['Synthetic question.', 'First stable section.']],
]) test(`${name}: capture finished items once, ignoring starts, deltas and both mirror representations`, async t => {
  const text = await readFile(new URL(name + '-0.162.0.jsonl', fixtures), 'utf8');
  const f = await fixture(t, { text }); await run(f); await run(f);
  assert.deepEqual(contents(f), expected); assert.equal(f.calls.length, 1);
  assert.ok(!JSON.stringify(f.calls).includes('UNFINISHED_CANARY'));
  assert.equal((await f.cursor()).offset, Buffer.byteLength(text));
});
test('partial followed by final on a later hook keeps stable partial once and appends final once', async t => {
  const text = await readFile(new URL('partial-final-0.162.0.jsonl', fixtures), 'utf8');
  const rows = text.trimEnd().split('\n'), split = rows.findIndex(line => JSON.parse(line).payload?.item?.phase === 'final_answer');
  const f = await fixture(t, { text: rows.slice(0, split).join('\n') + '\n' });
  await run(f); assert.deepEqual(contents(f), ['Synthetic question.', 'First stable section.']);
  await appendFile(f.path, rows.slice(split).join('\n') + '\n'); await run(f); await run(f);
  assert.deepEqual(contents(f), ['Synthetic question.', 'First stable section.', 'Second terminal section.']);
});
test('lost-reply replay freezes the same partial/final request and receiver counts it once', async t => {
  const f = await fixture(t, { text: await readFile(new URL('partial-final-0.162.0.jsonl', fixtures), 'utf8') });
  f.fail('lost'); await run(f); f.clear(); await run(f); await run(f);
  assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[0], f.calls[1]);
  assert.deepEqual(contents(f), ['Synthetic question.', 'First stable section.', 'Second terminal section.']);
});
test('unknown phase fails the scan closed before any finished content is dispatched', async t => {
  const text = await readFile(new URL('partial-unknown-0.162.0.jsonl', fixtures), 'utf8');
  const f = await fixture(t, { text }); const result = await run(f);
  assert.equal(result.status, 'unsupported_format'); assert.equal(f.calls.length, 0);
  const row = text.trimEnd().split('\n').map(JSON.parse).find(row => row.payload?.item?.phase === 'future_answer');
  assert.throws(() => parseLine(Buffer.from(JSON.stringify(row)), context), /unsupported_format/);
  row.payload.type = 'item_started';
  assert.throws(() => parseLine(Buffer.from(JSON.stringify(row)), context), /unsupported_format/);
});
test('interrupted partial with no item_completed never becomes a message', async t => {
  const text = await readFile(new URL('partial-interrupted-0.162.0.jsonl', fixtures), 'utf8');
  const rows = text.trimEnd().split('\n').map(JSON.parse).filter(row => !(row.payload?.type === 'item_completed' && row.payload.item?.type === 'AgentMessage'));
  const f = await fixture(t, { text: rows.map(row => JSON.stringify(row)).join('\n') + '\n' }); await run(f);
  assert.deepEqual(contents(f), ['Synthetic question.']);
});
